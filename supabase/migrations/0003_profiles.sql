-- 0003_profiles.sql — Anonymous personas / profiles (Story 2.5 / FR15, FR16)
-- Holds the handle now; the points/stats columns are used by scoring in Epic 3.

create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  handle         text,
  total_points   integer not null default 0,
  correct_count  integer not null default 0,
  resolved_count integer not null default 0,
  created_at     timestamptz not null default now()
);

-- Case-insensitive unique handle (avoids the citext extension dependency).
-- NULL handles are allowed (multiple), so unset profiles don't collide.
create unique index profiles_handle_lower_idx on profiles (lower(handle));

alter table profiles enable row level security;

-- Public read (leaderboard + showing handles). No direct UPDATE policy — handle
-- changes go through set_handle(); points are written only by scoring (Epic 3).
create policy "read profiles"
  on profiles for select
  to anon, authenticated
  using (true);

-- Auto-create a profile row whenever an auth user is created (incl. anonymous).
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for users that already exist (e.g. anonymous test sessions).
insert into profiles (id) select id from auth.users on conflict do nothing;

-- Set the current user's handle (unique, case-insensitive). Only path users have
-- to write profiles, so points stay protected.
create or replace function set_handle(p_handle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update profiles set handle = trim(p_handle) where id = auth.uid();
end;
$$;

grant execute on function set_handle(text) to authenticated;
