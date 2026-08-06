import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0044_coin_trading_quotes.sql', import.meta.url), 'utf8');
const baseMigration = readFileSync(new URL('../supabase/migrations/0043_coin_economy_fixed_odds.sql', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

test('0044 creates server-generated fixed prediction quotes with ids and expiry', () => {
  has(/create table if not exists fixed_prediction_quotes/i);
  has(/quote_id uuid/i);
  has(/expires_at timestamptz not null/i);
  has(/create or replace function request_fixed_prediction_quote\(p_rumor_id uuid, p_choice bet_choice\)/i);
  has(/now\(\) \+ interval '45 seconds'/i);
  has(/grant execute on function request_fixed_prediction_quote/i);
});

test('placement requires fresh quote and rejects expired, changed, duplicate, invalid, or underfunded trades', () => {
  has(/p_quote_id uuid default null/i);
  has(/fresh quote required/i);
  has(/quote expired/i);
  has(/quote changed; request a new quote/i);
  has(/quote already used/i);
  has(/stake must be a positive whole number/i);
  has(/insufficient coin balance/i);
  has(/stake exceeds hard maximum/i);
  has(/position already exists/i);
});

test('placement saves locked probability and odds, deducts stake, creates ledger atomically with idempotency', () => {
  has(/placement_idempotency_key = p_idempotency_key and user_id = v_user/i);
  has(/locked_probability[\s\S]*locked_decimal_odds[\s\S]*potential_total_return_coins/i);
  has(/floor\(p_stake_coins \* v_quote\.decimal_odds\)/i);
  has(/apply_wallet_transaction\([\s\S]*'PREDICTION_STAKE'[\s\S]*-p_stake_coins/i);
  has(/update fixed_prediction_quotes set used_at = now\(\) where id = v_quote\.id/i);
});

test('positions API exposes locked odds and actual coin returns without real-money wording', () => {
  has(/create or replace function get_my_fixed_positions/i);
  has(/locked_decimal_odds/i);
  has(/potential_total_return_coins/i);
  has(/actual_return_coins/i);
  has(/market_status/i);
  has(/Coins remain closed-loop entertainment currency with no cash value/i);
});

test('0043 settlement uses locked odds and returns stake on void', () => {
  has(/floor\(v_position\.stake_coins \* v_position\.locked_decimal_odds\)/i, baseMigration);
  has(/PREDICTION_WIN_RETURN/i, baseMigration);
  has(/PREDICTION_VOID_REFUND/i, baseMigration);
  has(/v_position\.stake_coins/i, baseMigration);
});
