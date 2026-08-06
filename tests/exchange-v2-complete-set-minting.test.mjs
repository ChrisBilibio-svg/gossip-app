import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0059_exchange_v2_complete_set_minting.sql', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const status = readFileSync(new URL('../PROJECT_STATUS.md', import.meta.url), 'utf8');
const loop = readFileSync(new URL('../docs/hermes-exchange-v2-loop.md', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0059 implements approved Option A complete-set minting and leaves production gates untouched', () => {
  has(/Option A is approved: complete-set minting is the genesis-liquidity path/i);
  has(/create or replace function exchange_insert_complete_set_mint_v2/i);
  has(/create or replace function exchange_match_complete_set_orders_v2/i);
  has(/opposing VERDADE\/MENTIRA buy orders may cross/i);
  has(/coinsClosedLoop/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
  not(/update\s+exchange_feature_gates/i);
});

test('0059 prices opposing buyers as complementary prices totaling one whole coin', () => {
  has(/create or replace function exchange_complete_set_taker_price_v2\(p_maker_price numeric\)/i);
  has(/select round\(1\.00000000 - coalesce\(p_maker_price, 0\), 8\)/i);
  has(/exchange_assert_complete_set_prices_v2/i);
  has(/v_taker_price < 0 or v_taker_price > p_taker_limit_price/i);
  has(/exchange_coin_notional_v2\(p_quantity, p_maker_price\) \+ exchange_coin_notional_v2\(p_quantity, v_taker_price\) <> p_quantity/i);
  has(/perform exchange_assert_whole_coin_amount_v2\(v_total_collateral, 'complete_set_total_collateral'\)/i);
});

test('0059 mints one share on each side without treating social or real money as settlement value', () => {
  has(/exchange_apply_mint_position_v2\(p_market\.market_id, p_maker_order\.outcome, p_maker_order\.user_id, p_quantity, v_maker_price, v_maker_fill\.id\)/i);
  has(/exchange_apply_mint_position_v2\(p_market\.market_id, p_taker_order\.outcome, p_taker_order\.user_id, p_quantity, v_taker_price, v_taker_fill\.id\)/i);
  has(/'credit_share'/i);
  has(/exchange_share_currency\(p_maker_order\.outcome\)/i);
  has(/exchange_share_currency\(p_taker_order\.outcome\)/i);
  has(/settlementInvariant', 'exactly_one_side_pays_1_coin'/i);
  has(/Coins remain closed-loop entertainment units with no cash value/i);
  not(/update\s+coin_wallets\s+set/i);
});

test('0059 consumes buy reservations with whole-coin lot constraints and releases excess idempotently', () => {
  has(/perform exchange_assert_whole_coin_order_v2\(p_market, 'buy', p_quantity, p_maker_price\)/i);
  has(/perform exchange_assert_whole_coin_order_v2\(p_market, 'buy', p_quantity, v_taker_price\)/i);
  has(/perform exchange_adjust_order_reservation_after_fill_v2\(p_maker_order\.id, p_quantity, v_maker_price, p_market\.fee_bps, v_event_id, 'complete_set_mint'\)/i);
  has(/perform exchange_adjust_order_reservation_after_fill_v2\(p_taker_order\.id, p_quantity, v_taker_price, p_market\.fee_bps, v_event_id, 'complete_set_mint'\)/i);
  has(/on conflict \(idempotency_key\) do nothing/i);
  has(/wholeCoinLotSize', p_market\.whole_coin_lot_size/i);
});

test('0059 integrates minting into fillability, self-cross detection, and the matching engine after same-outcome fills', () => {
  const availableIdx = migration.indexOf('create or replace function exchange_available_crossing_quantity_v2');
  const selfCrossIdx = migration.indexOf('create or replace function exchange_self_cross_exists_v2');
  const matchIdx = migration.indexOf('create or replace function exchange_match_order_v2');
  assert.ok(availableIdx >= 0, 'available crossing quantity function must be replaced');
  assert.ok(selfCrossIdx > availableIdx, 'self-cross detection must follow available quantity helper');
  assert.ok(matchIdx > selfCrossIdx, 'matching engine replacement must follow helper replacements');
  has(/exchange_available_minting_quantity_v2\(p_market_id, p_outcome, p_action, p_limit_price, p_taker_user_id\)/i);
  has(/and o\.outcome = exchange_opposite_outcome_v2\(p_outcome\)/i);
  has(/exchange_complete_set_taker_price_v2\(o\.limit_price\) <= p_limit_price/i);
  has(/v_mint_result := exchange_match_complete_set_orders_v2\(v_taker\.id\)/i);
});

test('0059 grants only internal execution for complete-set helpers and docs track applied state', () => {
  has(/revoke all on function exchange_insert_complete_set_mint_v2\(exchange_markets, exchange_orders, exchange_orders, numeric\) from public, anon, authenticated/i);
  has(/revoke all on function exchange_match_complete_set_orders_v2\(uuid\) from public, anon, authenticated/i);
  assert.match(backlog, /Exchange v2 M-mint — applied/i);
  assert.match(status, /0059` exchange v2 complete-set minting/i);
  assert.match(loop, /0059_exchange_v2_complete_set_minting` is code-ready|0059.*applied/i);
});
