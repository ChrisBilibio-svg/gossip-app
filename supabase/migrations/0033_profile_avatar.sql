-- 0033_profile_avatar.sql — Server-side profile avatars
--
-- Persists each user's curated emoji avatar on profiles so other users can see it
-- in leaderboard, comments, and Viddi Social surfaces. Re-runnable; Chris applies
-- this manually in Supabase.

alter table profiles
  add column if not exists avatar text;

alter table profiles
  drop constraint if exists profiles_avatar_safe_text;

alter table profiles
  add constraint profiles_avatar_safe_text check (
    avatar is null
    or (
      char_length(avatar) <= 8
      and avatar in ('🔮', '🍵', '🧢', '👀', '🔥', '👑', '⭐', '🎭', '✨', '👻', '🛸', '🃏')
    )
  );

create or replace function set_avatar(p_avatar text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar text := nullif(btrim(p_avatar), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_avatar is not null and v_avatar not in ('🔮', '🍵', '🧢', '👀', '🔥', '👑', '⭐', '🎭', '✨', '👻', '🛸', '🃏') then
    raise exception 'invalid avatar';
  end if;

  update profiles
  set avatar = v_avatar
  where id = auth.uid();
end;
$$;

revoke all on function set_avatar(text) from public;
grant execute on function set_avatar(text) to authenticated;

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
      p.avatar,
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
    cr.avatar,
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

create or replace view social_repost_feed as
select
  sr.id,
  sr.rumor_id,
  sr.user_id,
  sr.caption,
  sr.rating,
  sr.like_count,
  sr.dislike_count,
  sr.created_at,
  r.summary as rumor_summary,
  r.status as rumor_status,
  p.handle,
  sr.reply_count,
  p.avatar
from social_reposts sr
join rumors r on r.id = sr.rumor_id
left join profiles p on p.id = sr.user_id
where sr.status = 'visible';

grant select on social_repost_feed to anon, authenticated;
