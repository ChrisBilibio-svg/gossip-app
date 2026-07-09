-- 0035_delete_account_social_cleanup.sql — repair LGPD account deletion for post-v1 tables
--
-- The original 0007 delete_my_account() function predated the social feed,
-- reports, notification, analytics, and write-rate-limit tables. Those rows can
-- hold auth.users foreign keys and block the final auth user delete. Replace the
-- RPC with a complete, ordered cleanup so the in-app delete button actually
-- removes the account and owned data.

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated';
  end if;

  -- Newer social/repost data first, while parent rows still exist for triggers.
  delete from social_repost_replies   where user_id = v;
  delete from social_repost_reactions where user_id = v;
  delete from social_reposts          where user_id = v;
  delete from rumor_reactions         where user_id = v;

  -- Reports, notification preferences/devices, analytics, and rate-limit state.
  delete from content_reports          where reporter_id = v;
  delete from push_devices             where user_id = v;
  delete from notification_preferences where user_id = v;
  delete from analytics_events         where user_id = v;
  delete from user_rate_limits         where user_id = v;

  -- Original v1 account-owned data.
  delete from comment_likes   where user_id = v;
  delete from comment_reports where reporter_id = v;
  delete from blocks          where blocker_id = v or blocked_id = v;
  delete from comments        where user_id = v;
  delete from predictions     where user_id = v;
  delete from profiles        where id = v;

  -- Remove the Supabase auth user last. Tables that intentionally retain audit
  -- history use ON DELETE SET NULL and will be anonymized by this delete.
  delete from auth.users where id = v;
end;
$$;

revoke all on function delete_my_account() from public;
revoke all on function delete_my_account() from anon;
grant execute on function delete_my_account() to authenticated;
