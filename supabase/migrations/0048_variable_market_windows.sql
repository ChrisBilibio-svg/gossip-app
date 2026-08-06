-- 0048_variable_market_windows.sql
-- Draft only: Chris applies this manually in Supabase SQL Editor.
--
-- Replaces the hardcoded publish_approved_market +7 day betting window with
-- per-market market framing:
--   - prediction_deadline remains the betting/quote close timestamp.
--   - resolve_by_at is the latest determination timestamp; evidence markets VOID
--     if no credible verdict exists by then.
--   - resolution_criteria stores the written TEA/CAP/VOID rule for display.
--
-- Safety: no data deletion. Existing rows keep working through null-safe fallbacks.

alter table rumors
  add column if not exists resolve_by_at timestamptz,
  add column if not exists resolution_criteria text,
  add column if not exists suggested_timeframe text;

comment on column rumors.prediction_deadline is
  'Betting/quote close timestamp for the market. Before 0048 this was also the evidence resolve-by timestamp.';
comment on column rumors.resolve_by_at is
  'Latest determination timestamp. Evidence markets VOID if no credible verdict lands by this time; null falls back to prediction_deadline.';
comment on column rumors.resolution_criteria is
  'Human-readable market rule: resolves TEA if..., CAP if..., VOID if...';
comment on column rumors.suggested_timeframe is
  'Drafting/curation note explaining the suggested market timeframe.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rumors_resolution_criteria_safe_length') then
    alter table rumors add constraint rumors_resolution_criteria_safe_length
      check (resolution_criteria is null or char_length(resolution_criteria) between 40 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rumors_suggested_timeframe_safe_length') then
    alter table rumors add constraint rumors_suggested_timeframe_safe_length
      check (suggested_timeframe is null or char_length(suggested_timeframe) <= 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rumors_resolve_by_not_before_close') then
    alter table rumors add constraint rumors_resolve_by_not_before_close
      check (resolve_by_at is null or prediction_deadline is null or resolve_by_at >= prediction_deadline);
  end if;
end $$;

-- Existing open markets had a single resolve-by/betting timestamp. Preserve that
-- behavior until each market is reframed with a distinct resolve_by_at.
update rumors
set resolve_by_at = prediction_deadline
where resolve_by_at is null
  and prediction_deadline is not null;

create or replace function clamp_market_betting_close(
  p_publish_at timestamptz,
  p_requested_close_at timestamptz default null
)
returns timestamptz
language sql
stable
as $$
  select case
    when p_requested_close_at is null then p_publish_at + interval '7 days'
    when p_requested_close_at < p_publish_at + interval '6 hours' then p_publish_at + interval '6 hours'
    when p_requested_close_at > p_publish_at + interval '45 days' then p_publish_at + interval '45 days'
    else p_requested_close_at
  end;
$$;

comment on function clamp_market_betting_close(timestamptz, timestamptz) is
  'Clamps market betting close to [publish+6h, publish+45d], with null fallback to publish+7d.';

create or replace function market_resolve_by_for_policy(
  p_resolution_policy text,
  p_betting_closes_at timestamptz
)
returns timestamptz
language sql
stable
as $$
  -- Evidence markets get a determination grace period after betting closes so
  -- late credible confirmation can settle TEA/CAP before VOID. Deadline markets
  -- remain true by-date questions and resolve at the close/deadline itself.
  select case
    when coalesce(p_resolution_policy, 'evidence') = 'deadline' then p_betting_closes_at
    else p_betting_closes_at + interval '24 hours'
  end;
$$;

comment on function market_resolve_by_for_policy(text, timestamptz) is
  'Computes latest determination timestamp from policy + betting close. Evidence default gives 24h grace; deadline policy resolves at close.';

-- Changing the argument list requires dropping the previous 0046 function. The
-- new p_betting_closes_at is LAST and defaulted to preserve old positional calls.
drop function if exists publish_approved_market(uuid, numeric, numeric, timestamptz, text, text);

create function publish_approved_market(
  p_rumor_id uuid,
  p_true_probability numeric,
  p_false_probability numeric,
  p_publish_at timestamptz default now(),
  p_approval_reference text default null,
  p_idempotency_key text default null,
  p_betting_closes_at timestamptz default null
)
returns table (
  out_rumor_id uuid,
  out_publish_at timestamptz,
  out_prediction_deadline timestamptz,
  out_probability_version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user);
  v_rumor rumors;
  v_publish timestamptz := coalesce(p_publish_at, now());
  v_requested_close timestamptz;
  v_deadline timestamptz;
  v_resolve_by timestamptz;
  v_version integer;
  v_prev_role text;
  v_existing_rumor uuid;
begin
  if not (is_curator() or v_role = 'service_role') then
    raise exception 'curator or service authorization required';
  end if;

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

  select * into v_rumor from rumors r where r.id = p_rumor_id for update;
  if not found then raise exception 'rumor not found'; end if;
  if v_rumor.resolved_at is not null or v_rumor.status = 'confirmed' then
    raise exception 'rumor already resolved';
  end if;
  if v_rumor.is_draft = false and v_rumor.market_state = 'published' then
    raise exception 'rumor already published';
  end if;

  -- Prefer the explicit RPC close timestamp, otherwise the draft's stored
  -- per-market close, otherwise the 7-day compatibility default.
  v_requested_close := coalesce(p_betting_closes_at, v_rumor.prediction_deadline);
  v_deadline := clamp_market_betting_close(v_publish, v_requested_close);
  v_resolve_by := coalesce(v_rumor.resolve_by_at, market_resolve_by_for_policy(v_rumor.resolution_policy, v_deadline));

  -- If a stale draft carried a bad resolve_by_at, normalize instead of publishing
  -- an already-expired determination window.
  if v_resolve_by < v_deadline then
    v_resolve_by := market_resolve_by_for_policy(v_rumor.resolution_policy, v_deadline);
  end if;

  if v_deadline <= now() then raise exception 'publication window already expired'; end if;

  select coalesce(max(v.version), 0) + 1 into v_version
    from prediction_market_probability_versions v where v.rumor_id = p_rumor_id;

  v_prev_role := current_setting('request.jwt.claim.role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform service_approve_fixed_market_probabilities(
    p_rumor_id, v_version, p_true_probability, p_false_probability,
    coalesce(p_approval_reference, 'admin_publish'), 'admin_publish', null
  );
  perform set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);

  insert into market_approval_audit (rumor_id, actor_id, action, decision_fields, approval_reference, idempotency_key)
  values (p_rumor_id, auth.uid(), 'publish',
          jsonb_build_object('true_probability', p_true_probability,
                             'false_probability', p_false_probability,
                             'publish_at', v_publish,
                             'prediction_deadline', v_deadline,
                             'resolve_by_at', v_resolve_by,
                             'probability_version', v_version),
          coalesce(p_approval_reference, 'admin_publish'), p_idempotency_key);

  update rumors set
    is_draft = false,
    status = 'speculated',
    publish_at = v_publish,
    prediction_deadline = v_deadline,
    resolve_by_at = v_resolve_by,
    market_state = 'published',
    scheduled_publish_at = null
  where id = p_rumor_id;

  return query select p_rumor_id, v_publish, v_deadline, v_version;
end;
$$;

revoke all on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text, timestamptz) to authenticated, service_role;

-- The resolver now uses resolve_by_at for determination, while old/pre-0048 rows
-- fall back to prediction_deadline.
create or replace function resolve_expired_prediction_deadlines(p_limit integer default 25)
returns table (rumor_id uuid, summary text, prediction_deadline timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_effective_resolve_by timestamptz;
begin
  for r in
    select rr.id, rr.summary, rr.prediction_deadline, rr.resolve_by_at, rr.resolution_policy
    from rumors rr
    where rr.status = 'speculated'
      and coalesce(rr.is_draft, false) = false
      and coalesce(rr.resolve_by_at, rr.prediction_deadline) is not null
      and coalesce(rr.resolve_by_at, rr.prediction_deadline) <= now()
    order by coalesce(rr.resolve_by_at, rr.prediction_deadline) asc
    limit greatest(coalesce(p_limit, 25), 0)
  loop
    v_effective_resolve_by := coalesce(r.resolve_by_at, r.prediction_deadline);
    if r.resolution_policy = 'deadline' then
      update rumors set
        status = 'debunked',
        resolved_at = now(),
        resolution_note = coalesce(resolution_note, 'Deadline reached without confirmation'),
        updated_at = now()
      where id = r.id;
    else
      perform void_rumor(r.id, 'resolve_by_window_closed_no_verdict');
    end if;

    rumor_id := r.id;
    summary := r.summary;
    prediction_deadline := v_effective_resolve_by;
    return next;
  end loop;
end;
$$;

revoke all on function resolve_expired_prediction_deadlines(integer) from public;
grant execute on function resolve_expired_prediction_deadlines(integer) to service_role;

create index if not exists rumors_resolve_by_at_open_idx
  on rumors (resolve_by_at asc)
  where status = 'speculated' and resolve_by_at is not null and coalesce(is_draft, false) = false;
