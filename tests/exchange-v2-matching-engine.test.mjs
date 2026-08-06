import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0053_exchange_v2_matching_engine.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0053 hardens 0052 internal reservation helpers from authenticated direct calls', () => {
  has(/revoke all on function exchange_reserve_order_collateral_v2\(uuid\) from public, anon, authenticated/i);
  has(/revoke all on function exchange_release_order_reservation_v2\(uuid, text\) from public, anon, authenticated/i);
  has(/revoke all on function exchange_reject_order_v2\(uuid, text\) from public, anon, authenticated/i);
  has(/create or replace function exchange_release_order_reservation_v2\([\s\S]+if auth\.uid\(\) is not null and v_order\.user_id <> auth\.uid\(\)[\s\S]+order ownership check failed/i);
  has(/create or replace function exchange_reject_order_v2\(p_order_id uuid, p_reason text\)[\s\S]+if auth\.uid\(\) is not null and v_order\.user_id <> auth\.uid\(\)/i);
  has(/revoke all on function exchange_match_order_v2\(uuid\) from public, anon, authenticated/i);
  has(/grant execute on function place_order_v2[\s\S]+to authenticated/i);
});

test('0053 implements CLOB price-time priority matching inside place_order_v2', () => {
  has(/create or replace function exchange_match_order_v2\(p_taker_order_id uuid\)/i);
  has(/if v_taker\.action = 'buy'[\s\S]+order by o\.limit_price asc, o\.created_at asc, o\.id asc/i);
  has(/else[\s\S]+order by o\.limit_price desc, o\.created_at asc, o\.id asc/i);
  has(/v_fill_qty := least\(v_taker\.remaining_quantity, v_maker\.remaining_quantity\)/i);
  has(/v_fill_price := v_maker\.limit_price/i);
  has(/v_match := exchange_match_order_v2\(v_order\.id\)/i);
  has(/update exchange_orders[\s\S]+filled_quantity = filled_quantity \+ v_fill_qty[\s\S]+remaining_quantity = remaining_quantity - v_fill_qty[\s\S]+status = case when remaining_quantity - v_fill_qty = 0 then 'filled' else 'partially_filled' end/i);
});

test('0053 writes immutable fills and fill ledger entries while consuming or adjusting reservations', () => {
  has(/insert into exchange_fills[\s\S]+maker_order_id[\s\S]+taker_order_id[\s\S]+maker_user_id[\s\S]+taker_user_id[\s\S]+quantity[\s\S]+price/i);
  has(/create or replace function exchange_adjust_order_reservation_after_fill_v2\(/i);
  has(/'spend_coin'[\s\S]+'COIN'/i);
  has(/'credit_coin'[\s\S]+round\(p_quantity \* p_price/i);
  has(/'credit_share'[\s\S]+exchange_share_currency\(p_taker_order\.outcome\)/i);
  has(/'debit_share'[\s\S]+exchange_share_currency\(v_reservation\.outcome\)/i);
  has(/status = case when v_order\.remaining_quantity = 0 then 'consumed' else 'active' end/i);
  has(/'release_coin'[\s\S]+'fill_excess'/i);
});

test('0053 handles IOC FOK GTD and rejects self trades', () => {
  has(/create or replace function exchange_available_crossing_quantity_v2\(/i);
  has(/create or replace function exchange_self_cross_exists_v2\(/i);
  has(/if exchange_self_cross_exists_v2\(p_market_id, p_outcome, p_action, p_limit_price, v_user\) then/i);
  has(/'self-trade rejected'/i);
  has(/p_time_in_force = 'FOK' and v_fillable < p_quantity/i);
  has(/'FOK cannot fully fill'/i);
  has(/if p_time_in_force in \('IOC','FOK'\) and v_order\.remaining_quantity > 0 then/i);
  has(/case when p_time_in_force = 'GTD' then v_quote\.expires_at else null end/i);
});

test('0053 follows exchange v2 guardrails and ADR lock ordering', () => {
  has(/pg_advisory_xact_lock\(exchange_market_lock_key\(p_market_id, p_outcome\)\)[\s\S]+select \* into v_market from exchange_markets where market_id = p_market_id for update[\s\S]+v_reservation := exchange_reserve_order_collateral_v2\(v_order\.id\)[\s\S]+v_match := exchange_match_order_v2\(v_order\.id\)/i);
  has(/exchange_gate_allows\(p_environment, p_action\)/i);
  not(/insert\s+into\s+exchange_feature_gates/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
  not(/place_fixed_prediction/i);
  not(/update\s+coin_wallets/i);
  not(/insert into wallet_transactions/i);
});

test('exchangeV2 client maps matching receipt fields', () => {
  has(/actualAverageFillPrice\?: number \| null/, client);
  has(/releasedCollateral\?: number/, client);
  has(/actualAverageFillPrice: num\(r\.actualAverageFillPrice \?\? r\.actual_average_fill_price\)/, client);
  has(/releasedCollateral: Number\(r\.releasedCollateral \?\? r\.released_collateral \?\? 0\)/, client);
});
