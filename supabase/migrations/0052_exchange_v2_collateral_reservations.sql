-- 0052_exchange_v2_collateral_reservations.sql — exchange-v2 collateral & reservations
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds and legacy integer coin spend flows keep their semantics.
--   Exchange v2 reconciles reservations against coin_wallets.balance but records
--   exchange-only reserve/release accounting in exchange_reservations and
--   exchange_wallet_ledger.

create or replace function exchange_coin_wallet_balance(p_user_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select cw.balance::numeric from coin_wallets cw where cw.user_id = p_user_id), 0::numeric);
$$;

create or replace function exchange_active_coin_reserved(p_user_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(r.quantity - r.released_quantity), 0::numeric)
  from exchange_reservations r
  where r.user_id = p_user_id
    and r.kind = 'coin'
    and r.status = 'active';
$$;

create or replace function exchange_available_coin_balance(p_user_id uuid)
returns numeric
language sql
stable
as $$
  select greatest(exchange_coin_wallet_balance(p_user_id) - exchange_active_coin_reserved(p_user_id), 0::numeric);
$$;

create or replace function exchange_required_coin_reservation(
  p_quantity numeric,
  p_limit_price numeric,
  p_fee_bps integer
)
returns numeric
language sql
immutable
as $$
  select round((p_quantity * p_limit_price) + ((p_quantity * p_limit_price) * greatest(coalesce(p_fee_bps, 0), 0)::numeric / 10000), 6);
$$;

create or replace function exchange_share_currency(p_outcome exchange_outcome)
returns text
language sql
immutable
as $$
  select case when p_outcome = 'true' then 'SHARE_TRUE' else 'SHARE_FALSE' end;
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
    'actualAverageFillPrice', null,
    'fees', 0,
    'reservedCollateral', coalesce((select r.quantity from exchange_reservations r where r.id = p_order.reservation_id), 0),
    'reservationKind', (select r.kind from exchange_reservations r where r.id = p_order.reservation_id),
    'reservationId', p_order.reservation_id,
    'bookVersion', coalesce(p_market.book_version, (select m.book_version from exchange_markets m where m.market_id = p_order.market_id)),
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  );
$$;

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

create or replace function expire_order_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order exchange_orders;
begin
  if v_user is null then raise exception 'auth required'; end if;
  select * into v_order from exchange_orders where id = p_order_id and user_id = v_user for update;
  if not found then raise exception 'order not found'; end if;

  if v_order.status not in ('open','partially_filled') then
    return exchange_order_response_v2(v_order);
  end if;

  if v_order.expires_at is not null and v_order.expires_at > now() then
    raise exception 'order has not expired';
  end if;

  perform exchange_release_order_reservation_v2(p_order_id, 'expired');

  update exchange_orders
  set status = 'expired',
      cancelled_quantity = remaining_quantity,
      remaining_quantity = 0,
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  update exchange_markets set book_version = book_version + 1, updated_at = now() where market_id = v_order.market_id;
  return exchange_order_response_v2(v_order);
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
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exchange_gate_allows(p_environment, p_action) then
    raise exception 'exchange trading is disabled';
  end if;

  perform pg_advisory_xact_lock(exchange_market_lock_key(p_market_id, p_outcome));

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

    return exchange_order_response_v2(v_order);
  end if;

  select * into v_market from exchange_markets where market_id = p_market_id for update;
  if not found or v_market.state <> 'open' or v_market.close_at <= now() then
    raise exception 'market is not open';
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

  insert into exchange_orders (
    user_id, market_id, outcome, action, limit_price, original_quantity,
    filled_quantity, remaining_quantity, cancelled_quantity, time_in_force,
    reduce_only, status, client_order_id, quote_id, accepted_worst_price
  ) values (
    v_user, p_market_id, p_outcome, p_action, p_limit_price, p_quantity,
    0, p_quantity, 0, p_time_in_force,
    p_action = 'sell', 'open', p_client_order_id, p_quote_id, v_quote.worst_execution_price
  ) returning * into v_order;

  v_reservation := exchange_reserve_order_collateral_v2(v_order.id);

  update exchange_markets
  set book_version = book_version + 1,
      updated_at = now()
  where market_id = p_market_id
  returning * into v_market;

  select * into v_order from exchange_orders where id = v_order.id;

  return exchange_order_response_v2(v_order, v_market);
exception when others then
  raise;
end;
$$;

create or replace function cancel_order_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order exchange_orders;
begin
  if v_user is null then raise exception 'auth required'; end if;
  select * into v_order from exchange_orders where id = p_order_id and user_id = v_user for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('open','partially_filled') then
    return jsonb_build_object('orderId', p_order_id, 'status', v_order.status);
  end if;

  perform exchange_release_order_reservation_v2(p_order_id, 'cancelled');

  update exchange_orders
  set status = 'cancelled', cancelled_quantity = remaining_quantity, remaining_quantity = 0, updated_at = now()
  where id = p_order_id
  returning * into v_order;
  update exchange_markets set book_version = book_version + 1, updated_at = now() where market_id = v_order.market_id;
  return jsonb_build_object('orderId', p_order_id, 'status', v_order.status, 'releasedQuantity', v_order.cancelled_quantity);
end;
$$;

create or replace function get_trade_receipt_v1(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'marketId', o.market_id,
    'outcome', o.outcome,
    'action', o.action,
    'status', o.status,
    'coinsRequested', case when o.action = 'buy' then o.original_quantity * o.limit_price else null end,
    'sharesRequested', o.original_quantity,
    'sharesFilled', o.filled_quantity,
    'sharesRemaining', o.remaining_quantity,
    'requestedLimitPrice', o.limit_price,
    'actualAverageFillPrice', (select case when sum(f.quantity) > 0 then sum(f.quantity * f.price) / sum(f.quantity) end from exchange_fills f where f.maker_order_id = o.id or f.taker_order_id = o.id),
    'fees', 0,
    'reservationId', o.reservation_id,
    'reservationKind', (select r.kind from exchange_reservations r where r.id = o.reservation_id),
    'reservedCollateral', coalesce((select r.quantity from exchange_reservations r where r.id = o.reservation_id), 0),
    'releasedCollateral', coalesce((select r.released_quantity from exchange_reservations r where r.id = o.reservation_id), 0),
    'orderTimestamp', o.created_at,
    'cashOutDisclosure', 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.'
  )
  from exchange_orders o
  where o.id = p_order_id and o.user_id = auth.uid();
$$;

revoke all on function exchange_coin_wallet_balance(uuid) from public, anon;
revoke all on function exchange_active_coin_reserved(uuid) from public, anon;
revoke all on function exchange_available_coin_balance(uuid) from public, anon;
revoke all on function exchange_required_coin_reservation(numeric, numeric, integer) from public, anon;
revoke all on function exchange_share_currency(exchange_outcome) from public, anon;
revoke all on function exchange_order_response_v2(exchange_orders, exchange_markets) from public, anon;
revoke all on function exchange_reserve_order_collateral_v2(uuid) from public, anon;
revoke all on function exchange_release_order_reservation_v2(uuid, text) from public, anon;
revoke all on function exchange_reject_order_v2(uuid, text) from public, anon;
revoke all on function expire_order_v1(uuid) from public, anon;

revoke all on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) from public, anon;
revoke all on function cancel_order_v1(uuid) from public, anon;
revoke all on function get_trade_receipt_v1(uuid) from public, anon;

grant execute on function place_order_v2(uuid, exchange_outcome, exchange_order_action, numeric, numeric, exchange_time_in_force, text, uuid, text) to authenticated;
grant execute on function cancel_order_v1(uuid) to authenticated;
grant execute on function get_trade_receipt_v1(uuid) to authenticated;
grant execute on function expire_order_v1(uuid) to authenticated;
