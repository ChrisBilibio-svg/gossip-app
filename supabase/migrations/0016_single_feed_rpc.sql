-- 0016_single_feed_rpc.sql — One-call published feed payload
--
-- Replaces client-side fan-out over rumors + predictions + rumor reactions with a
-- single SECURITY DEFINER RPC. The function still enforces the public feed scope
-- itself because SECURITY DEFINER bypasses table RLS.

create or replace function get_feed(p_limit integer default 30)
returns table (
  id uuid,
  summary text,
  article text,
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
