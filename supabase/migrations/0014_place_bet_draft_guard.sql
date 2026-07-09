-- 0014_place_bet_draft_guard.sql — Prevent betting on curator drafts
--
-- Draft rumors are hidden from the public feed by RLS, but place_bet() is a
-- SECURITY DEFINER RPC. It must independently reject drafts so a guessed rumor
-- id cannot receive bets before curator approval.

create or replace function place_bet(p_rumor_id uuid, p_choice bet_choice)
returns predictions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_rumor rumors;
  v_pred  predictions;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the rumor row so the counter update remains atomic.
  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then
    raise exception 'rumor not found';
  end if;

  -- Drafts are curator-only and must not accept bets even if their UUID leaks.
  if coalesce(v_rumor.is_draft, false) then
    raise exception 'rumor not open';
  end if;

  if v_rumor.status <> 'speculated' then
    raise exception 'rumor not open for betting';
  end if;
  if v_rumor.publish_at > now() then
    raise exception 'rumor not published yet';
  end if;

  -- Record the bet, capturing the crowd split at this moment.
  insert into predictions (user_id, rumor_id, choice, crowd_true_at_cast, crowd_false_at_cast)
  values (
    v_user,
    p_rumor_id,
    p_choice,
    v_rumor.seed_true + v_rumor.true_votes,
    v_rumor.seed_false + v_rumor.false_votes
  )
  returning * into v_pred;  -- UNIQUE(user_id, rumor_id) raises 23505 on a second bet.

  -- Bump the real counter.
  update rumors set
    true_votes  = true_votes  + (case when p_choice = 'true'  then 1 else 0 end),
    false_votes = false_votes + (case when p_choice = 'false' then 1 else 0 end)
  where id = p_rumor_id;

  return v_pred;
end;
$$;

grant execute on function place_bet(uuid, bet_choice) to authenticated;
