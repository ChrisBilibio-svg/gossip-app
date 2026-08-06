import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0054_exchange_v2_positions_pnl.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0054 applies fill-driven position accounting from exchange_insert_fill_v2', () => {
  has(/create or replace function exchange_apply_fill_positions_v2\(/i);
  has(/create or replace function exchange_insert_fill_v2\([\s\S]+v_position_result := exchange_apply_fill_positions_v2\(/i);
  has(/perform exchange_adjust_order_reservation_after_fill_v2\(v_buyer_order_id[\s\S]+perform exchange_adjust_order_reservation_after_fill_v2\(v_seller_order_id/i);
  has(/revoke all on function exchange_apply_fill_positions_v2\([\s\S]+from public, anon, authenticated/i);
  not(/update\s+coin_wallets/i);
  not(/insert into wallet_transactions/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
});

test('0054 buy builds quantity cost basis and weighted average entry price', () => {
  has(/insert into exchange_positions \(user_id, market_id, outcome, quantity, cost_basis, average_entry_price, fees_paid\)[\s\S]+on conflict \(user_id, market_id, outcome\) do nothing/i);
  has(/v_buyer_new_quantity := round\(v_buyer\.quantity \+ p_quantity, 6\)/i);
  has(/v_buyer_new_cost_basis := round\(v_buyer\.cost_basis \+ v_buyer_cost, 6\)/i);
  has(/average_entry_price = case when v_buyer_new_quantity > 0 then round\(v_buyer_new_cost_basis \/ v_buyer_new_quantity, 8\) else 0 end/i);
});

test('0054 partial sell realizes P&L against disposed cost basis and preserves remaining average', () => {
  has(/v_disposed_basis := case[\s\S]+when v_seller\.quantity = p_quantity then v_seller\.cost_basis[\s\S]+else round\(v_seller\.cost_basis \* \(p_quantity \/ v_seller\.quantity\), 6\)[\s\S]+end/i);
  has(/v_seller_new_quantity := round\(v_seller\.quantity - p_quantity, 6\)/i);
  has(/v_seller_new_cost_basis := case[\s\S]+else greatest\(round\(v_seller\.cost_basis - v_disposed_basis, 6\), 0\)[\s\S]+end/i);
  has(/v_realized_pnl := round\(v_seller_proceeds - v_disposed_basis, 6\)/i);
  has(/realized_pnl = round\(realized_pnl \+ v_realized_pnl, 6\)/i);
  has(/average_entry_price = case when v_seller_new_quantity > 0 then round\(v_seller_new_cost_basis \/ v_seller_new_quantity, 8\) else 0 end/i);
});

test('0054 full sell closes the position while retaining realized P&L history', () => {
  has(/when v_seller\.quantity = p_quantity then v_seller\.cost_basis/i);
  has(/when v_seller_new_quantity <= 0 then 0/i);
  has(/set quantity = greatest\(v_seller_new_quantity, 0\),[\s\S]+cost_basis = v_seller_new_cost_basis,[\s\S]+average_entry_price = case when v_seller_new_quantity > 0 then round\(v_seller_new_cost_basis \/ v_seller_new_quantity, 8\) else 0 end,[\s\S]+realized_pnl = round\(realized_pnl \+ v_realized_pnl, 6\)/i);
  has(/if not found or v_seller\.quantity < p_quantity then[\s\S]+insufficient seller position for fill accounting/i);
});

test('0054 gives GTD an explicit expiry and guards FOK estimate-vs-actual race', () => {
  has(/p_expires_at timestamptz/i);
  has(/if p_time_in_force = 'GTD' then[\s\S]+if p_expires_at is null then[\s\S]+GTD orders require explicit expires_at/i);
  has(/if p_expires_at > v_market\.close_at then[\s\S]+GTD expires_at cannot exceed market close/i);
  has(/elsif p_expires_at is not null then[\s\S]+expires_at is only supported for GTD orders/i);
  has(/FOK is all-or-none[\s\S]+if p_time_in_force = 'FOK' and v_order\.filled_quantity < v_order\.original_quantity then[\s\S]+FOK fillability changed; requote required/i);
  has(/'fokPreMatchFillableQuantity', v_fillable/i);
});

test('exchangeV2 client exposes M4 portfolio and GTD expiry contracts', () => {
  has(/expiresAt\?: string \| null/, client);
  has(/p_expires_at: input\.expiresAt \?\? null/, client);
  has(/export interface ExchangePositionV2[\s\S]+quantity: number;[\s\S]+costBasis: number;[\s\S]+averageEntryPrice: number;[\s\S]+realizedPnl: number;/, client);
  has(/export async function getPortfolioV2\(\): Promise<ExchangePortfolioV2>/, client);
  has(/positions = Array\.isArray\(r\.positions\) \? r\.positions\.map\(mapPosition\) : \[\]/, client);
});
