-- 0038_keyword_notifications.sql — keyword follow + queued Expo push notifications
--
-- Adds LGPD-minimal keyword subscriptions and a service-role notification queue.
-- Client push-token registration still requires expo-notifications/native rebuild;
-- Hermes does not apply this migration. Chris applies manually in Supabase.

create table if not exists keyword_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  keyword text not null,
  created_at timestamptz not null default now(),
  unique (user_id, keyword)
);

alter table keyword_subscriptions
  drop constraint if exists keyword_subscription_keyword_len;

alter table keyword_subscriptions
  add constraint keyword_subscription_keyword_len check (char_length(keyword) between 2 and 48);

create index if not exists keyword_subscriptions_keyword_idx
  on keyword_subscriptions (keyword);

alter table keyword_subscriptions enable row level security;

drop policy if exists "read own keyword subscriptions" on keyword_subscriptions;
create policy "read own keyword subscriptions"
  on keyword_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "insert own keyword subscriptions" on keyword_subscriptions;
create policy "insert own keyword subscriptions"
  on keyword_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "delete own keyword subscriptions" on keyword_subscriptions;
create policy "delete own keyword subscriptions"
  on keyword_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function normalize_keyword(p_keyword text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      lower(unaccent(btrim(coalesce(p_keyword, '')))),
      '[^a-z0-9 ]+',
      '',
      'g'
    ),
    ''
  );
$$;

create or replace function keyword_subscription_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  new.keyword := normalize_keyword(new.keyword);
  if new.keyword is null or char_length(new.keyword) < 2 or char_length(new.keyword) > 48 then
    raise exception 'invalid keyword';
  end if;
  if new.user_id is null then new.user_id := auth.uid(); end if;
  if new.user_id is distinct from auth.uid() and auth.role() <> 'service_role' then
    raise exception 'cannot subscribe another user';
  end if;

  select count(*)::integer into v_count
  from keyword_subscriptions ks
  where ks.user_id = new.user_id;

  if tg_op = 'INSERT' and v_count >= 20 then
    raise exception 'keyword subscription limit reached';
  end if;

  return new;
end;
$$;

revoke all on function keyword_subscription_limit() from public;

drop trigger if exists keyword_subscriptions_normalize_limit on keyword_subscriptions;
create trigger keyword_subscriptions_normalize_limit
before insert or update of keyword, user_id on keyword_subscriptions
for each row execute function keyword_subscription_limit();

create table if not exists notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rumor_id uuid references rumors (id) on delete cascade,
  kind text not null check (kind in ('keyword_match')),
  keyword text,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, rumor_id, kind, keyword)
);

create index if not exists notification_queue_pending_idx
  on notification_queue (status, created_at)
  where status = 'pending';

create index if not exists notification_queue_frequency_idx
  on notification_queue (user_id, kind, created_at desc);

alter table notification_queue enable row level security;

-- Queue is service-role only; clients manage subscriptions/preferences/devices, not queued sends.
revoke all on notification_queue from anon, authenticated;

create or replace function rumor_keyword_text(p_rumor rumors)
returns text
language sql
immutable
as $$
  select normalize_keyword(
    concat_ws(' ', p_rumor.summary, p_rumor.article, p_rumor.category, p_rumor.source_label)
  );
$$;

create or replace function enqueue_keyword_notifications_for_rumor(p_rumor_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rumor rumors;
  v_text text;
  v_rows integer;
begin
  select * into v_rumor from rumors where id = p_rumor_id;
  if not found then return 0; end if;
  if coalesce(v_rumor.is_draft, false) = true or v_rumor.publish_at > now() then return 0; end if;

  v_text := rumor_keyword_text(v_rumor);
  if v_text is null then return 0; end if;

  insert into notification_queue (user_id, rumor_id, kind, keyword, title, body, data)
  select
    ks.user_id,
    v_rumor.id,
    'keyword_match',
    ks.keyword,
    'Novo mercado sobre ' || ks.keyword,
    left(v_rumor.summary, 180),
    jsonb_build_object('rumorId', v_rumor.id, 'kind', 'keyword_match', 'keyword', ks.keyword)
  from keyword_subscriptions ks
  left join notification_preferences np on np.user_id = ks.user_id
  where v_text like '%' || ks.keyword || '%'
    and (np.breaking_news = true or np.user_id is null)
    and (
      select count(*)
      from notification_queue nq
      where nq.user_id = ks.user_id
        and nq.kind = 'keyword_match'
        and nq.created_at > now() - interval '1 hour'
    ) < 3
  on conflict (user_id, rumor_id, kind, keyword) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function enqueue_keyword_notifications_for_rumor(uuid) from public;
grant execute on function enqueue_keyword_notifications_for_rumor(uuid) to service_role;

create or replace function enqueue_keyword_notifications_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_draft, false) = false and new.publish_at <= now() then
    perform enqueue_keyword_notifications_for_rumor(new.id);
  end if;
  return new;
end;
$$;

revoke all on function enqueue_keyword_notifications_trigger() from public;

drop trigger if exists rumors_keyword_notifications_insert on rumors;
create trigger rumors_keyword_notifications_insert
after insert on rumors
for each row execute function enqueue_keyword_notifications_trigger();

drop trigger if exists rumors_keyword_notifications_publish on rumors;
create trigger rumors_keyword_notifications_publish
after update of is_draft, publish_at, summary, article, category on rumors
for each row
when (coalesce(new.is_draft, false) = false)
execute function enqueue_keyword_notifications_trigger();

create or replace function get_pending_keyword_notifications(p_limit integer default 100)
returns table (
  id uuid,
  user_id uuid,
  rumor_id uuid,
  expo_push_token text,
  title text,
  body text,
  data jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    nq.id,
    nq.user_id,
    nq.rumor_id,
    pd.expo_push_token,
    nq.title,
    nq.body,
    nq.data
  from notification_queue nq
  join push_devices pd on pd.user_id = nq.user_id and pd.enabled = true
  where nq.status = 'pending'
    and nq.attempts < 5
  order by nq.created_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function get_pending_keyword_notifications(integer) from public;
grant execute on function get_pending_keyword_notifications(integer) to service_role;

create or replace function mark_notification_delivered(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_queue
  set status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_error = null
  where id = p_notification_id;
$$;

create or replace function mark_notification_failed(p_notification_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_queue
  set attempts = attempts + 1,
      status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
      last_error = left(coalesce(p_error, 'unknown error'), 500)
  where id = p_notification_id;
$$;

revoke all on function mark_notification_delivered(uuid) from public;
revoke all on function mark_notification_failed(uuid, text) from public;
grant execute on function mark_notification_delivered(uuid) to service_role;
grant execute on function mark_notification_failed(uuid, text) to service_role;
