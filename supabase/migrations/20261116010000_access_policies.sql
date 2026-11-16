-- LancerSnap role-based access policies (LS-04, RC-01)
--
-- The FastAPI backend is the authoritative authorization boundary and is the
-- only writer. These row-level security policies are a second layer for
-- anything that reaches Supabase directly with a user's token:
--
--   * students read only their own reports,
--   * staff read only reports assigned to a team they belong to,
--   * administrators read everything,
--   * nobody writes through the public API.

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
-- Kept in a non-exposed schema so they are not callable as public API
-- endpoints. SECURITY DEFINER lets a policy look up the caller's role and
-- team membership without those tables' own policies getting in the way.

create schema private;

create function private.user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() = 'administrator', false);
$$;

-- True when the caller is currently staff AND a member of the team. A user
-- whose staff role was removed loses access even if a membership row remains.
create function private.is_staff_member_of(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() = 'staff', false)
    and exists (
      select 1 from public.team_members
      where team_id = team and user_id = (select auth.uid())
    );
$$;

-- Staff-or-admin handling scope for a report.
create function private.can_manage_report(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or exists (
      select 1 from public.reports r
      where r.id = target
        and r.assigned_team_id is not null
        and private.is_staff_member_of(r.assigned_team_id)
    );
$$;

-- Read scope for a report: its submitter, or anyone who can manage it.
create function private.can_view_report(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.reports r
      where r.id = target and r.submitter_id = (select auth.uid())
    )
    or private.can_manage_report(target);
$$;

revoke all on schema private from public;
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: the public API is read-only, and only for signed-in users
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read policies (signed-in users only; no write policies exist)
-- ---------------------------------------------------------------------------

create policy "Own profile, or any profile for administrators"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());

create policy "Own teams for staff, all teams for administrators"
  on public.teams for select to authenticated
  using (private.is_admin() or private.is_staff_member_of(id));

create policy "Own memberships, or all for administrators"
  on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

create policy "Active locations, or all for administrators"
  on public.locations for select to authenticated
  using (is_active or private.is_admin());

create policy "Active categories, or all for administrators"
  on public.categories for select to authenticated
  using (is_active or private.is_admin());

create policy "Routing rules for administrators"
  on public.routing_rules for select to authenticated
  using (private.is_admin());

create policy "Own reports, team reports for staff, all for administrators"
  on public.reports for select to authenticated
  using (
    submitter_id = (select auth.uid())
    or private.is_admin()
    or (assigned_team_id is not null and private.is_staff_member_of(assigned_team_id))
  );

create policy "Media of viewable reports, or own unattached uploads"
  on public.report_media for select to authenticated
  using (
    case
      when report_id is null then uploader_id = (select auth.uid())
      else private.can_view_report(report_id)
    end
  );

create policy "AI analysis of viewable reports"
  on public.ai_analyses for select to authenticated
  using (private.can_view_report(report_id));

create policy "Status history of viewable reports"
  on public.status_history for select to authenticated
  using (private.can_view_report(report_id));

-- Duplicate suggestions are staff information (US-08), not shown to students.
create policy "Duplicate suggestions for staff in scope and administrators"
  on public.duplicate_candidates for select to authenticated
  using (private.can_manage_report(report_id));

create policy "Own notifications, or all for administrators"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) or private.is_admin());
