-- 0046_fix_publish_rpc.sql
-- Corrective, additive migration for two defects found while verifying 0045:
--   1. publish_approved_market RETURNS TABLE columns (rumor_id, publish_at, ...)
--      collided with table columns referenced inside the body, raising
--      'column reference "rumor_id" is ambiguous' before any real work. Rename
--      the OUT columns with an out_ prefix so all internal column refs are
--      unambiguous.
--   2. Supabase default privileges granted EXECUTE on the new SECURITY DEFINER
--      RPCs to the anon role at creation. The runtime guard already rejects
--      anon, but revoke the grant too (defense in depth).

-- Renaming the RETURNS TABLE columns changes the return type, which
-- CREATE OR REPLACE cannot do, so drop first. The function is new in 0045 with
-- no dependents (publish_due_scheduled_markets calls it dynamically), so this is
-- a safe recreate, not a destructive change to established schema.
drop function if exists publish_approved_market(uuid, numeric, numeric, timestamptz, text, text);

create function publish_approved_market(
  p_rumor_id uuid,
  p_true_probability numeric,
  p_false_probability numeric,
  p_publish_at timestamptz default now(),
  p_approval_reference text default null,
  p_idempotency_key text default null
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
  select * into v_rumor from rumors r where r.id = p_rumor_id for update;
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
  select coalesce(max(v.version), 0) + 1 into v_version
    from prediction_market_probability_versions v where v.rumor_id = p_rumor_id;

  -- (4-8) canonical version + Verdade/Mentira outcomes + validate sum=1, reusing
  -- the repo mechanism. It requires the service_role JWT claim, so elevate
  -- locally within this already-authorized definer context.
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

-- Lock down execution: curators (authenticated, gated in-body) + scheduler only.
revoke all on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text) from public, anon;
grant execute on function publish_approved_market(uuid, numeric, numeric, timestamptz, text, text) to authenticated, service_role;

revoke all on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) from public, anon;
grant execute on function record_market_decision(uuid, text, numeric, numeric, timestamptz, jsonb) to authenticated;
