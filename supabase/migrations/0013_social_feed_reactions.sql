-- 0013_social_feed_reactions.sql — Social repost feed + gossip like/dislike reactions
-- Code-ready migration. Apply after 0012_evidence_sources.sql.

-- ── Gossip-level likes/dislikes ────────────────────────────────────────────
-- One current sentiment per user per rumor. These are separate from TEA/CAP
-- predictions: reactions measure popularity/interest, not truth.
create table rumor_reactions (
  rumor_id   uuid not null references rumors (id) on delete cascade,
  user_id    uuid not null references auth.users (id) default auth.uid(),
  value      smallint not null check (value in (-1, 1)), -- 1 = like, -1 = dislike
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rumor_id, user_id)
);

create index rumor_reactions_popularity_idx on rumor_reactions (rumor_id, value);

alter table rumor_reactions enable row level security;

create policy "read own rumor reactions" on rumor_reactions for select to authenticated
  using (user_id = auth.uid());
create policy "insert own rumor reaction" on rumor_reactions for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own rumor reaction" on rumor_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own rumor reaction" on rumor_reactions for delete to authenticated
  using (user_id = auth.uid());

create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rumor_reactions_touch_updated_at
before update on rumor_reactions
for each row execute function touch_updated_at();

create or replace view rumor_reaction_summary as
select
  rumor_id,
  count(*) filter (where value = 1)::integer as like_count,
  count(*) filter (where value = -1)::integer as dislike_count
from rumor_reactions
group by rumor_id;

grant select on rumor_reaction_summary to anon, authenticated;

-- ── Social repost feed ──────────────────────────────────────────────────────
-- A repost is a lightweight user social object: the original rumor + a short
-- caption/comment + a 1–5 spice rating. It gives people something to browse and
-- react to outside the core prediction screen without allowing user-created rumors.
create table social_reposts (
  id            uuid primary key default gen_random_uuid(),
  rumor_id      uuid not null references rumors (id) on delete cascade,
  user_id       uuid not null references auth.users (id) default auth.uid(),
  caption       text not null check (char_length(caption) between 1 and 280),
  rating        smallint not null check (rating between 1 and 5),
  like_count    integer not null default 0,
  dislike_count integer not null default 0,
  status        comment_status not null default 'visible',
  created_at    timestamptz not null default now()
);

create index social_reposts_feed_idx on social_reposts (created_at desc) where status = 'visible';
create index social_reposts_rumor_idx on social_reposts (rumor_id, created_at desc);
create index social_reposts_user_idx on social_reposts (user_id, created_at desc);

create table social_repost_reactions (
  repost_id  uuid not null references social_reposts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) default auth.uid(),
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (repost_id, user_id)
);

alter table social_reposts enable row level security;
alter table social_repost_reactions enable row level security;

create policy "read visible reposts" on social_reposts for select to anon, authenticated
  using (
    status = 'visible'
    and user_id not in (select blocked_id from blocks where blocker_id = auth.uid())
  );
create policy "insert own repost" on social_reposts for insert to authenticated
  with check (user_id = auth.uid());
create policy "delete own repost" on social_reposts for delete to authenticated
  using (user_id = auth.uid());

create policy "read own repost reactions" on social_repost_reactions for select to authenticated
  using (user_id = auth.uid());
create policy "insert own repost reaction" on social_repost_reactions for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own repost reaction" on social_repost_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own repost reaction" on social_repost_reactions for delete to authenticated
  using (user_id = auth.uid());

create trigger social_repost_reactions_touch_updated_at
before update on social_repost_reactions
for each row execute function touch_updated_at();

create or replace function bump_social_repost_reaction_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update social_reposts
      set like_count = like_count + case when new.value = 1 then 1 else 0 end,
          dislike_count = dislike_count + case when new.value = -1 then 1 else 0 end
      where id = new.repost_id;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.value <> new.value then
      update social_reposts
        set like_count = greatest(like_count - case when old.value = 1 then 1 else 0 end + case when new.value = 1 then 1 else 0 end, 0),
            dislike_count = greatest(dislike_count - case when old.value = -1 then 1 else 0 end + case when new.value = -1 then 1 else 0 end, 0)
        where id = new.repost_id;
    end if;
    return new;
  else
    update social_reposts
      set like_count = greatest(like_count - case when old.value = 1 then 1 else 0 end, 0),
          dislike_count = greatest(dislike_count - case when old.value = -1 then 1 else 0 end, 0)
      where id = old.repost_id;
    return old;
  end if;
end;
$$;

create trigger social_repost_reaction_count_ins
after insert on social_repost_reactions
for each row execute function bump_social_repost_reaction_counts();

create trigger social_repost_reaction_count_upd
after update on social_repost_reactions
for each row execute function bump_social_repost_reaction_counts();

create trigger social_repost_reaction_count_del
after delete on social_repost_reactions
for each row execute function bump_social_repost_reaction_counts();

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
  p.handle
from social_reposts sr
join rumors r on r.id = sr.rumor_id
left join profiles p on p.id = sr.user_id
where sr.status = 'visible';

grant select on social_repost_feed to anon, authenticated;
