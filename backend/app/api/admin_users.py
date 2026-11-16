"""Administrator-only management of user roles and team membership (LS-04).

SDD v0.2 section 2.2: administrators "manage authorized users and role
assignments within the approved access model". Accounts themselves are
created in Supabase; this API only assigns LancerSnap roles and team scope.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel

from app.authz import AdminProfile, Role
from app.db import Connection, Db

router = APIRouter(prefix="/admin/users", tags=["administration"])


class UserSummary(BaseModel):
    id: UUID
    email: str | None
    role: Role
    team_ids: list[UUID]


class RoleUpdate(BaseModel):
    role: Role


_USER_QUERY = """
    select p.id,
           u.email,
           p.role::text as role,
           coalesce(
             array_agg(tm.team_id order by tm.team_id) filter (where tm.team_id is not null),
             '{}'
           ) as team_ids
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.team_members tm on tm.user_id = p.id
"""


def _load_user(db: Connection, user_id: UUID) -> UserSummary:
    row = db.execute(_USER_QUERY + " where p.id = %s group by p.id, u.email", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserSummary(**row)


@router.get("")
def list_users(admin: AdminProfile, db: Db) -> list[UserSummary]:
    rows = db.execute(_USER_QUERY + " group by p.id, u.email order by u.email, p.id").fetchall()
    return [UserSummary(**row) for row in rows]


@router.patch("/{user_id}")
def set_user_role(user_id: UUID, body: RoleUpdate, admin: AdminProfile, db: Db) -> UserSummary:
    if user_id == admin.id:
        # Prevents an administrator from locking the system out of its last admin
        # by accident; another administrator must make the change.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Administrators cannot change their own role",
        )
    _load_user(db, user_id)
    db.execute("update public.profiles set role = %s where id = %s", (body.role.value, user_id))
    if body.role is not Role.STAFF:
        # Team membership only has meaning for staff; do not leave stale scope behind.
        db.execute("delete from public.team_members where user_id = %s", (user_id,))
    return _load_user(db, user_id)


def _require_team(db: Connection, team_id: UUID) -> None:
    if db.execute("select 1 from public.teams where id = %s", (team_id,)).fetchone() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")


@router.put("/{user_id}/teams/{team_id}")
def add_team_membership(user_id: UUID, team_id: UUID, admin: AdminProfile, db: Db) -> UserSummary:
    user = _load_user(db, user_id)
    _require_team(db, team_id)
    if user.role is not Role.STAFF:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only staff can be added to a team",
        )
    db.execute(
        """
        insert into public.team_members (team_id, user_id) values (%s, %s)
        on conflict (team_id, user_id) do nothing
        """,
        (team_id, user_id),
    )
    return _load_user(db, user_id)


@router.delete("/{user_id}/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_membership(user_id: UUID, team_id: UUID, admin: AdminProfile, db: Db) -> Response:
    _load_user(db, user_id)
    _require_team(db, team_id)
    db.execute(
        "delete from public.team_members where team_id = %s and user_id = %s",
        (team_id, user_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
