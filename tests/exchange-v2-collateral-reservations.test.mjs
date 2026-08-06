import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0052_exchange_v2_collateral_reservations.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0052 reserves buy collateral against available real coin balance without touching legacy wallet flows', () => {
  has(/create or replace function exchange_coin_wallet_balance\(p_user_id uuid\)/i);
  has(/from coin_wallets cw where cw\.user_id = p_user_id/i);
  has(/exchange_active_coin_reserved\(p_user_id uuid\)/i);
  has(/exchange_available_coin_balance\(p_user_id uuid\)/i);
  has(/exchange_required_coin_reservation[\s\S]+p_quantity \* p_limit_price[\s\S]+p_fee_bps/i);
  has(/insert into exchange_reservations[\s\S]+kind[\s\S]+values[\s\S]+'coin'/i);
  has(/'reserve_coin'[\s\S]+'COIN'/i);
  has(/insufficient coin balance for exchange reservation/i);
  has(/legacyWalletTouched', false/i);
  not(/apply_wallet_transaction\(/i);
  not(/update\s+coin_wallets/i);
  not(/insert into wallet_transactions/i);
});

test('0052 reserves reduce-only sell shares and enforces no oversell', () => {
  has(/v_order\.action = 'buy'[\s\S]+else[\s\S]+from exchange_positions/i);
  has(/quantity - v_position\.reserved_sell_quantity\) < v_order\.remaining_quantity/i);
  has(/insufficient shares for reduce-only sell/i);
  has(/reserved_sell_quantity = reserved_sell_quantity \+ v_order\.remaining_quantity/i);
  has(/insert into exchange_reservations[\s\S]+values[\s\S]+v_order\.user_id[\s\S]+v_order\.market_id[\s\S]+v_order\.outcome[\s\S]+'share'/i);
  has(/'reserve_share'[\s\S]+exchange_share_currency\(v_order\.outcome\)/i);
  has(/reduceOnly', true/i);
});

test('0052 place_order_v2 is idempotent and attaches exactly one reservation', () => {
  has(/create or replace function place_order_v2\(/i);
  has(/where user_id = v_user[\s\S]+and client_order_id = p_client_order_id[\s\S]+for update/i);
  has(/client_order_id already used with different order parameters/i);
  has(/return exchange_order_response_v2\(v_order\)/i);
  has(/v_reservation := exchange_reserve_order_collateral_v2\(v_order\.id\)/i);
  has(/update exchange_orders[\s\S]+set reservation_id = v_reservation\.id/i);
  has(/unique \(user_id, client_order_id\)/, readFileSync(new URL('../supabase/migrations/0050_exchange_v2_foundation.sql', import.meta.url), 'utf8'));
});

test('0052 releases reservations on cancel expire and reject', () => {
  has(/create or replace function exchange_release_order_reservation_v2\(/i);
  has(/set released_quantity = quantity,[\s\S]+status = 'released'/i);
  has(/'release_coin'/i);
  has(/'release_share'/i);
  has(/reserved_sell_quantity = greatest\(reserved_sell_quantity - v_release_amount, 0\)/i);
  has(/create or replace function cancel_order_v1\(p_order_id uuid\)[\s\S]+exchange_release_order_reservation_v2\(p_order_id, 'cancelled'\)/i);
  has(/create or replace function expire_order_v1\(p_order_id uuid\)[\s\S]+exchange_release_order_reservation_v2\(p_order_id, 'expired'\)/i);
  has(/create or replace function exchange_reject_order_v2\(p_order_id uuid, p_reason text\)[\s\S]+exchange_release_order_reservation_v2\(p_order_id, coalesce\(p_reason, 'rejected'\)\)/i);
});

test('0052 keeps production trading disabled and preserves legacy fixed-odds separation', () => {
  not(/insert\s+into\s+exchange_feature_gates/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
  not(/place_fixed_prediction/i);
  not(/fixed_prediction_positions[\s\S]+update/i);
});

test('exchangeV2 client exposes reservation-aware contracts', () => {
  has(/export type ExchangeReservationKind = 'coin' \| 'share'/, client);
  has(/reservedCollateral\?: number/, client);
  has(/reservationId\?: string \| null/, client);
  has(/reservationKind\?: ExchangeReservationKind \| null/, client);
  has(/reservedCollateral: Number\(r\.reservedCollateral \?\? r\.reserved_collateral \?\? 0\)/, client);
  has(/export async function expireOrderV1/, client);
  has(/supabase\.rpc\('expire_order_v1'/, client);
  has(/releasedCollateral: Number\(r\.releasedCollateral \?\? r\.released_collateral \?\? 0\)/, client);
});
