-- 0007_delete_account.sql — LGPD / store-required account deletion (Story 6.3 / NFR2)

create or replace function delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated';
  end if;

  -- remove the user's data, then the auth user itself
  delete from comment_likes   where user_id = v;
  delete from comment_reports where reporter_id = v;
  delete from blocks          where blocker_id = v or blocked_id = v;
  delete from comments        where user_id = v;
  delete from predictions     where user_id = v;
  delete from profiles        where id = v;
  delete from auth.users      where id = v;
end;
$$;

grant execute on function delete_my_account() to authenticated;
