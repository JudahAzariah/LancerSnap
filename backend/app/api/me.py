from fastapi import APIRouter
from pydantic import BaseModel

from app.authz import CurrentProfile, Role

router = APIRouter(tags=["account"])


class Me(BaseModel):
    id: str
    email: str | None
    role: Role
    team_ids: list[str]


@router.get("/me")
def read_me(profile: CurrentProfile) -> Me:
    """Return the authenticated caller's identity, role, and team scope."""
    return Me(
        id=str(profile.id),
        email=profile.email,
        role=profile.role,
        team_ids=sorted(str(team_id) for team_id in profile.team_ids),
    )
