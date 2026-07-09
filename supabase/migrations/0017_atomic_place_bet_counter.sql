-- 0017_atomic_place_bet_counter.sql — Remove hot-row pre-lock from betting
--
-- Keep place_bet() write-once and validated, but collapse counter mutation and
-- cast-time crowd capture into one atomic UPDATE ... RETURNING. Duplicate bets
-- still fail through predictions(user_id, rumor_id); PostgreSQL rolls back the
-- counter update when the insert raises 23505.

create or replace function place_bet(p_rumor_id uuid, p_choice bet_choice)
returns predictions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pred predictions;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  with updated_rumor as (
    update rumors
    set
      true_votes = true_votes + (case when p_choice = 'true' then 1 else 0 end),
      false_votes = false_votes + (case when p_choice = 'false' then 1 else 0 end)
    where id = p_rumor_id
      and status = 'speculated'
      and publish_at <= now()
      and coalesce(is_draft, false) = false
    returning
      id,
      seed_true,
      seed_false,
      true_votes - (case when p_choice = 'true' then 1 else 0 end) as previous_true_votes,
      false_votes - (case when p_choice = 'false' then 1 else 0 end) as previous_false_votes
  )
  insert into predictions (user_id, rumor_id, choice, crowd_true_at_cast, crowd_false_at_cast)
  select
    v_user,
    id,
    p_choice,
    seed_true + previous_true_votes,
    seed_false + previous_false_votes
  from updated_rumor
  returning * into v_pred;

  if not found then
    raise exception 'rumor not open';
  end if;

  return v_pred;
end;
$$;

grant execute on function place_bet(uuid, bet_choice) to authenticated;
