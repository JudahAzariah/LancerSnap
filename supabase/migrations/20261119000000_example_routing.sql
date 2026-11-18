-- LS-16: example teams and routing rules (US-11, RC-04, RC-05, OQ-01).
--
-- UNVERIFIED EXAMPLE CONFIGURATION. These teams are the routing candidates
-- named in SDD v0.2 section 1.3, not confirmed CBU ownership. Which CBU team
-- handles which category is an open decision (OQ-01, RISK-09) that CBU must
-- validate. Every name and description below says so, and administrators can
-- rename, deactivate, or replace all of it through the backend (/admin/teams,
-- /admin/routing-rules) without any code or app change.
--
-- Categories with no obvious example team ("Potential safety hazard",
-- "Other supported campus issue") deliberately get no rule: those reports go
-- to manual review (LS-17) rather than to a guessed team.
--
-- Safe to re-run: existing teams and rules are left as they are.

insert into public.teams (name, description) values
  ('Housing / Residential Assistants (example, unverified)',
   'Example team from SDD section 1.3. Not confirmed CBU ownership; validate with CBU (OQ-01).'),
  ('Facilities (example, unverified)',
   'Example team from SDD section 1.3. Not confirmed CBU ownership; validate with CBU (OQ-01).'),
  ('Dining (example, unverified)',
   'Example team from SDD section 1.3. Not confirmed CBU ownership; validate with CBU (OQ-01).'),
  ('Building Administration (example, unverified)',
   'Example team from SDD section 1.3. Not confirmed CBU ownership; validate with CBU (OQ-01).'),
  ('IT / Technology Support (example, unverified)',
   'Example team from SDD section 1.3. Not confirmed CBU ownership; validate with CBU (OQ-01).')
on conflict (name) do nothing;

-- Example category-wide rules (no location), only for categories that exist
-- and have no active category-wide rule yet.
insert into public.routing_rules (category_id, team_id)
select c.id, t.id
from (values
  ('Facilities / maintenance issue', 'Facilities (example, unverified)'),
  ('Housing / residential issue', 'Housing / Residential Assistants (example, unverified)'),
  ('Dining or campus service-location issue', 'Dining (example, unverified)'),
  ('IT / technology problem', 'IT / Technology Support (example, unverified)')
) as example (category_name, team_name)
join public.categories c on c.name = example.category_name
join public.teams t on t.name = example.team_name
where not exists (
  select 1 from public.routing_rules r
  where r.category_id = c.id and r.location_id is null and r.is_active
);
