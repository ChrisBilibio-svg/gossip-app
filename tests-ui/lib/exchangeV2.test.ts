jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
  supabaseConfigured: true,
}));

import {
  CASH_OUT_LIQUIDITY_DISCLOSURE,
  getMarketSnapshotV2,
  quoteOrderV2,
  quoteCashOutV1,
  placeOrderV2,
  sellPositionV1,
  cancelOrderV1,
  getTradeReceiptV1,
} from '../../src/lib/exchangeV2';
import { supabase } from '../../src/lib/supabase';

const mockRpc = supabase.rpc as jest.Mock;
const MARKET_ID = '11111111-1111-4111-8111-111111111111';
const BUY_QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const SELL_QUOTE_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => mockRpc.mockReset());

test('maps v2 market snapshot with distinct mark, bid, ask, and last trade fields', async () => {
  mockRpc.mockResolvedValueOnce({
    data: { marketId: MARKET_ID, state: 'open', bookVersion: 7, markProbability: 0.55, lastTradePrice: 0.54, bestBid: 0.53, bestAsk: 0.57, tickSize: 0.01, quantityStep: 0.000001, updatedAt: '2026-07-30T00:00:00Z' },
    error: null,
  });
  await expect(getMarketSnapshotV2(MARKET_ID)).resolves.toMatchObject({ markProbability: 0.55, bestBid: 0.53, bestAsk: 0.57, lastTradePrice: 0.54 });
  expect(mockRpc).toHaveBeenCalledWith('get_market_snapshot_v2', { p_market_id: MARKET_ID });
});

test('quote wrappers expose execution estimates and liquidity warnings without treating them as fills', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: { quoteId: BUY_QUOTE_ID, marketId: MARKET_ID, bookVersion: 7, expiresAt: '2026-07-30T00:00:20Z', action: 'buy', outcome: 'true', requestedLimitPrice: 0.6, requestedQuantity: 10, estimatedFillableQuantity: 4, estimatedAverageExecutionPrice: 0.58, worstExecutionPrice: 0.6, fees: 0, warnings: ['parcial'] }, error: null })
    .mockResolvedValueOnce({ data: { quoteId: SELL_QUOTE_ID, marketId: MARKET_ID, bookVersion: 8, expiresAt: '2026-07-30T00:00:20Z', action: 'sell', outcome: 'false', requestedLimitPrice: 0.42, requestedQuantity: 3, estimatedFillableQuantity: 0, fees: 0, warnings: ['Sem liquidez suficiente agora'] }, error: null });

  await expect(quoteOrderV2(MARKET_ID, 'true', 'buy', '10', '0.60')).resolves.toMatchObject({ quoteId: BUY_QUOTE_ID, estimatedFillableQuantity: 4, worstExecutionPrice: 0.6 });
  await expect(quoteCashOutV1(MARKET_ID, 'false', '3')).resolves.toMatchObject({ quoteId: SELL_QUOTE_ID, action: 'sell', warnings: [expect.stringMatching(/liquidez/i)] });
});

test('placement maps stale quote errors to requote and sell uses liquidity disclosure', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { message: 'quote expired or stale; requote required' } })
    .mockResolvedValueOnce({ data: { orderId: 'o2', status: 'open', filledQuantity: 0, remainingQuantity: 5, fees: 0, bookVersion: 9, cashOutDisclosure: CASH_OUT_LIQUIDITY_DISCLOSURE }, error: null });

  await expect(placeOrderV2({ marketId: MARKET_ID, outcome: 'true', action: 'buy', quantity: '5', limitPrice: '0.60', timeInForce: 'GTC', clientOrderId: 'client-order-1', quoteId: BUY_QUOTE_ID })).resolves.toMatchObject({ ok: false, requiresRequote: true });
  await expect(sellPositionV1({ marketId: MARKET_ID, outcome: 'true', quantity: '5', limitPrice: '0.50', timeInForce: 'GTC', clientOrderId: 'client-order-2', quoteId: SELL_QUOTE_ID })).resolves.toMatchObject({ ok: true, orderId: 'o2', cashOutDisclosure: CASH_OUT_LIQUIDITY_DISCLOSURE });
  expect(mockRpc).toHaveBeenLastCalledWith('place_order_v2', expect.objectContaining({ p_action: 'sell' }));
});

test('cancel and receipt wrappers expose authoritative order state and actual average fill', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: { orderId: 'o1', status: 'cancelled', releasedQuantity: 2 }, error: null })
    .mockResolvedValueOnce({ data: { orderId: 'o1', marketId: 'm1', outcome: 'true', action: 'buy', status: 'partially_filled', coinsRequested: 10, sharesRequested: 20, sharesFilled: 12, sharesRemaining: 8, requestedLimitPrice: 0.5, actualAverageFillPrice: 0.49, fees: 0, orderTimestamp: '2026-07-30T00:00:00Z', cashOutDisclosure: CASH_OUT_LIQUIDITY_DISCLOSURE }, error: null });

  await expect(cancelOrderV1('o1')).resolves.toMatchObject({ ok: true, status: 'cancelled', releasedQuantity: 2 });
  await expect(getTradeReceiptV1('o1')).resolves.toMatchObject({ status: 'partially_filled', actualAverageFillPrice: 0.49, sharesRemaining: 8 });
});
