-- 0027_social_repost_replies.sql — Twitter-style replies on social reposts
--
-- Adds a lightweight reply thread under each social repost. This is scoped to
-- reposts, not original rumors, so the core TEA/CAP prediction object remains
-- curator-owned while users can discuss quote-tweet-style reposts.

alter table social_reposts
  add column if not exists reply_count integer not null default 0;

create table if not exists social_repost_replies (
  id uuid primary key default gen_random_uuid(),
  repost_id uuid not null references social_reposts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  status comment_status not null default 'visible',
  created_at timestamptz not null default now()
);

create index if not exists social_repost_replies_thread_idx
  on social_repost_replies (repost_id, created_at desc)
  where status = 'visible';

create index if not exists social_repost_replies_user_idx
  on social_repost_replies (user_id, created_at desc);

alter table social_repost_replies enable row level security;

drop policy if exists "read visible repost replies" on social_repost_replies;
drop policy if exists "insert own repost reply" on social_repost_replies;
drop policy if exists "delete own repost reply" on social_repost_replies;

create policy "read visible repost replies" on social_repost_replies for select to anon, authenticated
  using (
    status = 'visible'
    and user_id not in (select blocked_id from blocks where blocker_id = auth.uid())
  );

create policy "insert own repost reply" on social_repost_replies for insert to authenticated
  with check (user_id = auth.uid());

create policy "delete own repost reply" on social_repost_replies for delete to authenticated
  using (user_id = auth.uid());

-- Backfill existing counters if this migration is re-run in an environment that
-- already contains replies (for example, after a failed partial apply).
update social_reposts sr
set reply_count = coalesce(reply_counts.count, 0)
from (
  select repost_id, count(*)::integer as count
  from social_repost_replies
  group by repost_id
) reply_counts
where sr.id = reply_counts.repost_id;

create or replace function bump_social_repost_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update social_reposts
      set reply_count = reply_count + 1
      where id = new.repost_id;
    return new;
  else
    update social_reposts
      set reply_count = greatest(reply_count - 1, 0)
      where id = old.repost_id;
    return old;
  end if;
end;
$$;

drop trigger if exists social_repost_reply_count_ins on social_repost_replies;
create trigger social_repost_reply_count_ins
after insert on social_repost_replies
for each row execute function bump_social_repost_reply_count();

drop trigger if exists social_repost_reply_count_del on social_repost_replies;
create trigger social_repost_reply_count_del
after delete on social_repost_replies
for each row execute function bump_social_repost_reply_count();

create or replace function rate_limit_social_repost_reply_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform check_rate_limit('social_repost_replies', interval '1 minute', 6);
  return new;
end;
$$;

drop trigger if exists social_repost_replies_rate_limit on social_repost_replies;
create trigger social_repost_replies_rate_limit
before insert on social_repost_replies
for each row execute function rate_limit_social_repost_reply_insert();

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
  sr.reply_count
from social_reposts sr
join rumors r on r.id = sr.rumor_id
left join profiles p on p.id = sr.user_id
where sr.status = 'visible';

grant select on social_repost_feed to anon, authenticated;

revoke all on function bump_social_repost_reply_count() from public;
revoke all on function rate_limit_social_repost_reply_insert() from public;
