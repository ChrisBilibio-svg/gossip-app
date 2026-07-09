-- 0005_comments.sql — Comments + safety (Epic 4 / FR23-28)

create type comment_status as enum ('visible', 'hidden', 'removed');

-- guidelines acceptance lives on the profile
alter table profiles add column accepted_guidelines boolean not null default false;

create table comments (
  id         uuid primary key default gen_random_uuid(),
  rumor_id   uuid not null references rumors (id) on delete cascade,
  user_id    uuid not null references auth.users (id) default auth.uid(),
  body       text not null check (char_length(body) between 1 and 500),
  like_count integer not null default 0,
  status     comment_status not null default 'visible',
  created_at timestamptz not null default now()
);
create index comments_rumor_idx on comments (rumor_id, created_at desc);

create table comment_likes (
  comment_id uuid not null references comments (id) on delete cascade,
  user_id    uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table comment_reports (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references comments (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) default auth.uid(),
  reason      text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table blocks (
  blocker_id uuid not null references auth.users (id) default auth.uid(),
  blocked_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- ── RLS ──
alter table comments enable row level security;
alter table comment_likes enable row level security;
alter table comment_reports enable row level security;
alter table blocks enable row level security;

-- read visible/removed comments, hiding blocked authors
create policy "read comments" on comments for select to anon, authenticated
  using (
    status in ('visible', 'removed')
    and user_id not in (select blocked_id from blocks where blocker_id = auth.uid())
  );
create policy "insert own comment" on comments for insert to authenticated
  with check (user_id = auth.uid());

-- likes: manage own
create policy "read own likes" on comment_likes for select to authenticated using (user_id = auth.uid());
create policy "like" on comment_likes for insert to authenticated with check (user_id = auth.uid());
create policy "unlike" on comment_likes for delete to authenticated using (user_id = auth.uid());

-- reports + blocks: insert own
create policy "report" on comment_reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "read own blocks" on blocks for select to authenticated using (blocker_id = auth.uid());
create policy "block" on blocks for insert to authenticated with check (blocker_id = auth.uid());

-- ── like_count maintenance ──
create or replace function bump_like_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update comments set like_count = like_count + 1 where id = new.comment_id;
    return new;
  else
    update comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
    return old;
  end if;
end;
$$;
create trigger comment_like_count_ins after insert on comment_likes for each row execute function bump_like_count();
create trigger comment_like_count_del after delete on comment_likes for each row execute function bump_like_count();

-- ── profanity filter (starter list; auto-hide on insert) ──
create or replace function filter_comment()
returns trigger language plpgsql set search_path = public as $$
declare
  banned text[] := array['caralho', 'porra', 'viado', 'puta', 'merda'];
  w text;
begin
  foreach w in array banned loop
    if new.body ilike '%' || w || '%' then
      new.status := 'hidden';
      exit;
    end if;
  end loop;
  return new;
end;
$$;
create trigger comment_profanity before insert on comments for each row execute function filter_comment();

-- ── accept guidelines (one-time gate) ──
create or replace function accept_guidelines()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update profiles set accepted_guidelines = true where id = auth.uid();
end;
$$;
grant execute on function accept_guidelines() to authenticated;
