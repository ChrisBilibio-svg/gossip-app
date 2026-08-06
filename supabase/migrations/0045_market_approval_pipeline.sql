-- 0045_market_approval_pipeline.sql
-- Phase 2: human approval + scheduling + atomic publication for fresh markets.
-- Additive only. Transactional: if any statement fails the whole migration rolls back.
--
-- Also backfills the previously-unversioned public.log_product_event so a clean
-- replay of 0000..0045 produces a working place_fixed_prediction (0044 calls it).

-- ---------------------------------------------------------------------------
-- 1. Backfill log_product_event — EXACT current live definition (idempotent).
--    Semantic no-op against the live DB; makes fresh replays complete.
-- ---------------------------------------------------------------------------
create or replace function public.log_product_event(p_user_id uuid, p_event_name text, p_properties jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
  begin
    perform log_economy_analytics(p_user_id, p_event_name, coalesce(p_properties, '{}'::jsonb), 'app');
  end;
$function$;

revoke all on function public.log_product_event(uuid, text, jsonb) from public;
grant execute on function public.log_product_event(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Lifecycle + scheduling columns on rumors (additive).
-- ---------------------------------------------------------------------------
alter table rumors add column if not exists market_state text;
alter table rumors add column if not exists scheduled_publish_at timestamptz;
alter table rumors add column if not exists approved_true_probability numeric;
alter table rumors add column if not exists approved_false_probability numeric;

-- Backfill existing rows to a coherent state before constraining.
update rumors set market_state = case
    when is_draft then 'draft'
    when status = 'speculated' then 'published'
    else market_state
  end
where market_state is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rumors_market_state_check') then
    alter table rumors add constraint rumors_market_state_check
      check (market_state is null or market_state in
        ('draft','needs_review','approved','scheduled','published','rejected','publish_failed'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Immutable, append-only screening/approval audit record.
-- ---------------------------------------------------------------------------
create table if not exists market_approval_audit (
  id uuid primary key default gen_random_uuid(),
  rumor_id uuid not null references rumors(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null check (action in
    ('screen','approve','schedule','request_changes','reject','publish','publish_failed')),
  at timestamptz not null default now(),
  screening_snapshot jsonb,
  decision_fields jsonb,
  approval_reference text,
  idempotency_key text
);

create index if not exists market_approval_audit_rumor_idx on market_approval_audit (rumor_id, at desc);
create unique index if not exists market_approval_audit_idem_idx
  on market_approval_audit (idempotency_key) where idempotency_key is not null;

alter table market_approval_audit enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='market_approval_audit' and policyname='market_approval_audit_curator_read') then
    create policy market_approval_audit_curator_read on market_approval_audit
      for select using (is_curator());
  end if;
end $$;

-- Append-only: block UPDATE/DELETE for everyone (incl. service_role/app paths).
create or replace function market_approval_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'market_approval_audit is append-only';
end;
$$;

drop trigger if exists market_approval_audit_no_change on market_approval_audit;
create trigger market_approval_audit_no_change
  before update or delete on market_approval_audit
  for each row execute function market_approval_audit_immutable();

-- ---------------------------------------------------------------------------
-- 4. Curator review actions (approve / schedule / reject / request_changes).
--    Stores the approved probabilities + scheduled time. NEVER publishes.
-- ---------------------------------------------------------------------------
create or replace function record_market_decision(
  p_rumor_id uuid,
  p_action text,
  p_true_probability numeric default null,
  p_false_probability numeric default null,
  p_scheduled_publish_at timestamptz default null,
  p_decision_fields jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  if not is_curator() then raise exception 'curator authorization required'; end if;
  if p_action not in ('approve','schedule','reject','request_changes') then
    raise exception 'invalid review action %', p_action;
  end if;

  v_state := case p_action
    when 'approve' then 'approved'
    when 'schedule' then 'scheduled'
    when 'reject' then 'rejected'
    when 'request_changes' then 'needs_review'
  end;

  if p_action in ('approve','schedule') then
    if p_true_probability is null or p_false_probability is null then
      raise exception 'approved probabilities required';
    end if;
    if abs((p_true_probability + p_false_probability) - 1.0000) > 0.0001 then
      raise exception 'approved probabilities must sum to 1.0';
    end if;
  end if;
  if p_action = 'schedule' and p_scheduled_publish_at is null then
    raise exception 'scheduled_publish_at required to schedule';
  end if;

  update rumors set
    market_state = v_state,
    approved_true_probability  = coalesce(p_true_probability, approved_true_probability),
    approved_false_probability = coalesce(p_false_probability, approved_false_probability),
    scheduled_publish_at = case when p_action = 'schedule' then p_scheduled_publish_at else scheduled_publish_at end
  where id = p_rumor_id and is_draft = true; -- only unpublished items

  if not found then raise exception 'draft not found or already published'; end if;

  insert into market_approval_audit (rumor_id, actor_id, action, decision_fields)
  values (p_rumor_id, auth.uid(), p_action,
          coalesce(p_decision_fields, jsonb_build_object(
            'true_probability', p_true_probability,
            'false_probability', p_false_probability,
            'scheduled_publish_at', p_scheduled_publish_at)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Atomic publication RPC. Curator (interactive) OR service_role (scheduler).
--    All-or-nothing: rumor goes public only if the fixed probability version +
--    Verdade/Mentira outcomes are created and validated in the same transaction.
-- ---------------------------------------------------------------------------
create or replace function publish_approved_market(
  p_rumor_id uuid,
  p_true_probability numeric,
  p_false_probability numeric,
  p_publish_at timestamptz default now(),
  p_approval_reference text default null,
  p_idempotency_key text default null
)
returns table (
  rumor_id uuid,
  publish_at timestamptz,
  prediction_deadline timestamptz,
  probability_version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_rumor rumors;
  v_publish timestamptz := coalesce(p_publish_at, now());
  v_deadline timestamptz;
  v_version integer;
  v_prev_role text;
  v_existing_rumor uuid;
begin
  -- (1) authorize: interactive curator or the scheduler (service_role).
  if not (is_curator() or v_role = 'service_role') then
    raise exception 'curator or service authorization required';
  end if;

  -- idempotency: replaying the same key returns the prior published result.
  if p_idempotency_key is not null then
    select a.rumor_id into v_existing_rumor from market_approval_audit a
      where a.idempotency_key = p_idempotency_key and a.action = 'publish' limit 1;
    if found then
      return query
        select r.id, r.publish_at, r.prediction_deadline,
               (select max(v.version) from prediction_market_probability_versions v where v.rumor_id = r.id)
        from rumors r where r.id = v_existing_rumor;
      return;
    end if;
  end if;

  -- (2) lock + revalidate the draft.
  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then raise exception 'rumor not found'; end if;
  if v_rumor.resolved_at is not null or v_rumor.status = 'confirmed' then
    raise exception 'rumor already resolved';
  end if;
  if v_rumor.is_draft = false and v_rumor.market_state = 'published' then
    raise exception 'rumor already published';
  end if;

  -- (3) verify the deadline would not already be in the past.
  v_deadline := v_publish + interval '7 days';
  if v_deadline <= now() then raise exception 'publication window already expired'; end if;

  -- next probability version for this rumor.
  select coalesce(max(version), 0) + 1 into v_version
    from prediction_market_probability_versions where rumor_id = p_rumor_id;

  -- (4-8) create canonical version + Verdade/Mentira outcomes + validate sum=1,
  -- reusing the repo's server-side mechanism. It requires the service_role JWT
  -- claim, so elevate locally within this already-authorized definer context.
  v_prev_role := current_setting('request.jwt.claim.role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform service_approve_fixed_market_probabilities(
    p_rumor_id, v_version, p_true_probability, p_false_probability,
    coalesce(p_approval_reference, 'admin_publish'), 'admin_publish', null
  );
  perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);

  -- (9) immutable audit record.
  insert into market_approval_audit (rumor_id, actor_id, action, decision_fields, approval_reference, idempotency_key)
  values (p_rumor_id, auth.uid(), 'publish',
          jsonb_build_object('true_probability', p_true_probability,
                             'false_probability', p_false_probability,
                             'publish_at', v_publish,
                             'prediction_deadline', v_deadline,
                             'probability_version', v_version),
          coalesce(p_approval_reference, 'admin_publish'), p_idempotency_key);

  -- (10) publish — only reached if every step above succeeded.
  update rumors set
    is_draft = false,
    status = 'speculated',
    publish_at = v_publish,
    prediction_deadline = v_deadline,
    market_state = 'published',
    scheduled_publish_at = null
  where id = p_rumor_id;

  return query select p_rumor_id, v_publish, v_deadline, v_version;
end;
$$;

revoke all on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text) from public;
grant execute on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text) to authenticated, service_role;
revoke all on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) from public;
grant execute on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scheduler: publish due scheduled markets using the SAME atomic RPC.
--    Per-item savepoint so one failure marks that item publish_failed without
--    aborting the batch. Intended to be called by a service_role cron.
-- ---------------------------------------------------------------------------
create or replace function publish_due_scheduled_markets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  r record;
  v_published integer := 0;
begin
  if not (v_role = 'service_role' or is_curator()) then
    raise exception 'service authorization required';
  end if;

  for r in
    select id, approved_true_probability as tp, approved_false_probability as fp
    from rumors
    where market_state = 'scheduled' and is_draft = true
      and scheduled_publish_at is not null and scheduled_publish_at <= now()
    order by scheduled_publish_at asc
  loop
    begin
      perform publish_approved_market(r.id, r.tp, r.fp, now(), 'scheduled_publish',
                                      'sched_' || r.id::text);
      v_published := v_published + 1;
    exception when others then
      -- roll back this item only; flag it for the queue.
      update rumors set market_state = 'publish_failed' where id = r.id;
      insert into market_approval_audit (rumor_id, action, decision_fields)
        values (r.id, 'publish_failed', jsonb_build_object('error', sqlerrm));
    end;
  end loop;

  return v_published;
end;
$$;

revoke all on function publish_due_scheduled_markets() from public, anon, authenticated;
grant execute on function publish_due_scheduled_markets() to service_role;
