-- 0044_coin_trading_quotes.sql — quote-backed Kalshi-style coin trading UX
--
-- CODE-READY / HUMAN-GATED:
-- 1. Apply only after 0043_coin_economy_fixed_odds.sql.
-- 2. Still gated by economy_configs.is_active and prediction_placement_killed.
-- 3. Coins remain closed-loop entertainment currency with no cash value.
-- 4. Rollback/disable: set prediction_placement_killed=true; optionally revoke execute on request_fixed_prediction_quote/place_fixed_prediction.

create table if not exists fixed_prediction_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rumor_id uuid not null references rumors (id) on delete cascade,
  outcome_id uuid not null references prediction_outcomes (id),
  outcome_key bet_choice not null,
  probability_version integer not null,
  probability numeric(8,4) not null,
  decimal_odds numeric(12,4) not null,
  economy_config_version integer not null references economy_configs (version),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fixed_prediction_quotes_user_created_idx on fixed_prediction_quotes (user_id, created_at desc);
create index if not exists fixed_prediction_quotes_expiry_idx on fixed_prediction_quotes (expires_at);

alter table fixed_prediction_quotes enable row level security;
drop policy if exists "read own fixed quotes" on fixed_prediction_quotes;
create policy "read own fixed quotes" on fixed_prediction_quotes for select to authenticated using (user_id = auth.uid());

create or replace function request_fixed_prediction_quote(p_rumor_id uuid, p_choice bet_choice)
returns table (
  quote_id uuid,
  rumor_id uuid,
  probability_version integer,
  outcome_id uuid,
  outcome_key text,
  label text,
  probability numeric,
  decimal_odds numeric,
  economy_config_version integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg economy_configs;
  v_rumor rumors;
  v_outcome prediction_outcomes;
  v_quote fixed_prediction_quotes;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  v_cfg := active_economy_config();
  if not v_cfg.is_active or v_cfg.prediction_placement_killed then
    raise exception 'coin trading is disabled';
  end if;

  select * into v_rumor
  from rumors r
  where r.id = p_rumor_id
  for share;

  if not found or v_rumor.is_draft or v_rumor.publish_at > now() or v_rumor.status <> 'speculated' then
    raise exception 'market is not open';
  end if;
  if v_rumor.prediction_deadline is not null and v_rumor.prediction_deadline <= now() then
    raise exception 'market is locked';
  end if;

  select po.* into v_outcome
  from prediction_outcomes po
  join (
    select rumor_id, max(version) as version
    from prediction_market_probability_versions
    where rumor_id = p_rumor_id
    group by rumor_id
  ) latest on latest.rumor_id = po.rumor_id and latest.version = po.probability_version
  where po.rumor_id = p_rumor_id and po.outcome_key = p_choice;

  if not found then
    raise exception 'outcome not found';
  end if;

  insert into fixed_prediction_quotes (
    user_id, rumor_id, outcome_id, outcome_key, probability_version, probability,
    decimal_odds, economy_config_version, expires_at
  ) values (
    v_user, p_rumor_id, v_outcome.id, v_outcome.outcome_key, v_outcome.probability_version, v_outcome.probability,
    v_outcome.decimal_odds, v_cfg.version, now() + interval '45 seconds'
  ) returning * into v_quote;

  return query select
    v_quote.id,
    v_outcome.rumor_id,
    v_outcome.probability_version,
    v_outcome.id,
    v_outcome.outcome_key::text,
    v_outcome.label,
    v_outcome.probability,
    v_outcome.decimal_odds,
    v_outcome.economy_config_version,
    v_quote.expires_at;
end;
$$;

create or replace function place_fixed_prediction(
  p_rumor_id uuid,
  p_choice bet_choice,
  p_stake_coins integer,
  p_probability_version integer,
  p_idempotency_key text,
  p_quote_id uuid default null
)
returns fixed_prediction_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg economy_configs;
  v_rumor rumors;
  v_outcome prediction_outcomes;
  v_quote fixed_prediction_quotes;
  v_existing fixed_prediction_positions;
  v_limits jsonb;
  v_hard_max integer;
  v_position fixed_prediction_positions;
  v_wallet coin_wallets;
  v_ledger wallet_transactions;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 12 then
    raise exception 'idempotency key required';
  end if;
  if p_stake_coins is null or p_stake_coins <= 0 then
    raise exception 'stake must be a positive whole number';
  end if;

  select * into v_existing
  from fixed_prediction_positions
  where placement_idempotency_key = p_idempotency_key and user_id = v_user;
  if found then
    return v_existing;
  end if;

  v_cfg := active_economy_config();
  if not v_cfg.is_active or v_cfg.prediction_placement_killed then
    raise exception 'prediction placement is disabled';
  end if;

  perform ensure_coin_wallet(v_user, v_cfg.version);
  perform grant_starter_coins(v_user);

  select * into v_wallet from coin_wallets where user_id = v_user for update;

  select * into v_rumor
  from rumors r
  where r.id = p_rumor_id
  for share;

  if not found or v_rumor.is_draft or v_rumor.publish_at > now() or v_rumor.status <> 'speculated' then
    raise exception 'market is not open';
  end if;
  if v_rumor.prediction_deadline is not null and v_rumor.prediction_deadline <= now() then
    raise exception 'market is locked';
  end if;

  if p_quote_id is null then
    raise exception 'fresh quote required';
  end if;

  select * into v_quote
  from fixed_prediction_quotes
  where id = p_quote_id and user_id = v_user
  for update;

  if not found then
    raise exception 'quote not found';
  end if;
  if v_quote.used_at is not null then
    raise exception 'quote already used';
  end if;
  if v_quote.expires_at <= now() then
    raise exception 'quote expired';
  end if;
  if v_quote.rumor_id <> p_rumor_id or v_quote.outcome_key <> p_choice or v_quote.probability_version <> p_probability_version then
    raise exception 'quote changed; request a new quote';
  end if;

  select * into v_outcome
  from prediction_outcomes
  where id = v_quote.outcome_id
    and rumor_id = p_rumor_id
    and outcome_key = p_choice
    and probability_version = p_probability_version
    and decimal_odds = v_quote.decimal_odds
    and probability = v_quote.probability;
  if not found then
    raise exception 'quote changed; request a new quote';
  end if;

  if exists (select 1 from fixed_prediction_positions where user_id = v_user and market_id = p_rumor_id) then
    raise exception 'position already exists';
  end if;

  v_hard_max := least(v_cfg.absolute_max_stake_coins, floor(v_wallet.balance * v_cfg.max_wallet_fraction)::integer);
  if p_stake_coins > v_wallet.balance then
    raise exception 'insufficient coin balance';
  end if;
  if p_stake_coins > v_hard_max then
    raise exception 'stake exceeds hard maximum';
  end if;

  insert into fixed_prediction_positions (
    user_id,
    market_id,
    outcome_id,
    stake_coins,
    locked_probability,
    locked_decimal_odds,
    potential_total_return_coins,
    potential_net_win_coins,
    status,
    placement_idempotency_key,
    settlement_reference,
    economy_config_version
  ) values (
    v_user,
    p_rumor_id,
    v_outcome.id,
    p_stake_coins,
    v_quote.probability,
    v_quote.decimal_odds,
    floor(p_stake_coins * v_quote.decimal_odds),
    floor(p_stake_coins * v_quote.decimal_odds) - p_stake_coins,
    'OPEN',
    p_idempotency_key,
    'quote:' || v_quote.id::text,
    v_cfg.version
  ) returning * into v_position;

  update fixed_prediction_quotes set used_at = now() where id = v_quote.id;

  v_ledger := apply_wallet_transaction(
    v_user,
    'PREDICTION_STAKE',
    -p_stake_coins,
    'fixed_position:' || v_position.id::text,
    'stake:' || p_idempotency_key,
    v_cfg.version,
    jsonb_build_object(
      'positionId', v_position.id,
      'marketId', p_rumor_id,
      'outcome', p_choice,
      'quoteId', v_quote.id,
      'lockedProbability', v_quote.probability,
      'lockedDecimalOdds', v_quote.decimal_odds,
      'potentialTotalReturnCoins', v_position.potential_total_return_coins,
      'noCashValue', true
    )
  );

  perform log_product_event(v_user, 'prediction_placed', jsonb_build_object(
    'marketId', p_rumor_id,
    'positionId', v_position.id,
    'stakeCoins', p_stake_coins,
    'lockedDecimalOdds', v_quote.decimal_odds,
    'probabilityVersion', p_probability_version,
    'economyConfigVersion', v_cfg.version
  ));

  return v_position;
end;
$$;

create or replace function get_my_fixed_positions(p_limit integer default 50)
returns table (
  id uuid,
  market_id uuid,
  question text,
  outcome_key text,
  stake_coins integer,
  locked_probability numeric,
  locked_decimal_odds numeric,
  potential_total_return_coins integer,
  potential_net_win_coins integer,
  actual_return_coins integer,
  status text,
  market_status text,
  placed_at timestamptz,
  settled_at timestamptz,
  settlement_reference text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.market_id,
    r.summary,
    po.outcome_key::text,
    p.stake_coins,
    p.locked_probability,
    p.locked_decimal_odds,
    p.potential_total_return_coins,
    p.potential_net_win_coins,
    case
      when p.status = 'OPEN' then null
      when p.status = 'WON' then p.potential_total_return_coins
      when p.status = 'VOID' then p.stake_coins
      else 0
    end,
    p.status::text,
    r.status::text,
    p.placed_at,
    p.settled_at,
    p.settlement_reference
  from fixed_prediction_positions p
  join rumors r on r.id = p.market_id
  join prediction_outcomes po on po.id = p.outcome_id
  where p.user_id = auth.uid()
  order by p.placed_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function request_fixed_prediction_quote(uuid, bet_choice) to authenticated;
grant execute on function place_fixed_prediction(uuid, bet_choice, integer, integer, text, uuid) to authenticated;
grant execute on function get_my_fixed_positions(integer) to authenticated;
