-- 0062_exchange_v2_m8_single_reserved_sell_release.sql — avoid double-decrementing sell reservations
--
-- CODE-READY / HUMAN-GATED:
-- - Chris applies migrations manually; Hermes must not apply this file.
-- - Apply after 0061_exchange_v2_m8_reserved_sell_position_hardening.sql.
-- - Production trading remains disabled. This migration does not update the
--   production exchange_feature_gates row and does not enable any gate.
-- - Legacy fixed-odds semantics remain isolated from exchange_v2.
--
-- Review fix:
-- - 0061 correctly moves the reserved_sell_quantity decrement into
--   exchange_apply_fill_positions_v2 so a full-position cash-out sell updates
--   quantity and reserved sell shares atomically, preserving CHECK
--   (reserved_sell_quantity <= quantity).
-- - The older exchange_adjust_order_reservation_after_fill_v2 path from 0053
--   also decremented reserved_sell_quantity for share reservations after each
--   seller fill, so applying only 0061 would decrement twice.
-- - Keep the decrement in exactly one place: exchange_apply_fill_positions_v2.
--   This replacement removes the second decrement from the reservation-adjust
--   helper while preserving reservation release state and debit_share ledgering.

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
    -- Do not decrement exchange_positions.reserved_sell_quantity here. 0061 keeps
    -- the sell-reservation release in exchange_apply_fill_positions_v2, in the
    -- same seller-position update that decrements quantity, so the CHECK
    -- (reserved_sell_quantity <= quantity) holds without double-decrementing
    -- sellers that have multiple concurrent sell orders.

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

revoke all on function exchange_adjust_order_reservation_after_fill_v2(uuid, numeric, numeric, integer, uuid, text) from public, anon, authenticated;
grant execute on function exchange_adjust_order_reservation_after_fill_v2(uuid, numeric, numeric, integer, uuid, text) to service_role;
