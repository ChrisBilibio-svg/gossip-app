-- 0028_hybrid_resolution_model.sql — Polymarket-style hybrid resolution
--
-- Supersedes the "mandatory 7-day deadline, CAP-on-timeout for everything" idea.
-- A blanket timer that scores an unconfirmed rumor as CAP is wrong: absence of
-- confirmation is NOT proof of falsehood, and auto-CAP corrupts the skill
-- scoreboard — the one thing the product's trust model depends on.
--
-- Hybrid model (per-rumor, curator-controlled):
--   * resolution_policy = 'evidence' (DEFAULT): resolves TEA/CAP only on credible
--     sources. The prediction_deadline acts as a "resolve-by" window — if it
--     passes with no verdict the rumor is VOIDED (a push): every bet returns,
--     no points awarded, no accuracy hit. This protects scoreboard integrity.
--   * resolution_policy = 'deadline': the question is framed "by date X" (e.g.
--     "confirmed before the BBB finale?"). At the deadline an unconfirmed rumor
--     resolves CAP, because "didn't happen by X" genuinely means No.
-- Curators choose the policy + deadline per rumor, so horizons vary from days to
-- months and a healthy mix of fast and long-running markets is possible.
--
-- Re-runnable.

-- 1. New terminal outcome: a rumor can close with no verdict (a push / void).
--    ADD VALUE IF NOT EXISTS is safe to re-run. NOTE: if your SQL editor wraps
--    everything in a single transaction and complains about using the new value,
--    run this one statement on its own first, then run the rest.
alter type rumor_status add value if not exists 'void';

-- 2. Gentle defaults: evidence-first, with a 7-day resolve-by window so markets
--    still close on a timely cadence — but a timeout becomes a VOID, never a
--    false CAP. Per-rumor overrides remain fully under curator control.
alter table rumors
  alter column resolution_policy set default 'evidence',
  alter column prediction_deadline set default (now() + interval '7 days');

-- Defensive: drop the heavy-handed forcing trigger from the earlier 0028 draft,
-- if it was ever applied. The hybrid model does not force policy on every rumor.
drop trigger if exists rumors_enforce_seven_day_prediction_deadline on rumors;
drop function if exists enforce_seven_day_prediction_deadline();

-- 3. Backfill: give currently-open rumors a resolve-by window if they lack one,
--    WITHOUT flipping their policy to deadline/CAP. Worst case at expiry is a
--    harmless VOID, never a wrongful CAP.
update rumors
set prediction_deadline = coalesce(prediction_deadline, now() + interval '7 days')
where status = 'speculated'
  and coalesce(is_draft, false) = false
  and prediction_deadline is null;

-- 4. VOID a rumor: close it with no verdict. Returns every bet (0 points,
--    is_correct = null) and deliberately does NOT touch profile points or
--    accuracy — the call simply did not resolve. Idempotent (only un-terminal
--    rumors and unscored predictions are affected).
create or replace function void_rumor(p_rumor_id uuid, p_reason text default 'voided_no_verdict')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rumor rumors;
begin
  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then
    raise exception 'rumor not found';
  end if;

  -- Already terminal (confirmed / debunked / void)? Nothing to do.
  if v_rumor.status <> 'speculated' then
    return;
  end if;

  -- Enum write goes through EXECUTE so this function can be created in the same
  -- migration/transaction that just added the 'void' label.
  execute $q$
    update rumors set
      status            = 'void'::rumor_status,
      resolved_outcome  = null,
      resolved_at       = coalesce(resolved_at, now()),
      resolution_reason = $1
    where id = $2
  $q$ using p_reason, p_rumor_id;

  -- Mark unscored predictions processed-with-no-verdict: zero points, null
  -- verdict, NO change to profiles (no points, no accuracy denominator).
  update predictions set
    is_correct     = null,
    points_awarded = 0,
    scored_at      = now()
  where rumor_id = p_rumor_id
    and scored_at is null;
end;
$$;

revoke all on function void_rumor(uuid, text) from public;
grant execute on function void_rumor(uuid, text) to service_role;

-- 5. Deadline sweeper now branches by policy:
--    'deadline' -> CAP (resolve_rumor(..., false));  anything else -> VOID.
create or replace function resolve_expired_prediction_deadlines(p_limit integer default 25)
returns table (rumor_id uuid, summary text, prediction_deadline timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r rumors;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 250);
begin
  for r in
    select rr.*
    from rumors as rr
    where rr.status = 'speculated'
      and rr.prediction_deadline is not null
      and rr.prediction_deadline <= now()
      and coalesce(rr.is_draft, false) = false
    order by rr.prediction_deadline asc
    limit v_limit
    for update skip locked
  loop
    if r.resolution_policy = 'deadline' then
      -- "By date X" question: unconfirmed at the deadline genuinely means No.
      perform resolve_rumor(r.id, false);
      update rumors set resolution_reason = 'deadline_expired_resolved_cap' where id = r.id;
      insert into audit_log (actor_id, action, rumor_id, detail)
      values (
        null,
        'deadline_expired_cap',
        r.id,
        jsonb_build_object(
          'reason', 'deadline_expired_resolved_cap',
          'prediction_deadline', r.prediction_deadline
        )
      );
    else
      -- Evidence market: no verdict by the resolve-by window -> push / VOID.
      perform void_rumor(r.id, 'resolve_by_window_closed_no_verdict');
      insert into audit_log (actor_id, action, rumor_id, detail)
      values (
        null,
        'deadline_expired_void',
        r.id,
        jsonb_build_object(
          'reason', 'resolve_by_window_closed_no_verdict',
          'prediction_deadline', r.prediction_deadline
        )
      );
    end if;

    rumor_id := r.id;
    summary := r.summary;
    prediction_deadline := r.prediction_deadline;
    return next;
  end loop;
end;
$$;

revoke all on function resolve_expired_prediction_deadlines(integer) from public;
grant execute on function resolve_expired_prediction_deadlines(integer) to service_role;

-- 6. Index the sweeper's scan: any open, non-draft rumor with a resolve-by date.
drop index if exists rumors_deadline_open_idx;
create index if not exists rumors_resolve_by_open_idx
  on rumors (prediction_deadline asc)
  where status = 'speculated' and prediction_deadline is not null and coalesce(is_draft, false) = false;
