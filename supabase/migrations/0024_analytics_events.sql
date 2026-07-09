-- 0024_analytics_events.sql — privacy-minimal product telemetry events
--
-- Stores coarse product events for aggregate analysis. Clients may insert events
-- for themselves (or anonymous/null user_id events), but no client SELECT policy
-- exists: analytics rows are service/admin-only for reads.

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  session_id text check (session_id is null or char_length(session_id) between 8 and 128),
  event_name text not null check (event_name ~ '^[a-z0-9_.]{3,80}$'),
  source text not null default 'app' check (source in ('app', 'admin', 'bot', 'system')),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create index if not exists analytics_events_occurred_idx
  on analytics_events (occurred_at desc);

create index if not exists analytics_events_name_occurred_idx
  on analytics_events (event_name, occurred_at desc);

create index if not exists analytics_events_user_occurred_idx
  on analytics_events (user_id, occurred_at desc)
  where user_id is not null;

alter table analytics_events enable row level security;

revoke all on analytics_events from anon, authenticated;
grant insert on analytics_events to anon, authenticated;

create policy "insert own analytics events" on analytics_events
  for insert to anon, authenticated
  with check (
    user_id is null
    or user_id = auth.uid()
  );
