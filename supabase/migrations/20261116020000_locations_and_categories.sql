-- LancerSnap campus locations and report categories (LS-05)
--
-- Reference data for the reporting flow (US-06, US-13). Both lists are
-- configuration: administrators can add, rename, or deactivate rows through
-- the backend without a schema change or a mobile-app change.
--
-- This migration is about physical campus locations and issue categories
-- only. It does not create teams or routing rules (LS-16, OQ-01).

-- ---------------------------------------------------------------------------
-- Location type
-- ---------------------------------------------------------------------------
-- Free text rather than an enum so new kinds of location can be introduced as
-- data. Stored lower-case with underscores, e.g. 'building', 'outdoor_area'.

alter table public.locations
  add column location_type text not null
  check (location_type ~ '^[a-z][a-z0-9_]*$');

create index locations_type_idx on public.locations (location_type);

-- ---------------------------------------------------------------------------
-- Campus locations (list supplied by the project owner; see OQ-05)
-- ---------------------------------------------------------------------------

insert into public.locations (name, location_type) values
  ('Yeager Center', 'building'),
  ('Annie Gabriel Library', 'building'),
  ('James Building', 'building'),
  ('Wallace Theatre', 'building'),
  ('CBU Events Center', 'building'),
  ('Van Dyne Gymnasium', 'building'),
  ('Recreation Center', 'building'),
  ('Dining Commons', 'building'),
  ('Dennis and Carol Troesh Science Complex', 'building'),
  ('Engineering Building', 'building'),
  ('Business Building', 'building'),
  ('School of Nursing', 'building'),
  ('University Chapel', 'building'),
  ('Campus Store', 'building'),
  ('Lancer Plaza', 'building'),
  ('Residence Halls', 'residential'),
  ('Rose Garden', 'outdoor_area'),
  ('Academic Quad', 'outdoor_area'),
  ('Outdoor / Common Areas', 'outdoor_area'),
  ('Parking Lots', 'parking')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Report categories (candidate set from SDD v0.2 section 2.3)
-- ---------------------------------------------------------------------------
-- Descriptions help staff and the AI classifier tell categories apart. They
-- describe the kind of issue only; they do not name a responsible office.

insert into public.categories (name, description) values
  ('Facilities / maintenance issue',
   'Something in a building or on the grounds that is broken, damaged, leaking, or needs repair or cleaning.'),
  ('Potential safety hazard',
   'A condition that could cause injury or harm, such as a spill, exposed wiring, broken glass, or a blocked exit.'),
  ('Housing / residential issue',
   'A problem in or around student housing.'),
  ('IT / technology problem',
   'A problem with campus technology, such as Wi-Fi, classroom equipment, printers, or kiosks.'),
  ('Dining or campus service-location issue',
   'A problem at a dining or other campus service location.'),
  ('Other supported campus issue',
   'A physical or operational campus issue that does not fit another category.')
on conflict (name) do nothing;
