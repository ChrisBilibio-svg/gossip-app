-- 0010_auto_debunk.sql — Bot v2 stale Speculated cleanup
--
-- Resolves old published, non-draft Speculated rumors as Debunked. This keeps
-- open loops from going stale and rewards users who called CAP when no credible
-- confirmation arrived within the configured window.

create or replace function auto_debunk_stale_rumors(p_days integer default 7, p_limit integer default 25)
returns table (rumor_id uuid, summary text, published_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r rumors;
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 250);
begin
  for r in
    select *
    from rumors
    where status = 'speculated'
      and publish_at <= now() - make_interval(days => v_days)
      and coalesce(is_draft, false) = false
    order by publish_at asc
    limit v_limit
    for update skip locked
  loop
    perform resolve_rumor(r.id, false);

    insert into audit_log (actor_id, action, rumor_id, detail)
    values (
      null,
      'auto_debunk',
      r.id,
      jsonb_build_object(
        'days', v_days,
        'reason', 'stale_speculated_without_confirmation',
        'published_at', r.publish_at
      )
    );

    rumor_id := r.id;
    summary := r.summary;
    published_at := r.publish_at;
    return next;
  end loop;
end;
$$;

-- Service-role automation only. Do not grant to anon/authenticated users.
revoke all on function auto_debunk_stale_rumors(integer, integer) from public;
grant execute on function auto_debunk_stale_rumors(integer, integer) to service_role;
