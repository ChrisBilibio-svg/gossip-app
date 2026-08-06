-- 0065_exchange_v2_lmsr_house_amm.sql — exchange-v2 LMSR house AMM liquidity seed
--
-- CODE-READY / HUMAN-GATED:
-- - Chris/Claude applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update
--   exchange_feature_gates and never sets trading_enabled / production_approved.
-- - Coins remain closed-loop entertainment units with no cash value, withdrawal,
--   redemption, prizes, or crypto conversion.
-- - Legacy fixed-odds betting is not reinterpreted or mutated.
--
-- M10 / 0065:
-- - Add a volume-adaptive liquidity-sensitive LMSR house AMM for exchange_v2.
-- - The AMM is additive beside the CLOB: quote_amm_v2 / execute_amm_trade_v2
--   serve casual market orders, while place_order_v2 keeps resting limit orders.
-- - LMSR math follows Othman, Pennock, Reeves, Sandholm,
--   "A Practical Liquidity-Sensitive Automated Market Maker":
--     b(q)=b0+alpha*sum(q),
--     C(q)=b(q)*ln(sum_i exp(q_i/b(q))),
--     p_i=dC/dq_i = pi_i + alpha*ln(sum exp(q/b))
--          - (alpha/b(q))*sum_j(q_j*pi_j),
--   evaluated with log-sum-exp for numeric stability.

alter table exchange_markets
  add column if not exists amm_enabled boolean not null default false,
  add column if not exists amm_b0 numeric(24,6),
  add column if not exists amm_alpha numeric(18,8),
  add column if not exists amm_max_house_mint_coins numeric(24,6),
  add column if not exists amm_q_yes numeric(24,6) not null default 0,
  add column if not exists amm_q_no numeric(24,6) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exchange_markets'::regclass
      and conname = 'exchange_markets_amm_config_check'
  ) then
    alter table exchange_markets
      add constraint exchange_markets_amm_config_check
      check (
        (not amm_enabled and amm_b0 is null and amm_alpha is null and amm_max_house_mint_coins is null)
        or (
          amm_enabled
          and amm_b0 is not null and amm_b0 > 0
          and amm_alpha is not null and amm_alpha >= 0 and amm_alpha < 0.50
          and amm_max_house_mint_coins is not null and amm_max_house_mint_coins >= 0
        )
      ) not valid;
  end if;
end $$;

alter table exchange_markets validate constraint exchange_markets_amm_config_check;

create table if not exists exchange_amm_house_accounts (
  id text primary key default 'exchange_v2_lmsr_house',
  description text not null default 'Reserved system principal for exchange v2 LMSR AMM inventory and bounded house mint accounting.',
  created_at timestamptz not null default now(),
  check (id = 'exchange_v2_lmsr_house')
);

insert into exchange_amm_house_accounts (id)
values ('exchange_v2_lmsr_house')
on conflict (id) do nothing;

create table if not exists exchange_amm_house_ledger (
  id uuid primary key default gen_random_uuid(),
  house_account_id text not null references exchange_amm_house_accounts (id),
  event_id uuid not null,
  market_id uuid not null references exchange_markets (market_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  quote_id uuid references exchange_order_quotes (id) on delete set null,
  entry_type text not null check (entry_type in ('house_mint_reserved','buy_from_house','sell_to_house','house_inventory','settlement_marker')),
  amount numeric(24,6) not null check (amount >= 0),
  currency text not null check (currency in ('COIN','SHARE_TRUE','SHARE_FALSE')),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists exchange_amm_house_ledger_market_created_idx on exchange_amm_house_ledger (market_id, created_at desc);

create or replace function exchange_amm_house_net_coin_mint_v2(p_market_id uuid)
returns numeric
language sql
stable
as $$
  select round(coalesce(sum(case
    when entry_type in ('sell_to_house', 'settlement_marker') then amount
    when entry_type = 'buy_from_house' then -amount
    else 0
  end), 0), 6)
  from exchange_amm_house_ledger
  where market_id = p_market_id
    and currency = 'COIN';
$$;

create or replace function exchange_assert_amm_house_mint_cap_v2(
  p_market_id uuid,
  p_cap numeric,
  p_net_mint numeric
)
returns void
language plpgsql
stable
as $$
begin
  if p_cap is null or p_cap < 0 then
    raise exception 'AMM house mint cap missing';
  end if;
  if coalesce(p_net_mint, 0) > p_cap then
    raise exception 'AMM house mint cap exceeded';
  end if;
end;
$$;

create or replace function exchange_amm_house_settlement_exposure_v2(
  p_market_id uuid,
  p_outcome exchange_settlement_outcome
)
returns numeric
language sql
stable
as $$
  select greatest(round(coalesce(sum(
    (case
      when entry_type = 'buy_from_house' then 1
      when entry_type = 'sell_to_house' then -1
      else 0
    end)
    * coalesce((metadata->>'quantity')::numeric, 0)
    * case
      when p_outcome = 'void' then 0.500000
      when p_outcome::text = metadata->>'outcome' then 1.000000
      else 0.000000
    end
  ), 0), 6), 0)
  from exchange_amm_house_ledger
  where market_id = p_market_id
    and entry_type in ('buy_from_house', 'sell_to_house');
$$;

create or replace function exchange_lmsr_b_v2(
  p_q_yes numeric,
  p_q_no numeric,
  p_b0 numeric,
  p_alpha numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_b numeric;
begin
  if p_b0 is null or p_b0 <= 0 then raise exception 'amm_b0 must be positive'; end if;
  if p_alpha is null or p_alpha < 0 or p_alpha >= 0.50 then raise exception 'amm_alpha out of range'; end if;
  v_b := p_b0 + p_alpha * (coalesce(p_q_yes, 0) + coalesce(p_q_no, 0));
  if v_b <= 0 then raise exception 'liquidity-sensitive LMSR b(q) must stay positive'; end if;
  return v_b;
end;
$$;

create or replace function exchange_lmsr_state_v2(
  p_q_yes numeric,
  p_q_no numeric,
  p_b0 numeric,
  p_alpha numeric
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_b numeric := exchange_lmsr_b_v2(p_q_yes, p_q_no, p_b0, p_alpha);
  v_a_yes numeric := coalesce(p_q_yes, 0) / v_b;
  v_a_no numeric := coalesce(p_q_no, 0) / v_b;
  v_m numeric := greatest(v_a_yes, v_a_no);
  v_e_yes numeric := exp(v_a_yes - v_m);
  v_e_no numeric := exp(v_a_no - v_m);
  v_sum numeric := v_e_yes + v_e_no;
  v_log_sum numeric := v_m + ln(v_sum);
  v_pi_yes numeric := v_e_yes / v_sum;
  v_pi_no numeric := v_e_no / v_sum;
  v_weighted_q numeric := coalesce(p_q_yes, 0) * v_pi_yes + coalesce(p_q_no, 0) * v_pi_no;
  v_raw_yes numeric;
  v_raw_no numeric;
  v_raw_sum numeric;
  v_cost numeric;
begin
  -- Canonical liquidity-sensitive LMSR marginal prices dC/dq_i. These raw
  -- prices intentionally sum above 1; UI displays normalized probabilities.
  v_raw_yes := v_pi_yes + p_alpha * v_log_sum - (p_alpha / v_b) * v_weighted_q;
  v_raw_no := v_pi_no + p_alpha * v_log_sum - (p_alpha / v_b) * v_weighted_q;
  v_raw_sum := v_raw_yes + v_raw_no;
  v_cost := v_b * v_log_sum;

  return jsonb_build_object(
    'b', v_b,
    'cost', v_cost,
    'piYes', v_pi_yes,
    'piNo', v_pi_no,
    'rawPriceYes', v_raw_yes,
    'rawPriceNo', v_raw_no,
    'rawPriceSum', v_raw_sum,
    'normalizedPriceYes', case when v_raw_sum > 0 then v_raw_yes / v_raw_sum else 0.5 end,
    'normalizedPriceNo', case when v_raw_sum > 0 then v_raw_no / v_raw_sum else 0.5 end
  );
end;
$$;

create or replace function exchange_lmsr_cost_v2(
  p_q_yes numeric,
  p_q_no numeric,
  p_b0 numeric,
  p_alpha numeric
)
returns numeric
language sql
immutable
as $$
  select ((exchange_lmsr_state_v2(p_q_yes, p_q_no, p_b0, p_alpha))->>'cost')::numeric;
$$;

create or replace function exchange_lmsr_seed_q_yes_v2(
  p_opening_mark numeric,
  p_b0 numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_p numeric := coalesce(p_opening_mark, 0.5);
begin
  if v_p <= 0 or v_p >= 1 then
    raise exception 'opening AMM mark must be strictly between 0 and 1';
  end if;
  if p_b0 is null or p_b0 <= 0 then
    raise exception 'amm_b0 must be positive';
  end if;
  return round(p_b0 * ln(v_p / (1 - v_p)), 6);
end;
$$;

create or replace function exchange_lmsr_house_mint_cap_v2(
  p_b0 numeric,
  p_alpha numeric
)
returns numeric
language plpgsql
immutable
as $$
begin
  -- v1 cap policy from spec: bounded house-internal mint stored at open. With
  -- default b0=2000/alpha=0.05 the practical cap is approximately 2000 COIN.
  if p_b0 is null or p_b0 <= 0 then raise exception 'amm_b0 must be positive'; end if;
  if p_alpha is null or p_alpha < 0 or p_alpha >= 0.50 then raise exception 'amm_alpha out of range'; end if;
  return ceil(p_b0);
end;
$$;

create or replace function exchange_round_amm_buy_cost_v2(p_amount numeric)
returns numeric
language sql
immutable
as $$
  select exchange_assert_whole_coin_amount_v2(ceil(greatest(coalesce(p_amount, 0), 0)), 'amm_buy_cost');
$$;

create or replace function exchange_round_amm_sell_proceeds_v2(p_amount numeric)
returns numeric
language sql
immutable
as $$
  select exchange_assert_whole_coin_amount_v2(floor(greatest(coalesce(p_amount, 0), 0)), 'amm_sell_proceeds');
$$;

create or replace function exchange_lmsr_quote_math_v2(
  p_market exchange_markets,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_q_yes_after numeric := p_market.amm_q_yes;
  v_q_no_after numeric := p_market.amm_q_no;
  v_cost_before numeric;
  v_cost_after numeric;
  v_curve_delta numeric;
  v_coin_amount numeric;
  v_unit_price numeric;
begin
  if not p_market.amm_enabled then raise exception 'AMM is not enabled for this market'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive'; end if;

  if p_outcome = 'true' then
    v_q_yes_after := p_market.amm_q_yes + case when p_action = 'buy' then p_quantity else -p_quantity end;
  else
    v_q_no_after := p_market.amm_q_no + case when p_action = 'buy' then p_quantity else -p_quantity end;
  end if;

  v_before := exchange_lmsr_state_v2(p_market.amm_q_yes, p_market.amm_q_no, p_market.amm_b0, p_market.amm_alpha);
  v_after := exchange_lmsr_state_v2(v_q_yes_after, v_q_no_after, p_market.amm_b0, p_market.amm_alpha);
  v_cost_before := (v_before->>'cost')::numeric;
  v_cost_after := (v_after->>'cost')::numeric;
  v_curve_delta := case when p_action = 'buy' then v_cost_after - v_cost_before else v_cost_before - v_cost_after end;
  if v_curve_delta < 0 then raise exception 'AMM trade would have negative curve value'; end if;

  v_coin_amount := case when p_action = 'buy'
    then exchange_round_amm_buy_cost_v2(v_curve_delta)
    else exchange_round_amm_sell_proceeds_v2(v_curve_delta)
  end;
  v_unit_price := case when p_quantity > 0 then round(v_coin_amount / p_quantity, 8) else 0 end;

  return jsonb_build_object(
    'before', v_before,
    'after', v_after,
    'qYesAfter', v_q_yes_after,
    'qNoAfter', v_q_no_after,
    'curveCostBefore', v_cost_before,
    'curveCostAfter', v_cost_after,
    'curveDeltaCoins', v_curve_delta,
    'roundedCoins', v_coin_amount,
    'unitPrice', v_unit_price,
    'rounding', case when p_action = 'buy' then 'buy_cost_ceil_house_favor' else 'sell_proceeds_floor_house_favor' end,
    'priceImpact', ((v_after->>'normalizedPriceYes')::numeric - (v_before->>'normalizedPriceYes')::numeric)
  );
end;
$$;

create or replace function exchange_open_market_amm_v2(
  p_market_id uuid,
  p_b0 numeric default 2000.000000,
  p_alpha numeric default 0.05000000,
  p_opening_mark_price numeric default null
)
returns exchange_markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
  v_opening_mark numeric;
  v_q_yes numeric;
  v_cap numeric;
begin
  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found then raise exception 'exchange market not found'; end if;
  if v_market.state <> 'draft' then raise exception 'exchange market can only open from draft'; end if;
  if v_market.close_at <= now() then raise exception 'exchange market close_at has already passed'; end if;
  if p_b0 <= 0 then raise exception 'amm_b0 must be positive'; end if;
  if p_alpha < 0 or p_alpha >= 0.50 then raise exception 'amm_alpha out of range'; end if;

  v_opening_mark := coalesce(p_opening_mark_price, v_market.mark_price, 0.5);
  if v_opening_mark <= 0 or v_opening_mark >= 1 then
    raise exception 'opening AMM mark must be strictly between 0 and 1';
  end if;

  v_q_yes := exchange_lmsr_seed_q_yes_v2(v_opening_mark, p_b0);
  v_cap := exchange_lmsr_house_mint_cap_v2(p_b0, p_alpha);

  update exchange_markets
  set amm_enabled = true,
      amm_b0 = p_b0,
      amm_alpha = p_alpha,
      amm_max_house_mint_coins = v_cap,
      amm_q_yes = v_q_yes,
      amm_q_no = 0,
      mark_price = v_opening_mark,
      state = 'open'::exchange_market_state,
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  insert into exchange_amm_house_ledger (house_account_id, event_id, market_id, entry_type, amount, currency, idempotency_key, metadata)
  values (
    'exchange_v2_lmsr_house',
    gen_random_uuid(),
    p_market_id,
    'house_mint_reserved',
    v_cap,
    'COIN',
    'exchange:amm:house_mint_reserved:' || p_market_id::text,
    jsonb_build_object(
      'b0', p_b0,
      'alpha', p_alpha,
      'openingMarkPrice', v_opening_mark,
      'qYes', v_q_yes,
      'qNo', 0,
      'boundedInflationOnly', true,
      'coinsClosedLoop', true,
      'legacyFixedOddsTouched', false
    )
  ) on conflict (idempotency_key) do nothing;

  return v_market;
end;
$$;

create or replace function open_exchange_market_v2(p_market_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();
  v_market := exchange_open_market_amm_v2(p_market_id, 2000.000000, 0.05000000, null);

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    auth.uid(),
    'exchange_market_opened',
    'exchange_market',
    p_market_id,
    v_market.book_version,
    jsonb_build_object(
      'ammEnabled', true,
      'ammB0', v_market.amm_b0,
      'ammAlpha', v_market.amm_alpha,
      'ammMaxHouseMintCoins', v_market.amm_max_house_mint_coins,
      'ammSource', '0065_lmsr_house_amm'
    )
  );

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

create or replace function open_exchange_market_v2(
  p_market_id uuid,
  p_amm_b0 numeric,
  p_amm_alpha numeric,
  p_opening_mark_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
begin
  perform exchange_require_curator_or_service();
  v_market := exchange_open_market_amm_v2(p_market_id, coalesce(p_amm_b0, 2000.000000), coalesce(p_amm_alpha, 0.05000000), p_opening_mark_price);

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    auth.uid(),
    'exchange_market_opened',
    'exchange_market',
    p_market_id,
    v_market.book_version,
    jsonb_build_object(
      'ammEnabled', true,
      'ammB0', v_market.amm_b0,
      'ammAlpha', v_market.amm_alpha,
      'openingMarkPrice', v_market.mark_price,
      'ammMaxHouseMintCoins', v_market.amm_max_house_mint_coins,
      'ammSource', '0065_lmsr_house_amm'
    )
  );

  return exchange_market_lifecycle_response(p_market_id);
end;
$$;

create or replace function quote_amm_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_math jsonb;
  v_quote exchange_order_quotes;
  v_warnings jsonb := jsonb_build_array('Cotação da AMM da casa: preço garantido por curto prazo, sujeito a expiração e arredondamento pró-casa.');
begin
  if v_user is null then raise exception 'auth required'; end if;

  select * into v_market from exchange_markets where market_id = p_market_id for share;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;
  if not v_market.amm_enabled then raise exception 'AMM is not enabled for this market'; end if;

  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');
  if p_quantity < v_market.min_order_quantity then raise exception 'quantity below market minimum'; end if;

  v_math := exchange_lmsr_quote_math_v2(v_market, p_outcome, p_action, p_quantity);

  insert into exchange_order_quotes (
    user_id, market_id, outcome, action, requested_quantity, requested_limit_price,
    estimated_fillable_quantity, estimated_average_price, worst_execution_price,
    estimated_fees, spread, slippage, book_version, expires_at, warnings
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_quantity, (v_math->>'unitPrice')::numeric,
    p_quantity,
    (v_math->>'unitPrice')::numeric,
    (v_math->>'unitPrice')::numeric,
    0,
    ((v_math->'before'->>'rawPriceSum')::numeric - 1),
    abs((v_math->>'priceImpact')::numeric),
    v_market.book_version,
    now() + interval '20 seconds',
    v_warnings
  ) returning * into v_quote;

  return jsonb_build_object(
    'quoteId', v_quote.id,
    'marketId', p_market_id,
    'bookVersion', v_quote.book_version,
    'expiresAt', v_quote.expires_at,
    'action', p_action,
    'outcome', p_outcome,
    'requestedQuantity', p_quantity,
    'unitPrice', (v_math->>'unitPrice')::numeric,
    'totalCoins', (v_math->>'roundedCoins')::numeric,
    'curveDeltaCoins', (v_math->>'curveDeltaCoins')::numeric,
    'rounding', v_math->>'rounding',
    'priceImpact', (v_math->>'priceImpact')::numeric,
    'priceYesBefore', (v_math->'before'->>'normalizedPriceYes')::numeric,
    'priceYesAfter', (v_math->'after'->>'normalizedPriceYes')::numeric,
    'rawPriceYes', (v_math->'before'->>'rawPriceYes')::numeric,
    'rawPriceNo', (v_math->'before'->>'rawPriceNo')::numeric,
    'rawPriceSum', (v_math->'before'->>'rawPriceSum')::numeric,
    'bBefore', (v_math->'before'->>'b')::numeric,
    'bAfter', (v_math->'after'->>'b')::numeric,
    'estimatedFillableQuantity', p_quantity,
    'warnings', v_warnings
  );
end;
$$;

create or replace function exchange_apply_amm_position_v2(
  p_user_id uuid,
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_coin_amount numeric
)
returns exchange_positions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position exchange_positions;
  v_new_quantity numeric;
  v_new_cost_basis numeric;
begin
  insert into exchange_positions (user_id, market_id, outcome, quantity, cost_basis, average_entry_price, fees_paid)
  values (p_user_id, p_market_id, p_outcome, 0, 0, 0, 0)
  on conflict (user_id, market_id, outcome) do nothing;

  select * into v_position
  from exchange_positions
  where user_id = p_user_id and market_id = p_market_id and outcome = p_outcome
  for update;

  if p_action = 'buy' then
    v_new_quantity := round(v_position.quantity + p_quantity, 6);
    v_new_cost_basis := round(v_position.cost_basis + p_coin_amount, 6);
  else
    if v_position.quantity - v_position.reserved_sell_quantity < p_quantity then
      raise exception 'insufficient shares to sell';
    end if;
    v_new_quantity := round(v_position.quantity - p_quantity, 6);
    v_new_cost_basis := case
      when v_position.quantity > 0 then round(greatest(v_position.cost_basis - (v_position.cost_basis * (p_quantity / v_position.quantity)), 0), 6)
      else 0
    end;
  end if;

  update exchange_positions
  set quantity = v_new_quantity,
      cost_basis = v_new_cost_basis,
      average_entry_price = case when v_new_quantity > 0 then round(v_new_cost_basis / v_new_quantity, 8) else 0 end,
      realized_pnl = case when p_action = 'sell' then realized_pnl + round(p_coin_amount - coalesce(v_position.cost_basis * (p_quantity / nullif(v_position.quantity, 0)), 0), 6) else realized_pnl end,
      version = version + 1,
      updated_at = now()
  where id = v_position.id
  returning * into v_position;

  return v_position;
end;
$$;

create or replace function execute_amm_trade_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_quote_id uuid,
  p_environment text default 'production'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_quote exchange_order_quotes;
  v_math jsonb;
  v_coin_amount numeric;
  v_event_id uuid := gen_random_uuid();
  v_position exchange_positions;
  v_net_mint numeric;
  v_share_currency text;
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exchange_gate_allows(p_environment, p_action) then
    raise exception 'exchange trading is disabled';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, p_outcome));

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;
  if exists (select 1 from exchange_market_controls c where c.market_id = p_market_id and c.paused) then
    raise exception 'market is paused';
  end if;
  if not v_market.amm_enabled then raise exception 'AMM is not enabled for this market'; end if;

  select * into v_quote from exchange_order_quotes where id = p_quote_id and user_id = v_user for update;
  if not found or v_quote.expires_at <= now() or v_quote.book_version <> v_market.book_version then
    raise exception 'quote expired or stale; requote required';
  end if;
  if v_quote.market_id <> p_market_id or v_quote.outcome <> p_outcome or v_quote.action <> p_action or v_quote.requested_quantity <> p_quantity then
    raise exception 'quote changed; requote required';
  end if;

  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');
  if p_quantity < v_market.min_order_quantity then raise exception 'quantity below market minimum'; end if;

  v_math := exchange_lmsr_quote_math_v2(v_market, p_outcome, p_action, p_quantity);
  v_coin_amount := (v_math->>'roundedCoins')::numeric;
  v_share_currency := exchange_share_currency(p_outcome);

  if p_action = 'buy' then
    if exchange_available_coin_balance(v_user) < v_coin_amount then
      raise exception 'insufficient coin balance';
    end if;
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, idempotency_key, metadata)
    values (v_event_id, v_user, p_market_id, 'reserve_coin', v_coin_amount, 'COIN', 'exchange:amm:buy:coin:' || p_quote_id::text, jsonb_build_object('quoteId', p_quote_id, 'ammTrade', true, 'legacyFixedOddsTouched', false, 'coinsClosedLoop', true));
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, idempotency_key, metadata)
    values (v_event_id, v_user, p_market_id, 'credit_share', p_quantity, v_share_currency, 'exchange:amm:buy:share:' || p_quote_id::text, jsonb_build_object('quoteId', p_quote_id, 'ammTrade', true, 'houseCounterparty', true));
  else
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, idempotency_key, metadata)
    values (v_event_id, v_user, p_market_id, 'debit_share', p_quantity, v_share_currency, 'exchange:amm:sell:share:' || p_quote_id::text, jsonb_build_object('quoteId', p_quote_id, 'ammTrade', true, 'houseCounterparty', true));
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, idempotency_key, metadata)
    values (v_event_id, v_user, p_market_id, 'credit_coin', v_coin_amount, 'COIN', 'exchange:amm:sell:coin:' || p_quote_id::text, jsonb_build_object('quoteId', p_quote_id, 'ammTrade', true, 'legacyFixedOddsTouched', false, 'coinsClosedLoop', true));
  end if;

  v_position := exchange_apply_amm_position_v2(v_user, p_market_id, p_outcome, p_action, p_quantity, v_coin_amount);

  update exchange_markets
  set amm_q_yes = (v_math->>'qYesAfter')::numeric,
      amm_q_no = (v_math->>'qNoAfter')::numeric,
      mark_price = least(greatest((v_math->'after'->>'normalizedPriceYes')::numeric, tick_size), 1 - tick_size),
      last_trade_price = least(greatest((v_math->>'unitPrice')::numeric, 0), 1),
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  insert into exchange_amm_house_ledger (house_account_id, event_id, market_id, user_id, quote_id, entry_type, amount, currency, idempotency_key, metadata)
  values (
    'exchange_v2_lmsr_house',
    v_event_id,
    p_market_id,
    v_user,
    p_quote_id,
    case when p_action = 'buy' then 'buy_from_house' else 'sell_to_house' end,
    v_coin_amount,
    'COIN',
    'exchange:amm:house:' || p_action::text || ':' || p_quote_id::text,
    jsonb_build_object(
      'outcome', p_outcome,
      'quantity', p_quantity,
      'curveDeltaCoins', (v_math->>'curveDeltaCoins')::numeric,
      'roundedCoins', v_coin_amount,
      'rounding', v_math->>'rounding',
      'bBefore', (v_math->'before'->>'b')::numeric,
      'bAfter', (v_math->'after'->>'b')::numeric,
      'priceYesBefore', (v_math->'before'->>'normalizedPriceYes')::numeric,
      'priceYesAfter', (v_math->'after'->>'normalizedPriceYes')::numeric,
      'boundedInflationOnly', true,
      'coinsClosedLoop', true,
      'legacyFixedOddsTouched', false
    )
  );

  v_net_mint := exchange_amm_house_net_coin_mint_v2(p_market_id);
  perform exchange_assert_amm_house_mint_cap_v2(p_market_id, v_market.amm_max_house_mint_coins, v_net_mint);

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    v_user,
    'exchange_amm_trade_executed',
    'exchange_market',
    p_market_id,
    v_market.book_version,
    jsonb_build_object(
      'quoteId', p_quote_id,
      'action', p_action,
      'outcome', p_outcome,
      'quantity', p_quantity,
      'roundedCoins', v_coin_amount,
      'curveDeltaCoins', (v_math->>'curveDeltaCoins')::numeric,
      'houseCounterparty', true,
      'productionApproved', false,
      'legacyFixedOddsTouched', false,
      'coinsClosedLoop', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'marketId', p_market_id,
    'quoteId', p_quote_id,
    'action', p_action,
    'outcome', p_outcome,
    'quantity', p_quantity,
    'totalCoins', v_coin_amount,
    'unitPrice', (v_math->>'unitPrice')::numeric,
    'curveDeltaCoins', (v_math->>'curveDeltaCoins')::numeric,
    'rounding', v_math->>'rounding',
    'priceYesBefore', (v_math->'before'->>'normalizedPriceYes')::numeric,
    'priceYesAfter', (v_math->'after'->>'normalizedPriceYes')::numeric,
    'bBefore', (v_math->'before'->>'b')::numeric,
    'bAfter', (v_math->'after'->>'b')::numeric,
    'bookVersion', v_market.book_version,
    'positionQuantity', v_position.quantity,
    'houseMintCapCoins', v_market.amm_max_house_mint_coins
  );
end;
$$;

create or replace function resolve_market_v2(
  p_market_id uuid,
  p_outcome exchange_settlement_outcome,
  p_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market exchange_markets;
  v_existing exchange_settlements;
  v_settlement exchange_settlements;
  v_true_value numeric := case when p_outcome = 'true' then 1.00000000 when p_outcome = 'void' then 0.50000000 else 0.00000000 end;
  v_false_value numeric := case when p_outcome = 'false' then 1.00000000 when p_outcome = 'void' then 0.50000000 else 0.00000000 end;
  v_release_result jsonb := '{}'::jsonb;
  v_position_result jsonb := '{}'::jsonb;
  v_amm_settlement_exposure numeric := 0;
  v_amm_net_mint numeric := 0;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'settlement idempotency key required';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'true'));
  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, 'false'));

  select * into v_market
  from exchange_markets
  where market_id = p_market_id
  for update;

  if not found then
    raise exception 'exchange market not found';
  end if;

  select * into v_existing
  from exchange_settlements
  where market_id = p_market_id
  for update;

  if found then
    return jsonb_build_object(
      'settlementId', v_existing.id,
      'marketId', p_market_id,
      'outcome', v_existing.outcome,
      'trueValue', v_existing.settlement_value_true,
      'falseValue', v_existing.settlement_value_false,
      'idempotent', true,
      'positionsSettled', 0,
      'totalPayoutCoins', 0,
      'reservationsReleased', jsonb_build_object('cancelledOpenOrders', 0, 'fallbackReleasedReservations', 0),
      'legacyWalletTouched', false
    );
  end if;

  insert into exchange_settlements (
    market_id,
    outcome,
    settlement_value_true,
    settlement_value_false,
    settled_by,
    evidence_reference,
    idempotency_key
  ) values (
    p_market_id,
    p_outcome,
    v_true_value,
    v_false_value,
    auth.uid(),
    p_reference,
    p_idempotency_key
  ) returning * into v_settlement;

  v_release_result := exchange_release_market_reservations_for_settlement_v2(p_market_id, v_settlement.id);
  v_position_result := exchange_settle_positions_v2(p_market_id, v_settlement);

  if v_market.amm_enabled then
    v_amm_settlement_exposure := exchange_amm_house_settlement_exposure_v2(p_market_id, p_outcome);
    insert into exchange_amm_house_ledger (house_account_id, event_id, market_id, user_id, quote_id, entry_type, amount, currency, idempotency_key, metadata)
    values (
      'exchange_v2_lmsr_house',
      gen_random_uuid(),
      p_market_id,
      null,
      null,
      'settlement_marker',
      v_amm_settlement_exposure,
      'COIN',
      'exchange:amm:settlement:' || v_settlement.id::text,
      jsonb_build_object(
        'settlementId', v_settlement.id,
        'outcome', p_outcome,
        'ammSettlementExposureCoins', v_amm_settlement_exposure,
        'totalPayoutCoins', coalesce((v_position_result->>'totalPayoutCoins')::numeric, 0),
        'boundedInflationOnly', true,
        'coinsClosedLoop', true,
        'legacyFixedOddsTouched', false
      )
    );

    v_amm_net_mint := exchange_amm_house_net_coin_mint_v2(p_market_id);
    perform exchange_assert_amm_house_mint_cap_v2(p_market_id, v_market.amm_max_house_mint_coins, v_amm_net_mint);
  end if;

  update exchange_markets
  set state = (case when p_outcome = 'void' then 'voided'::exchange_market_state else 'resolved'::exchange_market_state end),
      book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    auth.uid(),
    'exchange_market_settled',
    'exchange_market',
    p_market_id,
    v_market.book_version,
    jsonb_build_object(
      'settlementId', v_settlement.id,
      'outcome', p_outcome,
      'trueValue', v_true_value,
      'falseValue', v_false_value,
      'reservationsReleased', v_release_result,
      'positionSettlement', v_position_result,
      'ammNetMintCoins', v_amm_net_mint,
      'ammSettlementExposureCoins', v_amm_settlement_exposure,
      'productionGateTouched', false,
      'legacyWalletTouched', false,
      'coinsClosedLoop', true
    )
  );

  return jsonb_build_object(
    'settlementId', v_settlement.id,
    'marketId', p_market_id,
    'state', v_market.state,
    'outcome', p_outcome,
    'trueValue', v_true_value,
    'falseValue', v_false_value,
    'idempotent', false,
    'positionsSettled', coalesce((v_position_result->>'positionsSettled')::integer, 0),
    'totalPayoutCoins', coalesce((v_position_result->>'totalPayoutCoins')::numeric, 0),
    'ammNetMintCoins', v_amm_net_mint,
    'ammSettlementExposureCoins', v_amm_settlement_exposure,
    'reservationsReleased', v_release_result,
    'legacyWalletTouched', false
  );
end;
$$;

revoke all on table exchange_amm_house_accounts from public, anon, authenticated;
revoke all on table exchange_amm_house_ledger from public, anon, authenticated;
grant select on table exchange_amm_house_accounts to service_role;
grant select, insert on table exchange_amm_house_ledger to service_role;

revoke all on function exchange_amm_house_net_coin_mint_v2(uuid) from public, anon, authenticated;
revoke all on function exchange_assert_amm_house_mint_cap_v2(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_amm_house_settlement_exposure_v2(uuid, exchange_settlement_outcome) from public, anon, authenticated;
revoke all on function exchange_lmsr_b_v2(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_lmsr_state_v2(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_lmsr_cost_v2(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_lmsr_seed_q_yes_v2(numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_lmsr_house_mint_cap_v2(numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_round_amm_buy_cost_v2(numeric) from public, anon, authenticated;
revoke all on function exchange_round_amm_sell_proceeds_v2(numeric) from public, anon, authenticated;
revoke all on function exchange_lmsr_quote_math_v2(exchange_markets, exchange_outcome, exchange_order_action, numeric) from public, anon, authenticated;
revoke all on function exchange_open_market_amm_v2(uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function open_exchange_market_v2(uuid) from public, anon;
revoke all on function open_exchange_market_v2(uuid, numeric, numeric, numeric) from public, anon;
revoke all on function quote_amm_v2(uuid, exchange_outcome, exchange_order_action, numeric) from public, anon;
revoke all on function exchange_apply_amm_position_v2(uuid, uuid, exchange_outcome, exchange_order_action, numeric, numeric) from public, anon, authenticated;
revoke all on function execute_amm_trade_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid, text) from public, anon;
revoke all on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) from public, anon, authenticated;

grant execute on function open_exchange_market_v2(uuid) to authenticated, service_role;
grant execute on function open_exchange_market_v2(uuid, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function quote_amm_v2(uuid, exchange_outcome, exchange_order_action, numeric) to authenticated, service_role;
grant execute on function execute_amm_trade_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid, text) to authenticated, service_role;
grant execute on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) to service_role;
