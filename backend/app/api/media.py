"""Report photo upload and viewing (LS-08; RC-01, RC-09, RC-10).

Upload is two steps so large files never pass through this API:

1. `POST /media/uploads` — the student declares the file type and size. The
   backend validates them, records the pending upload, and returns a signed
   URL that accepts exactly one object at a path the backend chose.
2. The client sends the file straight to storage using that URL.

Viewing: `GET /media/{id}/url` returns a short-lived signed URL only to a
caller who may see the report the photo belongs to.
"""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.authz import CurrentProfile, Profile, Role, can_view_report, require_roles
from app.config import Settings, get_settings
from app.db import Db
from app.storage import ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES, Storage, StorageError

router = APIRouter(prefix="/media", tags=["report media"])

# Reports are submitted by students (US-01), so only students start uploads.
StudentProfile = Annotated[Profile, Depends(require_roles(Role.STUDENT))]


class UploadRequest(BaseModel):
    content_type: str
    size_bytes: int = Field(gt=0)


class UploadTicket(BaseModel):
    media_id: UUID
    bucket: str
    object_path: str
    upload_url: str
    upload_token: str
    max_bytes: int


class MediaUrl(BaseModel):
    url: str
    expires_in: int


def _storage_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Photo storage is unavailable. Please try again.",
    )


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
def start_upload(
    body: UploadRequest,
    profile: StudentProfile,
    db: Db,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UploadTicket:
    content_type = body.content_type.strip().lower()
    extension = ALLOWED_CONTENT_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported photo type. Use a JPEG, PNG, WebP, or HEIC image.",
        )
    if body.size_bytes > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Photo is too large. The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    # The backend chooses the path: one folder per uploader, an unguessable name.
    object_path = f"{profile.id}/{uuid4()}.{extension}"
    try:
        signed = storage.create_signed_upload(object_path)
    except StorageError:
        # Nothing was recorded; the client is told the truth and can retry.
        raise _storage_unavailable() from None

    row = db.execute(
        """
        insert into public.report_media (uploader_id, bucket, object_path, content_type, size_bytes)
        values (%s, %s, %s, %s, %s)
        returning id
        """,
        (profile.id, settings.report_media_bucket, object_path, content_type, body.size_bytes),
    ).fetchone()
    assert row is not None
    return UploadTicket(
        media_id=row["id"],
        bucket=settings.report_media_bucket,
        object_path=object_path,
        upload_url=signed.url,
        upload_token=signed.token,
        max_bytes=MAX_UPLOAD_BYTES,
    )


@router.get("/{media_id}/url")
def get_media_url(
    media_id: UUID,
    profile: CurrentProfile,
    db: Db,
    storage: Storage,
    settings: Annotated[Settings, Depends(get_settings)],
) -> MediaUrl:
    row = db.execute(
        """
        select m.object_path, m.uploader_id, m.report_id, r.submitter_id, r.assigned_team_id
        from public.report_media m
        left join public.reports r on r.id = m.report_id
        where m.id = %s
        """,
        (media_id,),
    ).fetchone()

    if row is None:
        allowed = False
    elif row["report_id"] is None:
        # Not attached to a report yet: only the uploader may see it.
        allowed = row["uploader_id"] == profile.id
    else:
        allowed = can_view_report(
            profile, submitter_id=row["submitter_id"], assigned_team_id=row["assigned_team_id"]
        )
    if not allowed:
        # Same answer whether the photo is missing or off-limits, so the
        # endpoint cannot be used to discover which photos exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")

    assert row is not None
    expires_in = settings.media_download_url_seconds
    try:
        url = storage.create_signed_download_url(row["object_path"], expires_in)
    except StorageError:
        raise _storage_unavailable() from None
    return MediaUrl(url=url, expires_in=expires_in)
