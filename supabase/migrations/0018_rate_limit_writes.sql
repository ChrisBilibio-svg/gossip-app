-- 0018_rate_limit_writes.sql — DB-level spam throttles for user writes
--
-- Adds lightweight per-user/action fixed-window limits. These throttles live in
-- the database so direct client table writes and SECURITY DEFINER RPCs share the
-- same protection.

create table if not exists user_rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (user_id, action)
);

alter table user_rate_limits enable row level security;

create or replace function check_rate_limit(p_action text, p_window interval, p_max integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_limit user_rate_limits%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_max < 1 then
    raise exception 'invalid rate limit';
  end if;

  loop
    insert into user_rate_limits (user_id, action, window_start, count)
    values (v_user, p_action, v_now, 1)
    on conflict (user_id, action) do nothing;
    if found then
      return;
    end if;

    select * into v_limit
    from user_rate_limits
    where user_id = v_user and action = p_action
    for update;

    if v_limit.window_start <= v_now - p_window then
      update user_rate_limits
      set window_start = v_now,
          count = 1
      where user_id = v_user and action = p_action;
      return;
    end if;

    if v_limit.count >= p_max then
      raise exception 'rate limit exceeded';
    end if;

    update user_rate_limits
    set count = count + 1
    where user_id = v_user and action = p_action;
    return;
  end loop;
end;
$$;

revoke all on function check_rate_limit(text, interval, integer) from public;

create or replace function rate_limit_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('comments', interval '1 minute', 6);
  return new;
end;
$$;

create or replace function rate_limit_comment_like_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('comment_likes', interval '1 minute', 30);
  return new;
end;
$$;

create or replace function rate_limit_rumor_reaction_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('rumor_reactions', interval '1 minute', 30);
  return new;
end;
$$;

create or replace function rate_limit_social_repost_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('social_reposts', interval '10 minutes', 5);
  return new;
end;
$$;

create or replace function rate_limit_social_repost_reaction_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('social_repost_reactions', interval '1 minute', 30);
  return new;
end;
$$;

create or replace function rate_limit_comment_report_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('comment_reports', interval '10 minutes', 10);
  return new;
end;
$$;

drop trigger if exists comments_rate_limit on comments;
create trigger comments_rate_limit
before insert on comments
for each row execute function rate_limit_comment_insert();

drop trigger if exists comment_likes_rate_limit on comment_likes;
create trigger comment_likes_rate_limit
before insert on comment_likes
for each row execute function rate_limit_comment_like_insert();

drop trigger if exists rumor_reactions_rate_limit_ins on rumor_reactions;
create trigger rumor_reactions_rate_limit_ins
before insert on rumor_reactions
for each row execute function rate_limit_rumor_reaction_write();

drop trigger if exists rumor_reactions_rate_limit_upd on rumor_reactions;
create trigger rumor_reactions_rate_limit_upd
before update on rumor_reactions
for each row execute function rate_limit_rumor_reaction_write();

drop trigger if exists social_reposts_rate_limit on social_reposts;
create trigger social_reposts_rate_limit
before insert on social_reposts
for each row execute function rate_limit_social_repost_insert();

drop trigger if exists social_repost_reactions_rate_limit_ins on social_repost_reactions;
create trigger social_repost_reactions_rate_limit_ins
before insert on social_repost_reactions
for each row execute function rate_limit_social_repost_reaction_write();

drop trigger if exists social_repost_reactions_rate_limit_upd on social_repost_reactions;
create trigger social_repost_reactions_rate_limit_upd
before update on social_repost_reactions
for each row execute function rate_limit_social_repost_reaction_write();

drop trigger if exists comment_reports_rate_limit on comment_reports;
create trigger comment_reports_rate_limit
before insert on comment_reports
for each row execute function rate_limit_comment_report_insert();

create or replace function place_bet(p_rumor_id uuid, p_choice bet_choice)
returns predictions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pred predictions;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  perform check_rate_limit('bets', interval '1 minute', 20);

  with updated_rumor as (
    update rumors
    set
      true_votes = true_votes + (case when p_choice = 'true' then 1 else 0 end),
      false_votes = false_votes + (case when p_choice = 'false' then 1 else 0 end)
    where id = p_rumor_id
      and status = 'speculated'
      and publish_at <= now()
      and coalesce(is_draft, false) = false
    returning
      id,
      seed_true,
      seed_false,
      true_votes - (case when p_choice = 'true' then 1 else 0 end) as previous_true_votes,
      false_votes - (case when p_choice = 'false' then 1 else 0 end) as previous_false_votes
  )
  insert into predictions (user_id, rumor_id, choice, crowd_true_at_cast, crowd_false_at_cast)
  select
    v_user,
    id,
    p_choice,
    seed_true + previous_true_votes,
    seed_false + previous_false_votes
  from updated_rumor
  returning * into v_pred;

  if not found then
    raise exception 'rumor not open';
  end if;

  return v_pred;
end;
$$;

grant execute on function place_bet(uuid, bet_choice) to authenticated;
