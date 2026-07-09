-- 0025_moderation_queue_rpc.sql — unified curator moderation queue
--
-- Merges legacy comment_reports with generic content_reports for future admin
-- tooling. The RPC is callable by authenticated users, but it immediately gates
-- on is_curator() and returns only unresolved/open report rows.

create or replace function get_moderation_queue(p_limit integer default 50)
returns table (
  report_kind text,
  target_type text,
  target_id uuid,
  report_id uuid,
  reporter_id uuid,
  reason text,
  status text,
  created_at timestamptz,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_curator() then
    raise exception 'not a curator';
  end if;

  return query
  select *
  from (
    select
      'comment_report'::text as report_kind,
      'comment'::text as target_type,
      cr.comment_id as target_id,
      cr.id as report_id,
      cr.reporter_id,
      coalesce(nullif(btrim(cr.reason), ''), 'unspecified')::text as reason,
      case when cr.resolved then 'resolved' else 'open' end::text as status,
      cr.created_at,
      jsonb_build_object(
        'comment_id', cr.comment_id,
        'resolved', cr.resolved
      ) as metadata
    from comment_reports cr
    where cr.resolved = false

    union all

    select
      'content_report'::text as report_kind,
      cpr.target_type,
      cpr.target_id,
      cpr.id as report_id,
      cpr.reporter_id,
      cpr.reason,
      cpr.status,
      cpr.created_at,
      jsonb_build_object(
        'details', cpr.details,
        'reviewed_by', cpr.reviewed_by,
        'reviewed_at', cpr.reviewed_at
      ) as metadata
    from content_reports cpr
    where cpr.status in ('open', 'reviewing')
  ) queue
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function get_moderation_queue(integer) from public;
grant execute on function get_moderation_queue(integer) to authenticated;
