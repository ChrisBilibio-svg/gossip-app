-- 0020_leaderboard_rank_delta.sql — Daily leaderboard rank snapshots + delta
--
-- Stores one rank snapshot per profile per day and exposes current leaderboard
-- rows with rank_delta. Positive rank_delta means the profile moved up since the
-- latest previous snapshot; negative means it moved down.

create table if not exists leaderboard_rank_snapshots (
  profile_id uuid not null references profiles (id) on delete cascade,
  snapshot_date date not null default current_date,
  rank integer not null check (rank >= 1),
  total_points integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (profile_id, snapshot_date)
);

create index if not exists leaderboard_rank_snapshots_date_rank_idx
  on leaderboard_rank_snapshots (snapshot_date desc, rank asc);

alter table leaderboard_rank_snapshots enable row level security;

create policy "read leaderboard rank snapshots"
  on leaderboard_rank_snapshots for select
  to anon, authenticated
  using (true);

create or replace function snapshot_leaderboard_ranks(p_snapshot_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into leaderboard_rank_snapshots (profile_id, snapshot_date, rank, total_points)
  select
    ranked.id,
    p_snapshot_date,
    ranked.rank,
    ranked.total_points
  from (
    select
      id,
      total_points,
      row_number() over (
        order by total_points desc, correct_count desc, resolved_count desc, created_at asc, id asc
      )::integer as rank
    from profiles
  ) ranked
  on conflict (profile_id, snapshot_date) do update
    set rank = excluded.rank,
        total_points = excluded.total_points,
        created_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function snapshot_leaderboard_ranks(date) from public;

create or replace function get_leaderboard(p_limit integer default 100)
returns table (
  id uuid,
  handle text,
  total_points integer,
  correct_count integer,
  resolved_count integer,
  rank integer,
  previous_rank integer,
  rank_delta integer
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
      p.total_points,
      p.correct_count,
      p.resolved_count,
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
    cr.total_points,
    cr.correct_count,
    cr.resolved_count,
    cr.rank,
    pr.rank as previous_rank,
    case when pr.rank is null then null else pr.rank - cr.rank end as rank_delta
  from current_ranks cr
  left join previous_ranks pr on pr.profile_id = cr.id
  order by cr.rank asc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
$$;

revoke all on function get_leaderboard(integer) from public;
grant execute on function get_leaderboard(integer) to anon, authenticated;
