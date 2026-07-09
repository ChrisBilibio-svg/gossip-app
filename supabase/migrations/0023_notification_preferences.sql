-- 0023_notification_preferences.sql — opt-in notification settings + push devices
--
-- Adds minimal push-notification storage for future growth features. Preferences
-- stay per-user and device tokens are scoped by RLS so clients only manage their
-- own rows. No notification sending logic is added here.

create table if not exists notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  breaking_news boolean not null default true,
  resolution_updates boolean not null default true,
  leaderboard_movement boolean not null default true,
  marketing_opt_in boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_devices_user_idx
  on push_devices (user_id, enabled, last_seen_at desc);

create index if not exists push_devices_enabled_idx
  on push_devices (enabled, last_seen_at desc);

alter table notification_preferences enable row level security;
alter table push_devices enable row level security;

create policy "read own notification preferences" on notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy "upsert own notification preferences" on notification_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "manage own push devices" on push_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists notification_preferences_touch_updated_at on notification_preferences;
create trigger notification_preferences_touch_updated_at
before update on notification_preferences
for each row execute function touch_updated_at();

drop trigger if exists push_devices_touch_updated_at on push_devices;
create trigger push_devices_touch_updated_at
before update on push_devices
for each row execute function touch_updated_at();
