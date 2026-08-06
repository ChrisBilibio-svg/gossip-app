import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0043_coin_economy_fixed_odds.sql', import.meta.url), 'utf8');
const voteBlockSource = readFileSync(new URL('../src/components/VoteBlock.tsx', import.meta.url), 'utf8');
const slipSource = readFileSync(new URL('../src/components/PredictionSlip.tsx', import.meta.url), 'utf8');
const proSheetSource = readFileSync(new URL('../src/components/ProSheet.tsx', import.meta.url), 'utf8');
const walletPanelSource = readFileSync(new URL('../src/components/WalletPanel.tsx', import.meta.url), 'utf8');
const jobSource = readFileSync(new URL('../scripts/reconcile-coin-grants.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/reconcile-coin-grants.yml', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

test('0043 defines feature-flagged server-side EconomyConfig with launch defaults and kill switches', () => {
  has(/create\s+table\s+if\s+not\s+exists\s+economy_configs/i);
  for (const column of ['purchases_killed', 'subscription_grants_killed', 'recovery_grants_killed', 'prediction_placement_killed', 'prediction_settlement_killed']) {
    has(new RegExp(`${column}\\s+boolean\\s+not\\s+null\\s+default\\s+true`, 'i'));
  }
  has(/starter_grant_coins[\s\S]*2000/i);
  has(/free_daily_recovery_floor[\s\S]*500/i);
  has(/pro_daily_recovery_floor[\s\S]*1000/i);
  has(/pro_upfront_coins[\s\S]*300/i);
  has(/pro_daily_coins[\s\S]*40/i);
  has(/pro_service_days[\s\S]*30/i);
  has(/standard_stake_coins[\s\S]*100/i);
  has(/array\[50,\s*100,\s*250\]/i);
  has(/0\.0500/);
  has(/0\.1000/);
  has(/0\.9000/);
  has(/'pro_monthly_v1'/);
  has(/'coins_125'/);
  has(/'coins_750'/);
  has(/'coins_1650'/);
  has(/is_active,?[\s\S]*false/i);
});

test('0043 implements append-only wallet ledger with required traceability fields and RLS read policies', () => {
  has(/create\s+table\s+if\s+not\s+exists\s+wallet_transactions/i);
  for (const field of ['id uuid primary key', 'user_id uuid not null', 'transaction_type coin_wallet_transaction_type not null', 'signed_amount integer not null', 'balance_after integer not null', "currency_type text not null default 'COIN'", 'source_reference text not null', 'idempotency_key text not null', 'economy_config_version integer not null', 'metadata jsonb not null', 'created_at timestamptz not null']) {
    has(new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '\\s+'), 'i'));
  }
  has(/unique\s*\(\s*idempotency_key\s*\)/i);
  has(/alter\s+table\s+wallet_transactions\s+enable\s+row\s+level\s+security/i);
  has(/read own wallet transactions/i);
  has(/if\s+v_after\s*<\s*0\s+then[\s\S]*insufficient coin balance[\s\S]*update\s+coin_wallets[\s\S]*balance\s*=\s*v_after/i);
});

test('0043 covers starter, free recovery, pro recovery before daily, upfront, 30-day catch-up, and idempotency keys', () => {
  has(/create\s+or\s+replace\s+function\s+grant_starter_coins/i);
  has(/'starter:'\s*\|\|\s*v_user/i);
  has(/create\s+or\s+replace\s+function\s+apply_daily_recovery_for_user/i);
  has(/greatest\(v_floor\s*-\s*v_wallet\.balance,\s*0\)/i);
  has(/free_recovery:/i);
  has(/pro_recovery:/i);
  has(/create\s+or\s+replace\s+function\s+apply_due_pro_grants_for_user/i);
  has(/perform\s+apply_daily_recovery_for_user\(p_user_id,\s*v_date\)/i);
  has(/'PRO_DAILY'/i);
  has(/generate_series\(v_ent\.service_start_date[\s\S]*v_ent\.service_days\s*-\s*1/i);
  has(/'PRO_UPFRONT'/i);
});

test('0043 purchase hooks are service-only, idempotent by provider transaction id, and avoid sensitive analytics', () => {
  has(/create\s+table\s+if\s+not\s+exists\s+coin_purchases/i);
  has(/unique\s*\(\s*provider\s*,\s*provider_transaction_id\s*\)/i);
  has(/create\s+or\s+replace\s+function\s+service_record_verified_purchase/i);
  has(/service role required/i);
  has(/on\s+conflict\s*\(provider,\s*provider_transaction_id\)/i);
  has(/PACK_PURCHASE/i);
  has(/pro_entitlements/i);
  has(/purchase_restored/i);
  has(/subscription_refunded/i);
  has(/containsSensitivePaymentInfo'\s*,\s*false/i);
});

test('0043 fixed odds validate probabilities, store canonical odds, snapshot locked odds, and settle idempotently', () => {
  has(/prediction_market_probability_versions/i);
  has(/prediction_outcomes/i);
  has(/fixed_prediction_positions/i);
  has(/probability\s+numeric\(8,4\)\s+not\s+null/i);
  has(/decimal_odds\s+numeric\(12,4\)\s+not\s+null/i);
  has(/round\(\(1\s*-\s*v_house\)\s*\/\s*p_true_probability,\s*4\)/i);
  has(/abs\(\(p_true_probability\s*\+\s*p_false_probability\)\s*-\s*1\.0000\)\s*>\s*0\.0001/i);
  has(/locked_probability/i);
  has(/locked_decimal_odds/i);
  has(/potential_total_return_coins/i);
  has(/floor\(p_stake_coins\s*\*\s*v_outcome\.decimal_odds\)/i);
  has(/least\(v_cfg\.absolute_max_stake_coins,\s*floor\(v_wallet\.balance\s*\*\s*v_cfg\.max_wallet_fraction\)/i);
  has(/unique\s*\(user_id,\s*market_id\)/i);
  has(/settle_win:/i);
  has(/settle_void:/i);
  has(/where\s+market_id\s*=\s*p_rumor_id\s+and\s+status\s*=\s*'OPEN'/i);
});

test('client UI is feature-flagged and displays required prediction/subscription/wallet disclosures', () => {
  has(/getCoinEconomyState\(\).*featureEnabled.*predictionPlacementKilled/s, voteBlockSource);
  has(/PredictionSlip/, voteBlockSource);
  has(/Confirmar palpite/, slipSource);
  has(/Probabilidade atual/, slipSource);
  has(/Retorno fixado/, slipSource);
  has(/Retorno total potencial/, slipSource);
  has(/Ganho líquido potencial/, slipSource);
  has(/reserveWarningForStake/, slipSource);
  has(/mais de 25% das suas moedas/, readFileSync(new URL('../src/lib/economy.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(slipSource, /reserva recomendada de 1\.000/);
  has(/noCashValueReminder/, slipSource);
  has(/300 agora \+ 40 × 30 dias = 1\.500/, proSheetSource);
  has(/preço localizado da loja/i, proSheetSource);
  has(/Checkout bloqueado por feature flag/i, proSheetSource);
  has(/Restaurar compra/i, proSheetSource);
  has(/Histórico da carteira/i, walletPanelSource);
  has(/desativada por feature flag/i, walletPanelSource);
});

test('scheduler is import-safe and workflow defaults to dry-run/off', () => {
  has(/export\s+function\s+buildCoinGrantConfig/i, jobSource);
  has(/export\s+async\s+function\s+runCoinGrantReconciliation/i, jobSource);
  has(/if\s*\(!config\.live\)\s*return\s+summarizeGrantResult\(null,\s*false\)/i, jobSource);
  has(/COIN_GRANT_LIVE:[\s\S]*'false'/i, workflow);
  has(/workflow_dispatch/i, workflow);
  has(/schedule:/i, workflow);
});
