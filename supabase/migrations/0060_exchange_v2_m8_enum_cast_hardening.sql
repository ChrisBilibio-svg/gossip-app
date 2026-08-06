-- 0060_exchange_v2_m8_enum_cast_hardening.sql — exchange-v2 M8 enum-cast hardening
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Coins remain closed-loop entertainment units with no cash value, withdrawal,
--   redemption, prizes, or crypto conversion.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M8 live testing surfaced that Postgres resolves some PL/pgSQL status literals
-- as text inside replacement exchange order functions. Recreate the affected
-- functions with explicit exchange_order_status casts so the development
-- lifecycle test can place, match, mint, cash out, and settle orders without
-- weakening production gates.

create or replace function exchange_reject_order_for_risk_v2(
  p_user_id uuid,
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_quantity numeric,
  p_limit_price numeric,
  p_time_in_force exchange_time_in_force,
  p_client_order_id text,
  p_quote_id uuid,
  p_accepted_worst_price numeric,
  p_expires_at timestamptz,
  p_risk_result jsonb
)
returns exchange_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_event_type text := coalesce(p_risk_result->>'eventType', 'order_blocked');
  v_reason text := coalesce(p_risk_result->>'reason', 'risk limit blocked order');
begin
  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price,
    rejected_reason, expires_at
  ) values (
    p_user_id, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, 0, p_quantity, p_time_in_force,
    p_action = 'sell', 'rejected'::exchange_order_status, p_client_order_id, p_quote_id, p_accepted_worst_price,
    v_reason, p_expires_at
  ) returning * into v_order;

  perform exchange_log_risk_event_v2(
    p_user_id,
    p_market_id,
    p_outcome,
    v_order.id,
    v_event_type,
    'block',
    'blocked',
    v_reason,
    p_risk_result
  );

  return v_order;
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
      p_action = 'sell', 'rejected'::exchange_order_status, p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'self-trade rejected', v_expires_at
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
      p_action = 'sell', 'rejected'::exchange_order_status, p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'FOK cannot fully fill', null
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
    p_action = 'sell', 'open'::exchange_order_status, p_client_order_id, p_quote_id, v_quote.worst_execution_price, v_expires_at
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
    set status = case when filled_quantity > 0 then 'cancelled'::exchange_order_status else 'rejected'::exchange_order_status end,
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

create or replace function exchange_match_complete_set_orders_v2(p_taker_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taker exchange_orders;
  v_maker exchange_orders;
  v_market exchange_markets;
  v_fill_qty numeric;
  v_mint jsonb;
  v_minted numeric := 0;
  v_total_collateral numeric := 0;
  v_mint_count integer := 0;
begin
  select * into v_taker from exchange_orders where id = p_taker_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_taker.action <> 'buy' then
    return jsonb_build_object('mintCount', 0, 'mintedQuantity', 0, 'totalCollateralCoins', 0);
  end if;

  select * into v_market from exchange_markets where market_id = v_taker.market_id for update;
  if not found then raise exception 'market not found'; end if;

  loop
    exit when v_taker.remaining_quantity <= 0;

    select * into v_maker
    from exchange_orders o
    where o.market_id = v_taker.market_id
      and o.outcome = exchange_opposite_outcome_v2(v_taker.outcome)
      and o.action = 'buy'
      and o.status in ('open'::exchange_order_status,'partially_filled')
      and o.remaining_quantity > 0
      and o.user_id <> v_taker.user_id
      and exchange_complete_set_taker_price_v2(o.limit_price) <= v_taker.limit_price
    order by exchange_complete_set_taker_price_v2(o.limit_price) asc, o.created_at asc, o.id asc
    for update skip locked
    limit 1;

    exit when not found;

    v_fill_qty := least(v_taker.remaining_quantity, v_maker.remaining_quantity);
    perform exchange_assert_whole_coin_order_v2(v_market, 'buy', v_fill_qty, v_maker.limit_price);
    perform exchange_assert_whole_coin_order_v2(v_market, 'buy', v_fill_qty, exchange_complete_set_taker_price_v2(v_maker.limit_price));

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled'::exchange_order_status else 'partially_filled'::exchange_order_status end,
        updated_at = now()
    where id = v_maker.id
    returning * into v_maker;

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled'::exchange_order_status else 'partially_filled'::exchange_order_status end,
        updated_at = now()
    where id = v_taker.id
    returning * into v_taker;

    v_mint := exchange_insert_complete_set_mint_v2(v_market, v_maker, v_taker, v_fill_qty);
    v_mint_count := v_mint_count + 1;
    v_minted := round(v_minted + v_fill_qty, 6);
    v_total_collateral := round(v_total_collateral + (v_mint->>'totalCollateralCoins')::numeric, 6);
  end loop;

  return jsonb_build_object(
    'mintCount', v_mint_count,
    'mintedQuantity', v_minted,
    'totalCollateralCoins', v_total_collateral
  );
end;
$$;

create or replace function exchange_match_order_v2(p_taker_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taker exchange_orders;
  v_maker exchange_orders;
  v_market exchange_markets;
  v_fill_qty numeric;
  v_fill_price numeric;
  v_filled numeric := 0;
  v_notional numeric := 0;
  v_fill_count integer := 0;
  v_mint_result jsonb := '{}'::jsonb;
begin
  select * into v_taker from exchange_orders where id = p_taker_order_id for update;
  if not found then raise exception 'order not found'; end if;

  select * into v_market from exchange_markets where market_id = v_taker.market_id for update;
  if not found then raise exception 'market not found'; end if;

  loop
    exit when v_taker.remaining_quantity <= 0;

    if v_taker.action = 'buy' then
      select * into v_maker
      from exchange_orders o
      where o.market_id = v_taker.market_id
        and o.outcome = v_taker.outcome
        and o.action = 'sell'
        and o.status in ('open'::exchange_order_status,'partially_filled')
        and o.remaining_quantity > 0
        and o.limit_price <= v_taker.limit_price
        and o.user_id <> v_taker.user_id
      order by o.limit_price asc, o.created_at asc, o.id asc
      for update skip locked
      limit 1;
    else
      select * into v_maker
      from exchange_orders o
      where o.market_id = v_taker.market_id
        and o.outcome = v_taker.outcome
        and o.action = 'buy'
        and o.status in ('open'::exchange_order_status,'partially_filled')
        and o.remaining_quantity > 0
        and o.limit_price >= v_taker.limit_price
        and o.user_id <> v_taker.user_id
      order by o.limit_price desc, o.created_at asc, o.id asc
      for update skip locked
      limit 1;
    end if;

    exit when not found;

    v_fill_qty := least(v_taker.remaining_quantity, v_maker.remaining_quantity);
    v_fill_price := v_maker.limit_price;
    perform exchange_assert_whole_coin_notional_v2(v_fill_qty, v_fill_price, 'same_outcome_fill_notional');

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled'::exchange_order_status else 'partially_filled'::exchange_order_status end,
        updated_at = now()
    where id = v_maker.id
    returning * into v_maker;

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled'::exchange_order_status else 'partially_filled'::exchange_order_status end,
        updated_at = now()
    where id = v_taker.id
    returning * into v_taker;

    perform exchange_insert_fill_v2(v_market, v_maker, v_taker, v_fill_qty, v_fill_price);
    v_fill_count := v_fill_count + 1;
    v_filled := round(v_filled + v_fill_qty, 6);
    v_notional := round(v_notional + (v_fill_qty * v_fill_price), 6);
  end loop;

  if v_taker.action = 'buy' and v_taker.remaining_quantity > 0 then
    v_mint_result := exchange_match_complete_set_orders_v2(v_taker.id);
    select * into v_taker from exchange_orders where id = p_taker_order_id for update;
  else
    v_mint_result := jsonb_build_object('mintCount', 0, 'mintedQuantity', 0, 'totalCollateralCoins', 0);
  end if;

  return jsonb_build_object(
    'fillCount', v_fill_count,
    'filledQuantity', v_filled,
    'averageFillPrice', case when v_filled > 0 then round(v_notional / v_filled, 8) else null end,
    'completeSetMinting', v_mint_result
  );
end;
$$;

revoke all on function exchange_reject_order_for_risk_v2(uuid, uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, numeric, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) from public, anon;
revoke all on function exchange_match_complete_set_orders_v2(uuid) from public, anon, authenticated;
revoke all on function exchange_match_order_v2(uuid) from public, anon, authenticated;

grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) to authenticated;
