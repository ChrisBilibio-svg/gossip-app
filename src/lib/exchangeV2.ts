import { supabase, supabaseConfigured } from './supabase';

export const CASH_OUT_LIQUIDITY_DISCLOSURE = 'Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.';

export type ExchangeOutcome = 'true' | 'false';
export type ExchangeAction = 'buy' | 'sell';
export type ExchangeOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'expired' | 'rejected';
export type ExchangeTimeInForce = 'GTC' | 'GTD' | 'IOC' | 'FOK';
export type ExchangeMarketState = 'draft' | 'open' | 'paused' | 'closed' | 'resolved' | 'voided';
export type ExchangeResolutionPolicy = 'evidence' | 'deadline';

export interface MarketSnapshotV2 {
  marketId: string;
  engineVersion: 'exchange_v2';
  state: ExchangeMarketState;
  bookVersion: number;
  markProbability: number;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  tickSize: number;
  quantityStep: number;
  updatedAt: string;
}

export interface ExchangeMarketLifecycleConfig {
  rumorId: string;
  closeAt: string;
  resolveByAt?: string | null;
  resolutionPolicy?: ExchangeResolutionPolicy;
  requiredSourceCount?: number;
  tickSize?: string;
  quantityStep?: string;
  minOrderQuantity?: string;
  openingMarkPrice?: string;
  feeBps?: number;
}

export interface ExchangeMarketLifecycleResult {
  marketId: string;
  engineVersion: 'exchange_v2';
  state: ExchangeMarketState;
  closeAt: string;
  resolveByAt: string | null;
  resolutionPolicy: ExchangeResolutionPolicy;
  requiredSourceCount: number;
  tickSize: number;
  quantityStep: number;
  minOrderQuantity: number;
  feeBps: number;
  markProbability: number;
  bookVersion: number;
  updatedAt: string;
}

export interface ExchangeMarketControlInput {
  marketId: string;
  /** Curator/service-only reason; stored in audit/risk events. */
  reason: string;
}

export type ExchangeRiskEventType =
  | 'order_allowed'
  | 'order_blocked'
  | 'rate_limit_exceeded'
  | 'open_order_limit_exceeded'
  | 'position_limit_exceeded'
  | 'exposure_limit_exceeded'
  | 'order_notional_limit_exceeded'
  | 'market_paused'
  | 'market_resumed';

export interface ExchangeRiskEventV2 {
  id: string;
  userId: string | null;
  marketId: string | null;
  outcome: ExchangeOutcome | null;
  orderId: string | null;
  eventType: ExchangeRiskEventType;
  severity: 'info' | 'warn' | 'block';
  decision: 'allowed' | 'blocked' | 'paused' | 'resumed';
  reason: string;
  createdAt: string;
}

export interface OrderQuoteV2 {
  quoteId: string;
  marketId: string;
  bookVersion: number;
  expiresAt: string;
  action: ExchangeAction;
  outcome: ExchangeOutcome;
  requestedLimitPrice: number;
  requestedQuantity: number;
  estimatedFillableQuantity: number;
  estimatedAverageExecutionPrice: number | null;
  worstExecutionPrice: number | null;
  fees: number;
  warnings: string[];
}

export interface AmmQuoteV2 {
  quoteId: string;
  marketId: string;
  bookVersion: number;
  expiresAt: string;
  action: ExchangeAction;
  outcome: ExchangeOutcome;
  requestedQuantity: number;
  unitPrice: number;
  totalCoins: number;
  curveDeltaCoins: number;
  rounding: string;
  priceImpact: number;
  priceYesBefore: number;
  priceYesAfter: number;
  rawPriceYes: number;
  rawPriceNo: number;
  rawPriceSum: number;
  bBefore: number;
  bAfter: number;
  estimatedFillableQuantity: number;
  warnings: string[];
}

export interface ExecuteAmmTradeV2Input {
  marketId: string;
  outcome: ExchangeOutcome;
  action: ExchangeAction;
  quantity: string;
  quoteId: string;
  environment?: 'development' | 'preview' | 'production';
}

export interface ExecuteAmmTradeV2Result {
  ok: boolean;
  marketId?: string;
  quoteId?: string;
  action?: ExchangeAction;
  outcome?: ExchangeOutcome;
  quantity?: number;
  totalCoins?: number;
  unitPrice?: number;
  curveDeltaCoins?: number;
  rounding?: string;
  priceYesBefore?: number;
  priceYesAfter?: number;
  bBefore?: number;
  bAfter?: number;
  bookVersion?: number;
  positionQuantity?: number;
  houseMintCapCoins?: number;
  requiresRequote?: boolean;
  errorCode?: ExchangeClientErrorCode;
  error?: string;
}

export interface PlaceOrderV2Input {
  marketId: string;
  outcome: ExchangeOutcome;
  action: ExchangeAction;
  quantity: string;
  limitPrice: string;
  timeInForce: ExchangeTimeInForce;
  /**
   * Client-scoped idempotency key for this exact order intent.
   * Persist/reuse it across retries for the same button tap; generate a new one for edits.
   */
  clientOrderId: string;
  quoteId: string;
  environment?: 'development' | 'preview' | 'production';
  /** Required by 0054 for GTD orders; must be a future ISO timestamp no later than market close. */
  expiresAt?: string | null;
}

export interface ExchangeClientOrderIdInput {
  marketId: string;
  outcome: ExchangeOutcome;
  action: ExchangeAction;
  quoteId: string;
  /** Stable per-submit nonce; reuse for retries of the same order intent. */
  clientNonce?: string | null;
}

export type ExchangeReservationKind = 'coin' | 'share';

export interface ExchangePositionV2 {
  id: string;
  userId: string;
  marketId: string;
  outcome: ExchangeOutcome;
  quantity: number;
  reservedSellQuantity: number;
  costBasis: number;
  averageEntryPrice: number;
  realizedPnl: number;
  feesPaid: number;
  settlementId: string | null;
  settledAt: string | null;
  settledQuantity: number;
  settlementPayout: number;
  version: number;
  updatedAt: string;
}

export interface ExchangePortfolioV2 {
  positions: ExchangePositionV2[];
  cashOutDisclosure: string;
}

export interface TradeReceiptV1 {
  orderId: string;
  marketId: string;
  outcome: ExchangeOutcome;
  action: ExchangeAction;
  status: ExchangeOrderStatus;
  coinsRequested: number | null;
  sharesRequested: number;
  sharesFilled: number;
  sharesRemaining: number;
  requestedLimitPrice: number;
  actualAverageFillPrice: number | null;
  fees: number;
  reservationId: string | null;
  reservationKind: ExchangeReservationKind | null;
  reservedCollateral: number;
  releasedCollateral: number;
  orderTimestamp: string;
  cashOutDisclosure: string;
}

export type ExchangeClientErrorCode =
  | 'exchange_unavailable'
  | 'requires_requote'
  | 'market_closed'
  | 'market_paused'
  | 'insufficient_balance'
  | 'insufficient_position'
  | 'whole_coin_required'
  | 'risk_blocked'
  | 'duplicate_order'
  | 'invalid_order'
  | 'unknown';

export interface ExchangeClientError {
  code: ExchangeClientErrorCode;
  message: string;
  requiresRequote: boolean;
}

export interface PlaceOrderV2Result {
  ok: boolean;
  orderId?: string;
  status?: ExchangeOrderStatus;
  filledQuantity?: number;
  remainingQuantity?: number;
  actualAverageFillPrice?: number | null;
  fees?: number;
  reservationId?: string | null;
  reservationKind?: ExchangeReservationKind | null;
  reservedCollateral?: number;
  releasedCollateral?: number;
  bookVersion?: number;
  cashOutDisclosure?: string;
  requiresRequote?: boolean;
  errorCode?: ExchangeClientErrorCode;
  error?: string;
}

export interface PlaceOrderWithReceiptV1Result {
  order: PlaceOrderV2Result;
  receipt: TradeReceiptV1 | null;
  /** True when the submit hit the client-order idempotency guard and receipt lookup recovered the prior order. */
  duplicateRecovered: boolean;
}

export type PlaceOrderV2ValidationResult =
  | { ok: true }
  | { ok: false; errorCode: ExchangeClientErrorCode; error: string; requiresRequote?: boolean };

const EXCHANGE_UNAVAILABLE_ERROR: ExchangeClientError = {
  code: 'exchange_unavailable',
  message: 'Exchange v2 indisponível.',
  requiresRequote: false,
};

const GENERIC_EXCHANGE_ERROR = 'Não foi possível concluir a operação. Tente novamente.';
const EXCHANGE_CLIENT_ORDER_ID_MIN_LENGTH = 12;
const EXCHANGE_CLIENT_ORDER_ID_MAX_LENGTH = 120;
const EXCHANGE_CLIENT_ORDER_ID_RE = /^[a-z0-9:_-]+$/i;
const EXCHANGE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const EXCHANGE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPositiveExchangeDecimal(value: string): boolean {
  if (!EXCHANGE_DECIMAL_RE.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function validatePlaceOrderV2Input(input: PlaceOrderV2Input): PlaceOrderV2ValidationResult {
  if (!EXCHANGE_UUID_RE.test(input.marketId)) {
    return { ok: false, errorCode: 'invalid_order', error: 'Mercado inválido. Atualize a cotação e tente novamente.', requiresRequote: true };
  }
  if (input.outcome !== 'true' && input.outcome !== 'false') {
    return { ok: false, errorCode: 'invalid_order', error: 'Escolha inválida. Atualize a cotação e tente novamente.', requiresRequote: true };
  }
  if (input.action !== 'buy' && input.action !== 'sell') {
    return { ok: false, errorCode: 'invalid_order', error: 'Tipo de ordem inválido. Atualize a cotação e tente novamente.', requiresRequote: true };
  }
  if (!isPositiveExchangeDecimal(input.quantity)) {
    return { ok: false, errorCode: 'invalid_order', error: 'Informe uma quantidade positiva de contratos.', requiresRequote: false };
  }
  if (!isPositiveExchangeDecimal(input.limitPrice) || Number(input.limitPrice) >= 1) {
    return { ok: false, errorCode: 'invalid_order', error: 'Informe um preço entre 0 e 1 moeda.', requiresRequote: true };
  }
  if (!['GTC', 'GTD', 'IOC', 'FOK'].includes(input.timeInForce)) {
    return { ok: false, errorCode: 'invalid_order', error: 'Prazo da ordem inválido. Atualize a cotação e tente novamente.', requiresRequote: true };
  }
  if (input.timeInForce === 'GTD') {
    const expiresAt = input.expiresAt == null ? NaN : Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return { ok: false, errorCode: 'invalid_order', error: 'A expiração da ordem precisa ser uma data futura.', requiresRequote: true };
    }
  }
  if (!EXCHANGE_UUID_RE.test(input.quoteId)) {
    return { ok: false, errorCode: 'requires_requote', error: 'Atualize a cotação antes de enviar a ordem.', requiresRequote: true };
  }
  if (!isValidExchangeClientOrderId(input.clientOrderId)) {
    return { ok: false, errorCode: 'invalid_order', error: 'Identificador da ordem inválido. Atualize a cotação e tente novamente.', requiresRequote: true };
  }
  return { ok: true };
}

export function isValidExchangeClientOrderId(clientOrderId: string): boolean {
  return clientOrderId.length >= EXCHANGE_CLIENT_ORDER_ID_MIN_LENGTH
    && clientOrderId.length <= EXCHANGE_CLIENT_ORDER_ID_MAX_LENGTH
    && EXCHANGE_CLIENT_ORDER_ID_RE.test(clientOrderId);
}

export function buildExchangeClientOrderId(input: ExchangeClientOrderIdInput): string {
  const market = normalizeClientOrderIdPart(input.marketId, 24, 'market');
  const quote = normalizeClientOrderIdPart(input.quoteId, 24, 'quote');
  const nonce = normalizeClientOrderIdPart(input.clientNonce ?? buildLocalClientOrderNonce(), 24, 'nonce');
  const id = `xv2:${market}:${input.outcome}:${input.action}:${quote}:${nonce}`;
  return id.length <= EXCHANGE_CLIENT_ORDER_ID_MAX_LENGTH ? id : id.slice(0, EXCHANGE_CLIENT_ORDER_ID_MAX_LENGTH);
}

export function isDuplicateExchangeOrderResult(result: Pick<PlaceOrderV2Result, 'ok' | 'errorCode'> | null | undefined): boolean {
  return result?.ok === false && result.errorCode === 'duplicate_order';
}

function buildLocalClientOrderNonce(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeClientOrderIdPart(value: string, maxLength: number, fallback: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return safe || fallback;
}

export function normalizeExchangeV2Error(error: unknown, fallback = GENERIC_EXCHANGE_ERROR): ExchangeClientError {
  const raw = typeof error === 'string'
    ? error
    : String(asRecord(error).message ?? asRecord(error).details ?? asRecord(error).hint ?? fallback);
  const lower = raw.toLowerCase();

  if (/quote|stale|requote|expir|cot[aá]?[cç][aã]o|pre[cç]o mudou/.test(lower)) {
    return {
      code: 'requires_requote',
      message: 'A cotação expirou ou o livro mudou. Atualize a cotação e tente de novo.',
      requiresRequote: true,
    };
  }
  if (/closed|encerrad|resolved|voided|market is not open|estado.*open/.test(lower)) {
    return { code: 'market_closed', message: 'Este mercado não está aberto para novas ordens.', requiresRequote: false };
  }
  if (/paused|pausad/.test(lower)) {
    return { code: 'market_paused', message: 'Este mercado está pausado para revisão.', requiresRequote: false };
  }
  if (/insufficient.*(coin|balance)|saldo insuficiente|not enough.*coin|available.*balance/.test(lower)) {
    return { code: 'insufficient_balance', message: 'Saldo de moedas insuficiente para essa ordem.', requiresRequote: false };
  }
  if (/insufficient.*(share|position)|oversell|no oversell|posi[cç][aã]o insuficiente/.test(lower)) {
    return { code: 'insufficient_position', message: 'Você não tem posição suficiente para vender essa quantidade.', requiresRequote: false };
  }
  if (/whole.?coin|integer coin|fractional|lote inteiro|moeda inteira/.test(lower)) {
    return { code: 'whole_coin_required', message: 'A ordem precisa respeitar lotes de moeda inteira.', requiresRequote: false };
  }
  if (/risk|limit exceeded|rate limit|blocked|exposure|notional|open order limit/.test(lower)) {
    return { code: 'risk_blocked', message: 'A ordem foi bloqueada pelos limites de risco do mercado.', requiresRequote: false };
  }
  if (/duplicate|client_order_id|idempot/.test(lower)) {
    return { code: 'duplicate_order', message: 'Essa ordem já foi enviada. Confira o recibo antes de reenviar.', requiresRequote: false };
  }

  return { code: 'unknown', message: fallback, requiresRequote: false };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapQuote(row: unknown): OrderQuoteV2 {
  const r = asRecord(row);
  return {
    quoteId: String(r.quoteId ?? r.quote_id ?? ''),
    marketId: String(r.marketId ?? r.market_id ?? ''),
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    expiresAt: String(r.expiresAt ?? r.expires_at ?? ''),
    action: String(r.action) as ExchangeAction,
    outcome: String(r.outcome) as ExchangeOutcome,
    requestedLimitPrice: Number(r.requestedLimitPrice ?? r.requested_limit_price ?? 0),
    requestedQuantity: Number(r.requestedQuantity ?? r.requested_quantity ?? 0),
    estimatedFillableQuantity: Number(r.estimatedFillableQuantity ?? r.estimated_fillable_quantity ?? 0),
    estimatedAverageExecutionPrice: num(r.estimatedAverageExecutionPrice ?? r.estimated_average_execution_price),
    worstExecutionPrice: num(r.worstExecutionPrice ?? r.worst_execution_price),
    fees: Number(r.fees ?? 0),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
  };
}

function mapAmmQuote(row: unknown): AmmQuoteV2 {
  const r = asRecord(row);
  return {
    quoteId: String(r.quoteId ?? r.quote_id ?? ''),
    marketId: String(r.marketId ?? r.market_id ?? ''),
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    expiresAt: String(r.expiresAt ?? r.expires_at ?? ''),
    action: String(r.action) as ExchangeAction,
    outcome: String(r.outcome) as ExchangeOutcome,
    requestedQuantity: Number(r.requestedQuantity ?? r.requested_quantity ?? 0),
    unitPrice: Number(r.unitPrice ?? r.unit_price ?? 0),
    totalCoins: Number(r.totalCoins ?? r.total_coins ?? 0),
    curveDeltaCoins: Number(r.curveDeltaCoins ?? r.curve_delta_coins ?? 0),
    rounding: String(r.rounding ?? ''),
    priceImpact: Number(r.priceImpact ?? r.price_impact ?? 0),
    priceYesBefore: Number(r.priceYesBefore ?? r.price_yes_before ?? 0.5),
    priceYesAfter: Number(r.priceYesAfter ?? r.price_yes_after ?? 0.5),
    rawPriceYes: Number(r.rawPriceYes ?? r.raw_price_yes ?? 0),
    rawPriceNo: Number(r.rawPriceNo ?? r.raw_price_no ?? 0),
    rawPriceSum: Number(r.rawPriceSum ?? r.raw_price_sum ?? 0),
    bBefore: Number(r.bBefore ?? r.b_before ?? 0),
    bAfter: Number(r.bAfter ?? r.b_after ?? 0),
    estimatedFillableQuantity: Number(r.estimatedFillableQuantity ?? r.estimated_fillable_quantity ?? 0),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
  };
}

function mapPosition(row: unknown): ExchangePositionV2 {
  const r = asRecord(row);
  return {
    id: String(r.id ?? ''),
    userId: String(r.userId ?? r.user_id ?? ''),
    marketId: String(r.marketId ?? r.market_id ?? ''),
    outcome: String(r.outcome ?? 'true') as ExchangeOutcome,
    quantity: Number(r.quantity ?? 0),
    reservedSellQuantity: Number(r.reservedSellQuantity ?? r.reserved_sell_quantity ?? 0),
    costBasis: Number(r.costBasis ?? r.cost_basis ?? 0),
    averageEntryPrice: Number(r.averageEntryPrice ?? r.average_entry_price ?? 0),
    realizedPnl: Number(r.realizedPnl ?? r.realized_pnl ?? 0),
    feesPaid: Number(r.feesPaid ?? r.fees_paid ?? 0),
    settlementId: r.settlementId == null && r.settlement_id == null ? null : String(r.settlementId ?? r.settlement_id),
    settledAt: r.settledAt == null && r.settled_at == null ? null : String(r.settledAt ?? r.settled_at),
    settledQuantity: Number(r.settledQuantity ?? r.settled_quantity ?? 0),
    settlementPayout: Number(r.settlementPayout ?? r.settlement_payout ?? 0),
    version: Number(r.version ?? 0),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
  };
}

function mapLifecycle(row: unknown): ExchangeMarketLifecycleResult {
  const r = asRecord(row);
  return {
    marketId: String(r.marketId ?? r.market_id ?? ''),
    engineVersion: 'exchange_v2',
    state: String(r.state ?? 'draft') as ExchangeMarketState,
    closeAt: String(r.closeAt ?? r.close_at ?? ''),
    resolveByAt: r.resolveByAt == null && r.resolve_by_at == null ? null : String(r.resolveByAt ?? r.resolve_by_at),
    resolutionPolicy: String(r.resolutionPolicy ?? r.resolution_policy ?? 'evidence') as ExchangeResolutionPolicy,
    requiredSourceCount: Number(r.requiredSourceCount ?? r.required_source_count ?? 1),
    tickSize: Number(r.tickSize ?? r.tick_size ?? 0.01),
    quantityStep: Number(r.quantityStep ?? r.quantity_step ?? 0.000001),
    minOrderQuantity: Number(r.minOrderQuantity ?? r.min_order_quantity ?? 1),
    feeBps: Number(r.feeBps ?? r.fee_bps ?? 0),
    markProbability: Number(r.markProbability ?? r.mark_probability ?? r.markPrice ?? r.mark_price ?? 0.5),
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
  };
}

export async function promoteRumorToExchangeMarketV2(config: ExchangeMarketLifecycleConfig): Promise<ExchangeMarketLifecycleResult | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('promote_rumor_to_exchange_market_v2', {
    p_rumor_id: config.rumorId,
    p_close_at: config.closeAt,
    p_resolve_by_at: config.resolveByAt ?? null,
    p_resolution_policy: config.resolutionPolicy ?? 'evidence',
    p_required_source_count: config.requiredSourceCount ?? 2,
    p_tick_size: config.tickSize ?? '0.01000000',
    p_quantity_step: config.quantityStep ?? '0.000001',
    p_min_order_quantity: config.minOrderQuantity ?? '1.000000',
    p_opening_mark_price: config.openingMarkPrice ?? '0.50000000',
    p_fee_bps: config.feeBps ?? 0,
  });
  if (error || !data) return null;
  return mapLifecycle(data);
}

export async function openExchangeMarketV2(marketId: string): Promise<ExchangeMarketLifecycleResult | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('open_exchange_market_v2', { p_market_id: marketId });
  if (error || !data) return null;
  return mapLifecycle(data);
}

export async function closeExchangeMarketV2(marketId: string): Promise<ExchangeMarketLifecycleResult | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('close_exchange_market_v2', { p_market_id: marketId });
  if (error || !data) return null;
  return mapLifecycle(data);
}

export async function pauseExchangeMarketV2(input: ExchangeMarketControlInput): Promise<ExchangeMarketLifecycleResult | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('pause_exchange_market_v2', {
    p_market_id: input.marketId,
    p_reason: input.reason,
  });
  if (error || !data) return null;
  return mapLifecycle(data);
}

export async function resumeExchangeMarketV2(input: ExchangeMarketControlInput): Promise<ExchangeMarketLifecycleResult | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('resume_exchange_market_v2', {
    p_market_id: input.marketId,
    p_reason: input.reason,
  });
  if (error || !data) return null;
  return mapLifecycle(data);
}

export async function getMarketSnapshotV2(marketId: string): Promise<MarketSnapshotV2 | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_market_snapshot_v2', { p_market_id: marketId });
  if (error || !data) return null;
  const r = asRecord(data);
  return {
    marketId: String(r.marketId ?? r.market_id ?? marketId),
    engineVersion: 'exchange_v2',
    state: String(r.state ?? 'draft') as MarketSnapshotV2['state'],
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    markProbability: Number(r.markProbability ?? r.mark_probability ?? 0.5),
    lastTradePrice: num(r.lastTradePrice ?? r.last_trade_price),
    bestBid: num(r.bestBid ?? r.best_bid),
    bestAsk: num(r.bestAsk ?? r.best_ask),
    tickSize: Number(r.tickSize ?? r.tick_size ?? 0.01),
    quantityStep: Number(r.quantityStep ?? r.quantity_step ?? 0.000001),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ''),
  };
}

export async function quoteOrderV2(marketId: string, outcome: ExchangeOutcome, action: ExchangeAction, quantity: string, limitPrice: string): Promise<OrderQuoteV2 | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('quote_order_v2', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_action: action,
    p_quantity: quantity,
    p_limit_price: limitPrice,
  });
  if (error || !data) return null;
  return mapQuote(data);
}

export async function quoteCashOutV1(marketId: string, outcome: ExchangeOutcome, quantity: string): Promise<OrderQuoteV2 | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('quote_cash_out_v1', { p_market_id: marketId, p_outcome: outcome, p_quantity: quantity });
  if (error || !data) return null;
  return mapQuote(data);
}

export async function quoteAmmV2(marketId: string, outcome: ExchangeOutcome, action: ExchangeAction, quantity: string): Promise<AmmQuoteV2 | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('quote_amm_v2', {
    p_market_id: marketId,
    p_outcome: outcome,
    p_action: action,
    p_quantity: quantity,
  });
  if (error || !data) return null;
  return mapAmmQuote(data);
}

export async function executeAmmTradeV2(input: ExecuteAmmTradeV2Input): Promise<ExecuteAmmTradeV2Result> {
  if (!supabaseConfigured) return { ok: false, errorCode: EXCHANGE_UNAVAILABLE_ERROR.code, error: EXCHANGE_UNAVAILABLE_ERROR.message };
  if (!EXCHANGE_UUID_RE.test(input.marketId) || !EXCHANGE_UUID_RE.test(input.quoteId) || !isPositiveExchangeDecimal(input.quantity)) {
    return { ok: false, errorCode: 'invalid_order', error: 'Atualize a cotação da AMM antes de enviar a ordem.', requiresRequote: true };
  }
  const { data, error } = await supabase.rpc('execute_amm_trade_v2', {
    p_market_id: input.marketId,
    p_outcome: input.outcome,
    p_action: input.action,
    p_quantity: input.quantity,
    p_quote_id: input.quoteId,
    p_environment: input.environment ?? 'production',
  });
  if (error) {
    const normalized = normalizeExchangeV2Error(error, 'Não foi possível executar a ordem de mercado. Tente novamente.');
    return { ok: false, errorCode: normalized.code, error: normalized.message, requiresRequote: normalized.requiresRequote };
  }
  const r = asRecord(data);
  return {
    ok: true,
    marketId: String(r.marketId ?? r.market_id ?? input.marketId),
    quoteId: String(r.quoteId ?? r.quote_id ?? input.quoteId),
    action: String(r.action ?? input.action) as ExchangeAction,
    outcome: String(r.outcome ?? input.outcome) as ExchangeOutcome,
    quantity: Number(r.quantity ?? 0),
    totalCoins: Number(r.totalCoins ?? r.total_coins ?? 0),
    unitPrice: Number(r.unitPrice ?? r.unit_price ?? 0),
    curveDeltaCoins: Number(r.curveDeltaCoins ?? r.curve_delta_coins ?? 0),
    rounding: String(r.rounding ?? ''),
    priceYesBefore: Number(r.priceYesBefore ?? r.price_yes_before ?? 0.5),
    priceYesAfter: Number(r.priceYesAfter ?? r.price_yes_after ?? 0.5),
    bBefore: Number(r.bBefore ?? r.b_before ?? 0),
    bAfter: Number(r.bAfter ?? r.b_after ?? 0),
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    positionQuantity: Number(r.positionQuantity ?? r.position_quantity ?? 0),
    houseMintCapCoins: Number(r.houseMintCapCoins ?? r.house_mint_cap_coins ?? 0),
  };
}

export async function placeOrderV2(input: PlaceOrderV2Input): Promise<PlaceOrderV2Result> {
  if (!supabaseConfigured) return { ok: false, errorCode: EXCHANGE_UNAVAILABLE_ERROR.code, error: EXCHANGE_UNAVAILABLE_ERROR.message };
  const validation = validatePlaceOrderV2Input(input);
  if (!validation.ok) return validation;
  const { data, error } = await supabase.rpc('place_order_v2', {
    p_market_id: input.marketId,
    p_outcome: input.outcome,
    p_action: input.action,
    p_quantity: input.quantity,
    p_limit_price: input.limitPrice,
    p_time_in_force: input.timeInForce,
    p_client_order_id: input.clientOrderId,
    p_quote_id: input.quoteId,
    p_environment: input.environment ?? 'production',
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) {
    const normalized = normalizeExchangeV2Error(error, 'Não foi possível enviar a ordem. Tente novamente.');
    return { ok: false, errorCode: normalized.code, error: normalized.message, requiresRequote: normalized.requiresRequote };
  }
  const r = asRecord(data);
  return {
    ok: true,
    orderId: String(r.orderId ?? r.order_id ?? ''),
    status: String(r.status ?? 'open') as ExchangeOrderStatus,
    filledQuantity: Number(r.filledQuantity ?? r.filled_quantity ?? 0),
    remainingQuantity: Number(r.remainingQuantity ?? r.remaining_quantity ?? 0),
    actualAverageFillPrice: num(r.actualAverageFillPrice ?? r.actual_average_fill_price),
    fees: Number(r.fees ?? 0),
    reservationId: r.reservationId == null && r.reservation_id == null ? null : String(r.reservationId ?? r.reservation_id),
    reservationKind: r.reservationKind == null && r.reservation_kind == null ? null : String(r.reservationKind ?? r.reservation_kind) as ExchangeReservationKind,
    reservedCollateral: Number(r.reservedCollateral ?? r.reserved_collateral ?? 0),
    releasedCollateral: Number(r.releasedCollateral ?? r.released_collateral ?? 0),
    bookVersion: Number(r.bookVersion ?? r.book_version ?? 0),
    cashOutDisclosure: String(r.cashOutDisclosure ?? CASH_OUT_LIQUIDITY_DISCLOSURE),
  };
}

export async function sellPositionV1(input: Omit<PlaceOrderV2Input, 'action'>): Promise<PlaceOrderV2Result> {
  return placeOrderV2({ ...input, action: 'sell' });
}

export async function cancelOrderV1(orderId: string): Promise<{ ok: boolean; status?: ExchangeOrderStatus; releasedQuantity?: number; errorCode?: ExchangeClientErrorCode; error?: string }> {
  if (!supabaseConfigured) return { ok: false, errorCode: EXCHANGE_UNAVAILABLE_ERROR.code, error: EXCHANGE_UNAVAILABLE_ERROR.message };
  const { data, error } = await supabase.rpc('cancel_order_v1', { p_order_id: orderId });
  if (error) {
    const normalized = normalizeExchangeV2Error(error, 'Não foi possível cancelar a ordem. Tente novamente.');
    return { ok: false, errorCode: normalized.code, error: normalized.message };
  }
  const r = asRecord(data);
  return { ok: true, status: String(r.status ?? 'cancelled') as ExchangeOrderStatus, releasedQuantity: Number(r.releasedQuantity ?? r.released_quantity ?? 0) };
}

export async function expireOrderV1(orderId: string): Promise<{ ok: boolean; status?: ExchangeOrderStatus; errorCode?: ExchangeClientErrorCode; error?: string }> {
  if (!supabaseConfigured) return { ok: false, errorCode: EXCHANGE_UNAVAILABLE_ERROR.code, error: EXCHANGE_UNAVAILABLE_ERROR.message };
  const { data, error } = await supabase.rpc('expire_order_v1', { p_order_id: orderId });
  if (error) {
    const normalized = normalizeExchangeV2Error(error, 'Não foi possível expirar a ordem. Tente novamente.');
    return { ok: false, errorCode: normalized.code, error: normalized.message };
  }
  const r = asRecord(data);
  return { ok: true, status: String(r.status ?? 'expired') as ExchangeOrderStatus };
}

export async function getPortfolioV2(): Promise<ExchangePortfolioV2> {
  if (!supabaseConfigured) return { positions: [], cashOutDisclosure: CASH_OUT_LIQUIDITY_DISCLOSURE };
  const { data, error } = await supabase.rpc('get_portfolio_v2');
  if (error || !data) return { positions: [], cashOutDisclosure: CASH_OUT_LIQUIDITY_DISCLOSURE };
  const r = asRecord(data);
  const positions = Array.isArray(r.positions) ? r.positions.map(mapPosition) : [];
  return {
    positions,
    cashOutDisclosure: String(r.cashOutDisclosure ?? r.cash_out_disclosure ?? CASH_OUT_LIQUIDITY_DISCLOSURE),
  };
}

function mapTradeReceipt(row: unknown, fallbackOrderId = ''): TradeReceiptV1 {
  const r = asRecord(row);
  return {
    orderId: String(r.orderId ?? r.order_id ?? fallbackOrderId),
    marketId: String(r.marketId ?? r.market_id ?? ''),
    outcome: String(r.outcome) as ExchangeOutcome,
    action: String(r.action) as ExchangeAction,
    status: String(r.status) as ExchangeOrderStatus,
    coinsRequested: num(r.coinsRequested ?? r.coins_requested),
    sharesRequested: Number(r.sharesRequested ?? r.shares_requested ?? 0),
    sharesFilled: Number(r.sharesFilled ?? r.shares_filled ?? 0),
    sharesRemaining: Number(r.sharesRemaining ?? r.shares_remaining ?? 0),
    requestedLimitPrice: Number(r.requestedLimitPrice ?? r.requested_limit_price ?? 0),
    actualAverageFillPrice: num(r.actualAverageFillPrice ?? r.actual_average_fill_price),
    fees: Number(r.fees ?? 0),
    reservationId: r.reservationId == null && r.reservation_id == null ? null : String(r.reservationId ?? r.reservation_id),
    reservationKind: r.reservationKind == null && r.reservation_kind == null ? null : String(r.reservationKind ?? r.reservation_kind) as ExchangeReservationKind,
    reservedCollateral: Number(r.reservedCollateral ?? r.reserved_collateral ?? 0),
    releasedCollateral: Number(r.releasedCollateral ?? r.released_collateral ?? 0),
    orderTimestamp: String(r.orderTimestamp ?? r.order_timestamp ?? ''),
    cashOutDisclosure: String(r.cashOutDisclosure ?? CASH_OUT_LIQUIDITY_DISCLOSURE),
  };
}

export async function getTradeReceiptV1(orderId: string): Promise<TradeReceiptV1 | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('get_trade_receipt_v1', { p_order_id: orderId });
  if (error || !data) return null;
  return mapTradeReceipt(data, orderId);
}

export async function getTradeReceiptByClientOrderIdV1(clientOrderId: string): Promise<TradeReceiptV1 | null> {
  if (!supabaseConfigured || !isValidExchangeClientOrderId(clientOrderId)) return null;
  const { data: order, error: orderError } = await supabase
    .from('exchange_orders')
    .select('id')
    .eq('client_order_id', clientOrderId)
    .maybeSingle();
  if (orderError || !order?.id) return null;
  return getTradeReceiptV1(String(order.id));
}

export async function placeOrderWithReceiptV1(input: PlaceOrderV2Input): Promise<PlaceOrderWithReceiptV1Result> {
  const order = await placeOrderV2(input);

  if (order.ok && order.orderId) {
    return {
      order,
      receipt: await getTradeReceiptV1(order.orderId),
      duplicateRecovered: false,
    };
  }

  if (isDuplicateExchangeOrderResult(order)) {
    return {
      order,
      receipt: await getTradeReceiptByClientOrderIdV1(input.clientOrderId),
      duplicateRecovered: true,
    };
  }

  return { order, receipt: null, duplicateRecovered: false };
}
