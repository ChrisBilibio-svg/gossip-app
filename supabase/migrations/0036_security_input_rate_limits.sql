-- 0036_security_input_rate_limits.sql — extra payload validation + rate limiting
--
-- Additive hardening for user-controlled writes that were introduced after the
-- first write-rate-limit pass. Chris applies manually in Supabase.

create or replace function is_safe_user_text(p_text text, p_max integer, p_min integer default 1)
returns boolean
language sql
immutable
as $$
  select
    p_text is not null
    and char_length(btrim(p_text)) between p_min and p_max
    and octet_length(p_text) <= (p_max * 8)
    and p_text !~ '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]'
    and p_text !~* '(<|>|<\/?[a-z][\s\S]*>|javascript:|data:text/html|on[a-z]+\s*=|\mscript\M)'
$$;

-- Existing dirty rows should not block deployment; constraints are NOT VALID and
-- become enforcement for new/updated rows immediately. Validate after cleanup.
alter table comments
  drop constraint if exists comments_body_safe_text,
  add constraint comments_body_safe_text check (is_safe_user_text(body, 500, 1)) not valid;

alter table comment_reports
  drop constraint if exists comment_reports_reason_safe_text,
  add constraint comment_reports_reason_safe_text check (reason is null or is_safe_user_text(reason, 80, 3)) not valid;

alter table social_reposts
  drop constraint if exists social_reposts_caption_safe_text,
  add constraint social_reposts_caption_safe_text check (is_safe_user_text(caption, 280, 1)) not valid;

alter table social_repost_replies
  drop constraint if exists social_repost_replies_body_safe_text,
  add constraint social_repost_replies_body_safe_text check (is_safe_user_text(body, 280, 1)) not valid;

alter table content_reports
  drop constraint if exists content_reports_reason_safe_text,
  add constraint content_reports_reason_safe_text check (is_safe_user_text(reason, 80, 3)) not valid,
  drop constraint if exists content_reports_details_shape,
  add constraint content_reports_details_shape check (
    jsonb_typeof(details) = 'object'
    and octet_length(details::text) <= 2048
  ) not valid;

alter table push_devices
  drop constraint if exists push_devices_token_safe_shape,
  add constraint push_devices_token_safe_shape check (
    expo_push_token ~ '^ExponentPushToken\[[A-Za-z0-9_-]{10,256}\]$'
    and char_length(coalesce(device_name, '')) <= 80
    and char_length(coalesce(app_version, '')) <= 32
    and coalesce(device_name, '') !~* '(<|>|javascript:|data:text/html|on[a-z]+\s*=|\mscript\M)'
    and coalesce(app_version, '') !~* '(<|>|javascript:|data:text/html|on[a-z]+\s*=|\mscript\M)'
  ) not valid;

alter table analytics_events
  drop constraint if exists analytics_events_properties_size,
  add constraint analytics_events_properties_size check (
    jsonb_typeof(properties) = 'object'
    and octet_length(properties::text) <= 4096
  ) not valid,
  drop constraint if exists analytics_events_session_safe_text,
  add constraint analytics_events_session_safe_text check (
    session_id is null
    or (session_id ~ '^[A-Za-z0-9._:-]{8,128}$' and session_id !~* '(<|>|javascript:|data:text/html|on[a-z]+\s*=|\mscript\M)')
  ) not valid;

create or replace function rate_limit_content_reports_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('content_reports', interval '10 minutes', 10);
  return new;
end;
$$;

drop trigger if exists content_reports_insert_rate_limit on content_reports;
create trigger content_reports_insert_rate_limit
before insert on content_reports
for each row execute function rate_limit_content_reports_insert();

create or replace function rate_limit_analytics_events_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('analytics_events', interval '1 minute', 60);
  return new;
end;
$$;

drop trigger if exists analytics_events_insert_rate_limit on analytics_events;
create trigger analytics_events_insert_rate_limit
before insert on analytics_events
for each row execute function rate_limit_analytics_events_insert();

create or replace function rate_limit_notification_preferences_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('notification_preferences', interval '5 minutes', 20);
  return new;
end;
$$;

drop trigger if exists notification_preferences_write_rate_limit on notification_preferences;
create trigger notification_preferences_write_rate_limit
before insert or update on notification_preferences
for each row execute function rate_limit_notification_preferences_write();

create or replace function rate_limit_push_devices_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('push_devices', interval '5 minutes', 20);
  return new;
end;
$$;

drop trigger if exists push_devices_write_rate_limit on push_devices;
create trigger push_devices_write_rate_limit
before insert or update on push_devices
for each row execute function rate_limit_push_devices_write();

create or replace function rate_limit_blocks_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform check_rate_limit('blocks', interval '10 minutes', 30);
  return new;
end;
$$;

drop trigger if exists blocks_insert_rate_limit on blocks;
create trigger blocks_insert_rate_limit
before insert on blocks
for each row execute function rate_limit_blocks_insert();

-- Re-wrap profile mutation RPCs so profile edits are bounded too.
create or replace function set_handle(p_handle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(btrim(p_handle));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform check_rate_limit('set_handle', interval '15 minutes', 5);

  if v_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid handle';
  end if;

  if v_handle in (
    'admin',
    'administrator',
    'fofoca',
    'fofoca_app',
    'viddi',
    'viddi_app',
    'suporte',
    'support',
    'moderador',
    'moderadora',
    'curador',
    'curadora',
    'pastorfred',
    'system',
    'sistema'
  ) then
    raise exception 'invalid handle';
  end if;

  update profiles set handle = v_handle where id = auth.uid();
end;
$$;

revoke all on function set_handle(text) from public;
grant execute on function set_handle(text) to authenticated;

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

  perform check_rate_limit('set_avatar', interval '15 minutes', 20);

  if v_avatar is not null and v_avatar not in ('🔮', '🍵', '🧢', '👀', '🔥', '👑', '⭐', '🎭', '✨', '👻', '🛸', '🃏') then
    raise exception 'invalid avatar';
  end if;

  update profiles set avatar = v_avatar where id = auth.uid();
end;
$$;

revoke all on function set_avatar(text) from public;
grant execute on function set_avatar(text) to authenticated;
