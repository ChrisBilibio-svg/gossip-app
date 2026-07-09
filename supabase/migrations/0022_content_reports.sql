-- 0022_content_reports.sql — generic abuse/moderation reports beyond comments
--
-- Existing comment_reports covers comments only. This additive table lets users
-- report rumors, social reposts, and profiles while preserving anonymous-first
-- UX and giving curators a single moderation queue.

create table if not exists content_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('rumor', 'social_repost', 'profile')),
  target_id uuid not null,
  reporter_id uuid not null references auth.users (id) default auth.uid(),
  reason text not null check (char_length(btrim(reason)) between 3 and 80),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

create index if not exists content_reports_queue_idx
  on content_reports (status, created_at desc);

create index if not exists content_reports_target_idx
  on content_reports (target_type, target_id, created_at desc);

create index if not exists content_reports_reporter_idx
  on content_reports (reporter_id, created_at desc);

alter table content_reports enable row level security;

create policy "insert own content report" on content_reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

create policy "read own content reports" on content_reports
  for select to authenticated
  using (reporter_id = auth.uid());

create policy "curator read content reports" on content_reports
  for select to authenticated
  using (is_curator());

create policy "curator update content reports" on content_reports
  for update to authenticated
  using (is_curator())
  with check (is_curator());

drop trigger if exists content_reports_touch_updated_at on content_reports;
create trigger content_reports_touch_updated_at
before update on content_reports
for each row execute function touch_updated_at();
