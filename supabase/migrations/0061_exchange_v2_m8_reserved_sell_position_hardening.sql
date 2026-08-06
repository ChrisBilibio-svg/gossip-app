-- 0061_exchange_v2_m8_reserved_sell_position_hardening.sql — M8 cash-out position constraint hardening
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- M8 live run after 0060 exposed that fully-filled sell/cash-out orders can
-- reduce exchange_positions.quantity before their reserved_sell_quantity is
-- released, tripping check (reserved_sell_quantity <= quantity). Keep the sell
-- reservation decrement in the same seller-position update as the quantity
-- decrement so the invariant holds for full-position cash-outs.

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
      reserved_sell_quantity = greatest(reserved_sell_quantity - p_quantity, 0),
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

revoke all on function exchange_apply_fill_positions_v2(uuid, exchange_outcome, uuid, uuid, numeric, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function exchange_apply_fill_positions_v2(uuid, exchange_outcome, uuid, uuid, numeric, numeric, numeric, numeric, uuid) to service_role;
