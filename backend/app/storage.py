"""Protected report-media storage (LS-08, RC-09).

Report photographs live in a private Supabase Storage bucket that clients
cannot access directly. The backend decides who may upload or view a file and
then issues a short-lived signed URL for exactly one object. The Supabase
secret key used to create those URLs never leaves the server.
"""

from dataclasses import dataclass
from typing import Annotated, Protocol
from urllib.parse import quote

import httpx
from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings

# Accepted photo types and the extension used for the stored object.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # Keep in sync with the bucket's file_size_limit.


class StorageError(Exception):
    """The storage service failed or refused the request."""


@dataclass(frozen=True)
class SignedUpload:
    url: str
    token: str


@dataclass(frozen=True)
class StoredObject:
    """What storage actually holds for an object (not what the client declared)."""

    size_bytes: int
    content_type: str


class MediaStorage(Protocol):
    def create_signed_upload(self, object_path: str) -> SignedUpload: ...

    def create_signed_download_url(self, object_path: str, expires_in: int) -> str: ...

    def get_object(self, object_path: str) -> StoredObject | None:
        """The stored object's real size and type, or None if nothing was uploaded."""
        ...


class SupabaseStorage:
    """Supabase Storage REST client for one private bucket."""

    def __init__(self, *, supabase_url: str, secret_key: str, bucket: str) -> None:
        self._base = f"{supabase_url.rstrip('/')}/storage/v1"
        self._bucket = bucket
        self._headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}

    def _post(self, path: str, body: dict[str, object] | None = None) -> dict[str, object]:
        try:
            response = httpx.post(
                f"{self._base}{path}", headers=self._headers, json=body or {}, timeout=10
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            # Keep the cause for server logs; callers show a generic message.
            raise StorageError(type(error).__name__) from error
        if not isinstance(data, dict):
            raise StorageError("Unexpected storage response")
        return data

    def _object(self, object_path: str) -> str:
        return f"{self._bucket}/{quote(object_path, safe='/')}"

    def create_signed_upload(self, object_path: str) -> SignedUpload:
        data = self._post(f"/object/upload/sign/{self._object(object_path)}")
        relative, token = data.get("url"), data.get("token")
        if not isinstance(relative, str) or not relative:
            raise StorageError("Storage did not return an upload URL")
        if not isinstance(token, str) or not token:
            # Older responses carry the token only inside the URL.
            token = httpx.URL(relative).params.get("token", "")
        if not token:
            raise StorageError("Storage did not return an upload token")
        return SignedUpload(url=f"{self._base}{relative}", token=token)

    def create_signed_download_url(self, object_path: str, expires_in: int) -> str:
        data = self._post(f"/object/sign/{self._object(object_path)}", {"expiresIn": expires_in})
        relative = data.get("signedURL") or data.get("signedUrl")
        if not isinstance(relative, str) or not relative:
            raise StorageError("Storage did not return a download URL")
        return f"{self._base}{relative}"

    def get_object(self, object_path: str) -> StoredObject | None:
        try:
            response = httpx.get(
                f"{self._base}/object/info/{self._object(object_path)}",
                headers=self._headers,
                timeout=10,
            )
        except httpx.HTTPError as error:
            raise StorageError(type(error).__name__) from error
        if response.status_code != 200:
            if _is_not_found(response):
                return None
            raise StorageError(f"Storage returned {response.status_code}")
        try:
            data = response.json()
            size = int(data["size"])
            content_type = str(data["content_type"])
        except (ValueError, KeyError, TypeError) as error:
            raise StorageError("Unexpected storage response") from error
        return StoredObject(size_bytes=size, content_type=content_type.lower())


def _is_not_found(response: httpx.Response) -> bool:
    """Supabase Storage reports a missing object as HTTP 400 with a not-found body."""
    if response.status_code == 404:
        return True
    try:
        data = response.json()
    except ValueError:
        return False
    return isinstance(data, dict) and (
        data.get("code") == "NoSuchKey"
        or str(data.get("statusCode")) == "404"
        or data.get("error") == "not_found"
    )


def get_storage(settings: Annotated[Settings, Depends(get_settings)]) -> MediaStorage:
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Photo storage is not configured",
        )
    return SupabaseStorage(
        supabase_url=settings.supabase_url,
        secret_key=settings.supabase_secret_key,
        bucket=settings.report_media_bucket,
    )


Storage = Annotated[MediaStorage, Depends(get_storage)]
