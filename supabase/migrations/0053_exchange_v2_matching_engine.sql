-- 0053_exchange_v2_matching_engine.sql — exchange-v2 matching engine
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
-- - 0052 review hardening: internal helpers are definer-internal only and
--   authenticated users cannot call them directly.

-- 0052 hardening: internal helpers must not be directly executable by clients.
revoke all on function exchange_reserve_order_collateral_v2(uuid) from public, anon, authenticated;
revoke all on function exchange_release_order_reservation_v2(uuid, text) from public, anon, authenticated;
revoke all on function exchange_reject_order_v2(uuid, text) from public, anon, authenticated;

create or replace function exchange_reserve_order_collateral_v2(p_order_id uuid)
returns exchange_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_market exchange_markets;
  v_position exchange_positions;
  v_required numeric;
  v_available numeric;
  v_reservation exchange_reservations;
  v_event_id uuid := gen_random_uuid();
  v_ledger_key text;
begin
  select * into v_order from exchange_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if auth.uid() is not null and v_order.user_id <> auth.uid() then
    raise exception 'order ownership check failed';
  end if;

  select * into v_market from exchange_markets where market_id = v_order.market_id for update;
  if not found then raise exception 'market not found'; end if;

  select * into v_reservation from exchange_reservations where order_id = p_order_id for update;
  if found then
    return v_reservation;
  end if;

  if v_order.remaining_quantity <= 0 or v_order.status not in ('open','partially_filled') then
    raise exception 'order is not reservable';
  end if;

  if v_order.action = 'buy' then
    v_required := exchange_required_coin_reservation(v_order.remaining_quantity, v_order.limit_price, v_market.fee_bps);
    if v_required <= 0 then raise exception 'invalid coin reservation'; end if;

    v_available := exchange_available_coin_balance(v_order.user_id);
    if v_available < v_required then
      raise exception 'insufficient coin balance for exchange reservation';
    end if;

    insert into exchange_reservations (user_id, market_id, outcome, kind, quantity, order_id, status)
    values (v_order.user_id, v_order.market_id, v_order.outcome, 'coin', v_required, p_order_id, 'active')
    returning * into v_reservation;

    v_ledger_key := 'exchange:reserve_coin:' || p_order_id::text;
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
    values (
      v_event_id,
      v_order.user_id,
      v_order.market_id,
      'reserve_coin',
      v_required,
      'COIN',
      p_order_id,
      v_ledger_key,
      jsonb_build_object(
        'limitPrice', v_order.limit_price,
        'remainingQuantity', v_order.remaining_quantity,
        'feeBps', v_market.fee_bps,
        'coinWalletBalance', exchange_coin_wallet_balance(v_order.user_id),
        'availableCoinBalanceAfterReserve', exchange_available_coin_balance(v_order.user_id) - v_required,
        'legacyWalletTouched', false
      )
    ) on conflict (idempotency_key) do nothing;
  else
    select * into v_position
    from exchange_positions
    where user_id = v_order.user_id
      and market_id = v_order.market_id
      and outcome = v_order.outcome
    for update;

    if not found or (v_position.quantity - v_position.reserved_sell_quantity) < v_order.remaining_quantity then
      raise exception 'insufficient shares for reduce-only sell';
    end if;

    update exchange_positions
    set reserved_sell_quantity = reserved_sell_quantity + v_order.remaining_quantity,
        version = version + 1,
        updated_at = now()
    where id = v_position.id;

    insert into exchange_reservations (user_id, market_id, outcome, kind, quantity, order_id, status)
    values (v_order.user_id, v_order.market_id, v_order.outcome, 'share', v_order.remaining_quantity, p_order_id, 'active')
    returning * into v_reservation;

    v_ledger_key := 'exchange:reserve_share:' || p_order_id::text;
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
    values (
      v_event_id,
      v_order.user_id,
      v_order.market_id,
      'reserve_share',
      v_order.remaining_quantity,
      exchange_share_currency(v_order.outcome),
      p_order_id,
      v_ledger_key,
      jsonb_build_object('reduceOnly', true, 'legacyWalletTouched', false)
    ) on conflict (idempotency_key) do nothing;
  end if;

  update exchange_orders
  set reservation_id = v_reservation.id,
      reduce_only = (v_order.action = 'sell'),
      updated_at = now()
  where id = p_order_id;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, metadata)
  values (
    v_order.user_id,
    'exchange_order_collateral_reserved',
    'exchange_order',
    p_order_id,
    jsonb_build_object('reservationId', v_reservation.id, 'kind', v_reservation.kind, 'quantity', v_reservation.quantity)
  );

  return v_reservation;
end;
$$;

create or replace function exchange_release_order_reservation_v2(
  p_order_id uuid,
  p_reason text default 'cancelled'
)
returns exchange_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_reservation exchange_reservations;
  v_release_amount numeric;
  v_event_id uuid := gen_random_uuid();
  v_entry_type text;
  v_key text;
begin
  select * into v_order from exchange_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if auth.uid() is not null and v_order.user_id <> auth.uid() then
    raise exception 'order ownership check failed';
  end if;

  select * into v_reservation
  from exchange_reservations
  where order_id = p_order_id
  for update;

  if not found then
    return null;
  end if;

  v_release_amount := greatest(v_reservation.quantity - v_reservation.released_quantity, 0);
  if v_release_amount <= 0 or v_reservation.status <> 'active' then
    return v_reservation;
  end if;

  if v_reservation.kind = 'share' then
    update exchange_positions
    set reserved_sell_quantity = greatest(reserved_sell_quantity - v_release_amount, 0),
        version = version + 1,
        updated_at = now()
    where user_id = v_reservation.user_id
      and market_id = v_reservation.market_id
      and outcome = v_reservation.outcome;
    v_entry_type := 'release_share';
    v_key := 'exchange:release_share:' || p_order_id::text || ':' || coalesce(p_reason, 'release');
  else
    v_entry_type := 'release_coin';
    v_key := 'exchange:release_coin:' || p_order_id::text || ':' || coalesce(p_reason, 'release');
  end if;

  update exchange_reservations
  set released_quantity = quantity,
      status = 'released',
      updated_at = now()
  where id = v_reservation.id
  returning * into v_reservation;

  insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
  values (
    v_event_id,
    v_reservation.user_id,
    v_reservation.market_id,
    v_entry_type,
    v_release_amount,
    case when v_reservation.kind = 'coin' then 'COIN' else exchange_share_currency(v_reservation.outcome) end,
    p_order_id,
    v_key,
    jsonb_build_object('reason', coalesce(p_reason, 'release'), 'legacyWalletTouched', false)
  ) on conflict (idempotency_key) do nothing;

  insert into exchange_audit_events (actor_user_id, event_type, aggregate_type, aggregate_id, metadata)
  values (
    v_order.user_id,
    'exchange_order_reservation_released',
    'exchange_order',
    p_order_id,
    jsonb_build_object('reservationId', v_reservation.id, 'kind', v_reservation.kind, 'quantity', v_release_amount, 'reason', coalesce(p_reason, 'release'))
  );

  return v_reservation;
end;
$$;

create or replace function exchange_reject_order_v2(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
begin
  select * into v_order from exchange_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  if auth.uid() is not null and v_order.user_id <> auth.uid() then
    raise exception 'order ownership check failed';
  end if;

  perform exchange_release_order_reservation_v2(p_order_id, coalesce(p_reason, 'rejected'));

  update exchange_orders
  set status = 'rejected',
      rejected_reason = coalesce(p_reason, 'rejected'),
      cancelled_quantity = remaining_quantity,
      remaining_quantity = 0,
      updated_at = now()
  where id = p_order_id
    and status in ('open','partially_filled')
  returning * into v_order;

  if not found then
    select * into v_order from exchange_orders where id = p_order_id;
  end if;

  return exchange_order_response_v2(v_order);
end;
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
  select coalesce(sum(o.remaining_quantity), 0::numeric)
  from exchange_orders o
  where o.market_id = p_market_id
    and o.outcome = p_outcome
    and o.user_id <> p_taker_user_id
    and o.status in ('open','partially_filled')
    and o.remaining_quantity > 0
    and (
      (p_action = 'buy' and o.action = 'sell' and o.limit_price <= p_limit_price)
      or (p_action = 'sell' and o.action = 'buy' and o.limit_price >= p_limit_price)
    );
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
      and o.outcome = p_outcome
      and o.user_id = p_taker_user_id
      and o.status in ('open','partially_filled')
      and o.remaining_quantity > 0
      and (
        (p_action = 'buy' and o.action = 'sell' and o.limit_price <= p_limit_price)
        or (p_action = 'sell' and o.action = 'buy' and o.limit_price >= p_limit_price)
      )
  );
$$;

create or replace function exchange_adjust_order_reservation_after_fill_v2(
  p_order_id uuid,
  p_fill_quantity numeric,
  p_fill_price numeric,
  p_fee_bps integer,
  p_event_id uuid,
  p_reason text default 'fill'
)
returns exchange_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_reservation exchange_reservations;
  v_consumed numeric;
  v_target_active numeric;
  v_release_amount numeric;
  v_key text;
begin
  select * into v_order from exchange_orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  select * into v_reservation from exchange_reservations where order_id = p_order_id for update;
  if not found then return null; end if;

  if v_reservation.status <> 'active' then
    return v_reservation;
  end if;

  if v_reservation.kind = 'coin' then
    v_consumed := round(p_fill_quantity * p_fill_price + ((p_fill_quantity * p_fill_price) * greatest(coalesce(p_fee_bps, 0), 0)::numeric / 10000), 6);
    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
    values (
      p_event_id,
      v_reservation.user_id,
      v_reservation.market_id,
      'spend_coin',
      v_consumed,
      'COIN',
      p_order_id,
      'exchange:spend_coin:' || p_order_id::text || ':' || p_event_id::text,
      jsonb_build_object('fillQuantity', p_fill_quantity, 'fillPrice', p_fill_price, 'reason', p_reason, 'legacyWalletTouched', false)
    ) on conflict (idempotency_key) do nothing;

    v_target_active := case
      when v_order.remaining_quantity > 0 then exchange_required_coin_reservation(v_order.remaining_quantity, v_order.limit_price, p_fee_bps)
      else 0
    end;
    v_release_amount := greatest(v_reservation.quantity - v_reservation.released_quantity - v_consumed - v_target_active, 0);
    if v_release_amount > 0 then
      v_key := 'exchange:release_coin_fill_excess:' || p_order_id::text || ':' || p_event_id::text;
      insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
      values (p_event_id, v_reservation.user_id, v_reservation.market_id, 'release_coin', v_release_amount, 'COIN', p_order_id, v_key, jsonb_build_object('reason', 'fill_excess', 'legacyWalletTouched', false))
      on conflict (idempotency_key) do nothing;
    end if;

    update exchange_reservations
    set released_quantity = least(quantity, released_quantity + v_consumed + v_release_amount),
        status = case when v_order.remaining_quantity = 0 then 'consumed' else 'active' end,
        updated_at = now()
    where id = v_reservation.id
    returning * into v_reservation;
  else
    v_consumed := p_fill_quantity;
    update exchange_positions
    set reserved_sell_quantity = greatest(reserved_sell_quantity - v_consumed, 0),
        version = version + 1,
        updated_at = now()
    where user_id = v_reservation.user_id
      and market_id = v_reservation.market_id
      and outcome = v_reservation.outcome;

    insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, idempotency_key, metadata)
    values (
      p_event_id,
      v_reservation.user_id,
      v_reservation.market_id,
      'debit_share',
      v_consumed,
      exchange_share_currency(v_reservation.outcome),
      p_order_id,
      'exchange:debit_share:' || p_order_id::text || ':' || p_event_id::text,
      jsonb_build_object('fillQuantity', p_fill_quantity, 'fillPrice', p_fill_price, 'reason', p_reason)
    ) on conflict (idempotency_key) do nothing;

    update exchange_reservations
    set released_quantity = least(quantity, released_quantity + v_consumed),
        status = case when v_order.remaining_quantity = 0 then 'consumed' else 'active' end,
        updated_at = now()
    where id = v_reservation.id
    returning * into v_reservation;
  end if;

  return v_reservation;
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
  else
    v_buyer_user_id := p_maker_order.user_id;
    v_buyer_order_id := p_maker_order.id;
    v_seller_user_id := p_taker_order.user_id;
    v_seller_order_id := p_taker_order.id;
  end if;

  insert into exchange_wallet_ledger (event_id, user_id, market_id, entry_type, amount, currency, order_id, fill_id, idempotency_key, metadata)
  values
    (v_event_id, v_buyer_user_id, p_market.market_id, 'credit_share', p_quantity, exchange_share_currency(p_taker_order.outcome), v_buyer_order_id, v_fill.id, 'exchange:credit_share:' || v_fill.id::text, jsonb_build_object('counterpartyOrderId', v_seller_order_id)),
    (v_event_id, v_seller_user_id, p_market.market_id, 'credit_coin', round(p_quantity * p_price - v_maker_fee, 6), 'COIN', v_seller_order_id, v_fill.id, 'exchange:credit_coin:' || v_fill.id::text, jsonb_build_object('counterpartyOrderId', v_buyer_order_id, 'legacyWalletTouched', false))
  on conflict (idempotency_key) do nothing;

  perform exchange_adjust_order_reservation_after_fill_v2(v_buyer_order_id, p_quantity, p_price, p_market.fee_bps, v_event_id, 'fill');
  perform exchange_adjust_order_reservation_after_fill_v2(v_seller_order_id, p_quantity, p_price, p_market.fee_bps, v_event_id, 'fill');

  return v_fill;
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
    v_filled := v_filled + v_fill_qty;
    v_notional := v_notional + (v_fill_qty * v_fill_price);
  end loop;

  return jsonb_build_object(
    'fillCount', v_fill_count,
    'filledQuantity', v_filled,
    'averageFillPrice', case when v_filled > 0 then round(v_notional / v_filled, 8) else null end
  );
end;
$$;

create or replace function exchange_order_response_v2(p_order exchange_orders, p_market exchange_markets default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'orderId', p_order.id,
    'status', p_order.status,
    'filledQuantity', p_order.filled_quantity,
    'remainingQuantity', p_order.remaining_quantity,
    'actualAverageFillPrice', (select case when sum(f.quantity) > 0 then round(sum(f.quantity * f.price) / sum(f.quantity), 8) end from exchange_fills f where f.maker_order_id = p_order.id or f.taker_order_id = p_order.id),
    'fees', coalesce((select sum(case when f.maker_order_id = p_order.id then f.maker_fee when f.taker_order_id = p_order.id then f.taker_fee else 0 end) from exchange_fills f where f.maker_order_id = p_order.id or f.taker_order_id = p_order.id), 0),
    'reservedCollateral', coalesce((select r.quantity from exchange_reservations r where r.id = p_order.reservation_id), 0),
    'releasedCollateral', coalesce((select r.released_quantity from exchange_reservations r where r.id = p_order.reservation_id), 0),
    'reservationKind', (select r.kind from exchange_reservations r where r.id = p_order.reservation_id),
    'reservationId', p_order.reservation_id,
    'bookVersion', coalesce(p_market.book_version, (select m.book_version from exchange_markets m where m.market_id = p_order.market_id)),
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  );
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
       or v_order.time_in_force <> p_time_in_force then
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
      case when p_time_in_force = 'GTD' then v_quote.expires_at else null end
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
    case when p_time_in_force = 'GTD' then v_quote.expires_at else null end
  ) returning * into v_order;

  -- Reserve before order/fill mutation so every committed fill is fully collateralized.
  v_reservation := exchange_reserve_order_collateral_v2(v_order.id);

  v_match := exchange_match_order_v2(v_order.id);
  select * into v_order from exchange_orders where id = v_order.id for update;

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
    jsonb_build_object('match', v_match, 'timeInForce', p_time_in_force, 'productionGateTouched', false)
  );

  return exchange_order_response_v2(v_order, v_market);
exception when others then
  raise;
end;
$$;

revoke all on function exchange_available_crossing_quantity_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_self_cross_exists_v2(uuid, exchange_outcome, exchange_order_action, numeric, uuid) from public, anon, authenticated;
revoke all on function exchange_adjust_order_reservation_after_fill_v2(uuid, numeric, numeric, integer, uuid, text) from public, anon, authenticated;
revoke all on function exchange_insert_fill_v2(exchange_markets, exchange_orders, exchange_orders, numeric, numeric) from public, anon, authenticated;
revoke all on function exchange_match_order_v2(uuid) from public, anon, authenticated;
revoke all on function exchange_order_response_v2(exchange_orders, exchange_markets) from public, anon, authenticated;
revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;

grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
