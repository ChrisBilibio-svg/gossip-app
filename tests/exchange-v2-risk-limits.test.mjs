import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0057_exchange_v2_risk_limits.sql', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const adr = readFileSync(new URL('../docs/exchange-v2-adr.md', import.meta.url), 'utf8');
const loopDoc = readFileSync(new URL('../docs/hermes-exchange-v2-loop.md', import.meta.url), 'utf8');
const exchangeLib = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0057 creates configurable risk limits and append-only risk events', () => {
  has(/create table if not exists exchange_risk_limits/i);
  has(/max_open_orders_per_user_global integer not null default 100/i);
  has(/max_open_orders_per_user_market integer not null default 20/i);
  has(/max_position_quantity_per_market_outcome numeric\(24,6\) not null default 1000\.000000/i);
  has(/max_gross_notional_per_user_market numeric\(24,6\) not null default 1000\.000000/i);
  has(/max_order_notional numeric\(24,6\) not null default 100\.000000/i);
  has(/order_rate_limit_count integer not null default 30/i);
  has(/create table if not exists exchange_risk_events/i);
  has(/'rate_limit_exceeded'/i);
  has(/'position_limit_exceeded'/i);
  has(/'exposure_limit_exceeded'/i);
});

test('0057 upgrades the existing 0050 exchange_risk_events table before the insert path uses new columns', () => {
  const createIndex = migration.indexOf('create table if not exists exchange_risk_events');
  const alterIndex = migration.indexOf('alter table exchange_risk_events');
  const loggerIndex = migration.indexOf('create or replace function exchange_log_risk_event_v2');
  assert.ok(createIndex >= 0, 'migration must create/fresh-define exchange_risk_events');
  assert.ok(alterIndex > createIndex, 'migration must alter existing 0050 exchange_risk_events after create-if-not-exists');
  assert.ok(loggerIndex > alterIndex, 'schema drift repair must run before exchange_log_risk_event_v2 insert path');
  has(/alter table exchange_risk_events\s+add column if not exists outcome exchange_outcome,\s+add column if not exists order_id uuid references exchange_orders \(id\) on delete set null,\s+add column if not exists decision text,\s+add column if not exists reason text;/i);
  has(/exchange_risk_events_m7_event_type_check check \(event_type in \([\s\S]+order_allowed[\s\S]+market_resumed[\s\S]+\)\) not valid/i);
  has(/exchange_risk_events_m7_decision_check check \(decision is null or decision in \('allowed', 'blocked', 'paused', 'resumed'\)\) not valid/i);
  has(/insert into exchange_risk_events \([\s\S]+outcome,[\s\S]+order_id,[\s\S]+decision,[\s\S]+reason,[\s\S]+metadata/i);
});

test('0057 enforces per-user order, exposure, position, and rate limits in place_order_v2 before reserving collateral', () => {
  has(/create or replace function exchange_check_order_risk_limits_v2/i);
  has(/exchange_user_open_order_count_v2\(p_user_id, null\)/i);
  has(/exchange_recent_order_count_v2\(p_user_id, v_limits\.order_rate_limit_window_seconds\)/i);
  has(/if v_order_notional > v_limits\.max_order_notional then/i);
  has(/v_projected_position := round\(v_position_quantity \+ v_pending_buy_quantity \+ p_quantity, 6\)/i);
  has(/v_projected_gross_notional := round\(exchange_user_market_gross_notional_v2\(p_user_id, p_market_id\) \+ v_order_notional, 6\)/i);
  has(/v_risk_result := exchange_check_order_risk_limits_v2\(v_user, p_market_id, p_outcome, p_action, p_quantity, p_limit_price, p_environment\)/i);
  has(/if not coalesce\(\(v_risk_result->>'allowed'\)::boolean, false\) then[\s\S]+exchange_reject_order_for_risk_v2/i);
  assert.ok(migration.indexOf('exchange_check_order_risk_limits_v2') < migration.indexOf('v_reservation := exchange_reserve_order_collateral_v2'), 'risk check must occur before collateral reservation');
});

test('0057 persists blocked and allowed risk decisions without touching legacy fixed-odds', () => {
  has(/create or replace function exchange_log_risk_event_v2/i);
  has(/create or replace function exchange_reject_order_for_risk_v2/i);
  has(/'rejected', p_client_order_id, p_quote_id/i);
  has(/perform exchange_log_risk_event_v2\([\s\S]+v_order\.id,[\s\S]+v_event_type,[\s\S]+'block',[\s\S]+'blocked'/i);
  has(/perform exchange_log_risk_event_v2\([\s\S]+coalesce\(v_risk_result->>'eventType', 'order_allowed'\),[\s\S]+'info',[\s\S]+'allowed'/i);
  has(/'legacyFixedOddsTouched', false/i);
  has(/'coinsClosedLoop', true/i);
  not(/update\s+fixed_prediction_positions/i);
  not(/update\s+prediction_outcomes/i);
});

test('0057 adds curator/service-gated market pause and resume controls', () => {
  has(/create table if not exists exchange_market_controls/i);
  has(/create or replace function pause_exchange_market_v2\(\s*p_market_id uuid,\s*p_reason text\s*\)/i);
  has(/create or replace function resume_exchange_market_v2\(\s*p_market_id uuid,\s*p_reason text\s*\)/i);
  has(/perform exchange_require_curator_or_service\(\)/i);
  has(/set state = 'paused'/i);
  has(/set state = 'open'/i);
  has(/if exists \(select 1 from exchange_market_controls c where c\.market_id = p_market_id and c\.paused\) then[\s\S]+raise exception 'market is paused'/i);
  has(/'market_paused'/i);
  has(/'market_resumed'/i);
});

test('0057 keeps production trading disabled and grants no unsafe public functions', () => {
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
  has(/revoke all on function pause_exchange_market_v2\(uuid, text\) from public, anon, authenticated/i);
  has(/revoke all on function resume_exchange_market_v2\(uuid, text\) from public, anon, authenticated/i);
  has(/grant execute on function pause_exchange_market_v2\(uuid, text\) to authenticated, service_role/i);
  has(/grant execute on function resume_exchange_market_v2\(uuid, text\) to authenticated, service_role/i);
  has(/revoke all on function exchange_check_order_risk_limits_v2/i);
});

test('roadmap and ADR record applied whole-coin/minting plus M8 0061/0062 blocker', () => {
  assert.match(backlog, /Exchange v2 M6 — applied/i);
  assert.match(backlog, /Exchange v2 M7 — applied/i);
  assert.match(backlog, /Exchange v2 M-whole-coin — applied/i);
  assert.match(backlog, /Exchange v2 M-mint — applied/i);
  assert.match(adr, /Whole-coin wallet decision — Option 1 locked/i);
  assert.match(adr, /whole-coin lots/i);
  assert.match(adr, /M-mint must land before M8/i);
  assert.match(loopDoc, /DB is at `0059`|0059.*applied/i);
});

test('src/lib exposes M7 pause/resume and risk event contracts without UI lane edits', () => {
  assert.match(exchangeLib, /export interface ExchangeMarketControlInput/i);
  assert.match(exchangeLib, /export type ExchangeRiskEventType/i);
  assert.match(exchangeLib, /export async function pauseExchangeMarketV2/i);
  assert.match(exchangeLib, /export async function resumeExchangeMarketV2/i);
  assert.match(exchangeLib, /pause_exchange_market_v2/i);
  assert.match(exchangeLib, /resume_exchange_market_v2/i);
});
