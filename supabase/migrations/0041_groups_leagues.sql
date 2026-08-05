-- 0041_groups_leagues.sql — private time-limited Grupos / friend leagues
--
-- Backend-only contract for O Profeta private groups. Chris applies manually.
-- MVP counts from starts_at regardless of join date, so late joiners can still
-- bring already-earned window points into the group leaderboard.

alter table predictions
  add column if not exists awarded_at timestamptz;

-- Backfill award timestamps from existing scored prediction history. Prefer the
-- scorer timestamp, then the rumor resolution timestamp. VOID rows may have
-- points_awarded=0/is_correct null; they are harmless and excluded from group
-- resolved_count by the leaderboard query below.
update predictions p
set awarded_at = coalesce(p.scored_at, r.resolved_at)
from rumors r
where r.id = p.rumor_id
  and p.awarded_at is null
  and (p.scored_at is not null or r.resolved_at is not null);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text,
  owner_id uuid not null references profiles (id) on delete cascade,
  invite_code text not null unique,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 1 and 30),
  constraint groups_name_trimmed check (name = btrim(name)),
  constraint groups_emoji_length check (emoji is null or char_length(emoji) between 1 and 4),
  constraint groups_duration_valid check (
    ends_at >= starts_at + interval '1 day'
    and ends_at <= starts_at + interval '1 year'
  ),
  constraint groups_invite_code_format check (invite_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$')
);

create table if not exists group_members (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_id_idx on group_members (user_id);
create index if not exists groups_invite_code_idx on groups (invite_code);
create index if not exists groups_ends_at_idx on groups (ends_at);
create index if not exists predictions_awarded_at_idx on predictions (awarded_at);

create or replace function is_group_member_for_rls(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  )
$$;

revoke all on function is_group_member_for_rls(uuid) from public;
grant execute on function is_group_member_for_rls(uuid) to authenticated;

alter table groups enable row level security;
alter table group_members enable row level security;

drop policy if exists groups_select_members on groups;
create policy groups_select_members on groups
for select
using (is_group_member_for_rls(groups.id));

drop policy if exists group_members_select_members on group_members;
create policy group_members_select_members on group_members
for select
using (is_group_member_for_rls(group_members.group_id));

create or replace function normalize_group_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_name, '')), '')
$$;

revoke all on function normalize_group_name(text) from public;

create or replace function normalize_group_emoji(p_emoji text)
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_emoji, '')), '')
$$;

revoke all on function normalize_group_emoji(text) from public;

create or replace function assert_group_auth()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  v_user := auth.uid();
  return v_user;
end;
$$;

revoke all on function assert_group_auth() from public;

create or replace function assert_group_handle(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text;
begin
  select handle into v_handle
  from profiles
  where id = p_user_id;

  if v_handle is null or btrim(v_handle) = '' then
    raise exception 'no_handle';
  end if;
end;
$$;

revoke all on function assert_group_handle(uuid) from public;

create or replace function generate_group_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_i integer;
begin
  -- Collision-safe alphabet excludes 0/O/1/I/L. The translate call is a cheap
  -- normalization guard for future edits: translate(..., '23456789ABCDEFGHJKMNPQRSTUVWXYZ', ...).
  v_code := '';
  for v_i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
  end loop;
  v_code := translate(v_code, '23456789ABCDEFGHJKMNPQRSTUVWXYZ', '23456789ABCDEFGHJKMNPQRSTUVWXYZ');
  return v_code;
end;
$$;

revoke all on function generate_group_invite_code() from public;

create or replace function assert_group_member(p_group_id uuid, p_user_id uuid)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
begin
  select * into v_member
  from group_members
  where group_id = p_group_id
    and user_id = p_user_id;

  if not found then
    raise exception 'not_found';
  end if;
  return v_member;
end;
$$;

revoke all on function assert_group_member(uuid, uuid) from public;

create or replace function assert_group_owner(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from group_members
  where group_id = p_group_id
    and user_id = p_user_id;

  if v_role is distinct from 'owner' then
    raise exception 'not_owner';
  end if;
end;
$$;

revoke all on function assert_group_owner(uuid, uuid) from public;

create or replace function create_group(p_name text, p_ends_at timestamptz, p_emoji text default null)
returns table (
  id uuid,
  name text,
  emoji text,
  owner_id uuid,
  invite_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  member_count integer,
  is_active boolean,
  is_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_name text := normalize_group_name(p_name);
  v_emoji text := normalize_group_emoji(p_emoji);
  v_now timestamptz := now();
  v_code text;
  v_group groups;
  v_attempt integer;
  v_group_count integer;
begin
  perform check_rate_limit('groups_create', interval '10 minutes', 5);
  perform assert_group_handle(v_user);

  if v_name is null or char_length(v_name) > 30 then
    raise exception 'invalid_name';
  end if;
  if v_emoji is not null and char_length(v_emoji) > 4 then
    raise exception 'invalid_emoji';
  end if;
  if p_ends_at is null or p_ends_at < v_now + interval '1 day' or p_ends_at > v_now + interval '1 year' then
    raise exception 'invalid_duration';
  end if;

  select count(*) into v_group_count
  from group_members
  where user_id = v_user;
  if v_group_count >= 20 then
    raise exception 'over_cap';
  end if;

  for v_attempt in 1..10 loop
    v_code := generate_group_invite_code();
    begin
      insert into groups (name, emoji, owner_id, invite_code, starts_at, ends_at)
      values (v_name, v_emoji, v_user, v_code, v_now, p_ends_at)
      returning * into v_group;
      exit;
    exception when unique_violation then
      if v_attempt = 10 then
        raise exception 'invite_collision';
      end if;
    end;
  end loop;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, v_user, 'owner');

  return query
  select v_group.id, v_group.name, v_group.emoji, v_group.owner_id, v_group.invite_code,
         v_group.starts_at, v_group.ends_at, v_group.created_at, 1::integer,
         (now() < v_group.ends_at), true;
end;
$$;

revoke all on function create_group(text, timestamptz, text) from public;
grant execute on function create_group(text, timestamptz, text) to authenticated;

create or replace function join_group(p_invite_code text)
returns table (
  id uuid,
  name text,
  emoji text,
  owner_id uuid,
  invite_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  member_count integer,
  is_active boolean,
  is_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_code text := upper(btrim(p_invite_code));
  v_group groups;
  v_member_count integer;
  v_user_groups integer;
begin
  perform check_rate_limit('groups_join', interval '10 minutes', 10);
  perform assert_group_handle(v_user);

  select * into v_group
  from groups
  where invite_code = v_code
  for update;

  if not found then
    raise exception 'not_found';
  end if;
  if now() >= v_group.ends_at then
    raise exception 'group_ended';
  end if;
  if exists (select 1 from group_members where group_id = v_group.id and user_id = v_user) then
    raise exception 'already_member';
  end if;

  select count(*) into v_member_count from group_members where group_id = v_group.id;
  if v_member_count >= 50 then
    raise exception 'group_full';
  end if;

  select count(*) into v_user_groups from group_members where user_id = v_user;
  if v_user_groups >= 20 then
    raise exception 'over_cap';
  end if;

  insert into group_members (group_id, user_id, role)
  values (v_group.id, v_user, 'member');

  return query
  select v_group.id, v_group.name, v_group.emoji, v_group.owner_id, v_group.invite_code,
         v_group.starts_at, v_group.ends_at, v_group.created_at, (v_member_count + 1)::integer,
         (now() < v_group.ends_at), false;
end;
$$;

revoke all on function join_group(text) from public;
grant execute on function join_group(text) to authenticated;

create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_member group_members;
  v_next_owner group_members;
begin
  select * into v_member
  from group_members
  where group_id = p_group_id
    and user_id = v_user
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if v_member.role <> 'owner' then
    delete from group_members where group_id = p_group_id and user_id = v_user;
    return;
  end if;

  select * into v_next_owner
  from group_members
  where group_id = p_group_id
    and user_id <> v_user
  order by joined_at asc, user_id asc
  limit 1
  for update;

  if not found then
    delete from groups where id = p_group_id and owner_id = v_user;
    return;
  end if;

  update group_members set role = 'owner'
  where group_id = p_group_id and user_id = v_next_owner.user_id;
  update groups set owner_id = v_next_owner.user_id
  where id = p_group_id;
  delete from group_members where group_id = p_group_id and user_id = v_user;
end;
$$;

revoke all on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

create or replace function get_group_leaderboard(p_group_id uuid, p_limit integer default 100)
returns table (
  group_id uuid,
  id uuid,
  handle text,
  avatar text,
  points integer,
  correct_count integer,
  resolved_count integer,
  rank integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := assert_group_auth();
  v_group groups;
  v_window_end timestamptz;
begin
  perform assert_group_member(p_group_id, v_user);

  select * into v_group
  from groups
  where groups.id = p_group_id;

  if not found then
    raise exception 'not_found';
  end if;

  v_window_end := least(v_group.ends_at, now());

  return query
  with scores as (
    select
      gm.group_id,
      gm.user_id as id,
      p.handle,
      p.avatar,
      coalesce(sum(pred.points_awarded), 0)::integer as points,
      count(pred.id) filter (where pred.is_correct is true)::integer as correct_count,
      count(pred.id)::integer as resolved_count,
      gm.joined_at
    from group_members gm
    join profiles p on p.id = gm.user_id
    left join predictions pred
      on pred.user_id = gm.user_id
     and pred.awarded_at >= v_group.starts_at
     and pred.awarded_at < v_window_end
     and pred.scored_at is not null
     and pred.is_correct is not null
    where gm.group_id = p_group_id
    group by gm.group_id, gm.user_id, p.handle, p.avatar, gm.joined_at
  ), ranked as (
    select
      scores.*,
      row_number() over (
        order by points desc, correct_count desc, resolved_count desc, scores.joined_at asc, scores.id asc
      )::integer as rank
    from scores
  )
  select ranked.group_id, ranked.id, ranked.handle, ranked.avatar, ranked.points,
         ranked.correct_count, ranked.resolved_count, ranked.rank
  from ranked
  order by ranked.rank asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
end;
$$;

revoke all on function get_group_leaderboard(uuid, integer) from public;
grant execute on function get_group_leaderboard(uuid, integer) to authenticated;

create or replace function get_my_groups()
returns table (
  id uuid,
  name text,
  emoji text,
  member_count integer,
  my_rank integer,
  is_owner boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select assert_group_auth() as uid
  ), my_groups as (
    select g.*, gm.role, gm.joined_at
    from groups g
    join group_members gm on gm.group_id = g.id
    join me on me.uid = gm.user_id
  ), counts as (
    select group_id, count(*)::integer as member_count
    from group_members
    group by group_id
  ), ranks as (
    select lb.group_id, lb.id as user_id, lb.rank
    from my_groups g
    cross join lateral get_group_leaderboard(g.id, 100) lb
  )
  select g.id, g.name, g.emoji, coalesce(c.member_count, 0), r.rank,
         (g.role = 'owner') as is_owner, g.starts_at, g.ends_at, (now() < g.ends_at) as is_active
  from my_groups g
  left join counts c on c.group_id = g.id
  left join ranks r on r.group_id = g.id and r.user_id = (select uid from me)
  order by (now() < g.ends_at) desc, g.ends_at desc, g.created_at desc;
$$;

revoke all on function get_my_groups() from public;
grant execute on function get_my_groups() to authenticated;

create or replace function get_group(p_group_id uuid)
returns table (
  id uuid,
  name text,
  emoji text,
  owner_id uuid,
  invite_code text,
  member_count integer,
  is_owner boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := assert_group_auth();
  v_member group_members;
begin
  v_member := assert_group_member(p_group_id, v_user);

  return query
  select g.id, g.name, g.emoji, g.owner_id, g.invite_code,
         (select count(*)::integer from group_members gm where gm.group_id = g.id),
         (v_member.role = 'owner'), g.starts_at, g.ends_at, g.created_at, (now() < g.ends_at)
  from groups g
  where g.id = p_group_id;
end;
$$;

revoke all on function get_group(uuid) from public;
grant execute on function get_group(uuid) to authenticated;

create or replace function rename_group(p_group_id uuid, p_name text, p_emoji text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_name text := normalize_group_name(p_name);
  v_emoji text := normalize_group_emoji(p_emoji);
begin
  perform check_rate_limit('groups_manage', interval '10 minutes', 20);
  perform assert_group_owner(p_group_id, v_user);

  if v_name is null or char_length(v_name) > 30 then
    raise exception 'invalid_name';
  end if;
  if v_emoji is not null and char_length(v_emoji) > 4 then
    raise exception 'invalid_emoji';
  end if;

  update groups
  set name = v_name,
      emoji = v_emoji
  where id = p_group_id;
end;
$$;

revoke all on function rename_group(uuid, text, text) from public;
grant execute on function rename_group(uuid, text, text) to authenticated;

create or replace function remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_target_role text;
begin
  perform check_rate_limit('groups_manage', interval '10 minutes', 20);
  perform assert_group_owner(p_group_id, v_user);

  if p_user_id = v_user then
    raise exception 'cannot_remove_self';
  end if;

  select role into v_target_role
  from group_members
  where group_id = p_group_id
    and user_id = p_user_id;

  if not found then
    raise exception 'not_found';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;

  delete from group_members
  where group_id = p_group_id
    and user_id = p_user_id;
end;
$$;

revoke all on function remove_group_member(uuid, uuid) from public;
grant execute on function remove_group_member(uuid, uuid) to authenticated;

create or replace function delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
begin
  perform check_rate_limit('groups_manage', interval '10 minutes', 20);
  perform assert_group_owner(p_group_id, v_user);
  delete from groups where id = p_group_id;
end;
$$;

revoke all on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;

create or replace function regenerate_group_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := assert_group_auth();
  v_code text;
  v_attempt integer;
begin
  perform check_rate_limit('groups_manage', interval '10 minutes', 20);
  perform assert_group_owner(p_group_id, v_user);

  for v_attempt in 1..10 loop
    v_code := generate_group_invite_code();
    begin
      update groups
      set invite_code = v_code
      where id = p_group_id;
      return v_code;
    exception when unique_violation then
      if v_attempt = 10 then
        raise exception 'invite_collision';
      end if;
    end;
  end loop;

  raise exception 'invite_collision';
end;
$$;

revoke all on function regenerate_group_invite(uuid) from public;
grant execute on function regenerate_group_invite(uuid) to authenticated;

-- Restate the scorer to stamp predictions.awarded_at at award time for group
-- windows. This mirrors 0040 streak behavior and keeps VOID/push rows unchanged.
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
        scored_at = now(),
        awarded_at = now()
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
