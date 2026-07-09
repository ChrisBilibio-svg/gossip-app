-- 0004_scoring.sql — resolve_rumor scorer (Stories 3.1, 3.2 / FR10-13)
-- Curator resolves a rumor; every unscored prediction is scored with a
-- skill-weighted model (contrarian × early-bird), points + stats applied to
-- profiles. Idempotent via predictions.scored_at. Curator-only (no grants).

create or replace function resolve_rumor(p_rumor_id uuid, p_outcome boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rumor      rumors;
  v_resolved   timestamptz;
  v_life       numeric;
  r            predictions;
  v_total      numeric;
  v_pick_share numeric;
  v_contrarian numeric;
  v_early      numeric;
  v_correct    boolean;
  v_points     integer;
  BASE         constant numeric := 100;   -- base points for a correct call
  EARLY_BONUS  constant numeric := 0.5;    -- up to +50% for betting early
begin
  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then
    raise exception 'rumor not found';
  end if;

  v_resolved := coalesce(v_rumor.resolved_at, now());

  update rumors set
    status           = (case when p_outcome then 'confirmed' else 'debunked' end)::rumor_status,
    resolved_outcome = p_outcome,
    resolved_at      = v_resolved
  where id = p_rumor_id;

  -- total life of the rumor (seconds), guarded against divide-by-zero
  v_life := greatest(extract(epoch from (v_resolved - v_rumor.publish_at)), 1);

  for r in select * from predictions where rumor_id = p_rumor_id and scored_at is null loop
    v_correct := ((r.choice = 'true') = p_outcome);

    if v_correct then
      -- contrarian: being right when fewer agreed pays more (1x..2x)
      v_total := greatest(r.crowd_true_at_cast + r.crowd_false_at_cast, 1);
      v_pick_share := (case when r.choice = 'true' then r.crowd_true_at_cast else r.crowd_false_at_cast end)::numeric / v_total;
      v_contrarian := 1 + (1 - v_pick_share);

      -- early-bird: betting earlier in the rumor's life pays more (1x..1.5x)
      v_early := 1 + EARLY_BONUS * greatest(least(extract(epoch from (v_resolved - r.cast_at)) / v_life, 1), 0);

      v_points := round(BASE * v_contrarian * v_early);
    else
      v_points := 0;  -- no negative points in v1
    end if;

    update predictions set
      is_correct     = v_correct,
      points_awarded = v_points,
      scored_at      = now()
    where id = r.id;

    update profiles set
      total_points   = total_points + v_points,
      correct_count  = correct_count + (case when v_correct then 1 else 0 end),
      resolved_count = resolved_count + 1
    where id = r.user_id;
  end loop;
end;
$$;

-- Curator-only: regular users must NOT be able to resolve rumors / write points.
revoke all on function resolve_rumor(uuid, boolean) from public;
