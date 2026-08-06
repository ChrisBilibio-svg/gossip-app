import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0050_exchange_v2_foundation.sql', import.meta.url), 'utf8');
const adr = readFileSync(new URL('../docs/exchange-v2-adr.md', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

test('0050 preserves immutable engine routing for legacy fixed odds and v2 exchange markets', () => {
  has(/create\s+type\s+market_engine_version\s+as\s+enum\s*\('legacy_fixed_odds',\s*'exchange_v2'\)/i);
  has(/alter\s+table\s+rumors[\s\S]*engine_version\s+market_engine_version\s+not\s+null\s+default\s+'legacy_fixed_odds'/i);
  has(/alter\s+table\s+fixed_prediction_positions[\s\S]*engine_version\s+market_engine_version\s+not\s+null\s+default\s+'legacy_fixed_odds'/i);
  has(/exchange_markets[\s\S]*engine_version\s+market_engine_version\s+not\s+null\s+default\s+'exchange_v2'\s+check\s*\(engine_version\s*=\s*'exchange_v2'\)/i);
});

test('0050 defines fail-closed production feature gates for trading selling maker fees and approval', () => {
  for (const column of ['trading_enabled', 'selling_enabled', 'market_maker_enabled', 'fees_enabled', 'production_approved']) {
    has(new RegExp(`${column}\\s+boolean\\s+not\\s+null\\s+default\\s+false`, 'i'));
  }
  has(/environment\s+<>\s+'production'\s+or\s*\(not\s+trading_enabled\s+or\s+production_approved\)/i);
  has(/exchange_gate_allows/i);
  has(/exchange trading is disabled/i);
});

test('0050 models v2 order book, reservations, fills, positions, ledger, quotes, and settlements', () => {
  for (const table of ['exchange_orders', 'exchange_reservations', 'exchange_fills', 'exchange_positions', 'exchange_wallet_ledger', 'exchange_order_quotes', 'exchange_settlements', 'exchange_audit_events', 'exchange_risk_events']) {
    has(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}`, 'i'));
  }
  has(/unique\s*\(user_id,\s*client_order_id\)/i);
  has(/original_quantity\s*=\s*filled_quantity\s*\+\s*remaining_quantity\s*\+\s*cancelled_quantity/i);
  has(/reserved_sell_quantity\s*<=\s*quantity/i);
  has(/maker_user_id\s*<>\s*taker_user_id/i);
  has(/entry_type[\s\S]*reserve_coin[\s\S]*release_coin[\s\S]*spend_coin[\s\S]*credit_coin[\s\S]*reserve_share[\s\S]*debit_share[\s\S]*credit_share/i);
});

test('0050 exposes versioned authenticated RPCs with quote revalidation and liquidity disclosure', () => {
  for (const fn of ['get_market_snapshot_v2', 'quote_order_v2', 'place_order_v2', 'quote_cash_out_v1', 'sell_position_v1', 'cancel_order_v1', 'get_portfolio_v2', 'get_trade_receipt_v1', 'resolve_market_v2']) {
    has(new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn}`, 'i'));
  }
  has(/pg_advisory_xact_lock\(exchange_market_lock_key\(p_market_id,\s*p_outcome\)\)/i);
  has(/quote expired or stale; requote required/i);
  has(/Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez\./);
  has(/grant\s+execute\s+on\s+function\s+resolve_market_v2[\s\S]*to\s+service_role/i);
  has(/revoke\s+all\s+on\s+function\s+resolve_market_v2[\s\S]*from\s+public,\s*anon,\s*authenticated/i);
});

test('0050 documents fixed-point precision, collateral, price-time priority, P&L, mark, VOID, liquidity provider, and gates', () => {
  for (const required of [
    /PostgreSQL `numeric`/,
    /fully collateralized/i,
    /price-time priority/i,
    /Average entry and cost basis/i,
    /headline\/display probability is not necessarily executable/i,
    /VOID v2 settlement pays `0\.5`/i,
    /MARKET_MAKER_ENABLED=false/,
    /TRADING_ENABLED/,
    /SELLING_ENABLED/,
    /FEES_ENABLED/,
  ]) {
    assert.match(adr, required);
  }
});
