"""Authorization: roles and record-level access rules (LS-04, RC-01).

Authentication (`app.auth`) says who the caller is. This module says what
they may do:

* students may access only their own reports;
* staff may access only reports assigned to a team they belong to;
* administrative functions require the administrator role.

These checks run on the backend for every protected operation. Hiding a
screen or control in the mobile app is never sufficient.
"""

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status

from app.auth import CurrentUser
from app.db import Db


class Role(StrEnum):
    STUDENT = "student"
    STAFF = "staff"
    ADMINISTRATOR = "administrator"


@dataclass(frozen=True)
class Profile:
    """The authenticated caller with their application role and team scope."""

    id: UUID
    email: str | None
    role: Role
    # Teams whose report queues this user may work. Always empty unless the
    # user is currently staff, even if stale membership rows exist.
    team_ids: frozenset[UUID]

    @property
    def is_admin(self) -> bool:
        return self.role is Role.ADMINISTRATOR

    @property
    def is_staff(self) -> bool:
        return self.role is Role.STAFF


def _forbidden() -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")


def get_current_profile(user: CurrentUser, db: Db) -> Profile:
    """FastAPI dependency: the caller's role and team scope, read from the database.

    The role is looked up on every request rather than trusted from the token,
    so a role change takes effect immediately.
    """
    try:
        user_id = UUID(user.id)
    except ValueError:
        raise _forbidden() from None

    row = db.execute(
        """
        select p.role::text as role,
               coalesce(
                 array_agg(tm.team_id) filter (where tm.team_id is not null),
                 '{}'
               ) as team_ids
        from public.profiles p
        left join public.team_members tm on tm.user_id = p.id
        where p.id = %s
        group by p.id
        """,
        (user_id,),
    ).fetchone()
    if row is None:
        # Authenticated with Supabase but unknown to LancerSnap.
        raise _forbidden()

    role = Role(row["role"])
    team_ids = frozenset(row["team_ids"]) if role is Role.STAFF else frozenset()
    return Profile(id=user_id, email=user.email, role=role, team_ids=team_ids)


CurrentProfile = Annotated[Profile, Depends(get_current_profile)]


def require_roles(*allowed: Role) -> Callable[[Profile], Profile]:
    """Dependency factory: allow only callers with one of the given roles."""

    def dependency(profile: CurrentProfile) -> Profile:
        if profile.role not in allowed:
            raise _forbidden()
        return profile

    return dependency


AdminProfile = Annotated[Profile, Depends(require_roles(Role.ADMINISTRATOR))]
StaffProfile = Annotated[Profile, Depends(require_roles(Role.STAFF, Role.ADMINISTRATOR))]


# --- Record-level rules -----------------------------------------------------
# Pure functions so every endpoint applies the same rule and it can be tested
# directly.


def can_manage_report(profile: Profile, *, assigned_team_id: UUID | None) -> bool:
    """Staff handling scope: administrators, or staff on the report's team."""
    if profile.is_admin:
        return True
    return (
        profile.is_staff and assigned_team_id is not None and assigned_team_id in profile.team_ids
    )


def can_view_report(profile: Profile, *, submitter_id: UUID, assigned_team_id: UUID | None) -> bool:
    """Read scope: the report's submitter, or anyone who can manage it."""
    if submitter_id == profile.id:
        return True
    return can_manage_report(profile, assigned_team_id=assigned_team_id)
