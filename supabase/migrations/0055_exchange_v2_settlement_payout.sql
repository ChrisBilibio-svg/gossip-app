-- 0055_exchange_v2_settlement_payout.sql — exchange-v2 settlement payouts
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M5:
-- - resolve_market_v2 becomes the authoritative settlement payout path.
-- - Winning remaining shares settle to COIN at 1.0 per share.
-- - Losing remaining shares settle to COIN at 0.0 per share and are zeroed.
-- - VOID settles TRUE and FALSE shares to COIN at 0.5 per share.
-- - Open order reservations are released before positions are settled.
-- - Settlement is idempotent by market and by ledger idempotency key.

alter table exchange_positions
  add column if not exists settlement_id uuid references exchange_settlements (id) on delete set null,
  add column if not exists settled_at timestamptz,
  add column if not exists settled_quantity numeric(24,6) not null default 0 check (settled_quantity >= 0),
  add column if not exists settlement_payout numeric(24,6) not null default 0 check (settlement_payout >= 0);

create index if not exists exchange_positions_settlement_idx on exchange_positions (settlement_id);

create or replace function exchange_settlement_value_for_outcome_v2(
  p_settlement_outcome exchange_settlement_outcome,
  p_position_outcome exchange_outcome
)
returns numeric
language sql
immutable
as $$
  select case
    when p_settlement_outcome = 'void' then 0.50000000::numeric
    when p_settlement_outcome::text = p_position_outcome::text then 1.00000000::numeric
    else 0.00000000::numeric
  end;
$$;

create or replace function exchange_release_market_reservations_for_settlement_v2(
  p_market_id uuid,
  p_settlement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order exchange_orders;
  v_released_count integer := 0;
  v_cancelled_count integer := 0;
begin
  for v_order in
    select *
    from exchange_orders
    where market_id = p_market_id
      and status in ('open','partially_filled')
    order by created_at, id
    for update
  loop
    perform exchange_release_order_reservation_v2(v_order.id, 'settlement');

    update exchange_orders
    set status = 'cancelled',
        cancelled_quantity = cancelled_quantity + remaining_quantity,
        remaining_quantity = 0,
        updated_at = now()
    where id = v_order.id
      and status in ('open','partially_filled');

    v_cancelled_count := v_cancelled_count + 1;
  end loop;

  update exchange_reservations r
  set released_quantity = quantity,
      status = 'released',
      updated_at = now()
  where r.market_id = p_market_id
    and r.status = 'active'
    and r.released_quantity < r.quantity;
  get diagnostics v_released_count = row_count;

  insert into exchange_audit_events (event_type, aggregate_type, aggregate_id, metadata)
  values (
    'exchange_market_reservations_released_for_settlement',
    'exchange_settlement',
    p_settlement_id,
    jsonb_build_object(
      'marketId', p_market_id,
      'cancelledOpenOrders', v_cancelled_count,
      'fallbackReleasedReservations', v_released_count,
      'legacyWalletTouched', false
    )
  );

  return jsonb_build_object(
    'cancelledOpenOrders', v_cancelled_count,
    'fallbackReleasedReservations', v_released_count
  );
end;
$$;

create or replace function exchange_settle_positions_v2(
  p_market_id uuid,
  p_settlement exchange_settlements
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position exchange_positions;
  v_event_id uuid := gen_random_uuid();
  v_settlement_value numeric;
  v_payout numeric;
  v_positions_settled integer := 0;
  v_total_payout numeric := 0;
  v_winning_shares numeric := 0;
  v_losing_shares numeric := 0;
  v_void_shares numeric := 0;
begin
  for v_position in
    select *
    from exchange_positions
    where market_id = p_market_id
      and settlement_id is null
    order by user_id, outcome
    for update
  loop
    v_settlement_value := exchange_settlement_value_for_outcome_v2(p_settlement.outcome, v_position.outcome);
    v_payout := round(v_position.quantity * v_settlement_value, 6);

    insert into exchange_wallet_ledger (
      event_id,
      user_id,
      market_id,
      entry_type,
      amount,
      currency,
      settlement_id,
      idempotency_key,
      metadata
    ) values (
      v_event_id,
      v_position.user_id,
      p_market_id,
      'settlement',
      v_payout,
      'COIN',
      p_settlement.id,
      'exchange:settlement:' || p_settlement.id::text || ':' || v_position.id::text,
      jsonb_build_object(
        'positionId', v_position.id,
        'outcome', v_position.outcome,
        'settlementOutcome', p_settlement.outcome,
        'settlementValuePerShare', v_settlement_value,
        'settledQuantity', v_position.quantity,
        'payoutCoins', v_payout,
        'legacyWalletTouched', false,
        'coinsClosedLoop', true
      )
    ) on conflict (idempotency_key) do nothing;

    update exchange_positions
    set settlement_id = p_settlement.id,
        settled_at = now(),
        settled_quantity = v_position.quantity,
        settlement_payout = v_payout,
        quantity = 0,
        reserved_sell_quantity = 0,
        cost_basis = 0,
        average_entry_price = 0,
        version = version + 1,
        updated_at = now()
    where id = v_position.id;

    v_positions_settled := v_positions_settled + 1;
    v_total_payout := round(v_total_payout + v_payout, 6);

    if p_settlement.outcome = 'void' then
      v_void_shares := round(v_void_shares + v_position.quantity, 6);
    elsif p_settlement.outcome::text = v_position.outcome::text then
      v_winning_shares := round(v_winning_shares + v_position.quantity, 6);
    else
      v_losing_shares := round(v_losing_shares + v_position.quantity, 6);
    end if;
  end loop;

  insert into exchange_audit_events (event_type, aggregate_type, aggregate_id, metadata)
  values (
    'exchange_positions_settled',
    'exchange_settlement',
    p_settlement.id,
    jsonb_build_object(
      'marketId', p_market_id,
      'positionsSettled', v_positions_settled,
      'totalPayoutCoins', v_total_payout,
      'winningShares', v_winning_shares,
      'losingShares', v_losing_shares,
      'voidShares', v_void_shares,
      'legacyWalletTouched', false
    )
  );

  return jsonb_build_object(
    'positionsSettled', v_positions_settled,
    'totalPayoutCoins', v_total_payout,
    'winningShares', v_winning_shares,
    'losingShares', v_losing_shares,
    'voidShares', v_void_shares
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

  update exchange_markets
  set state = case when p_outcome = 'void' then 'voided' else 'resolved' end,
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
      'productionGateTouched', false,
      'legacyWalletTouched', false,
      'coinsClosedLoop', true
    )
  );

  return jsonb_build_object(
    'settlementId', v_settlement.id,
    'marketId', p_market_id,
    'outcome', p_outcome,
    'trueValue', v_true_value,
    'falseValue', v_false_value,
    'idempotent', false,
    'positionsSettled', coalesce((v_position_result->>'positionsSettled')::integer, 0),
    'totalPayoutCoins', coalesce((v_position_result->>'totalPayoutCoins')::numeric, 0),
    'reservationsReleased', v_release_result,
    'legacyWalletTouched', false
  );
end;
$$;

revoke all on function exchange_settlement_value_for_outcome_v2(exchange_settlement_outcome, exchange_outcome) from public, anon, authenticated;
revoke all on function exchange_release_market_reservations_for_settlement_v2(uuid, uuid) from public, anon, authenticated;
revoke all on function exchange_settle_positions_v2(uuid, exchange_settlements) from public, anon, authenticated;
revoke all on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) from public, anon, authenticated;

grant execute on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) to service_role;
