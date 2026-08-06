import { supabase, supabaseConfigured } from './supabase';
import { isMissingRpcError } from './rpcFallback';
import type { Choice } from './predictions';

export type WalletTransactionType =
  | 'STARTER_GRANT'
  | 'FREE_RECOVERY'
  | 'PRO_RECOVERY'
  | 'PRO_UPFRONT'
  | 'PRO_DAILY'
  | 'PACK_PURCHASE'
  | 'PREDICTION_STAKE'
  | 'PREDICTION_WIN_RETURN'
  | 'PREDICTION_VOID_REFUND'
  | 'NON_BET_SINK'
  | 'ADMIN_ADJUSTMENT';

export interface EconomyState {
  featureEnabled: boolean;
  economyConfigVersion: number | null;
  balance: number;
  currencyType: 'COIN';
  isPro: boolean;
  proStatus: string | null;
  proExpiresAt: string | null;
  nextGrantAt: string | null;
  purchasesKilled: boolean;
  predictionPlacementKilled: boolean;
  standardStakeCoins: number;
  quickStakeCoins: number[];
  recommendedWalletFraction: number;
  maxWalletFraction: number;
  absoluteMaxStakeCoins: number;
  legalCopy: string;
}

export interface CoinStoreProduct {
  id: 'coins_125' | 'coins_750' | 'coins_1650' | 'pro_monthly_v1';
  title: string;
  coins: number;
  benchmarkUsd: string;
  localizedPrice: string | null;
  subscription: boolean;
  description: string;
}

export interface WalletTransaction {
  id: string;
  transactionType: WalletTransactionType;
  signedAmount: number;
  balanceAfter: number;
  currencyType: 'COIN';
  sourceReference: string;
  economyConfigVersion: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FixedMarketOutcomeQuote {
  quoteId?: string;
  rumorId: string;
  probabilityVersion: number;
  outcomeId: string;
  outcomeKey: Choice;
  label: string;
  probability: number;
  decimalOdds: number;
  economyConfigVersion: number;
  expiresAt?: string;
}

export interface PlaceFixedPredictionInput {
  rumorId: string;
  choice: Choice;
  stakeCoins: number;
  probabilityVersion: number;
  quoteId?: string;
  idempotencyKey: string;
}

export interface PlaceFixedPredictionResult {
  ok: boolean;
  positionId?: string;
  alreadyPlaced?: boolean;
  quoteChanged?: boolean;
  error?: string;
}

export interface FixedPosition {
  id: string;
  marketId: string;
  question: string;
  outcomeKey: Choice;
  stakeCoins: number;
  lockedProbability: number;
  lockedDecimalOdds: number;
  potentialTotalReturnCoins: number;
  potentialNetWinCoins: number;
  actualReturnCoins: number | null;
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  marketStatus: string;
  placedAt: string;
  settledAt: string | null;
  settlementReference: string | null;
}

export interface StakeLimits {
  recommendedStake: number;
  hardMaxStake: number;
  reserveWarning: boolean;
  reserveWarningReason: 'large_order' | 'low_remaining_reserve' | null;
}

export const CLOSED_LOOP_COIN_COPY =
  'Moedas são entretenimento fechado: não têm valor em dinheiro, não podem ser sacadas, vendidas, transferidas, trocadas por cripto ou usadas para prêmios reais.';

export const DEFAULT_DISABLED_ECONOMY_STATE: EconomyState = {
  featureEnabled: false,
  economyConfigVersion: null,
  balance: 0,
  currencyType: 'COIN',
  isPro: false,
  proStatus: null,
  proExpiresAt: null,
  nextGrantAt: null,
  purchasesKilled: true,
  predictionPlacementKilled: true,
  standardStakeCoins: 100,
  quickStakeCoins: [50, 100, 250],
  recommendedWalletFraction: 0.05,
  maxWalletFraction: 0.1,
  absoluteMaxStakeCoins: 500,
  legalCopy: CLOSED_LOOP_COIN_COPY,
};

export const COIN_STORE_PRODUCTS: CoinStoreProduct[] = [
  { id: 'coins_125', title: '125 moedas', coins: 125, benchmarkUsd: 'US$ 0,99', localizedPrice: null, subscription: false, description: 'Pacote único disponível para usuários grátis e Pro.' },
  { id: 'coins_750', title: '750 moedas', coins: 750, benchmarkUsd: 'US$ 4,99', localizedPrice: null, subscription: false, description: 'Pacote único disponível para usuários grátis e Pro.' },
  { id: 'coins_1650', title: '1.650 moedas', coins: 1650, benchmarkUsd: 'US$ 9,99', localizedPrice: null, subscription: false, description: 'Pacote único disponível para usuários grátis e Pro.' },
  { id: 'pro_monthly_v1', title: 'Viddi Pro', coins: 1500, benchmarkUsd: 'US$ 4,99/mês', localizedPrice: null, subscription: true, description: '300 moedas agora + 40 por dia por 30 dias = 1.500 moedas programadas.' },
];

export function offeredDecimalOdds(probability: number, houseEdge = 0.05, storagePrecision = 4): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) throw new Error('Invalid probability');
  if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 1) throw new Error('Invalid house edge');
  const factor = 10 ** storagePrecision;
  return Math.round(((1 - houseEdge) / probability) * factor) / factor;
}

export function potentialReturns(stakeCoins: number, lockedDecimalOdds: number): { totalReturn: number; netWin: number } {
  if (!Number.isInteger(stakeCoins) || stakeCoins <= 0) throw new Error('Invalid stake');
  if (!Number.isFinite(lockedDecimalOdds) || lockedDecimalOdds <= 0) throw new Error('Invalid odds');
  const totalReturn = Math.floor(stakeCoins * lockedDecimalOdds);
  return { totalReturn, netWin: totalReturn - stakeCoins };
}

export function stakeLimits(walletBalance: number, recommendedWalletFraction = 0.05, maxWalletFraction = 0.1, absoluteMaxStakeCoins = 500): StakeLimits {
  const balance = Math.max(0, Math.floor(walletBalance));
  const recommendedStake = Math.floor(balance * recommendedWalletFraction);
  const hardMaxStake = Math.min(absoluteMaxStakeCoins, Math.floor(balance * maxWalletFraction));
  return { recommendedStake, hardMaxStake, reserveWarning: false, reserveWarningReason: null };
}

export function reserveWarningForStake(stakeCoins: number, walletBalance: number, largeOrderFraction = 0.25, minimumReserveCoins = 25): StakeLimits['reserveWarningReason'] {
  if (!Number.isInteger(stakeCoins) || stakeCoins <= 0) return null;
  const balance = Math.max(0, Math.floor(walletBalance));
  if (balance <= 0 || stakeCoins > balance) return null;
  if (stakeCoins / balance > largeOrderFraction) return 'large_order';
  if (balance - stakeCoins < minimumReserveCoins) return 'low_remaining_reserve';
  return null;
}

export function reserveWarningCopy(reason: StakeLimits['reserveWarningReason']): string | null {
  if (reason === 'large_order') return 'Esse pedido usa mais de 25% das suas moedas. Confira antes de confirmar.';
  if (reason === 'low_remaining_reserve') return 'Esse pedido deixa poucas moedas livres para próximos mercados.';
  return null;
}

export function validateStake(stakeCoins: number, walletBalance: number, limits: StakeLimits, absoluteMaxStakeCoins = 500): string | null {
  if (!Number.isInteger(stakeCoins) || stakeCoins <= 0) return 'Escolha uma quantidade inteira e positiva de moedas.';
  if (stakeCoins > walletBalance) return `Saldo insuficiente: precisa de ${stakeCoins}, disponível ${walletBalance}.`;
  if (stakeCoins > limits.hardMaxStake) return 'Aposta acima do limite de proteção da banca.';
  if (stakeCoins > absoluteMaxStakeCoins) return 'Aposta acima do limite absoluto.';
  return null;
}

export function walletTransactionLabel(type: WalletTransactionType, amount: number): string {
  switch (type) {
    case 'STARTER_GRANT': return 'Bônus inicial';
    case 'FREE_RECOVERY': return 'Recarga de recuperação grátis';
    case 'PRO_RECOVERY': return 'Piso diário Pro';
    case 'PRO_UPFRONT': return 'Moedas imediatas do Pro';
    case 'PRO_DAILY': return 'Moedas diárias do Pro';
    case 'PACK_PURCHASE': return 'Pacote de moedas verificado';
    case 'PREDICTION_STAKE': return 'Stake em previsão';
    case 'PREDICTION_WIN_RETURN': return 'Retorno de previsão vencedora';
    case 'PREDICTION_VOID_REFUND': return 'Reembolso de mercado anulado';
    case 'NON_BET_SINK': return amount < 0 ? 'Uso cosmético' : 'Crédito não apostável';
    case 'ADMIN_ADJUSTMENT': return 'Ajuste administrativo';
    default: return 'Movimento de carteira';
  }
}

export function noCashValueReminder(): string {
  return CLOSED_LOOP_COIN_COPY;
}

function mapEconomyRow(row: Record<string, unknown> | null | undefined): EconomyState {
  if (!row) return DEFAULT_DISABLED_ECONOMY_STATE;
  return {
    featureEnabled: Boolean(row.feature_enabled),
    economyConfigVersion: typeof row.economy_config_version === 'number' ? row.economy_config_version : null,
    balance: Number(row.balance ?? 0),
    currencyType: 'COIN',
    isPro: Boolean(row.is_pro),
    proStatus: row.pro_status == null ? null : String(row.pro_status),
    proExpiresAt: row.pro_expires_at == null ? null : String(row.pro_expires_at),
    nextGrantAt: row.next_grant_at == null ? null : String(row.next_grant_at),
    purchasesKilled: Boolean(row.purchases_killed),
    predictionPlacementKilled: Boolean(row.prediction_placement_killed),
    standardStakeCoins: Number(row.standard_stake_coins ?? 100),
    quickStakeCoins: Array.isArray(row.quick_stake_coins) ? row.quick_stake_coins.map(Number) : [50, 100, 250],
    recommendedWalletFraction: Number(row.recommended_wallet_fraction ?? 0.05),
    maxWalletFraction: Number(row.max_wallet_fraction ?? 0.1),
    absoluteMaxStakeCoins: Number(row.absolute_max_stake_coins ?? 500),
    legalCopy: String(row.legal_copy ?? CLOSED_LOOP_COIN_COPY),
  };
}

export async function getCoinEconomyState(): Promise<EconomyState> {
  if (!supabaseConfigured) return DEFAULT_DISABLED_ECONOMY_STATE;
  const { data, error } = await supabase.rpc('get_coin_economy_state');
  if (error) return DEFAULT_DISABLED_ECONOMY_STATE;
  return mapEconomyRow(Array.isArray(data) ? data[0] : data);
}

export async function getWalletHistory(limit = 50): Promise<WalletTransaction[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_wallet_history', { p_limit: limit, p_before: null });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), transactionType: row.transaction_type as WalletTransactionType, signedAmount: Number(row.signed_amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0), currencyType: 'COIN', sourceReference: String(row.source_reference ?? ''),
    economyConfigVersion: Number(row.economy_config_version ?? 0), metadata: (row.metadata as Record<string, unknown>) ?? {}, createdAt: String(row.created_at ?? ''),
  }));
}

function mapQuote(row: Record<string, unknown>): FixedMarketOutcomeQuote {
  return {
    quoteId: row.quote_id == null ? undefined : String(row.quote_id),
    rumorId: String(row.rumor_id),
    probabilityVersion: Number(row.probability_version),
    outcomeId: String(row.outcome_id),
    outcomeKey: row.outcome_key as Choice,
    label: String(row.label),
    probability: Number(row.probability),
    decimalOdds: Number(row.decimal_odds),
    economyConfigVersion: Number(row.economy_config_version),
    expiresAt: row.expires_at == null ? undefined : String(row.expires_at),
  };
}

export async function getFixedMarketQuote(rumorId: string): Promise<FixedMarketOutcomeQuote[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_fixed_market_quote', { p_rumor_id: rumorId });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapQuote);
}

export async function requestFixedPredictionQuote(rumorId: string, choice: Choice): Promise<FixedMarketOutcomeQuote | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase.rpc('request_fixed_prediction_quote', { p_rumor_id: rumorId, p_choice: choice });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapQuote(row as Record<string, unknown>) : null;
}

export async function placeFixedPrediction(input: PlaceFixedPredictionInput): Promise<PlaceFixedPredictionResult> {
  const { data, error } = await supabase.rpc('place_fixed_prediction', {
    p_rumor_id: input.rumorId,
    p_choice: input.choice,
    p_stake_coins: input.stakeCoins,
    p_probability_version: input.probabilityVersion,
    p_idempotency_key: input.idempotencyKey,
    p_quote_id: input.quoteId ?? null,
  });
  if (error) {
    if (error.code === '23505' || /duplicate|unique|already exists/i.test(error.message)) return { ok: false, alreadyPlaced: true, error: 'Você já tem posição nesse mercado 🔒' };
    if (/quote|expired|changed/i.test(error.message)) return { ok: false, quoteChanged: true, error: 'As odds mudaram ou a cotação expirou. Revise o novo retorno.' };
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, positionId: row?.id ? String(row.id) : undefined };
}

export async function getMyFixedPositions(limit = 50): Promise<FixedPosition[]> {
  if (!supabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_my_fixed_positions', { p_limit: limit });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    marketId: String(row.market_id),
    question: String(row.question ?? ''),
    outcomeKey: row.outcome_key as Choice,
    stakeCoins: Number(row.stake_coins ?? 0),
    lockedProbability: Number(row.locked_probability ?? 0),
    lockedDecimalOdds: Number(row.locked_decimal_odds ?? 0),
    potentialTotalReturnCoins: Number(row.potential_total_return_coins ?? 0),
    potentialNetWinCoins: Number(row.potential_net_win_coins ?? 0),
    actualReturnCoins: row.actual_return_coins == null ? null : Number(row.actual_return_coins),
    status: row.status as FixedPosition['status'],
    marketStatus: String(row.market_status ?? ''),
    placedAt: String(row.placed_at ?? ''),
    settledAt: row.settled_at == null ? null : String(row.settled_at),
    settlementReference: row.settlement_reference == null ? null : String(row.settlement_reference),
  }));
}
