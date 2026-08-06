-- 0054_exchange_v2_positions_pnl.sql — exchange-v2 positions and P&L
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M4:
-- - Every fill updates buyer and seller exchange_positions atomically.
-- - Buyer quantity/cost_basis/average_entry_price use weighted-average accounting.
-- - Seller quantity/cost_basis decrease by disposed basis and realized_pnl records
--   proceeds - disposed cost basis.
--
-- 0053 review polish:
-- - GTD orders now accept an explicit p_expires_at argument. Existing callers may
--   omit it, but GTD callers must provide a future expiry <= market close.
-- - FOK fillability is still estimated before matching, but a post-match guard
--   raises if actual fillability changes, rolling back the transaction so FOK
--   remains all-or-none under concurrency.

create or replace function exchange_apply_fill_positions_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_buyer_user_id uuid,
  p_seller_user_id uuid,
  p_quantity numeric,
  p_price numeric,
  p_buyer_fee numeric default 0,
  p_seller_fee numeric default 0,
  p_fill_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer exchange_positions;
  v_seller exchange_positions;
  v_notional numeric := round(p_quantity * p_price, 6);
  v_buyer_cost numeric := round((p_quantity * p_price) + greatest(coalesce(p_buyer_fee, 0), 0), 6);
  v_seller_proceeds numeric := round((p_quantity * p_price) - greatest(coalesce(p_seller_fee, 0), 0), 6);
  v_disposed_basis numeric;
  v_buyer_new_quantity numeric;
  v_buyer_new_cost_basis numeric;
  v_seller_new_quantity numeric;
  v_seller_new_cost_basis numeric;
  v_realized_pnl numeric;
begin
  if p_buyer_user_id is null or p_seller_user_id is null then
    raise exception 'position parties required';
  end if;
  if p_buyer_user_id = p_seller_user_id then
    raise exception 'self-trade rejected';
  end if;
  if p_quantity <= 0 or p_price < 0 or p_price > 1 then
    raise exception 'invalid fill accounting inputs';
  end if;

  insert into exchange_positions (user_id, market_id, outcome, quantity, cost_basis, average_entry_price, fees_paid)
  values (p_buyer_user_id, p_market_id, p_outcome, 0, 0, 0, 0)
  on conflict (user_id, market_id, outcome) do nothing;

  select * into v_buyer
  from exchange_positions
  where user_id = p_buyer_user_id
    and market_id = p_market_id
    and outcome = p_outcome
  for update;

  select * into v_seller
  from exchange_positions
  where user_id = p_seller_user_id
    and market_id = p_market_id
    and outcome = p_outcome
  for update;

  if not found or v_seller.quantity < p_quantity then
    raise exception 'insufficient seller position for fill accounting';
  end if;

  v_buyer_new_quantity := round(v_buyer.quantity + p_quantity, 6);
  v_buyer_new_cost_basis := round(v_buyer.cost_basis + v_buyer_cost, 6);

  v_disposed_basis := case
    when v_seller.quantity <= 0 then 0
    when v_seller.quantity = p_quantity then v_seller.cost_basis
    else round(v_seller.cost_basis * (p_quantity / v_seller.quantity), 6)
  end;
  v_seller_new_quantity := round(v_seller.quantity - p_quantity, 6);
  v_seller_new_cost_basis := case
    when v_seller_new_quantity <= 0 then 0
    else greatest(round(v_seller.cost_basis - v_disposed_basis, 6), 0)
  end;
  v_realized_pnl := round(v_seller_proceeds - v_disposed_basis, 6);

  update exchange_positions
  set quantity = v_buyer_new_quantity,
      cost_basis = v_buyer_new_cost_basis,
      average_entry_price = case when v_buyer_new_quantity > 0 then round(v_buyer_new_cost_basis / v_buyer_new_quantity, 8) else 0 end,
      fees_paid = round(fees_paid + greatest(coalesce(p_buyer_fee, 0), 0), 6),
      version = version + 1,
      updated_at = now()
  where id = v_buyer.id
  returning * into v_buyer;

  update exchange_positions
  set quantity = greatest(v_seller_new_quantity, 0),
      cost_basis = v_seller_new_cost_basis,
      average_entry_price = case when v_seller_new_quantity > 0 then round(v_seller_new_cost_basis / v_seller_new_quantity, 8) else 0 end,
      realized_pnl = round(realized_pnl + v_realized_pnl, 6),
      fees_paid = round(fees_paid + greatest(coalesce(p_seller_fee, 0), 0), 6),
      version = version + 1,
      updated_at = now()
  where id = v_seller.id
  returning * into v_seller;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, metadata)
  values (
    p_buyer_user_id,
    'exchange_positions_adjusted',
    'exchange_fill',
    p_fill_id,
    jsonb_build_object(
      'buyerUserId', p_buyer_user_id,
      'sellerUserId', p_seller_user_id,
      'marketId', p_market_id,
      'outcome', p_outcome,
      'quantity', p_quantity,
      'price', p_price,
      'notional', v_notional,
      'buyerCostBasisAdded', v_buyer_cost,
      'sellerDisposedCostBasis', v_disposed_basis,
      'sellerProceeds', v_seller_proceeds,
      'sellerRealizedPnl', v_realized_pnl,
      'legacyWalletTouched', false
    )
  );

  return jsonb_build_object(
    'buyerQuantity', v_buyer.quantity,
    'buyerCostBasis', v_buyer.cost_basis,
    'buyerAverageEntryPrice', v_buyer.average_entry_price,
    'sellerQuantity', v_seller.quantity,
    'sellerCostBasis', v_seller.cost_basis,
    'sellerAverageEntryPrice', v_seller.average_entry_price,
    'sellerRealizedPnlDelta', v_realized_pnl,
    'sellerRealizedPnlTotal', v_seller.realized_pnl
  );
end;
$$;

create or replace function exchange_insert_fill_v2(
  p_market exchange_markets,
  p_maker_order exchange_orders,
  p_taker_order exchange_orders,
  p_quantity numeric,
  p_price numeric
)
returns exchange_fills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fill exchange_fills;
  v_event_id uuid := gen_random_uuid();
  v_maker_fee numeric := 0;
  v_taker_fee numeric := 0;
  v_buyer_user_id uuid;
  v_seller_user_id uuid;
  v_buyer_order_id uuid;
  v_seller_order_id uuid;
  v_buyer_fee numeric := 0;
  v_seller_fee numeric := 0;
  v_position_result jsonb;
begin
  if p_maker_order.user_id = p_taker_order.user_id then
    raise exception 'self-trade rejected';
  end if;

  insert into exchange_fills (
    market_id, outcome, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
    quantity, price, maker_fee, taker_fee, book_version
  ) values (
    p_market.market_id, p_taker_order.outcome, p_maker_order.id, p_taker_order.id,
    p_maker_order.user_id, p_taker_order.user_id, p_quantity, p_price,
    v_maker_fee, v_taker_fee, p_market.book_version + 1
  ) returning * into v_fill;

  if p_taker_order.action = 'buy' then
    v_buyer_user_id := p_taker_order.user_id;
    v_buyer_order_id := p_taker_order.id;
    v_seller_user_id := p_maker_order.user_id;
    v_seller_order_id := p_maker_order.id;
    v_buyer_fee := v_taker_fee;
    v_seller_fee := v_maker_fee;
  else
    v_buyer_user_id := p_maker_order.user_id;
    v_buyer_order_id := p_maker_order.id;
    v_seller_user_id := p_taker_order.user_id;
    v_seller_order_id := p_taker_order.id;
    v_buyer_fee := v_maker_fee;
    v_seller_fee := v_taker_fee;
  end if;

  v_position_result := exchange_apply_fill_positions_v2(
    p_market.market_id,
    p_taker_order.outcome,
    v_buyer_user_id,
    v_seller_user_id,
    p_quantity,
    p_price,
    v_buyer_fee,
    v_seller_fee,
    v_fill.id
  );

  insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, fill_id, idempotency_key, metadata)
  values
    (v_event_id, v_buyer_user_id, p_market.market_id, 'credit_share', p_quantity, exchange_share_currency(p_taker_order.outcome), v_buyer_order_id, v_fill.id, 'exchange:credit_share:' || v_fill.id::text, jsonb_build_object('counterpartyOrderId', v_seller_order_id, 'positionAccounting', v_position_result)),
    (v_event_id, v_seller_user_id, p_market.market_id, 'credit_coin', round(p_quantity * p_price - v_seller_fee, 6), 'COIN', v_seller_order_id, v_fill.id, 'exchange:credit_coin:' || v_fill.id::text, jsonb_build_object('counterpartyOrderId', v_buyer_order_id, 'legacyWalletTouched', false, 'positionAccounting', v_position_result))
  on conflict (idempotency_key) do nothing;

  perform exchange_adjust_order_reservation_after_fill_v2(v_buyer_order_id, p_quantity, p_price, p_market.fee_bps, v_event_id, 'fill');
  perform exchange_adjust_order_reservation_after_fill_v2(v_seller_order_id, p_quantity, p_price, p_market.fee_bps, v_event_id, 'fill');

  return v_fill;
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
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exchange_gate_allows(p_environment, p_action) then
    raise exception 'exchange trading is disabled';
  end if;

  -- ADR lock order: market advisory lock -> market row -> reservations -> orders -> fills/ledger.
  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, p_outcome));

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
  end if;

  if p_time_in_force = 'GTD' then
    if p_expires_at is null then
      raise exception 'GTD orders require explicit expires_at';
    end if;
    if p_expires_at <= now() then
      raise exception 'GTD expires_at must be in the future';
    end if;
    if p_expires_at > v_market.close_at then
      raise exception 'GTD expires_at cannot exceed market close';
    end if;
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

  select * into v_quote from exchange_order_quotes where id = p_quote_id and user_id = v_user for update;
  if not found or v_quote.expires_at <= now() or v_quote.book_version <> v_market.book_version then
    raise exception 'quote expired or stale; requote required';
  end if;
  if v_quote.market_id <> p_market_id or v_quote.outcome <> p_outcome or v_quote.action <> p_action or v_quote.requested_limit_price <> p_limit_price or v_quote.requested_quantity <> p_quantity then
    raise exception 'quote changed; requote required';
  end if;

  if exchange_self_cross_exists_v2(p_market_id, p_outcome, p_action, p_limit_price, v_user) then
    insert into exchange_orders (
      user_id, market_id, outcome, action, limit_price, original_quantity,
      filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
      reduce_only, status, client_order_id, quote_id, accepted_worst_price, rejected_reason, expires_at
    ) values (
      v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
      0, 0, p_quantity, p_time_in_force,
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'self-trade rejected',
      v_expires_at
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
      p_action = 'sell', 'rejected', p_client_order_id, p_quote_id, v_quote.worst_execution_price, 'FOK cannot fully fill',
      null
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
    p_action = 'sell', 'open', p_client_order_id, p_quote_id, v_quote.worst_execution_price,
    v_expires_at
  ) returning * into v_order;

  -- Reserve before order/fill mutation so every committed fill is fully collateralized.
  v_reservation := exchange_reserve_order_collateral_v2(v_order.id);

  v_match := exchange_match_order_v2(v_order.id);
  select * into v_order from exchange_orders where id = v_order.id for update;

  -- FOK is all-or-none. The pre-match fillable check is an estimate; if actual
  -- matching changes under concurrency, raise so the transaction rolls back any
  -- partial fills, ledger entries, and position updates.
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
  values (
    v_user,
    'exchange_order_matched',
    'exchange_order',
    v_order.id,
    v_market.book_version,
    jsonb_build_object('match', v_match, 'timeInForce', p_time_in_force, 'expiresAt', v_expires_at, 'fokPreMatchFillableQuantity', v_fillable, 'productionGateTouched', false)
  );

  return exchange_order_response_v2(v_order, v_market);
exception when others then
  raise;
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
  select place_order_v2(
    p_market_id,
    p_outcome,
    p_action,
    p_quantity,
    p_limit_price,
    p_time_in_force,
    p_client_order_id,
    p_quote_id,
    p_environment,
    null::timestamptz
  );
$$;

revoke all on function exchange_apply_fill_positions_v2(uuid, exchange_outcome, uuid, uuid, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_insert_fill_v2(exchange_markets, exchange_orders, exchange_orders, numeric, numeric) from public, anon, authenticated;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) from public, anon;

grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text, timestamptz) to authenticated;
