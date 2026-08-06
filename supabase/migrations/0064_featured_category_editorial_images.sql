-- 0064_featured_category_editorial_images.sql
-- Optional, attributed Pexels artwork for one published market per category/day.
-- The feed/search RPCs are intentionally unchanged so this migration remains
-- compatible with databases that have not applied every intermediate RPC shape.

alter table rumors
  add column if not exists editorial_image_url text,
  add column if not exists editorial_image_alt text,
  add column if not exists editorial_image_page_url text,
  add column if not exists editorial_image_photographer text,
  add column if not exists editorial_image_photographer_url text,
  add column if not exists editorial_image_provider text,
  add column if not exists editorial_image_provider_id text,
  add column if not exists editorial_image_descriptor text,
  add column if not exists editorial_image_feature_date date;

alter table rumors
  drop constraint if exists rumors_editorial_image_complete,
  drop constraint if exists rumors_editorial_image_safe;

alter table rumors
  add constraint rumors_editorial_image_complete check (
    num_nonnulls(
      editorial_image_url,
      editorial_image_alt,
      editorial_image_page_url,
      editorial_image_photographer,
      editorial_image_photographer_url,
      editorial_image_provider,
      editorial_image_provider_id,
      editorial_image_descriptor,
      editorial_image_feature_date
    ) in (0, 9)
  ),
  add constraint rumors_editorial_image_safe check (
    editorial_image_url is null
    or (
      editorial_image_provider = 'pexels'
      and editorial_image_url ~ '^https://images\.pexels\.com/'
      and editorial_image_page_url ~ '^https://(www\.)?pexels\.com/photo/'
      and editorial_image_photographer_url ~ '^https://(www\.)?pexels\.com/'
      and char_length(editorial_image_url) between 20 and 2048
      and char_length(editorial_image_page_url) between 20 and 2048
      and char_length(editorial_image_photographer_url) between 20 and 2048
      and char_length(btrim(editorial_image_alt)) between 10 and 180
      and char_length(btrim(editorial_image_photographer)) between 1 and 120
      and char_length(btrim(editorial_image_provider_id)) between 1 and 32
      and editorial_image_provider_id ~ '^[0-9]+$'
      and char_length(btrim(editorial_image_descriptor)) between 3 and 100
      and editorial_image_alt !~ '[<>{}]'
      and editorial_image_photographer !~ '[<>{}]'
      and editorial_image_descriptor !~ '[<>{}]'
    )
  );

drop index if exists rumors_one_editorial_image_per_category_day_idx;

create unique index rumors_one_editorial_image_per_category_day_idx
  on rumors (lower(translate(btrim(category), 'Úú', 'Uu')), editorial_image_feature_date)
  where editorial_image_url is not null;

create or replace function service_assign_daily_editorial_image(
  p_rumor_id uuid,
  p_feature_date date,
  p_image_url text,
  p_image_alt text,
  p_image_page_url text,
  p_photographer text,
  p_photographer_url text,
  p_provider_id text,
  p_descriptor text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target rumors%rowtype;
  v_category text;
  v_normalized_category text;
  v_locked_category text;
  v_newest_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_feature_date is null
    or p_image_url !~ '^https://images\.pexels\.com/'
    or p_image_page_url !~ '^https://(www\.)?pexels\.com/photo/'
    or p_photographer_url !~ '^https://(www\.)?pexels\.com/'
    or char_length(btrim(coalesce(p_image_alt, ''))) not between 10 and 180
    or char_length(btrim(coalesce(p_photographer, ''))) not between 1 and 120
    or coalesce(p_provider_id, '') !~ '^[0-9]{1,32}$'
    or char_length(btrim(coalesce(p_descriptor, ''))) not between 3 and 100
  then
    raise exception 'invalid editorial image metadata' using errcode = '22023';
  end if;

  select btrim(coalesce(category, '')) into v_category
  from rumors
  where id = p_rumor_id;

  if not found then
    raise exception 'rumor is not eligible for editorial imagery' using errcode = '22023';
  end if;

  v_normalized_category := lower(translate(v_category, 'Úú', 'Uu'));
  if v_normalized_category not in ('celebridades', 'bbb', 'futebol', 'musica', 'novelas', 'influencers') then
    raise exception 'unsupported editorial image category' using errcode = '22023';
  end if;

  -- Serialize every caller for the same category/day before locking a target row.
  perform pg_advisory_xact_lock(hashtextextended(v_normalized_category || '|' || p_feature_date::text, 0));

  select * into v_target
  from rumors
  where id = p_rumor_id
  for update;

  v_locked_category := lower(translate(btrim(coalesce(v_target.category, '')), 'Úú', 'Uu'));

  if not found
    or coalesce(v_target.is_draft, false)
    or v_target.status::text <> 'speculated'
    or v_target.publish_at is null
    or v_target.publish_at > now()
    or (v_target.prediction_deadline is not null and v_target.prediction_deadline <= now())
    or (v_target.publish_at at time zone 'America/Sao_Paulo')::date <> p_feature_date
    or p_feature_date <> (now() at time zone 'America/Sao_Paulo')::date
    or v_locked_category <> v_normalized_category
  then
    raise exception 'rumor is not eligible for editorial imagery' using errcode = '22023';
  end if;

  select r.id into v_newest_id
  from rumors r
  where coalesce(r.is_draft, false) = false
    and r.status::text = 'speculated'
    and r.publish_at is not null
    and r.publish_at <= now()
    and (r.prediction_deadline is null or r.prediction_deadline > now())
    and (r.publish_at at time zone 'America/Sao_Paulo')::date = p_feature_date
    and lower(translate(btrim(coalesce(r.category, '')), 'Úú', 'Uu')) = v_normalized_category
  order by r.publish_at desc, r.created_at desc nulls last, r.id desc
  limit 1;

  if v_newest_id is distinct from p_rumor_id then
    raise exception 'rumor is not the newest eligible category winner' using errcode = '40001';
  end if;

  -- Validation and target locking happen before the prior winner is cleared.
  -- Any later failure rolls this whole function back transactionally.
  update rumors
  set editorial_image_url = null,
      editorial_image_alt = null,
      editorial_image_page_url = null,
      editorial_image_photographer = null,
      editorial_image_photographer_url = null,
      editorial_image_provider = null,
      editorial_image_provider_id = null,
      editorial_image_descriptor = null,
      editorial_image_feature_date = null
  where id <> p_rumor_id
    and lower(translate(btrim(category), 'Úú', 'Uu')) = v_normalized_category
    and editorial_image_feature_date = p_feature_date
    and editorial_image_url is not null;

  update rumors
  set editorial_image_url = btrim(p_image_url),
      editorial_image_alt = btrim(p_image_alt),
      editorial_image_page_url = btrim(p_image_page_url),
      editorial_image_photographer = btrim(p_photographer),
      editorial_image_photographer_url = btrim(p_photographer_url),
      editorial_image_provider = 'pexels',
      editorial_image_provider_id = btrim(p_provider_id),
      editorial_image_descriptor = btrim(p_descriptor),
      editorial_image_feature_date = p_feature_date
  where id = p_rumor_id;

  return true;
end;
$$;

revoke all on function service_assign_daily_editorial_image(uuid, date, text, text, text, text, text, text, text) from public;
revoke all on function service_assign_daily_editorial_image(uuid, date, text, text, text, text, text, text, text) from anon, authenticated;
grant execute on function service_assign_daily_editorial_image(uuid, date, text, text, text, text, text, text, text) to service_role;
