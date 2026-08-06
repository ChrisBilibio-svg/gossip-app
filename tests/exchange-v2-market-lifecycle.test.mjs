import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0051_exchange_v2_market_lifecycle.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0051 drafts curator/service-gated market lifecycle RPCs', () => {
  has(/create or replace function exchange_require_curator_or_service\(\)/i);
  has(/exchange_current_request_role\(\) = 'service_role'/i);
  has(/not is_curator\(\)/i);
  has(/create or replace function promote_rumor_to_exchange_market_v2\(/i);
  has(/create or replace function open_exchange_market_v2\(p_market_id uuid\)/i);
  has(/create or replace function close_exchange_market_v2\(p_market_id uuid\)/i);
  has(/grant execute on function promote_rumor_to_exchange_market_v2/i);
  has(/grant execute on function open_exchange_market_v2/i);
  has(/grant execute on function close_exchange_market_v2/i);
  has(/revoke all on function promote_rumor_to_exchange_market_v2[\s\S]+from public, anon/i);
});

test('0051 promotes only explicit exchange_v2 markets and preserves legacy separation', () => {
  has(/insert into exchange_markets[\s\S]+engine_version[\s\S]+state[\s\S]+values[\s\S]+'exchange_v2'[\s\S]+'draft'/i);
  has(/update rumors[\s\S]+set engine_version = 'exchange_v2'/i);
  has(/v_rumor\.engine_version <> 'legacy_fixed_odds' and v_rumor\.engine_version <> 'exchange_v2'/i);
  has(/exchange market configuration is locked after draft/i);
  not(/place_fixed_prediction/i);
  not(/fixed_odds_positions/i);
});

test('0051 validates lifecycle dates and price/quantity configuration', () => {
  has(/exchange_validate_market_lifecycle_config/i);
  has(/close_at must be in the future/i);
  has(/resolve_by_at must be on or after close_at/i);
  has(/tick_size must be between 0 and 1/i);
  has(/quantity_step must be positive/i);
  has(/opening_mark_price must be between 0 and 1/i);
  has(/perform exchange_assert_tick\(p_opening_mark_price, p_tick_size, 'opening_mark_price'\)/i);
  has(/perform exchange_assert_tick\(p_min_order_quantity, p_quantity_step, 'min_order_quantity'\)/i);
});

test('0051 lifecycle transitions are narrow and audited', () => {
  has(/v_market\.state <> 'draft'[\s\S]+exchange market can only open from draft/i);
  has(/v_market\.state <> 'open'[\s\S]+exchange market can only close from open/i);
  has(/state = 'open'[\s\S]+book_version = book_version \+ 1/i);
  has(/state = 'closed'[\s\S]+book_version = book_version \+ 1/i);
  has(/exchange_market_promoted/i);
  has(/exchange_market_opened/i);
  has(/exchange_market_closed/i);
});

test('0051 never enables or writes production trading gates', () => {
  not(/insert\s+into\s+exchange_feature_gates/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
  not(/trading_enabled\s*=\s*true/i);
});

test('exchangeV2 client exposes lifecycle wrappers and maps lifecycle payloads', () => {
  has(/export interface ExchangeMarketLifecycleConfig/, client);
  has(/export interface ExchangeMarketLifecycleResult/, client);
  has(/promoteRumorToExchangeMarketV2/, client);
  has(/supabase\.rpc\('promote_rumor_to_exchange_market_v2'/, client);
  has(/openExchangeMarketV2/, client);
  has(/supabase\.rpc\('open_exchange_market_v2'/, client);
  has(/closeExchangeMarketV2/, client);
  has(/supabase\.rpc\('close_exchange_market_v2'/, client);
  has(/p_opening_mark_price: config\.openingMarkPrice \?\? '0\.50000000'/, client);
  has(/p_fee_bps: config\.feeBps \?\? 0/, client);
});
