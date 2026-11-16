-- LancerSnap initial schema (LS-03)
--
-- Implements the conceptual data areas in SDD v0.2 section 5.6:
--   users and roles, reports, report media, locations, categories,
--   routing rules, AI analysis, duplicate candidates, status history,
--   notifications.
--
-- Security note: row-level security is ENABLED on every table here with no
-- policies, so nothing is readable or writable through the public Supabase
-- API until LS-04 adds explicit role-based policies. Deny by default.

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

-- Application roles (SDD section 1.3, RC-01).
create type public.user_role as enum ('student', 'staff', 'administrator');

-- Report status model (SDD section 6.4). Allowed transitions are enforced by
-- the backend workflow service (LS-20), not by this type.
create type public.report_status as enum (
  'submitted',
  'assigned',
  'in_progress',
  'resolved',
  'reopened',
  'closed'
);

-- Advisory priority suggested by AI (RC-07). Never an automated decision.
create type public.priority_level as enum ('low', 'medium', 'high');

create type public.ai_processing_status as enum ('pending', 'succeeded', 'failed');

-- Staff disposition of a duplicate suggestion (RC-06). A suggestion never
-- merges, deletes, or closes a report by itself.
create type public.duplicate_review_state as enum (
  'pending',
  'confirmed_duplicate',
  'not_duplicate'
);

create type public.notification_delivery_state as enum ('pending', 'sent', 'failed');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users, roles, and teams
-- ---------------------------------------------------------------------------

-- One row per authenticated user. Identity lives in Supabase auth.users;
-- this table adds the application role.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'student',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Every new auth user gets a profile with the least-privileged role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Users that already existed before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Operational teams / role-based queues (RC-05, DD-05). Rows are
-- configuration data; actual CBU teams must be validated (OQ-01).
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

-- Which staff belong to which team; defines a staff member's report scope.
create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_id_idx on public.team_members (user_id);

-- ---------------------------------------------------------------------------
-- Reference / configuration data
-- ---------------------------------------------------------------------------

-- Supported campus buildings/locations (US-06). Content is pending
-- confirmation (OQ-05).
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger locations_set_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

-- Administrator-managed report categories (US-13).
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- Administrator-configured routing (US-11, RC-04). A rule sends reports of a
-- category (optionally at one location) to a TEAM, never to an individual.
-- location_id null means "any location".
create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  location_id uuid references public.locations (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  is_active boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger routing_rules_set_updated_at
before update on public.routing_rules
for each row execute function public.set_updated_at();

-- At most one active rule per category + location, and one active
-- category-wide rule, so routing is never ambiguous.
create unique index routing_rules_active_specific_idx
  on public.routing_rules (category_id, location_id)
  where is_active and location_id is not null;

create unique index routing_rules_active_general_idx
  on public.routing_rules (category_id)
  where is_active and location_id is null;

create index routing_rules_team_id_idx on public.routing_rules (team_id);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create sequence public.report_reference_seq;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable identifier shown on the receipt (US-01).
  reference_code text not null unique
    default ('RPT-' || lpad(nextval('public.report_reference_seq')::text, 6, '0')),
  submitter_id uuid not null references public.profiles (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  note text check (note is null or length(note) <= 2000),
  status public.report_status not null default 'submitted',
  -- Category currently used for routing and display. Set from a validated AI
  -- suggestion or by staff; it is staff-confirmed only when
  -- category_confirmed_by is set (US-08).
  category_id uuid references public.categories (id) on delete restrict,
  category_confirmed_by uuid references public.profiles (id) on delete set null,
  category_confirmed_at timestamptz,
  -- Destination queue (team). assigned_to is the staff member who accepted it.
  assigned_team_id uuid references public.teams (id) on delete restrict,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((category_confirmed_by is null) = (category_confirmed_at is null))
);

alter sequence public.report_reference_seq owned by public.reports.reference_code;

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create index reports_submitter_id_idx on public.reports (submitter_id, created_at desc);
create index reports_assigned_team_status_idx on public.reports (assigned_team_id, status);
create index reports_location_category_created_idx
  on public.reports (location_id, category_id, created_at desc);
create index reports_status_idx on public.reports (status);

-- Protected photograph reference (RC-09). The file itself lives in private
-- object storage; this row records where and who uploaded it. report_id is
-- null between upload and report submission.
create table public.report_media (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  bucket text not null,
  object_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create index report_media_report_id_idx on public.report_media (report_id);
create index report_media_uploader_id_idx on public.report_media (uploader_id);

-- ---------------------------------------------------------------------------
-- AI analysis (advisory only: RC-02, RC-03)
-- ---------------------------------------------------------------------------

-- One row per analysis attempt; the most recent row is the current result.
create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  processing_status public.ai_processing_status not null default 'pending',
  suggested_category_id uuid references public.categories (id) on delete set null,
  summary text,
  details jsonb,
  suggested_priority public.priority_level,
  is_potential_safety_hazard boolean,
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  is_uncertain boolean not null default false,
  uncertainty_reason text,
  provider text,
  model text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ai_analyses_report_id_idx on public.ai_analyses (report_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Duplicate candidates (suggestions for staff review: RC-06)
-- ---------------------------------------------------------------------------

create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  candidate_report_id uuid not null references public.reports (id) on delete cascade,
  similarity_signals jsonb not null default '{}'::jsonb,
  review_state public.duplicate_review_state not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (report_id <> candidate_report_id),
  unique (report_id, candidate_report_id)
);

create index duplicate_candidates_candidate_idx
  on public.duplicate_candidates (candidate_report_id);

-- ---------------------------------------------------------------------------
-- Status history (RC-12): the authoritative audit trail of status changes
-- ---------------------------------------------------------------------------

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  from_status public.report_status, -- null for the initial 'submitted' entry
  to_status public.report_status not null,
  actor_id uuid references public.profiles (id) on delete set null, -- null = system
  note text,
  created_at timestamptz not null default now()
);

create index status_history_report_id_idx on public.status_history (report_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications: a delivery side effect, never the system of record
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status_history_id uuid references public.status_history (id) on delete set null,
  event_type text not null,
  channel text not null,
  delivery_state public.notification_delivery_state not null default 'pending',
  failure_reason text,
  attempted_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_report_id_idx on public.notifications (report_id);

-- ---------------------------------------------------------------------------
-- Deny by default: enable row-level security everywhere. Policies come in LS-04.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.routing_rules enable row level security;
alter table public.reports enable row level security;
alter table public.report_media enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.status_history enable row level security;
alter table public.notifications enable row level security;
