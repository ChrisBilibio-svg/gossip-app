-- 0058_exchange_v2_whole_coin_guardrails.sql — exchange-v2 whole-coin economics
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Coins remain closed-loop entertainment units with no cash value, withdrawal,
--   redemption, prizes, or crypto conversion.
-- - Legacy fixed-odds semantics and integer coin_wallets accounting remain untouched.
--
-- M-fraction / 0058 decision:
-- - Option 1 is locked: keep integer coin_wallets.balance and enforce whole-coin
--   lots for exchange v2.
-- - Per-market whole_coin_lot_size is configurable and derived from tick_size by
--   default so every price tick and VOID payout can settle as whole COIN amounts.
-- - Every exchange v2 COIN ledger entry that the 0056 wallet bridge sees must be
--   a whole coin; orders that would create fractional COIN movements are rejected.

create or replace function exchange_gcd_bigint_v2(p_a bigint, p_b bigint)
returns bigint
language plpgsql
immutable
as $$
declare
  v_a bigint := abs(coalesce(p_a, 0));
  v_b bigint := abs(coalesce(p_b, 0));
  v_tmp bigint;
begin
  if v_a = 0 then return greatest(v_b, 1); end if;
  if v_b = 0 then return greatest(v_a, 1); end if;

  while v_b <> 0 loop
    v_tmp := v_a % v_b;
    v_a := v_b;
    v_b := v_tmp;
  end loop;

  return greatest(v_a, 1);
end;
$$;

create or replace function exchange_lcm_bigint_v2(p_a bigint, p_b bigint)
returns bigint
language sql
immutable
as $$
  select greatest(abs(coalesce(p_a, 1)) / exchange_gcd_bigint_v2(p_a, p_b) * abs(coalesce(p_b, 1)), 1)::bigint;
$$;

create or replace function exchange_default_whole_coin_lot_size_v2(p_tick_size numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  v_tick numeric := coalesce(p_tick_size, 0.01);
  v_ticks_per_coin bigint;
begin
  if v_tick <= 0 or v_tick > 1 then
    raise exception 'invalid tick_size for whole-coin lot sizing';
  end if;

  v_ticks_per_coin := ceil(1 / v_tick)::bigint;
  return exchange_lcm_bigint_v2(v_ticks_per_coin, 2)::numeric;
end;
$$;

alter table exchange_markets
  add column if not exists whole_coin_lot_size numeric(24,6);

update exchange_markets
set whole_coin_lot_size = exchange_default_whole_coin_lot_size_v2(tick_size)
where whole_coin_lot_size is null;

alter table exchange_markets
  alter column whole_coin_lot_size set default 100.000000,
  alter column whole_coin_lot_size set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exchange_markets'::regclass
      and conname = 'exchange_markets_whole_coin_lot_size_check'
  ) then
    alter table exchange_markets
      add constraint exchange_markets_whole_coin_lot_size_check
      check (
        whole_coin_lot_size > 0
        and whole_coin_lot_size = trunc(whole_coin_lot_size)
        and mod(round(whole_coin_lot_size, 6), quantity_step) = 0
      ) not valid;
  end if;
end $$;

alter table exchange_markets validate constraint exchange_markets_whole_coin_lot_size_check;

do $$
declare
  v_fractional_count integer;
begin
  select count(*) into v_fractional_count
  from exchange_wallet_ledger
  where currency = 'COIN'
    and amount <> trunc(amount);

  if v_fractional_count > 0 then
    raise exception 'cannot enable whole-coin exchange v2: % fractional COIN ledger rows exist', v_fractional_count;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exchange_wallet_ledger'::regclass
      and conname = 'exchange_wallet_ledger_coin_whole_amount_check'
  ) then
    alter table exchange_wallet_ledger
      add constraint exchange_wallet_ledger_coin_whole_amount_check
      check (currency <> 'COIN' or amount = trunc(amount)) not valid;
  end if;
end $$;

alter table exchange_wallet_ledger validate constraint exchange_wallet_ledger_coin_whole_amount_check;

create or replace function exchange_is_whole_coin_amount_v2(p_amount numeric)
returns boolean
language sql
immutable
as $$
  select p_amount is not null and p_amount >= 0 and p_amount = trunc(p_amount);
$$;

create or replace function exchange_assert_whole_coin_amount_v2(
  p_amount numeric,
  p_context text
)
returns numeric
language plpgsql
immutable
as $$
begin
  if not exchange_is_whole_coin_amount_v2(p_amount) then
    raise exception 'exchange whole-coin violation: % amount % is not a whole COIN amount', coalesce(p_context, 'unknown'), p_amount;
  end if;

  return p_amount;
end;
$$;

create or replace function exchange_coin_notional_v2(
  p_quantity numeric,
  p_price numeric
)
returns numeric
language sql
immutable
as $$
  select round(coalesce(p_quantity, 0) * coalesce(p_price, 0), 6);
$$;

create or replace function exchange_assert_whole_coin_notional_v2(
  p_quantity numeric,
  p_price numeric,
  p_context text
)
returns numeric
language sql
immutable
as $$
  select exchange_assert_whole_coin_amount_v2(exchange_coin_notional_v2(p_quantity, p_price), p_context);
$$;

create or replace function exchange_assert_whole_coin_order_v2(
  p_market exchange_markets,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric
)
returns void
language plpgsql
immutable
as $$
declare
  v_remainder numeric;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  v_remainder := mod(round(p_quantity, 6), p_market.whole_coin_lot_size);
  if v_remainder <> 0 then
    raise exception 'quantity must be a whole-coin lot multiple of %', p_market.whole_coin_lot_size;
  end if;

  if p_action in ('buy','sell') then
    perform exchange_assert_whole_coin_notional_v2(p_quantity, p_limit_price, 'order_limit_notional');
    perform exchange_assert_whole_coin_notional_v2(p_quantity, 0.50000000, 'void_settlement_notional');
  end if;
end;
$$;

create or replace function exchange_required_coin_reservation(
  p_quantity numeric,
  p_limit_price numeric,
  p_fee_bps integer
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_required numeric;
begin
  v_required := round(
    (p_quantity * p_limit_price)
    + ((p_quantity * p_limit_price) * greatest(coalesce(p_fee_bps, 0), 0)::numeric / 10000),
    6
  );

  return exchange_assert_whole_coin_amount_v2(v_required, 'required_coin_reservation');
end;
$$;

create or replace function quote_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_market exchange_markets;
  v_best_opposing numeric;
  v_quote exchange_order_quotes;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'auth required'; end if;
  select * into v_market from exchange_markets where market_id = p_market_id for share;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;
  perform exchange_assert_tick(p_limit_price, v_market.tick_size, 'limit_price');
  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');
  if p_quantity < v_market.min_order_quantity then
    raise exception 'quantity below market minimum';
  end if;
  perform exchange_assert_whole_coin_order_v2(v_market, p_action, p_quantity, p_limit_price);

  if p_action = 'buy' then
    perform exchange_required_coin_reservation(p_quantity, p_limit_price, v_market.fee_bps);
    select min(limit_price) into v_best_opposing from exchange_orders where market_id = p_market_id and outcome = p_outcome and action = 'sell' and status in ('open','partially_filled') and remaining_quantity > 0 and limit_price <= p_limit_price;
  else
    select max(limit_price) into v_best_opposing from exchange_orders where market_id = p_market_id and outcome = p_outcome and action = 'buy' and status in ('open','partially_filled') and remaining_quantity > 0 and limit_price >= p_limit_price;
  end if;

  if v_best_opposing is null then
    v_warnings := v_warnings || jsonb_build_array('Sem liquidez suficiente agora; uma ordem limite pode ficar aguardando contraparte.');
  end if;

  insert into exchange_order_quotes (
    user_id, market_id, outcome, action, requested_quantity, requested_limit_price,
    estimated_fillable_quantity, estimated_average_price, worst_execution_price,
    estimated_fees, spread, slippage, book_version, expires_at, warnings
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price,
    case when v_best_opposing is null then 0 else p_quantity end,
    v_best_opposing,
    case when v_best_opposing is null then null else p_limit_price end,
    0,
    null,
    case when v_best_opposing is null then null else abs(p_limit_price - v_best_opposing) end,
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
    'requestedLimitPrice', p_limit_price,
    'requestedQuantity', p_quantity,
    'wholeCoinLotSize', v_market.whole_coin_lot_size,
    'estimatedFillableQuantity', v_quote.estimated_fillable_quantity,
    'estimatedAverageExecutionPrice', v_quote.estimated_average_price,
    'worstExecutionPrice', v_quote.worst_execution_price,
    'fees', 0,
    'warnings', v_warnings
  );
end;
$$;

create or replace function place_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_environment text,
  p_expires_at timestamptz
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
  v_order exchange_orders;
  v_reservation exchange_reservations;
  v_match jsonb := '{}'::jsonb;
  v_fillable numeric := 0;
  v_cancel_qty numeric := 0;
  v_expires_at timestamptz := null;
  v_risk_result jsonb := '{}'::jsonb;
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

  if p_time_in_force = 'GTD' then
    if p_expires_at is null then raise exception 'GTD orders require explicit expires_at'; end if;
    if p_expires_at <= now() then raise exception 'GTD expires_at must be in the future'; end if;
    if p_expires_at > v_market.close_at then raise exception 'GTD expires_at cannot exceed market close'; end if;
    v_expires_at := p_expires_at;
  elsif p_expires_at is not null then
    raise exception 'expires_at is only supported for GTD orders';
  end if;

  select * into v_order
  from exchange_orders
  where user_id = v_user
    and client_order_id = p_client_order_id
  for update;

  if found then
    if v_order.market_id <> p_market_id
       or v_order.outcome <> p_outcome
       or v_order.action <> p_action
       or v_order.original_quantity <> p_quantity
       or v_order.limit_price <> p_limit_price
       or v_order.time_in_force <> p_time_in_force
       or coalesce(v_order.expires_at, '-infinity'::timestamptz) <> coalesce(v_expires_at, '-infinity'::timestamptz) then
      raise exception 'client_order_id already used with different order parameters';
    end if;

    return exchange_order_response_v2(v_order, v_market);
  end if;

  perform exchange_assert_tick(p_limit_price, v_market.tick_size, 'limit_price');
  perform exchange_assert_tick(p_quantity, v_market.quantity_step, 'quantity');
  if p_quantity < v_market.min_order_quantity then
    raise exception 'quantity below market minimum';
  end if;
  perform exchange_assert_whole_coin_order_v2(v_market, p_action, p_quantity, p_limit_price);
  if p_action = 'buy' then
    perform exchange_required_coin_reservation(p_quantity, p_limit_price, v_market.fee_bps);
  end if;

  select * into v_quote from exchange_order_quotes where id = p_quote_id and user_id = v_user for update;
  if not found or v_quote.expires_at <= now() or v_quote.book_version <> v_market.book_version then
    raise exception 'quote expired or stale; requote required';
  end if;
  if v_quote.market_id <> p_market_id or v_quote.outcome <> p_outcome or v_quote.action <> p_action or v_quote.requested_limit_price <> p_limit_price or v_quote.requested_quantity <> p_quantity then
    raise exception 'quote changed; requote required';
  end if;

  v_risk_result := exchange_check_order_risk_limits_v2(v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_environment);
  if not coalesce((v_risk_result->>'allowed')::boolean, false) then
    v_order := exchange_reject_order_for_risk_v2(v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_time_in_force, p_client_order_id, p_quote_id, v_quote.worst_execution_price, v_expires_at, v_risk_result);
    return exchange_order_response_v2(v_order, v_market);
  end if;

  if exchange_self_cross_exists_v2(p_market_id, p_outcome, p_action, p_limit_price, v_user) then
    insert into exchange_orders (
      user_id, market_id, outcome, action, limit_price, original_quantity,
      filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
      reduce_only, status, client_order_id, quote_id, accepted_worst_price, rejected_reason, expires_at
    ) values (
      v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
      0, 0, p_quantity, p_time_in_force,
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'self-trade rejected', v_expires_at
    ) returning * into v_order;
    return exchange_order_response_v2(v_order, v_market);
  end if;

  v_fillable := exchange_available_crossing_quantity_v2(p_market_id, p_outcome, p_action, p_limit_price, v_user);
  if p_time_in_force = 'FOK' and v_fillable < p_quantity then
    insert into exchange_orders (
      user_id, market_id, outcome, action, limit_price, original_quantity,
      filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
      reduce_only, status, client_order_id, quote_id, accepted_worst_price, rejected_reason, expires_at
    ) values (
      v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
      0, 0, p_quantity, p_time_in_force,
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'FOK cannot fully fill', null
    ) returning * into v_order;
    return exchange_order_response_v2(v_order, v_market);
  end if;

  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price, expires_at
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, p_quantity, 0, p_time_in_force,
    p_action = 'sell', 'open', p_client_order_id, p_quote_id, v_quote.worst_execution_price, v_expires_at
  ) returning * into v_order;

  perform exchange_log_risk_event_v2(v_user, p_market_id, p_outcome, v_order.id, coalesce(v_risk_result->>'eventType', 'order_allowed'), 'info', 'allowed', coalesce(v_risk_result->>'reason', 'risk limits passed'), v_risk_result || jsonb_build_object('wholeCoinLotSize', v_market.whole_coin_lot_size));

  v_reservation := exchange_reserve_order_collateral_v2(v_order.id);

  v_match := exchange_match_order_v2(v_order.id);
  select * into v_order from exchange_orders where id = v_order.id for update;

  if p_time_in_force = 'FOK' and v_order.filled_quantity < v_order.original_quantity then
    raise exception 'FOK fillability changed; requote required';
  end if;

  if p_time_in_force in ('IOC','FOK') and v_order.remaining_quantity > 0 then
    v_cancel_qty := v_order.remaining_quantity;
    perform exchange_release_order_reservation_v2(v_order.id, lower(p_time_in_force::text) || '_unfilled');
    update exchange_orders
    set status = case when filled_quantity > 0 then 'cancelled' else 'rejected' end,
        rejected_reason = case when filled_quantity > 0 then rejected_reason else p_time_in_force::text || ' unfilled' end,
        cancelled_quantity = cancelled_quantity + v_cancel_qty,
        remaining_quantity = 0,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;
  end if;

  update exchange_markets
  set book_version = book_version + 1,
      last_trade_price = coalesce((select f.price from exchange_fills f where f.market_id = p_market_id order by f.created_at desc limit 1), last_trade_price),
      mark_price = coalesce((select f.price from exchange_fills f where f.market_id = p_market_id order by f.created_at desc limit 1), mark_price),
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  select * into v_order from exchange_orders where id = v_order.id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (v_user, 'exchange_order_matched', 'exchange_order', v_order.id, v_market.book_version, jsonb_build_object('match', v_match, 'timeInForce', p_time_in_force, 'expiresAt', v_expires_at, 'fokPreMatchFillableQuantity', v_fillable, 'risk', v_risk_result, 'wholeCoinLotSize', v_market.whole_coin_lot_size, 'productionGateTouched', false));

  return exchange_order_response_v2(v_order, v_market);
end;
$$;

create or replace function place_order_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_environment text default 'production'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select place_order_v2(p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_time_in_force, p_client_order_id, p_quote_id, p_environment, null::timestamptz);
$$;

revoke all on function exchange_gcd_bigint_v2(bigint, bigint) from public, anon, authenticated;
revoke all on function exchange_lcm_bigint_v2(bigint, bigint) from public, anon, authenticated;
revoke all on function exchange_default_whole_coin_lot_size_v2(numeric) from public, anon, authenticated;
revoke all on function exchange_is_whole_coin_amount_v2(numeric) from public, anon, authenticated;
revoke all on function exchange_assert_whole_coin_amount_v2(numeric, text) from public, anon, authenticated;
revoke all on function exchange_coin_notional_v2(numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_assert_whole_coin_notional_v2(numeric, numeric, text) from public, anon, authenticated;
revoke all on function exchange_assert_whole_coin_order_v2(exchange_markets, exchange_order_action, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_required_coin_reservation(numeric, numeric, integer) from public, anon, authenticated;
revoke all on function quote_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) from public, anon;

grant execute on function quote_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) to authenticated;
