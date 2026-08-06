-- Exchange v2 M8/M9: fix settlement market-state enum casts.
--
-- Context:
-- - Chris confirmed 0061 + 0062 were applied, then the M8 live lifecycle reached settlement.
-- - Live settlement failed because resolve_market_v2 assigned text literals to exchange_markets.state,
--   an exchange_market_state enum column.
--
-- Safety:
-- - Recreates only resolve_market_v2 with explicit enum casts.
-- - Does not enable production trading, selling, market maker, fees, or production approval.
-- - Keeps service-role-only settlement execution grants.

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


revoke all on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) from public, anon, authenticated;
grant execute on function resolve_market_v2(uuid, exchange_settlement_outcome, text, text) to service_role;
