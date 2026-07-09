-- 0011_prediction_deadlines.sql — Evidence-first resolution + explicit prediction deadlines
--
-- Supersedes the time-only auto-debunk idea from 0010. Rumors should stay
-- Speculated until multiple credible sources confirm/disprove them, unless the
-- curator intentionally writes a time-bounded prediction with a concrete deadline.

-- Disable the stale-age-only resolver so future automation cannot treat mere age
-- as proof of CAP.
drop function if exists auto_debunk_stale_rumors(integer, integer);

alter table rumors
  add column if not exists prediction_deadline timestamptz,
  add column if not exists resolution_policy text not null default 'evidence',
  add column if not exists required_source_count integer not null default 2,
  add column if not exists resolution_reason text;

alter table rumors
  add constraint rumors_resolution_policy_check
    check (resolution_policy in ('evidence', 'deadline'));

alter table rumors
  add constraint rumors_required_source_count_check
    check (required_source_count >= 1 and required_source_count <= 5);

alter table rumors
  add constraint rumors_deadline_policy_requires_deadline_check
    check (resolution_policy <> 'deadline' or prediction_deadline is not null);

create index if not exists rumors_deadline_idx
  on rumors (prediction_deadline asc)
  where status = 'speculated' and resolution_policy = 'deadline' and coalesce(is_draft, false) = false;

create or replace function resolve_expired_prediction_deadlines(p_limit integer default 25)
returns table (rumor_id uuid, summary text, prediction_deadline timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r rumors;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 250);
begin
  for r in
    select rr.*
    from rumors as rr
    where rr.status = 'speculated'
      and rr.resolution_policy = 'deadline'
      and rr.prediction_deadline <= now()
      and coalesce(rr.is_draft, false) = false
    order by rr.prediction_deadline asc
    limit v_limit
    for update skip locked
  loop
    perform resolve_rumor(r.id, false);

    update rumors
    set resolution_reason = 'deadline_expired_without_confirmation'
    where id = r.id;

    insert into audit_log (actor_id, action, rumor_id, detail)
    values (
      null,
      'deadline_expired',
      r.id,
      jsonb_build_object(
        'reason', 'deadline_expired_without_confirmation',
        'prediction_deadline', r.prediction_deadline
      )
    );

    rumor_id := r.id;
    summary := r.summary;
    prediction_deadline := r.prediction_deadline;
    return next;
  end loop;
end;
$$;

-- Service-role automation only. Curators still resolve manually through the admin.
revoke all on function resolve_expired_prediction_deadlines(integer) from public;
grant execute on function resolve_expired_prediction_deadlines(integer) to service_role;
