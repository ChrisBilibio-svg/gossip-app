-- 0002_predictions.sql — Predictions + place_bet (Story 2.1 / FR5, FR6, FR9)

create type bet_choice as enum ('true', 'false');

create table predictions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) default auth.uid(),
  rumor_id            uuid not null references rumors (id),
  choice              bet_choice not null,
  -- cast-time capture: required for skill-weighted scoring (Story 3.1)
  crowd_true_at_cast  integer not null,
  crowd_false_at_cast integer not null,
  cast_at             timestamptz not null default now(),
  -- filled at resolution (Story 3.x)
  is_correct          boolean,
  points_awarded      integer,
  scored_at           timestamptz,
  -- write-once: one locked bet per user per rumor
  unique (user_id, rumor_id)
);

create index predictions_user_idx on predictions (user_id);

-- RLS: a user can read ONLY their own predictions. No direct INSERT policy —
-- all bets go through place_bet() (SECURITY DEFINER), which enforces the rules.
alter table predictions enable row level security;

create policy "read own predictions"
  on predictions for select
  to authenticated
  using (user_id = auth.uid());

-- Atomic, validated bet placement.
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

  -- lock the rumor row so the counter update is atomic
  select * into v_rumor from rumors where id = p_rumor_id for update;
  if not found then
    raise exception 'rumor not found';
  end if;
  if v_rumor.status <> 'speculated' then
    raise exception 'rumor not open for betting';
  end if;
  if v_rumor.publish_at > now() then
    raise exception 'rumor not published yet';
  end if;

  -- record the bet, capturing the crowd split at this moment
  insert into predictions (user_id, rumor_id, choice, crowd_true_at_cast, crowd_false_at_cast)
  values (
    v_user,
    p_rumor_id,
    p_choice,
    v_rumor.seed_true + v_rumor.true_votes,
    v_rumor.seed_false + v_rumor.false_votes
  )
  returning * into v_pred;  -- UNIQUE(user_id, rumor_id) raises 23505 on a second bet

  -- bump the real counter
  update rumors set
    true_votes  = true_votes  + (case when p_choice = 'true'  then 1 else 0 end),
    false_votes = false_votes + (case when p_choice = 'false' then 1 else 0 end)
  where id = p_rumor_id;

  return v_pred;
end;
$$;

grant execute on function place_bet(uuid, bet_choice) to authenticated;
