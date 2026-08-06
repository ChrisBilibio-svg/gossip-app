import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0055_exchange_v2_settlement_payout.sql', import.meta.url), 'utf8');
const adr = readFileSync(new URL('../docs/exchange-v2-adr.md', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0055 extends resolve_market_v2 as service-only idempotent settlement payout path', () => {
  has(/create or replace function resolve_market_v2\(\s*p_market_id uuid,\s*p_outcome exchange_settlement_outcome,\s*p_reference text,\s*p_idempotency_key text\s*\)/i);
  has(/select \* into v_existing[\s\S]+from exchange_settlements[\s\S]+where market_id = p_market_id[\s\S]+for update/i);
  has(/if found then[\s\S]+'idempotent', true[\s\S]+'positionsSettled', 0[\s\S]+end if/i);
  has(/insert into exchange_settlements \([\s\S]+idempotency_key[\s\S]+\) values/i);
  has(/revoke all on function resolve_market_v2\(uuid, exchange_settlement_outcome, text, text\) from public, anon, authenticated/i);
  has(/grant execute on function resolve_market_v2\(uuid, exchange_settlement_outcome, text, text\) to service_role/i);
  not(/update\s+coin_wallets/i);
  not(/insert into wallet_transactions/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
});

test('0055 pays winners 1 coin per remaining winning share and zeroes losers', () => {
  has(/exchange_settlement_value_for_outcome_v2\([\s\S]+when p_settlement_outcome::text = p_position_outcome::text then 1\.00000000::numeric[\s\S]+else 0\.00000000::numeric/i);
  has(/v_payout := round\(v_position\.quantity \* v_settlement_value, 6\)/i);
  has(/'entry_type',[\s\S]*'settlement'|entry_type,\s*amount,\s*currency,[\s\S]+\) values \([\s\S]+\s+'settlement',\s+v_payout,\s+'COIN'/i);
  has(/'settlementValuePerShare', v_settlement_value[\s\S]+'settledQuantity', v_position\.quantity[\s\S]+'payoutCoins', v_payout/i);
  has(/set settlement_id = p_settlement\.id,[\s\S]+settled_quantity = v_position\.quantity,[\s\S]+settlement_payout = v_payout,[\s\S]+quantity = 0,[\s\S]+cost_basis = 0,[\s\S]+average_entry_price = 0/i);
  has(/'winningShares', v_winning_shares[\s\S]+'losingShares', v_losing_shares/i);
});

test('0055 VOID pays 0.5 per TRUE and FALSE share', () => {
  has(/when p_settlement_outcome = 'void' then 0\.50000000::numeric/i);
  has(/v_true_value numeric := case when p_outcome = 'true' then 1\.00000000 when p_outcome = 'void' then 0\.50000000 else 0\.00000000 end/i);
  has(/v_false_value numeric := case when p_outcome = 'false' then 1\.00000000 when p_outcome = 'void' then 0\.50000000 else 0\.00000000 end/i);
  has(/if p_settlement\.outcome = 'void' then[\s\S]+v_void_shares := round\(v_void_shares \+ v_position\.quantity, 6\)/i);
});

test('0055 releases remaining reservations and cancels open orders during settlement', () => {
  has(/create or replace function exchange_release_market_reservations_for_settlement_v2\(/i);
  has(/where market_id = p_market_id[\s\S]+and status in \('open','partially_filled'\)[\s\S]+for update/i);
  has(/perform exchange_release_order_reservation_v2\(v_order\.id, 'settlement'\)/i);
  has(/set status = 'cancelled',[\s\S]+cancelled_quantity = cancelled_quantity \+ remaining_quantity,[\s\S]+remaining_quantity = 0/i);
  has(/update exchange_reservations r[\s\S]+status = 'released',[\s\S]+r\.status = 'active'/i);
  has(/v_release_result := exchange_release_market_reservations_for_settlement_v2\(p_market_id, v_settlement\.id\)/i);
});

test('0055 tracks settled positions without breaking legacy engine or production gates', () => {
  has(/alter table exchange_positions[\s\S]+add column if not exists settlement_id uuid references exchange_settlements \(id\)[\s\S]+add column if not exists settled_at timestamptz[\s\S]+add column if not exists settled_quantity numeric\(24,6\)[\s\S]+add column if not exists settlement_payout numeric\(24,6\)/i);
  has(/where market_id = p_market_id[\s\S]+and settlement_id is null/i);
  has(/'legacyWalletTouched', false/i);
  has(/'coinsClosedLoop', true/i);
  has(/settlementId: string \| null;[\s\S]+settledAt: string \| null;[\s\S]+settledQuantity: number;[\s\S]+settlementPayout: number;/, client);
  has(/settlementId: r\.settlementId == null && r\.settlement_id == null \? null : String\(r\.settlementId \?\? r\.settlement_id\)/, client);
});

test('ADR records approved complete-set minting as the pre-M8 share creation path', () => {
  assert.match(adr, /Share creation bootstrap — Option A approved/i);
  assert.match(adr, /DECISION LOCKED/i);
  assert.match(adr, /Option A — minting \/ complete-set creation \(approved direction\)/i);
  assert.match(adr, /M-mint/i);
  assert.match(adr, /market-maker share seeding/i);
  assert.match(adr, /not the bootstrap direction/i);
});
