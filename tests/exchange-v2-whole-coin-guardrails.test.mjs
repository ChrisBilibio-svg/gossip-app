import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0058_exchange_v2_whole_coin_guardrails.sql', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const adr = readFileSync(new URL('../docs/exchange-v2-adr.md', import.meta.url), 'utf8');
const status = readFileSync(new URL('../PROJECT_STATUS.md', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0058 records Option 1 whole-coin lots and never enables production trading', () => {
  has(/Option 1 is locked: keep integer coin_wallets\.balance and enforce whole-coin/i);
  has(/Coins remain closed-loop entertainment units with no cash value/i);
  has(/alter table exchange_markets\s+add column if not exists whole_coin_lot_size numeric\(24,6\)/i);
  has(/exchange_default_whole_coin_lot_size_v2\(tick_size\)/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
  not(/update\s+exchange_feature_gates/i);
});

test('0058 makes lot size configurable and derived from tick size for whole coin settlement', () => {
  has(/create or replace function exchange_default_whole_coin_lot_size_v2\(p_tick_size numeric\)/i);
  has(/v_ticks_per_coin := ceil\(1 \/ v_tick\)::bigint/i);
  has(/return exchange_lcm_bigint_v2\(v_ticks_per_coin, 2\)::numeric/i);
  has(/exchange_markets_whole_coin_lot_size_check/i);
  has(/whole_coin_lot_size = trunc\(whole_coin_lot_size\)/i);
  has(/mod\(round\(whole_coin_lot_size, 6\), quantity_step\) = 0/i);
});

test('0058 rejects every fractional v2 COIN movement before wallet bridge drift', () => {
  has(/exchange_wallet_ledger_coin_whole_amount_check/i);
  has(/currency <> 'COIN' or amount = trunc\(amount\)/i);
  has(/create or replace function exchange_assert_whole_coin_amount_v2/i);
  has(/exchange whole-coin violation/i);
  has(/create or replace function exchange_assert_whole_coin_notional_v2/i);
  has(/return exchange_assert_whole_coin_amount_v2\(v_required, 'required_coin_reservation'\)/i);
});

test('0058 quote and place order both reject non-lot or fractional-notional orders', () => {
  const quoteIdx = migration.indexOf('create or replace function quote_order_v2');
  const placeIdx = migration.indexOf('create or replace function place_order_v2');
  const riskIdx = migration.indexOf('v_risk_result := exchange_check_order_risk_limits_v2');
  const reserveIdx = migration.indexOf('v_reservation := exchange_reserve_order_collateral_v2');
  assert.ok(quoteIdx >= 0, 'quote_order_v2 must be replaced');
  assert.ok(placeIdx > quoteIdx, 'place_order_v2 replacement must follow quote replacement');
  assert.ok(riskIdx > placeIdx, 'risk check must remain in place_order_v2');
  assert.ok(reserveIdx > riskIdx, 'risk still runs before reservation');
  has(/perform exchange_assert_whole_coin_order_v2\(v_market, p_action, p_quantity, p_limit_price\)/i);
  has(/perform exchange_required_coin_reservation\(p_quantity, p_limit_price, v_market\.fee_bps\)/i);
  has(/'wholeCoinLotSize', v_market\.whole_coin_lot_size/i);
});

test('0058 preserves old place_order_v2 arity with a compatibility wrapper', () => {
  has(/create or replace function place_order_v2\(\s*p_market_id uuid,\s*p_outcome exchange_outcome,\s*p_action exchange_order_action,\s*p_quantity numeric,\s*p_limit_price numeric,\s*p_time_in_force exchange_time_in_force,\s*p_client_order_id text,\s*p_quote_id uuid,\s*p_environment text default 'production'\s*\)/i);
  has(/select place_order_v2\(p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_time_in_force, p_client_order_id, p_quote_id, p_environment, null::timestamptz\)/i);
});

test('ADR and roadmap lock Option 1 whole-coin model with 0058 applied', () => {
  assert.match(adr, /Whole-coin wallet decision — Option 1 locked/i);
  assert.match(adr, /Chris locked \*\*Option 1/i);
  assert.match(adr, /whole_coin_lot_size/i);
  assert.match(backlog, /Exchange v2 M-whole-coin — applied/i);
  assert.match(backlog, /Exchange v2 M-mint — applied/i);
  assert.match(status, /DB is currently at `0062`/i);
});
