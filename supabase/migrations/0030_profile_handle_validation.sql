-- 0030_profile_handle_validation.sql — DB-enforced profile handle safety
--
-- Rerunnable replacement for set_handle(). Handles are shown in social surfaces,
-- comments, profiles, and leaderboards, so keep the database as the source of
-- truth for length/character/reserved-name constraints instead of relying on UI.

create or replace function set_handle(p_handle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_handle is null or v_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid handle';
  end if;

  if v_handle in (
    'admin',
    'administrator',
    'fofoca',
    'fofoca_app',
    'suporte',
    'support',
    'moderador',
    'moderadora',
    'curador',
    'curadora',
    'pastorfred',
    'system',
    'sistema'
  ) then
    raise exception 'invalid handle';
  end if;

  update profiles
  set handle = v_handle
  where id = auth.uid();
end;
$$;

revoke all on function set_handle(text) from public;
grant execute on function set_handle(text) to authenticated;
