import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration0060 = readFileSync('supabase/migrations/0060_exchange_v2_m8_enum_cast_hardening.sql', 'utf8');
const migration0063 = readFileSync('supabase/migrations/0063_exchange_v2_m8_settlement_state_enum_cast.sql', 'utf8');
const m8LiveTest = readFileSync('tests/exchange-v2-m8-live.test.mjs', 'utf8');
const backlog = readFileSync('BACKLOG.md', 'utf8');
const projectStatus = readFileSync('PROJECT_STATUS.md', 'utf8');

test('0060 hardens M8 order status enum casts without enabling production trading', () => {
  assert.match(migration0060, /0060_exchange_v2_m8_enum_cast_hardening/i);
  assert.match(migration0060, /'open'::exchange_order_status/);
  assert.match(migration0060, /'rejected'::exchange_order_status/);
  assert.match(migration0060, /'filled'::exchange_order_status/);
  assert.match(migration0060, /'partially_filled'::exchange_order_status/);
  assert.match(migration0060, /'cancelled'::exchange_order_status/);
  assert.match(migration0060, /create or replace function place_order_v2/);
  assert.match(migration0060, /create or replace function exchange_match_complete_set_orders_v2/);
  assert.match(migration0060, /create or replace function exchange_match_order_v2/);
  assert.doesNotMatch(migration0060, /update\s+exchange_feature_gates\s+set[\s\S]*environment\s*=\s*'production'/i);
  assert.doesNotMatch(migration0060, /production_approved\s*=\s*true/i);
});

test('M8 live test is env-gated, development-only, and asserts whole-coin conservation', () => {
  assert.match(m8LiveTest, /RUN_EXCHANGE_V2_M8_LIVE === 'true'/);
  assert.match(m8LiveTest, /p_environment: 'development'/);
  assert.match(m8LiveTest, /assertProductionGateFalse\(service, 'before M8 setup'\)/);
  assert.match(m8LiveTest, /assertProductionGateFalse\(service, 'after all M8 lifecycle assertions'\)/);
  assert.match(m8LiveTest, /promote_rumor_to_exchange_market_v2/);
  assert.match(m8LiveTest, /exchange_complete_set_minted/);
  assert.match(m8LiveTest, /same-outcome cash-out sell/);
  assert.match(m8LiveTest, /p_outcome: 'true'/);
  assert.match(m8LiveTest, /p_outcome: 'void'/);
  assert.match(m8LiveTest, /conserves total whole coins/);
  assert.match(m8LiveTest, /source_reference', 'exchange_v2:%'/);
  assert.doesNotMatch(m8LiveTest, /environment'\)\s*\.eq\('environment', 'production'\)[\s\S]*\.update\(/i);
});

test('0063 hardens M8 settlement state enum casts without enabling production trading', () => {
  assert.match(migration0063, /fix settlement market-state enum casts/i);
  assert.match(migration0063, /create or replace function resolve_market_v2/);
  assert.match(migration0063, /'voided'::exchange_market_state/);
  assert.match(migration0063, /'resolved'::exchange_market_state/);
  assert.match(migration0063, /grant execute on function resolve_market_v2\(uuid, exchange_settlement_outcome, text, text\) to service_role/);
  assert.doesNotMatch(migration0063, /update\s+exchange_feature_gates\s+set[\s\S]*environment\s*=\s*'production'/i);
  assert.doesNotMatch(migration0063, /production_approved\s*=\s*true/i);
});

test('project docs record DB at 0062 and M8 blocked on 0063 apply', () => {
  assert.match(projectStatus, /DB is currently at `0062`/i);
  assert.match(projectStatus, /`0063_exchange_v2_m8_settlement_state_enum_cast\.sql`/);
  assert.match(projectStatus, /live test reached settlement/i);
  assert.match(backlog, /Exchange v2 M8 — blocked: human apply 0063/i);
  assert.match(backlog, /recreates only `resolve_market_v2`/i);
});
