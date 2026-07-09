-- 0026_moderation_audit_triggers.sql — audit moderation state changes
--
-- Uses the append-only admin_audit_events table from 0021 to record curator-facing
-- moderation decisions. These triggers only log state transitions, not routine
-- edits that leave moderation status unchanged.

create or replace function audit_content_report_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.status is distinct from new.status then
    perform log_admin_audit_event(
      'content_report_status_change',
      'content_reports',
      new.id,
      jsonb_build_object(
        'target_type', new.target_type,
        'target_id', new.target_id,
        'old_status', old.status,
        'new_status', new.status,
        'reviewed_by', new.reviewed_by,
        'reviewed_at', new.reviewed_at
      )
    );
  end if;

  return new;
end;
$$;

create or replace function audit_comment_report_resolution_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.resolved is distinct from new.resolved then
    perform log_admin_audit_event(
      'comment_report_resolution_change',
      'comment_reports',
      new.id,
      jsonb_build_object(
        'comment_id', new.comment_id,
        'old_resolved', old.resolved,
        'new_resolved', new.resolved
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists content_reports_audit_status_change on content_reports;
create trigger content_reports_audit_status_change
after update on content_reports
for each row execute function audit_content_report_status_change();

drop trigger if exists comment_reports_audit_resolution_change on comment_reports;
create trigger comment_reports_audit_resolution_change
after update on comment_reports
for each row execute function audit_comment_report_resolution_change();

revoke all on function audit_content_report_status_change() from public;
revoke all on function audit_comment_report_resolution_change() from public;
