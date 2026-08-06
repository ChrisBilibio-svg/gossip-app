-- 0042_state_leaderboards.sql — Coarse profile location + state/world O Profeta leaderboards
--
-- Privacy-minimal location support: stores only country/state codes on profiles,
-- never precise coordinates. Chris applies this manually in Supabase SQL Editor.

alter table profiles
  add column if not exists country_code text,
  add column if not exists state_code text;

alter table profiles
  drop constraint if exists profiles_country_code_format;

alter table profiles
  add constraint profiles_country_code_format check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  );

alter table profiles
  drop constraint if exists profiles_state_code_format;

alter table profiles
  add constraint profiles_state_code_format check (
    state_code is null or state_code ~ '^[A-Z0-9]{2,6}$'
  );

create index if not exists profiles_state_leaderboard_idx
  on profiles (country_code, state_code, total_points desc, correct_count desc, resolved_count desc)
  where state_code is not null;

create or replace function set_profile_location(p_country_code text, p_state_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country_code text := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  v_state_code text := nullif(upper(btrim(coalesce(p_state_code, ''))), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if v_country_code is not null and v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country_code';
  end if;

  if v_state_code is not null and v_state_code !~ '^[A-Z0-9]{2,6}$' then
    raise exception 'invalid_state_code';
  end if;

  update profiles
  set
    country_code = v_country_code,
    state_code = v_state_code
  where id = auth.uid();
end;
$$;

revoke all on function set_profile_location(text, text) from public;
grant execute on function set_profile_location(text, text) to authenticated;

drop function if exists get_leaderboard(integer);
drop function if exists get_leaderboard(integer, text, text);

create or replace function get_leaderboard(
  p_limit integer default 100,
  p_scope text default 'world',
  p_state_code text default null
)
returns table (
  id uuid,
  handle text,
  avatar text,
  state_code text,
  total_points integer,
  correct_count integer,
  resolved_count integer,
  rank integer,
  previous_rank integer,
  rank_delta integer,
  current_streak integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, 'world')));
  v_state_code text := upper(btrim(coalesce(
    p_state_code,
    (select profiles.state_code from profiles where profiles.id = auth.uid()),
    ''
  )));
begin
  if v_scope not in ('world', 'state') then
    v_scope := 'world';
  end if;

  if v_scope = 'state' and nullif(v_state_code, '') is null then
    v_scope := 'world';
  end if;

  return query
  with current_ranks as (
    select
      p.id,
      p.handle,
      p.avatar,
      p.state_code,
      p.total_points,
      p.correct_count,
      p.resolved_count,
      p.current_streak,
      row_number() over (
        order by p.total_points desc, p.correct_count desc, p.resolved_count desc, p.created_at asc, p.id asc
      )::integer as rank
    from profiles p
    where v_scope = 'world'
      or (
        v_scope = 'state'
        and p.state_code = v_state_code
        and (p.country_code = 'BR' or p.country_code is null)
      )
  ), latest_snapshot as (
    select max(snapshot_date) as snapshot_date
    from leaderboard_rank_snapshots
    where snapshot_date < current_date
  ), previous_ranks as (
    select
      s.profile_id,
      row_number() over (
        order by s.total_points desc, p.correct_count desc, p.resolved_count desc, p.created_at asc, p.id asc
      )::integer as rank
    from leaderboard_rank_snapshots s
    join latest_snapshot ls on ls.snapshot_date = s.snapshot_date
    join profiles p on p.id = s.profile_id
    where v_scope = 'world'
      or (
        v_scope = 'state'
        and p.state_code = v_state_code
        and (p.country_code = 'BR' or p.country_code is null)
      )
  )
  select
    cr.id,
    cr.handle,
    cr.avatar,
    cr.state_code,
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
end;
$$;

revoke all on function get_leaderboard(integer, text, text) from public;
grant execute on function get_leaderboard(integer, text, text) to anon, authenticated;
