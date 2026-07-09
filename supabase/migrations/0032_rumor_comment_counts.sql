-- 0032_rumor_comment_counts.sql — expose comment counts for "Mais comentados"
--
-- Adds a denormalized `comment_count` to rumors so feed filtering/sorting can use
-- a cheap per-rumor count without scanning comments for every feed request.
-- Counts visible comments only; hidden/removed comments do not boost ranking.
--
-- Re-runnable.

alter table rumors
  add column if not exists comment_count integer not null default 0;

alter table rumors
  drop constraint if exists rumors_comment_count_nonnegative;

alter table rumors
  add constraint rumors_comment_count_nonnegative check (comment_count >= 0);

create index if not exists rumors_comment_count_published_idx
  on rumors (comment_count desc, created_at desc)
  where coalesce(is_draft, false) = false;

update rumors r
set comment_count = coalesce(c.visible_count, 0)
from (
  select rumor_id, count(*)::integer as visible_count
  from comments
  where status = 'visible'
  group by rumor_id
) c
where c.rumor_id = r.id;

update rumors r
set comment_count = 0
where not exists (
  select 1
  from comments c
  where c.rumor_id = r.id
    and c.status = 'visible'
);

create or replace function refresh_rumor_comment_count(p_rumor_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update rumors r
  set comment_count = (
    select count(*)::integer
    from comments c
    where c.rumor_id = p_rumor_id
      and c.status = 'visible'
  )
  where r.id = p_rumor_id;
$$;

revoke all on function refresh_rumor_comment_count(uuid) from public;
revoke all on function refresh_rumor_comment_count(uuid) from anon, authenticated;

create or replace function bump_rumor_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform refresh_rumor_comment_count(new.rumor_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform refresh_rumor_comment_count(new.rumor_id);
    if old.rumor_id is distinct from new.rumor_id then
      perform refresh_rumor_comment_count(old.rumor_id);
    end if;
    return new;
  else
    perform refresh_rumor_comment_count(old.rumor_id);
    return old;
  end if;
end;
$$;

revoke all on function bump_rumor_comment_count() from public;
revoke all on function bump_rumor_comment_count() from anon, authenticated;

drop trigger if exists comments_rumor_comment_count_insert on comments;
create trigger comments_rumor_comment_count_insert
after insert on comments
for each row execute function bump_rumor_comment_count();

drop trigger if exists comments_rumor_comment_count_update on comments;
create trigger comments_rumor_comment_count_update
after update of status, rumor_id on comments
for each row execute function bump_rumor_comment_count();

drop trigger if exists comments_rumor_comment_count_delete on comments;
create trigger comments_rumor_comment_count_delete
after delete on comments
for each row execute function bump_rumor_comment_count();

drop function if exists get_feed(integer);

create or replace function get_feed(p_limit integer default 30)
returns table (
  id uuid,
  summary text,
  article text,
  category text,
  status rumor_status,
  is_hero boolean,
  source_url text,
  prediction_deadline timestamptz,
  resolution_policy text,
  required_source_count integer,
  created_at timestamptz,
  resolved_at timestamptz,
  seed_true integer,
  seed_false integer,
  true_votes integer,
  false_votes integer,
  like_count integer,
  dislike_count integer,
  comment_count integer,
  my_choice bet_choice,
  my_reaction smallint,
  rumor_evidence_sources jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.summary,
    r.article,
    nullif(btrim(r.category), '') as category,
    r.status,
    r.is_hero,
    r.source_url,
    r.prediction_deadline,
    r.resolution_policy,
    r.required_source_count,
    r.created_at,
    r.resolved_at,
    r.seed_true,
    r.seed_false,
    r.true_votes,
    r.false_votes,
    r.like_count,
    r.dislike_count,
    r.comment_count,
    p.choice as my_choice,
    rr.value as my_reaction,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'source_url', es.source_url,
          'source_label', es.source_label,
          'supports_outcome', es.supports_outcome,
          'note', es.note
        ) order by es.created_at desc
      ) filter (where es.id is not null),
      '[]'::jsonb
    ) as rumor_evidence_sources
  from rumors r
  left join rumor_evidence_sources es on es.rumor_id = r.id
  left join predictions p
    on p.rumor_id = r.id
   and p.user_id = auth.uid()
  left join rumor_reactions rr
    on rr.rumor_id = r.id
   and rr.user_id = auth.uid()
  where r.publish_at <= now()
    and coalesce(r.is_draft, false) = false
  group by
    r.id,
    p.choice,
    rr.value
  order by r.is_hero desc, r.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke all on function get_feed(integer) from public;
grant execute on function get_feed(integer) to anon, authenticated;

drop function if exists search_rumors(text, integer);

create or replace function search_rumors(p_query text, p_limit integer default 50)
returns table (
  id uuid,
  summary text,
  article text,
  category text,
  status rumor_status,
  is_hero boolean,
  source_url text,
  prediction_deadline timestamptz,
  resolution_policy text,
  required_source_count integer,
  created_at timestamptz,
  resolved_at timestamptz,
  seed_true integer,
  seed_false integer,
  true_votes integer,
  false_votes integer,
  like_count integer,
  dislike_count integer,
  comment_count integer,
  my_choice bet_choice,
  my_reaction smallint,
  rumor_evidence_sources jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.summary,
    r.article,
    nullif(btrim(r.category), '') as category,
    r.status,
    r.is_hero,
    r.source_url,
    r.prediction_deadline,
    r.resolution_policy,
    r.required_source_count,
    r.created_at,
    r.resolved_at,
    r.seed_true,
    r.seed_false,
    r.true_votes,
    r.false_votes,
    r.like_count,
    r.dislike_count,
    r.comment_count,
    p.choice as my_choice,
    rr.value as my_reaction,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'source_url', es.source_url,
          'source_label', es.source_label,
          'supports_outcome', es.supports_outcome,
          'note', es.note
        ) order by es.created_at desc
      ) filter (where es.id is not null),
      '[]'::jsonb
    ) as rumor_evidence_sources
  from rumors r
  left join rumor_evidence_sources es on es.rumor_id = r.id
  left join predictions p
    on p.rumor_id = r.id
   and p.user_id = auth.uid()
  left join rumor_reactions rr
    on rr.rumor_id = r.id
   and rr.user_id = auth.uid()
  where r.publish_at <= now()
    and coalesce(r.is_draft, false) = false
    and (
      lower(unaccent(coalesce(r.summary, ''))) ilike '%' || lower(unaccent(coalesce(p_query, ''))) || '%'
      or lower(unaccent(coalesce(r.article, ''))) ilike '%' || lower(unaccent(coalesce(p_query, ''))) || '%'
      or lower(unaccent(coalesce(r.category, ''))) ilike '%' || lower(unaccent(coalesce(p_query, ''))) || '%'
    )
  group by
    r.id,
    p.choice,
    rr.value
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function search_rumors(text, integer) from public;
grant execute on function search_rumors(text, integer) to anon, authenticated;
