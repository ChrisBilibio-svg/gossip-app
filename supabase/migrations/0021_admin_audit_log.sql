-- 0021_admin_audit_log.sql — append-only audit trail for admin/curator actions
--
-- Adds a client-private audit table plus a service-role logging function for
-- future admin tooling. This is additive and does not expose audit rows to the
-- mobile client. Service role can still read/write for admin dashboards or jobs.

create table if not exists admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (length(btrim(action)) > 0),
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_events_created_at_idx
  on admin_audit_events (created_at desc);

create index if not exists admin_audit_events_actor_created_at_idx
  on admin_audit_events (actor_id, created_at desc);

create index if not exists admin_audit_events_action_created_at_idx
  on admin_audit_events (action, created_at desc);

alter table admin_audit_events enable row level security;

-- No anon/authenticated policies are created. RLS + revoked privileges keep
-- audit rows private from clients; Supabase service_role bypasses RLS for jobs.
revoke all on admin_audit_events from anon, authenticated;

drop function if exists log_admin_audit_event(text, text, uuid, jsonb);

create or replace function log_admin_audit_event(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_event_id uuid;
begin
  if length(btrim(p_action)) = 0 then
    raise exception 'audit action required';
  end if;

  insert into admin_audit_events (actor_id, action, target_table, target_id, metadata)
  values (auth.uid(), btrim(p_action), nullif(btrim(p_target_table), ''), p_target_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function log_admin_audit_event(text, text, uuid, jsonb) from public;
grant execute on function log_admin_audit_event(text, text, uuid, jsonb) to service_role;
