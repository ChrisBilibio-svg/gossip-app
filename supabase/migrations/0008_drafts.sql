-- 0008_drafts.sql — Draft rumors for the auto-ingest pipeline (curator approves before live)

alter table rumors add column is_draft boolean not null default false;
alter table rumors add column source_label text;   -- where it came from (e.g. "Google News")

-- Drafts must NOT appear in the public feed until approved (is_draft -> false).
drop policy "read published rumors" on rumors;
create policy "read published rumors"
  on rumors for select
  to anon, authenticated
  using (publish_at <= now() and is_draft = false);
