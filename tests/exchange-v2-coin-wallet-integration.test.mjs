import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0056_exchange_v2_coin_wallet_integration.sql', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const adr = readFileSync(new URL('../docs/exchange-v2-adr.md', import.meta.url), 'utf8');

function has(pattern, source = migration) {
  assert.match(source, pattern);
}

function not(pattern, source = migration) {
  assert.doesNotMatch(source, pattern);
}

test('0056 bridges exchange COIN ledger entries into the real coin wallet with an idempotent trigger', () => {
  has(/create or replace function exchange_apply_coin_wallet_ledger_entry_v2\(\)/i);
  has(/create trigger exchange_apply_coin_wallet_ledger_entry_v2_trigger[\s\S]+before insert on exchange_wallet_ledger[\s\S]+execute function exchange_apply_coin_wallet_ledger_entry_v2\(\)/i);
  has(/v_wallet_idempotency_key := 'exchange_wallet_bridge:' \|\| new\.idempotency_key/i);
  has(/v_tx := apply_wallet_transaction\([\s\S]+new\.user_id,[\s\S]+exchange_wallet_transaction_type_for_entry_v2\(new\.entry_type, new\.metadata\),[\s\S]+v_signed_amount,[\s\S]+v_source_reference,[\s\S]+v_wallet_idempotency_key/i);
  has(/'exchangeLedgerIdempotencyKey', new\.idempotency_key/i);
  has(/'realCoinWalletApplied', true/i);
});

test('0056 makes reserve_coin debit spendable coin_wallets balance and available balance avoids double-subtracting reservations', () => {
  has(/create or replace function exchange_available_coin_balance\(p_user_id uuid\)[\s\S]+select exchange_coin_wallet_balance\(p_user_id\)/i);
  has(/if p_entry_type = 'reserve_coin' then[\s\S]+return \(p_amount \* -1\)::integer/i);
  has(/when p_entry_type in \('reserve_coin', 'spend_coin'\) then 'PREDICTION_STAKE'::coin_wallet_transaction_type/i);
  has(/'bridgeMode', 'reserve-debits-real-wallet'/i);
});

test('0056 credits release, seller credit, and settlement entries to real coin_wallets balance', () => {
  has(/elsif p_entry_type in \('release_coin', 'credit_coin', 'settlement'\) then[\s\S]+return p_amount::integer/i);
  has(/when p_entry_type = 'settlement' and coalesce\(p_metadata->>'settlementOutcome', ''\) = 'void' then 'PREDICTION_VOID_REFUND'::coin_wallet_transaction_type/i);
  has(/when p_entry_type = 'release_coin' then 'PREDICTION_VOID_REFUND'::coin_wallet_transaction_type/i);
  has(/when p_entry_type in \('credit_coin', 'settlement'\) then 'PREDICTION_WIN_RETURN'::coin_wallet_transaction_type/i);
});

test('0056 prevents double debits and non-whole coin drift', () => {
  has(/elsif p_entry_type = 'spend_coin' then[\s\S]+return 0/i);
  has(/reserve already removed spendable balance/i);
  has(/if p_amount <> trunc\(p_amount\) then[\s\S]+raise exception 'exchange wallet bridge requires whole-coin amounts'/i);
  has(/if v_signed_amount = 0 then[\s\S]+'realCoinWalletApplied', false[\s\S]+'reserve_already_debited_or_zero_amount'/i);
});

test('0056 stays closed-loop and does not touch legacy fixed-odds position semantics or production gates', () => {
  has(/'engineVersion', 'exchange_v2'/i);
  has(/'legacyFixedOddsTouched', false/i);
  has(/'coinsClosedLoop', true/i);
  has(/revoke all on function exchange_apply_coin_wallet_ledger_entry_v2\(\) from public, anon, authenticated/i);
  not(/update\s+fixed_prediction_positions/i);
  not(/update\s+prediction_outcomes/i);
  not(/update\s+exchange_feature_gates/i);
  not(/production_approved\s*=\s*true/i);
});

test('roadmap records applied complete-set minting and M8 0061/0062 blocker', () => {
  assert.match(adr, /Option A — minting \/ complete-set creation \(approved direction\)/i);
  assert.match(adr, /DECISION LOCKED/i);
  assert.match(backlog, /Exchange v2 M-whole-coin — applied/i);
  assert.match(backlog, /Exchange v2 M-mint — applied/i);
});
