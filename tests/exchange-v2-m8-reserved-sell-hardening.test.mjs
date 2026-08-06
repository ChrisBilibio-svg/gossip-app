import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration0061 = readFileSync(new URL('../supabase/migrations/0061_exchange_v2_m8_reserved_sell_position_hardening.sql', import.meta.url), 'utf8');
const migration0062 = readFileSync(new URL('../supabase/migrations/0062_exchange_v2_m8_single_reserved_sell_release.sql', import.meta.url), 'utf8');
const liveTest = readFileSync(new URL('./exchange-v2-m8-live.test.mjs', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const status = readFileSync(new URL('../PROJECT_STATUS.md', import.meta.url), 'utf8');

function has(pattern, source = migration0061) {
  assert.match(source, pattern);
}

function not(pattern, source = migration0061) {
  assert.doesNotMatch(source, pattern);
}

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function applySellerPositionFill({ quantity, reservedSellQuantity, fillQuantity }) {
  return {
    quantity: Math.max(quantity - fillQuantity, 0),
    reservedSellQuantity: Math.max(reservedSellQuantity - fillQuantity, 0),
  };
}

function adjustShareReservationAfterFill0062({ reservationReleasedQuantity, reservationQuantity, fillQuantity }) {
  return {
    releasedQuantity: Math.min(reservationQuantity, reservationReleasedQuantity + fillQuantity),
  };
}

test('0061 hardens full cash-out sells by decrementing reserved shares with seller quantity', () => {
  has(/0061_exchange_v2_m8_reserved_sell_position_hardening/i);
  has(/create or replace function exchange_apply_fill_positions_v2/i);
  has(/reserved_sell_quantity = greatest\(reserved_sell_quantity - p_quantity, 0\)/);
  has(/set quantity = greatest\(v_seller_new_quantity, 0\),\s*reserved_sell_quantity = greatest\(reserved_sell_quantity - p_quantity, 0\)/i);
  has(/reserved_sell_quantity <= quantity/i);
  has(/revoke all on function exchange_apply_fill_positions_v2/i);
  has(/grant execute on function exchange_apply_fill_positions_v2\([^)]*\) to service_role/i);
  not(/production_approved\s*=\s*true/i);
  not(/environment'\s*,\s*'production'|environment\s*=\s*'production'/i);
  not(/trading_enabled\s*=\s*true/i);
});

test('0062 removes the duplicate reserved-sell decrement from reservation adjustment', () => {
  has(/0062_exchange_v2_m8_single_reserved_sell_release/i, migration0062);
  has(/create or replace function exchange_adjust_order_reservation_after_fill_v2/i, migration0062);
  has(/Do not decrement exchange_positions\.reserved_sell_quantity here/i, migration0062);
  has(/exchange_apply_fill_positions_v2/i, migration0062);
  has(/insert into exchange_wallet_ledger[\s\S]*'debit_share'/i, migration0062);
  has(/set released_quantity = least\(quantity, released_quantity \+ v_consumed\)/i, migration0062);
  not(/set\s+reserved_sell_quantity\s*=\s*greatest\(reserved_sell_quantity - v_consumed, 0\)/i, migration0062);
  not(/update exchange_positions[\s\S]{0,220}reserved_sell_quantity\s*=/i, migration0062);
  not(/production_approved\s*=\s*true/i, migration0062);
  not(/environment'\s*,\s*'production'|environment\s*=\s*'production'/i, migration0062);
  not(/trading_enabled\s*=\s*true/i, migration0062);
  has(/revoke all on function exchange_adjust_order_reservation_after_fill_v2/i, migration0062);
  has(/grant execute on function exchange_adjust_order_reservation_after_fill_v2\([^)]*\) to service_role/i, migration0062);
});

test('reserved_sell_quantity is decremented in exactly one live-fill function after 0062', () => {
  assert.equal(countMatches(migration0061, /reserved_sell_quantity\s*=\s*greatest\(reserved_sell_quantity - p_quantity, 0\)/g), 1);
  assert.equal(countMatches(migration0062, /reserved_sell_quantity\s*=\s*greatest\(/g), 0);
});

test('two concurrent sell orders regression: one fill releases exactly the filled shares, not double', () => {
  const starting = {
    quantity: 200,
    reservedSellQuantity: 200, // two open sell orders of 100 shares each
    firstOrderReservationQuantity: 100,
    firstOrderReleasedQuantity: 0,
    fillQuantity: 100,
  };

  const afterPositionAccounting = applySellerPositionFill({
    quantity: starting.quantity,
    reservedSellQuantity: starting.reservedSellQuantity,
    fillQuantity: starting.fillQuantity,
  });
  const afterReservationAdjust = adjustShareReservationAfterFill0062({
    reservationQuantity: starting.firstOrderReservationQuantity,
    reservationReleasedQuantity: starting.firstOrderReleasedQuantity,
    fillQuantity: starting.fillQuantity,
  });

  assert.equal(afterPositionAccounting.quantity, 100);
  assert.equal(afterPositionAccounting.reservedSellQuantity, 100, 'only the filled first sell order is released; second open sell remains reserved');
  assert.equal(afterReservationAdjust.releasedQuantity, 100, 'the filled order reservation is consumed/released for order state');

  const buggyDoubleDecrement = Math.max(afterPositionAccounting.reservedSellQuantity - starting.fillQuantity, 0);
  assert.equal(buggyDoubleDecrement, 0, 'old post-fill position decrement would mask an outstanding second sell order');
  assert.notEqual(afterPositionAccounting.reservedSellQuantity, buggyDoubleDecrement);
});

test('M8 live test covers cash-out sell path that exposed the reserved-sell blocker', () => {
  has(/m8-tea-cashout-sell/i, liveTest);
  has(/cashOutSell\.status, 'filled'/i, liveTest);
  has(/seller cash-out credited 50 whole coins/i, liveTest);
  has(/production gate stays false|assertProductionGateFalse/i, liveTest);
});

test('source of truth records 0062 applied and M8 blocked on 0063 settlement enum-cast apply', () => {
  has(/Exchange v2 M8 — blocked: human apply 0063/i, backlog);
  has(/0063_exchange_v2_m8_settlement_state_enum_cast\.sql/i, backlog);
  has(/DB is currently at `0062`/i, status);
  has(/M8 live development test rerun after `0061`\/`0062` reached settlement/i, status);
  has(/recreates only `resolve_market_v2`/i, status);
});
