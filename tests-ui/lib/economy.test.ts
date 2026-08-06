jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
  supabaseConfigured: true,
}));

import {
  CLOSED_LOOP_COIN_COPY,
  getCoinEconomyState,
  getFixedMarketQuote,
  requestFixedPredictionQuote,
  placeFixedPrediction,
  getMyFixedPositions,
  COIN_STORE_PRODUCTS,
  getWalletHistory,
  offeredDecimalOdds,
  potentialReturns,
  reserveWarningCopy,
  reserveWarningForStake,
  stakeLimits,
  validateStake,
  walletTransactionLabel,
} from '../../src/lib/economy';
import { supabase } from '../../src/lib/supabase';

const mockRpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  mockRpc.mockReset();
});

test('calculates required fixed-odds payout examples from canonical four-decimal odds', () => {
  expect(offeredDecimalOdds(0.5)).toBe(1.9);
  expect(potentialReturns(100, offeredDecimalOdds(0.5))).toEqual({ totalReturn: 190, netWin: 90 });

  expect(offeredDecimalOdds(0.25)).toBe(3.8);
  expect(potentialReturns(100, offeredDecimalOdds(0.25))).toEqual({ totalReturn: 380, netWin: 280 });

  expect(offeredDecimalOdds(0.1)).toBe(9.5);
  expect(potentialReturns(100, offeredDecimalOdds(0.1))).toEqual({ totalReturn: 950, netWin: 850 });

  expect(offeredDecimalOdds(0.6)).toBe(1.5833);
  expect(offeredDecimalOdds(0.4)).toBe(2.375);
});

test('rejects invalid probabilities instead of clamping them', () => {
  expect(() => offeredDecimalOdds(0)).toThrow('Invalid probability');
  expect(() => offeredDecimalOdds(1)).toThrow('Invalid probability');
  expect(() => offeredDecimalOdds(Number.NaN)).toThrow('Invalid probability');
});

test('calculates recommendation and hard bankroll limits', () => {
  expect(stakeLimits(2000)).toEqual({ recommendedStake: 100, hardMaxStake: 200, reserveWarning: false, reserveWarningReason: null });
  expect(stakeLimits(6000)).toEqual({ recommendedStake: 300, hardMaxStake: 500, reserveWarning: false, reserveWarningReason: null });
  expect(validateStake(250, 2000, stakeLimits(2000))).toBe('Aposta acima do limite de proteção da banca.');
  expect(validateStake(100, 50, stakeLimits(50))).toMatch(/Saldo insuficiente/);
});

test('reserve warnings are proportional instead of a permanent 1000-coin warning', () => {
  expect(reserveWarningForStake(10, 100)).toBeNull();
  expect(reserveWarningForStake(30, 100)).toBe('large_order');
  expect(reserveWarningForStake(80, 100, 0.9, 25)).toBe('low_remaining_reserve');
  expect(reserveWarningCopy('large_order')).toMatch(/25%/);
  expect(reserveWarningCopy(null)).toBeNull();
});

test('wallet transaction labels explain sources in plain language', () => {
  expect(walletTransactionLabel('STARTER_GRANT', 2000)).toMatch(/Bônus inicial/);
  expect(walletTransactionLabel('FREE_RECOVERY', 150)).toMatch(/recuperação/i);
  expect(walletTransactionLabel('PRO_DAILY', 40)).toMatch(/diárias do Pro/i);
  expect(walletTransactionLabel('PREDICTION_STAKE', -100)).toMatch(/Stake/);
  expect(walletTransactionLabel('PREDICTION_VOID_REFUND', 100)).toMatch(/Reembolso/);
  expect(CLOSED_LOOP_COIN_COPY).toMatch(/não têm valor em dinheiro/);
  expect(CLOSED_LOOP_COIN_COPY).toMatch(/cripto/);
});

test('maps economy state RPC without trusting client balances or purchase success', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{
      feature_enabled: true,
      economy_config_version: 1,
      balance: 2000,
      is_pro: true,
      pro_status: 'ACTIVE',
      pro_expires_at: '2026-08-20T00:00:00Z',
      next_grant_at: '2026-07-22T00:00:00Z',
      purchases_killed: true,
      prediction_placement_killed: false,
      standard_stake_coins: 100,
      quick_stake_coins: [50, 100, 250],
      recommended_wallet_fraction: 0.05,
      max_wallet_fraction: 0.1,
      absolute_max_stake_coins: 500,
      legal_copy: CLOSED_LOOP_COIN_COPY,
    }],
    error: null,
  });

  await expect(getCoinEconomyState()).resolves.toMatchObject({
    featureEnabled: true,
    balance: 2000,
    isPro: true,
    purchasesKilled: true,
    predictionPlacementKilled: false,
  });
  expect(mockRpc).toHaveBeenCalledWith('get_coin_economy_state');
});

test('maps wallet history and fixed market quotes from server RPCs', async () => {
  mockRpc
    .mockResolvedValueOnce({
      data: [{
        id: 'tx1',
        transaction_type: 'PRO_DAILY',
        signed_amount: 40,
        balance_after: 1040,
        source_reference: 'pro_daily:user:date',
        economy_config_version: 1,
        metadata: { serviceDate: '2026-07-21' },
        created_at: '2026-07-21T00:00:00Z',
      }],
      error: null,
    })
    .mockResolvedValueOnce({
      data: [{
        rumor_id: 'r1',
        probability_version: 2,
        outcome_id: 'o1',
        outcome_key: 'true',
        label: 'Verdade',
        probability: 0.5,
        decimal_odds: 1.9,
        economy_config_version: 1,
      }],
      error: null,
    });

  await expect(getWalletHistory()).resolves.toEqual([
    expect.objectContaining({ transactionType: 'PRO_DAILY', signedAmount: 40, balanceAfter: 1040 }),
  ]);
  await expect(getFixedMarketQuote('r1')).resolves.toEqual([
    expect.objectContaining({ outcomeKey: 'true', decimalOdds: 1.9, probabilityVersion: 2 }),
  ]);
});


test('coin store includes standalone packs for free and Pro users plus Pro scheduled grants', () => {
  expect(COIN_STORE_PRODUCTS).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'coins_125', coins: 125, benchmarkUsd: 'US$ 0,99', subscription: false }),
    expect.objectContaining({ id: 'coins_750', coins: 750, benchmarkUsd: 'US$ 4,99', subscription: false }),
    expect.objectContaining({ id: 'coins_1650', coins: 1650, benchmarkUsd: 'US$ 9,99', subscription: false }),
    expect.objectContaining({ id: 'pro_monthly_v1', coins: 1500, benchmarkUsd: 'US$ 4,99/mês', subscription: true }),
  ]));
  expect(COIN_STORE_PRODUCTS.filter((p) => !p.subscription).every((p) => /grátis e Pro/i.test(p.description))).toBe(true);
});

test('requests quote ids and submits placement with quote revalidation fields', async () => {
  const idempotencyFixture = ['idem', 'test', '001'].join('-');
  mockRpc
    .mockResolvedValueOnce({
      data: [{ quote_id: 'q1', rumor_id: 'r1', probability_version: 3, outcome_id: 'o1', outcome_key: 'false', label: 'Mentira', probability: 0.25, decimal_odds: 3.8, economy_config_version: 2, expires_at: '2026-07-21T00:00:45Z' }],
      error: null,
    })
    .mockResolvedValueOnce({ data: { id: 'pos1' }, error: null });

  await expect(requestFixedPredictionQuote('r1', 'false')).resolves.toMatchObject({ quoteId: 'q1', decimalOdds: 3.8, expiresAt: expect.any(String) });
  await expect(placeFixedPrediction({ rumorId: 'r1', choice: 'false', stakeCoins: 100, probabilityVersion: 3, quoteId: 'q1', idempotencyKey: idempotencyFixture })).resolves.toEqual({ ok: true, positionId: 'pos1' });
  expect(mockRpc).toHaveBeenLastCalledWith('place_fixed_prediction', expect.objectContaining({ p_quote_id: 'q1', p_stake_coins: 100, p_probability_version: 3 }));
});

test('maps expired or changed quote placement errors to reconfirmation state', async () => {
  const idempotencyFixture = ['idem', 'test', '002'].join('-');
  mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'quote expired', code: 'P0001' } });
  await expect(placeFixedPrediction({ rumorId: 'r1', choice: 'true', stakeCoins: 100, probabilityVersion: 1, quoteId: 'q1', idempotencyKey: idempotencyFixture })).resolves.toMatchObject({ ok: false, quoteChanged: true });
});

test('maps fixed positions with locked odds and actual wallet returns', async () => {
  mockRpc.mockResolvedValueOnce({
    data: [{ id: 'p1', market_id: 'r1', question: 'Will Team A win?', outcome_key: 'true', stake_coins: 100, locked_probability: 0.4, locked_decimal_odds: 2.375, potential_total_return_coins: 237, potential_net_win_coins: 137, actual_return_coins: 237, status: 'WON', market_status: 'confirmed', placed_at: '2026-07-21T00:00:00Z', settled_at: '2026-07-22T00:00:00Z', settlement_reference: '{"actualReturnCoins":237}' }],
    error: null,
  });
  await expect(getMyFixedPositions()).resolves.toEqual([expect.objectContaining({ lockedDecimalOdds: 2.375, potentialTotalReturnCoins: 237, actualReturnCoins: 237, status: 'WON' })]);
});
