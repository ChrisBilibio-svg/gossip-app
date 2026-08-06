import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const exchangeLib = readFileSync(new URL('../src/lib/exchangeV2.ts', import.meta.url), 'utf8');
const migration0063 = readFileSync(new URL('../supabase/migrations/0063_exchange_v2_m8_settlement_state_enum_cast.sql', import.meta.url), 'utf8');
const backlog = readFileSync(new URL('../BACKLOG.md', import.meta.url), 'utf8');
const status = readFileSync(new URL('../PROJECT_STATUS.md', import.meta.url), 'utf8');

function has(pattern, source = exchangeLib) {
  assert.match(source, pattern);
}

function not(pattern, source = exchangeLib) {
  assert.doesNotMatch(source, pattern);
}

test('M9 exposes typed PT-BR exchange error normalization for backend contract completeness', () => {
  has(/export type ExchangeClientErrorCode\s*=\s*\n\s*\| 'exchange_unavailable'/);
  has(/\| 'requires_requote'/);
  has(/\| 'insufficient_balance'/);
  has(/\| 'insufficient_position'/);
  has(/\| 'whole_coin_required'/);
  has(/\| 'risk_blocked'/);
  has(/export interface ExchangeClientError/);
  has(/export function normalizeExchangeV2Error\(error: unknown/);
  has(/A cotação expirou ou o livro mudou\. Atualize a cotação e tente de novo\./);
  has(/Saldo de moedas insuficiente para essa ordem\./);
  has(/Você não tem posição suficiente para vender essa quantidade\./);
  has(/A ordem precisa respeitar lotes de moeda inteira\./);
  has(/A ordem foi bloqueada pelos limites de risco do mercado\./);
});

test('M9 order/cancel/expire wrappers return stable codes instead of raw SQL errors', () => {
  has(/errorCode\?: ExchangeClientErrorCode/);
  has(/const normalized = normalizeExchangeV2Error\(error, 'Não foi possível enviar a ordem\. Tente novamente\.'\)/);
  has(/return \{ ok: false, errorCode: normalized\.code, error: normalized\.message, requiresRequote: normalized\.requiresRequote \}/);
  has(/const normalized = normalizeExchangeV2Error\(error, 'Não foi possível cancelar a ordem\. Tente novamente\.'\)/);
  has(/const normalized = normalizeExchangeV2Error\(error, 'Não foi possível expirar a ordem\. Tente novamente\.'\)/);
  not(/return \{ ok: false, error: String\(error\.message/);
  not(/const message = String\(error\.message/);
});

test('M9 client-order id helpers keep idempotency keys bounded, safe, and retry-aware', () => {
  has(/export interface ExchangeClientOrderIdInput/);
  has(/export function buildExchangeClientOrderId\(input: ExchangeClientOrderIdInput\): string/);
  has(/export function isValidExchangeClientOrderId\(clientOrderId: string\): boolean/);
  has(/EXCHANGE_CLIENT_ORDER_ID_MIN_LENGTH = 12/);
  has(/EXCHANGE_CLIENT_ORDER_ID_MAX_LENGTH = 120/);
  has(/const EXCHANGE_CLIENT_ORDER_ID_RE = \/\^\[a-z0-9:_-\]\+\$\/i/);
  has(/clientNonce \?\? buildLocalClientOrderNonce\(\)/);
  has(/reuse for retries of the same order intent/i);
  has(/!isValidExchangeClientOrderId\(input\.clientOrderId\)/);
  has(/errorCode: 'invalid_order'/);
  has(/Identificador da ordem inválido\. Atualize a cotação e tente novamente\./);
});

test('M9 order preflight rejects malformed orders before Supabase RPCs', () => {
  has(/export type PlaceOrderV2ValidationResult/);
  has(/const EXCHANGE_DECIMAL_RE = \/\^\(\?:0\|\[1-9\]\\d\*\)\(\?:\\\.\\d\+\)\?\$\//);
  has(/const EXCHANGE_UUID_RE = \/\^\[0-9a-f\]\{8\}-/);
  has(/export function isPositiveExchangeDecimal\(value: string\): boolean/);
  has(/export function validatePlaceOrderV2Input\(input: PlaceOrderV2Input\): PlaceOrderV2ValidationResult/);
  has(/!isPositiveExchangeDecimal\(input\.quantity\)/);
  has(/Informe uma quantidade positiva de contratos\./);
  has(/!isPositiveExchangeDecimal\(input\.limitPrice\) \|\| Number\(input\.limitPrice\) >= 1/);
  has(/Informe um preço entre 0 e 1 moeda\./);
  has(/input\.timeInForce === 'GTD'/);
  has(/A expiração da ordem precisa ser uma data futura\./);
  has(/!EXCHANGE_UUID_RE\.test\(input\.quoteId\)/);
  has(/Atualize a cotação antes de enviar a ordem\./);
  has(/const validation = validatePlaceOrderV2Input\(input\)/);
  has(/if \(!validation\.ok\) return validation/);
});

test('M9 duplicate submit helper lets UI fetch receipts instead of blindly resubmitting', () => {
  has(/\| 'duplicate_order'/);
  has(/export function isDuplicateExchangeOrderResult\(result: Pick<PlaceOrderV2Result, 'ok' \| 'errorCode'> \| null \| undefined\): boolean/);
  has(/result\?\.ok === false && result\.errorCode === 'duplicate_order'/);
  has(/Essa ordem já foi enviada\. Confira o recibo antes de reenviar\./);
});

test('M9 receipt recovery can resolve duplicate client-order submits without raw DB errors', () => {
  has(/function mapTradeReceipt\(row: unknown, fallbackOrderId = ''\): TradeReceiptV1/);
  has(/export async function getTradeReceiptByClientOrderIdV1\(clientOrderId: string\): Promise<TradeReceiptV1 \| null>/);
  has(/!isValidExchangeClientOrderId\(clientOrderId\)/);
  has(/\.from\('exchange_orders'\)/);
  has(/\.eq\('client_order_id', clientOrderId\)/);
  has(/return getTradeReceiptV1\(String\(order\.id\)\)/);
});

test('M9 submit wrapper returns receipts for success and duplicate recovery paths', () => {
  has(/export interface PlaceOrderWithReceiptV1Result/);
  has(/receipt: TradeReceiptV1 \| null/);
  has(/duplicateRecovered: boolean/);
  has(/export async function placeOrderWithReceiptV1\(input: PlaceOrderV2Input\): Promise<PlaceOrderWithReceiptV1Result>/);
  has(/const order = await placeOrderV2\(input\)/);
  has(/if \(order\.ok && order\.orderId\)/);
  has(/receipt: await getTradeReceiptV1\(order\.orderId\)/);
  has(/if \(isDuplicateExchangeOrderResult\(order\)\)/);
  has(/receipt: await getTradeReceiptByClientOrderIdV1\(input\.clientOrderId\)/);
  has(/duplicateRecovered: true/);
});

test('0063 fixes settlement state enum casts without enabling production trading', () => {
  has(/fix settlement market-state enum casts/i, migration0063);
  has(/create or replace function resolve_market_v2/, migration0063);
  has(/'voided'::exchange_market_state/, migration0063);
  has(/'resolved'::exchange_market_state/, migration0063);
  has(/grant execute on function resolve_market_v2\(uuid, exchange_settlement_outcome, text, text\) to service_role/, migration0063);
  assert.doesNotMatch(migration0063, /update\s+exchange_feature_gates\s+set[\s\S]*environment\s*=\s*'production'/i);
  assert.doesNotMatch(migration0063, /production_approved\s*=\s*true/i);
});

test('M9 docs remain human-gated: M8 blocked on 0063 and M9 recorded as backend polish', () => {
  has(/Exchange v2 M8 — blocked: human apply 0063/i, backlog);
  has(/Exchange v2 M9 — backend polish/i, backlog);
  has(/M9 first backend-polish slice/i, backlog);
  has(/M9 second backend-polish slice/i, backlog);
  has(/M9 third backend-polish slice/i, backlog);
  has(/M9 fourth backend-polish slice/i, backlog);
  has(/M9 fifth backend-polish slice/i, backlog);
  has(/M8 live development test is blocked until Chris applies `0063`/i, status);
  has(/PT-BR exchange error normalization/i, status);
  has(/client-order idempotency/i, status);
  has(/duplicate-submit receipt recovery/i, status);
  has(/placeOrderWithReceiptV1/i, status);
  has(/order-input preflight validation/i, status);
});
