-- 0059_exchange_v2_complete_set_minting.sql — exchange-v2 complete-set minting
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Coins remain closed-loop entertainment units with no cash value, withdrawal,
--   redemption, prizes, or crypto conversion.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M-mint / 0059:
-- - Option A is approved: complete-set minting is the genesis-liquidity path.
-- - Opposing VERDADE/MENTIRA buy orders may cross when the resting buyer's price
--   plus the incoming buyer's limit price can collateralize one complete set.
-- - Execution prices are complementary: maker pays maker.limit_price, taker pays
--   1 - maker.limit_price, so exactly 1 whole coin is reserved/spent per
--   complete-set payout unit and exactly one side pays 1 at TEA/CAP settlement.
-- - 0058 whole_coin_lot_size keeps each side's spend, excess release, and VOID
--   payout as whole COIN amounts before the 0056 wallet bridge sees them.

create or replace function exchange_opposite_outcome_v2(p_outcome exchange_outcome)
returns exchange_outcome
language sql
immutable
as $$
  select case when p_outcome = 'true' then 'false'::exchange_outcome else 'true'::exchange_outcome end;
$$;

create or replace function exchange_complete_set_taker_price_v2(p_maker_price numeric)
returns numeric
language sql
immutable
as $$
  select round(1.00000000 - coalesce(p_maker_price, 0), 8);
$$;

create or replace function exchange_assert_complete_set_prices_v2(
  p_market exchange_markets,
  p_maker_price numeric,
  p_taker_limit_price numeric,
  p_quantity numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_taker_price numeric := exchange_complete_set_taker_price_v2(p_maker_price);
begin
  perform exchange_assert_tick(p_maker_price, p_market.tick_size, 'complete_set_maker_price');
  perform exchange_assert_tick(v_taker_price, p_market.tick_size, 'complete_set_taker_price');
  perform exchange_assert_tick(p_quantity, p_market.quantity_step, 'complete_set_quantity');
  perform exchange_assert_whole_coin_order_v2(p_market, 'buy', p_quantity, p_maker_price);
  perform exchange_assert_whole_coin_order_v2(p_market, 'buy', p_quantity, v_taker_price);

  if p_maker_price <= 0 or p_maker_price >= 1 then
    raise exception 'complete-set maker price must be strictly between 0 and 1';
  end if;

  if v_taker_price < 0 or v_taker_price > p_taker_limit_price then
    raise exception 'opposing buyer limits do not collateralize a complete set';
  end if;

  if exchange_coin_notional_v2(p_quantity, p_maker_price) + exchange_coin_notional_v2(p_quantity, v_taker_price) <> p_quantity then
    raise exception 'complete-set mint must reserve exactly one whole COIN per payout unit';
  end if;

  return v_taker_price;
end;
$$;

create or replace function exchange_available_minting_quantity_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_limit_price numeric,
  p_taker_user_id uuid
)
returns numeric
language sql
stable
as $$
  select case
    when p_action <> 'buy' then 0::numeric
    else coalesce(sum(o.remaining_quantity), 0::numeric)
  end
  from exchange_orders o
  where p_action = 'buy'
    and o.market_id = p_market_id
    and o.outcome = exchange_opposite_outcome_v2(p_outcome)
    and o.action = 'buy'
    and o.status in ('open','partially_filled')
    and o.remaining_quantity > 0
    and o.user_id <> p_taker_user_id
    and exchange_complete_set_taker_price_v2(o.limit_price) <= p_limit_price;
$$;

create or replace function exchange_available_crossing_quantity_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_limit_price numeric,
  p_taker_user_id uuid
)
returns numeric
language sql
stable
as $$
  select
    coalesce((
      select sum(o.remaining_quantity)
      from exchange_orders o
      where o.market_id = p_market_id
        and o.outcome = p_outcome
        and o.user_id <> p_taker_user_id
        and o.status in ('open','partially_filled')
        and o.remaining_quantity > 0
        and (
          (p_action = 'buy' and o.action = 'sell' and o.limit_price <= p_limit_price)
          or (p_action = 'sell' and o.action = 'buy' and o.limit_price >= p_limit_price)
        )
    ), 0::numeric)
    + exchange_available_minting_quantity_v2(p_market_id, p_outcome, p_action, p_limit_price, p_taker_user_id);
$$;

create or replace function exchange_self_cross_exists_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_action exchange_order_action,
  p_limit_price numeric,
  p_taker_user_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from exchange_orders o
    where o.market_id = p_market_id
      and o.user_id = p_taker_user_id
      and o.status in ('open','partially_filled')
      and o.remaining_quantity > 0
      and (
        (
          o.outcome = p_outcome
          and (
            (p_action = 'buy' and o.action = 'sell' and o.limit_price <= p_limit_price)
            or (p_action = 'sell' and o.action = 'buy' and o.limit_price >= p_limit_price)
          )
        )
        or (
          p_action = 'buy'
          and o.action = 'buy'
          and o.outcome = exchange_opposite_outcome_v2(p_outcome)
          and exchange_complete_set_taker_price_v2(o.limit_price) <= p_limit_price
        )
      )
  );
$$;

create or replace function exchange_apply_mint_position_v2(
  p_market_id uuid,
  p_outcome exchange_outcome,
  p_user_id uuid,
  p_quantity numeric,
  p_price numeric,
  p_fill_id uuid
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
  if p_user_id is null then raise exception 'mint position user required'; end if;
  if p_quantity <= 0 or p_price < 0 or p_price > 1 then raise exception 'invalid mint position inputs'; end if;

  insert into exchange_positions (user_id, market_id, outcome, quantity, cost_basis, average_entry_price, fees_paid)
  values (p_user_id, p_market_id, p_outcome, 0, 0, 0, 0)
  on conflict (user_id, market_id, outcome) do nothing;

  select * into v_position
  from exchange_positions
  where user_id = p_user_id
    and market_id = p_market_id
    and outcome = p_outcome
  for update;

  v_new_quantity := round(v_position.quantity + p_quantity, 6);
  v_new_cost_basis := round(v_position.cost_basis + exchange_coin_notional_v2(p_quantity, p_price), 6);

  update exchange_positions
  set quantity = v_new_quantity,
      cost_basis = v_new_cost_basis,
      average_entry_price = case when v_new_quantity > 0 then round(v_new_cost_basis / v_new_quantity, 8) else 0 end,
      version = version + 1,
      updated_at = now()
  where id = v_position.id
  returning * into v_position;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, metadata)
  values (
    p_user_id,
    'exchange_complete_set_position_credited',
    'exchange_fill',
    p_fill_id,
    jsonb_build_object(
      'marketId', p_market_id,
      'outcome', p_outcome,
      'quantity', p_quantity,
      'price', p_price,
      'costBasisAdded', exchange_coin_notional_v2(p_quantity, p_price),
      'legacyWalletTouched', false,
      'coinsClosedLoop', true
    )
  );

  return v_position;
end;
$$;

create or replace function exchange_insert_complete_set_mint_v2(
  p_market exchange_markets,
  p_maker_order exchange_orders,
  p_taker_order exchange_orders,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_maker_price numeric := p_maker_order.limit_price;
  v_taker_price numeric;
  v_maker_fill exchange_fills;
  v_taker_fill exchange_fills;
  v_maker_position exchange_positions;
  v_taker_position exchange_positions;
  v_total_collateral numeric;
begin
  if p_maker_order.user_id = p_taker_order.user_id then
    raise exception 'self-trade rejected';
  end if;
  if p_maker_order.action <> 'buy' or p_taker_order.action <> 'buy' then
    raise exception 'complete-set minting requires two buy orders';
  end if;
  if p_maker_order.market_id <> p_taker_order.market_id or p_maker_order.outcome = p_taker_order.outcome then
    raise exception 'complete-set minting requires opposing outcomes in one market';
  end if;

  v_taker_price := exchange_assert_complete_set_prices_v2(p_market, v_maker_price, p_taker_order.limit_price, p_quantity);
  v_total_collateral := exchange_coin_notional_v2(p_quantity, v_maker_price) + exchange_coin_notional_v2(p_quantity, v_taker_price);
  perform exchange_assert_whole_coin_amount_v2(v_total_collateral, 'complete_set_total_collateral');

  insert into exchange_fills (
    market_id, outcome, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
    quantity, price, maker_fee, taker_fee, book_version
  ) values (
    p_market.market_id, p_maker_order.outcome, p_maker_order.id, p_taker_order.id,
    p_maker_order.user_id, p_taker_order.user_id, p_quantity, v_maker_price,
    0, 0, p_market.book_version + 1
  ) returning * into v_maker_fill;

  insert into exchange_fills (
    market_id, outcome, maker_order_id, taker_order_id, maker_user_id, taker_user_id,
    quantity, price, maker_fee, taker_fee, book_version
  ) values (
    p_market.market_id, p_taker_order.outcome, p_maker_order.id, p_taker_order.id,
    p_maker_order.user_id, p_taker_order.user_id, p_quantity, v_taker_price,
    0, 0, p_market.book_version + 1
  ) returning * into v_taker_fill;

  v_maker_position := exchange_apply_mint_position_v2(p_market.market_id, p_maker_order.outcome, p_maker_order.user_id, p_quantity, v_maker_price, v_maker_fill.id);
  v_taker_position := exchange_apply_mint_position_v2(p_market.market_id, p_taker_order.outcome, p_taker_order.user_id, p_quantity, v_taker_price, v_taker_fill.id);

  insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, fill_id, idempotency_key, metadata)
  values
    (
      v_event_id,
      p_maker_order.user_id,
      p_market.market_id,
      'credit_share',
      p_quantity,
      exchange_share_currency(p_maker_order.outcome),
      p_maker_order.id,
      v_maker_fill.id,
      'exchange:mint_credit_share:' || v_maker_fill.id::text,
      jsonb_build_object('mintEventId', v_event_id, 'counterpartyOrderId', p_taker_order.id, 'positionId', v_maker_position.id, 'completeSetMint', true)
    ),
    (
      v_event_id,
      p_taker_order.user_id,
      p_market.market_id,
      'credit_share',
      p_quantity,
      exchange_share_currency(p_taker_order.outcome),
      p_taker_order.id,
      v_taker_fill.id,
      'exchange:mint_credit_share:' || v_taker_fill.id::text,
      jsonb_build_object('mintEventId', v_event_id, 'counterpartyOrderId', p_maker_order.id, 'positionId', v_taker_position.id, 'completeSetMint', true)
    )
  on conflict (idempotency_key) do nothing;

  perform exchange_adjust_order_reservation_after_fill_v2(p_maker_order.id, p_quantity, v_maker_price, p_market.fee_bps, v_event_id, 'complete_set_mint');
  perform exchange_adjust_order_reservation_after_fill_v2(p_taker_order.id, p_quantity, v_taker_price, p_market.fee_bps, v_event_id, 'complete_set_mint');

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, aggregate_version, metadata)
  values (
    p_taker_order.user_id,
    'exchange_complete_set_minted',
    'exchange_market',
    p_market.market_id,
    p_market.book_version + 1,
    jsonb_build_object(
      'eventId', v_event_id,
      'makerOrderId', p_maker_order.id,
      'takerOrderId', p_taker_order.id,
      'makerOutcome', p_maker_order.outcome,
      'takerOutcome', p_taker_order.outcome,
      'quantity', p_quantity,
      'makerPrice', v_maker_price,
      'takerPrice', v_taker_price,
      'totalCollateralCoins', v_total_collateral,
      'wholeCoinLotSize', p_market.whole_coin_lot_size,
      'settlementInvariant', 'exactly_one_side_pays_1_coin',
      'legacyFixedOddsTouched', false,
      'coinsClosedLoop', true,
      'productionGateTouched', false
    )
  );

  return jsonb_build_object(
    'eventId', v_event_id,
    'makerFillId', v_maker_fill.id,
    'takerFillId', v_taker_fill.id,
    'quantity', p_quantity,
    'makerPrice', v_maker_price,
    'takerPrice', v_taker_price,
    'totalCollateralCoins', v_total_collateral
  );
end;
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
      and o.status in ('open','partially_filled')
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
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled' else 'partially_filled' end,
        updated_at = now()
    where id = v_maker.id
    returning * into v_maker;

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled' else 'partially_filled' end,
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
        and o.status in ('open','partially_filled')
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
        and o.status in ('open','partially_filled')
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
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled' else 'partially_filled' end,
        updated_at = now()
    where id = v_maker.id
    returning * into v_maker;

    update exchange_orders
    set filled_quantity = filled_quantity + v_fill_qty,
        remaining_quantity = remaining_quantity - v_fill_qty,
        status = case when remaining_quantity - v_fill_qty = 0 then 'filled' else 'partially_filled' end,
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

revoke all on function exchange_opposite_outcome_v2(exchange_outcome) from public, anon, authenticated;
revoke all on function exchange_complete_set_taker_price_v2(numeric) from public, anon, authenticated;
revoke all on function exchange_assert_complete_set_prices_v2(exchange_markets, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_available_minting_quantity_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_available_crossing_quantity_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_self_cross_exists_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_apply_mint_position_v2(uuid, exchange_outcome, uuid, numeric, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_insert_complete_set_mint_v2(exchange_markets, exchange_orders, exchange_orders, numeric) from public, anon, authenticated;
revoke all on function exchange_match_complete_set_orders_v2(uuid) from public, anon, authenticated;
revoke all on function exchange_match_order_v2(uuid) from public, anon, authenticated;
