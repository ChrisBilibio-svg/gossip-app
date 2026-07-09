-- 0034_rumor_odds_history.sql — TEA probability history for market sparklines
--
-- Lightweight periodic snapshots of visible open rumor odds. The client receives
-- recent TEA percentages (oldest → newest) as `odds_history`, allowing market
-- cards/detail to render real sparkline movement instead of placeholders.
-- Re-runnable; Chris applies manually in Supabase.

create table if not exists rumor_odds_snapshots (
  rumor_id uuid not null references rumors (id) on delete cascade,
  captured_at timestamptz not null default now(),
  tea_pct integer not null check (tea_pct between 0 and 100),
  volume integer not null check (volume >= 0),
  primary key (rumor_id, captured_at)
);

create index if not exists rumor_odds_snapshots_recent_idx
  on rumor_odds_snapshots (rumor_id, captured_at desc);

alter table rumor_odds_snapshots enable row level security;

drop policy if exists "read odds snapshots for visible rumors" on rumor_odds_snapshots;

create policy "read odds snapshots for visible rumors"
  on rumor_odds_snapshots for select
  to anon, authenticated
  using (
    exists (
      select 1
      from rumors r
      where r.id = rumor_odds_snapshots.rumor_id
        and coalesce(r.is_draft, false) = false
        and r.publish_at <= now()
    )
  );

create or replace function snapshot_rumor_odds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into rumor_odds_snapshots (rumor_id, tea_pct, volume)
  select
    r.id,
    case
      when (r.seed_true + r.seed_false + r.true_votes + r.false_votes) <= 0 then 50
      else round((r.seed_true + r.true_votes) * 100.0 / (r.seed_true + r.seed_false + r.true_votes + r.false_votes))::integer
    end as tea_pct,
    greatest(r.seed_true + r.seed_false + r.true_votes + r.false_votes, 0)::integer as volume
  from rumors r
  where r.status = 'speculated'
    and coalesce(r.is_draft, false) = false
    and r.publish_at <= now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function snapshot_rumor_odds() from public;

create or replace function get_rumor_odds_history(p_rumor_id uuid, p_limit integer default 8)
returns table (
  tea_pct integer,
  captured_at timestamptz,
  volume integer
)
language sql
security definer
set search_path = public
stable
as $$
  select h.tea_pct, h.captured_at, h.volume
  from (
    select s.tea_pct, s.captured_at, s.volume
    from rumor_odds_snapshots s
    join rumors r on r.id = s.rumor_id
    where s.rumor_id = p_rumor_id
      and coalesce(r.is_draft, false) = false
      and r.publish_at <= now()
    order by s.captured_at desc
    limit least(greatest(coalesce(p_limit, 8), 1), 48)
  ) h
  order by captured_at asc;
$$;

revoke all on function get_rumor_odds_history(uuid, integer) from public;
grant execute on function get_rumor_odds_history(uuid, integer) to anon, authenticated;

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
  rumor_evidence_sources jsonb,
  odds_history integer[]
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
    ) as rumor_evidence_sources,
    coalesce(
      (
        select array_agg(recent.tea_pct order by recent.captured_at asc)
        from get_rumor_odds_history(r.id, 8) recent
      ),
      '{}'::integer[]
    ) as odds_history
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
  rumor_evidence_sources jsonb,
  odds_history integer[]
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
    ) as rumor_evidence_sources,
    coalesce(
      (
        select array_agg(recent.tea_pct order by recent.captured_at asc)
        from get_rumor_odds_history(r.id, 8) recent
      ),
      '{}'::integer[]
    ) as odds_history
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
