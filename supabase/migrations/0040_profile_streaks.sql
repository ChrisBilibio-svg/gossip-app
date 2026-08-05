-- 0040_profile_streaks.sql — profile prediction streaks
--
-- Adds first-class streak stats beside existing accuracy counters:
-- current_streak = consecutive correct scored predictions as of the latest
--                  non-VOID scored prediction.
-- best_streak    = all-time max consecutive correct scored predictions.
-- VOID/push predictions keep is_correct = null and are intentionally ignored:
-- no points, no correct_count/resolved_count change, and no streak change.
--
-- Re-runnable; Chris applies this manually in Supabase SQL Editor.

alter table profiles
  add column if not exists current_streak integer not null default 0,
  add column if not exists best_streak integer not null default 0;

alter table profiles
  drop constraint if exists profiles_streaks_nonnegative;

alter table profiles
  add constraint profiles_streaks_nonnegative check (
    current_streak >= 0 and best_streak >= 0
  );

-- Shared one-user/all-users recompute used for backfill and safe repair. The
-- ordering mirrors how resolution scoring happens: every scored prediction is
-- considered in chronological resolution order; VOID rows have is_correct null
-- and are skipped so they do not break or extend a streak.
create or replace function recompute_profile_streaks(p_profile_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
  v_prediction record;
  v_current integer;
  v_best integer;
  v_rows integer := 0;
begin
  for v_profile in
    select *
    from profiles
    where p_profile_id is null or id = p_profile_id
    order by id asc
  loop
    v_current := 0;
    v_best := 0;

    for v_prediction in
      select p.is_correct
      from predictions p
      join rumors r on r.id = p.rumor_id
      where p.scored_at is not null
        and p.is_correct is not null
        and p.user_id = v_profile.id
      order by coalesce(r.resolved_at, p.scored_at) asc, p.scored_at asc, p.id asc
    loop
      if v_prediction.is_correct then
        v_current := v_current + 1;
        v_best := greatest(v_best, v_current);
      else
        v_current := 0;
      end if;
    end loop;

    update profiles
    set current_streak = v_current,
        best_streak = v_best
    where id = v_profile.id;

    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end;
$$;

revoke all on function recompute_profile_streaks(uuid) from public;
grant execute on function recompute_profile_streaks(uuid) to service_role;

-- Backfill existing scored history once. Safe to rerun because it recomputes
-- from immutable prediction history instead of incrementing blindly.
select recompute_profile_streaks();

-- Replace scorer with streak maintenance in the same profile update that already
-- maintains total_points, correct_count, and resolved_count. Incorrect resolved
-- predictions reset current_streak; correct resolved predictions increment it
-- and update best_streak. VOID is handled by void_rumor below and never reaches
-- this scorer.
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
  BASE         constant numeric := 100;
  EARLY_BONUS  constant numeric := 0.5;
begin
  if auth.uid() is not null and not is_curator() then
    raise exception 'not a curator';
  end if;

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

  v_life := greatest(extract(epoch from (v_resolved - v_rumor.publish_at)), 1);

  for r in
    select *
    from predictions
    where rumor_id = p_rumor_id
      and scored_at is null
    order by cast_at asc, id asc
  loop
    v_correct := ((r.choice = 'true') = p_outcome);

    if v_correct then
      v_total := greatest(r.crowd_true_at_cast + r.crowd_false_at_cast, 1);
      v_pick_share := (case when r.choice = 'true' then r.crowd_true_at_cast else r.crowd_false_at_cast end)::numeric / v_total;
      v_contrarian := 1 + (1 - v_pick_share);
      v_early := 1 + EARLY_BONUS * greatest(least(extract(epoch from (v_resolved - r.cast_at)) / v_life, 1), 0);
      v_points := round(BASE * v_contrarian * v_early);
    else
      v_points := 0;
    end if;

    update predictions
    set is_correct = v_correct,
        points_awarded = v_points,
        scored_at = now()
    where id = r.id;

    update profiles set
      total_points = total_points + v_points,
      correct_count = correct_count + (case when v_correct then 1 else 0 end),
      resolved_count = resolved_count + 1,
      current_streak = case when v_correct then current_streak + 1 else 0 end,
      best_streak = greatest(best_streak, case when v_correct then current_streak + 1 else 0 end)
    where id = r.user_id;
  end loop;
end;
$$;

revoke all on function resolve_rumor(uuid, boolean) from public;
grant execute on function resolve_rumor(uuid, boolean) to authenticated;

-- Re-state void_rumor for the streak contract: voids are pushes. They mark
-- predictions processed with a null verdict, but deliberately do not update
-- profiles, so points, accuracy counters, and streaks are unchanged.
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

  if v_rumor.status <> 'speculated' then
    return;
  end if;

  execute $q$
    update rumors set
      status            = 'void'::rumor_status,
      resolved_outcome  = null,
      resolved_at       = coalesce(resolved_at, now()),
      resolution_reason = $1
    where id = $2
  $q$ using p_reason, p_rumor_id;

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

drop function if exists get_leaderboard(integer);

create or replace function get_leaderboard(p_limit integer default 100)
returns table (
  id uuid,
  handle text,
  avatar text,
  total_points integer,
  correct_count integer,
  resolved_count integer,
  rank integer,
  previous_rank integer,
  rank_delta integer,
  current_streak integer
)
language sql
security definer
set search_path = public
stable
as $$
  with current_ranks as (
    select
      p.id,
      p.handle,
      p.avatar,
      p.total_points,
      p.correct_count,
      p.resolved_count,
      p.current_streak,
      row_number() over (
        order by p.total_points desc, p.correct_count desc, p.resolved_count desc, p.created_at asc, p.id asc
      )::integer as rank
    from profiles p
  ), latest_snapshot as (
    select max(snapshot_date) as snapshot_date
    from leaderboard_rank_snapshots
    where snapshot_date < current_date
  ), previous_ranks as (
    select s.profile_id, s.rank
    from leaderboard_rank_snapshots s
    join latest_snapshot ls on ls.snapshot_date = s.snapshot_date
  )
  select
    cr.id,
    cr.handle,
    cr.avatar,
    cr.total_points,
    cr.correct_count,
    cr.resolved_count,
    cr.rank,
    pr.rank as previous_rank,
    case when pr.rank is null then null else pr.rank - cr.rank end as rank_delta,
    cr.current_streak
  from current_ranks cr
  left join previous_ranks pr on pr.profile_id = cr.id
  order by cr.rank asc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
$$;

revoke all on function get_leaderboard(integer) from public;
grant execute on function get_leaderboard(integer) to anon, authenticated;
