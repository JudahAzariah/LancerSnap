from fastapi import APIRouter

from app.auth import CurrentUser

router = APIRouter(tags=["account"])


@router.get("/me")
def read_me(user: CurrentUser) -> dict[str, str | None]:
    """Return the authenticated caller's identity."""
    return {"id": user.id, "email": user.email}
