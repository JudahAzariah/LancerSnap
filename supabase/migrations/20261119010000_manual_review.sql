-- LS-17: manual-review fallback (RC-02, RC-03, RC-10, DD-08, SDD §5.5 step 6).
--
-- * teams.is_manual_review marks the one team that receives reports the AI
--   cannot route. Administrators can move the mark to another team.
-- * reports.review_reason records why a report is in manual review. It is
--   staff-facing only; the backend never shows it to students. It is cleared
--   when the report is routed out of review.
-- * A dedicated example review team is seeded (project-owner decision,
--   2026-11-18). Like the LS-16 examples, it is unverified configuration.

alter table public.teams
  add column is_manual_review boolean not null default false;

-- At most one manual-review team at a time.
create unique index teams_one_manual_review_idx
  on public.teams (is_manual_review)
  where is_manual_review;

alter table public.reports
  add column review_reason text
    check (review_reason in (
      'ai_failed',        -- AI analysis failed
      'ai_unavailable',   -- no AI analysis (turned off or never ran)
      'uncertain',        -- the AI result was uncertain
      'no_category',      -- the AI suggested no category
      'no_matching_rule'  -- no active routing rule for the category
    ));

create index reports_review_reason_idx
  on public.reports (review_reason)
  where review_reason is not null;

insert into public.teams (name, description, is_manual_review)
select 'Manual review (example, unverified)',
       'Receives reports the AI could not route, for a person to review. '
       'Example configuration; who reviews must be confirmed with CBU (OQ-01).',
       not exists (select 1 from public.teams where is_manual_review)
where not exists (
  select 1 from public.teams where name = 'Manual review (example, unverified)'
);
