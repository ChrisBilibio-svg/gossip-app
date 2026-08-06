/**
 * FeedScreen market odds regression. Coin markets must show odds before any user
 * interaction, and Yes/No actions must open coin trading instead of submitting
 * a separate free vote.
 */
jest.mock('../../src/lib/rumors', () => {
  const actual = jest.requireActual('../../src/lib/rumors');
  return {
    ...actual,
    fetchFeed: jest.fn(),
    getRumorById: jest.fn(),
    formatDate: jest.fn(() => '01/06'),
    formatDateTime: jest.fn(() => '01/06 12:00'),
    formatDeadline: jest.fn(() => '01/06'),
  };
});
jest.mock('../../src/lib/predictions', () => ({
  getMyChoice: jest.fn(),
  placeBet: jest.fn(),
}));
jest.mock('../../src/lib/profile', () => ({
  getMyHandle: jest.fn(),
}));
jest.mock('../../src/lib/economy', () => {
  const actual = jest.requireActual('../../src/lib/economy');
  return {
    ...actual,
    getCoinEconomyState: jest.fn(),
    requestFixedPredictionQuote: jest.fn(),
    placeFixedPrediction: jest.fn(),
  };
});
jest.mock('../../src/lib/reactions', () => {
  const actual = jest.requireActual('../../src/lib/reactions');
  return {
    ...actual,
    setRumorReaction: jest.fn(),
  };
});
jest.mock('../../src/lib/social', () => ({
  createRepost: jest.fn(),
}));
jest.mock('../../src/components/CommentSection', () => () => null);

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FeedScreen from '../../src/screens/FeedScreen';
import type { Rumor } from '../../src/lib/rumors';
import { fetchFeed } from '../../src/lib/rumors';
import { getMyChoice, placeBet } from '../../src/lib/predictions';
import { getMyHandle } from '../../src/lib/profile';
import { getCoinEconomyState, requestFixedPredictionQuote } from '../../src/lib/economy';

const mockFetchFeed = fetchFeed as jest.Mock;
const mockGetMyChoice = getMyChoice as jest.Mock;
const mockPlaceBet = placeBet as jest.Mock;
const mockGetMyHandle = getMyHandle as jest.Mock;
const mockEconomy = getCoinEconomyState as jest.Mock;
const mockQuote = requestFixedPredictionQuote as jest.Mock;

function makeRumor(overrides: Partial<Rumor> = {}): Rumor {
  const { category = null, ...rest } = overrides;
  return {
    id: 'rumor-1',
    summary: 'Bruna vai lançar música nova?',
    article: null,
    status: 'speculated',
    isHero: false,
    sourceUrl: null,
    predictionDeadline: '2026-06-08T00:00:00Z',
    resolutionPolicy: 'deadline',
    requiredSourceCount: 2,
    evidenceSources: [],
    createdAt: '2026-06-01T00:00:00Z',
    resolvedAt: null,
    trueTotal: 15,
    falseTotal: 5,
    myChoice: null,
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    sourceCount: 1,
    oddsHistory: [75, 76],
    updatesRumor: null,
    myReaction: null,
    ...rest,
    category: category ?? null,
  };
}

beforeEach(() => {
  const staleRumor = makeRumor();
  mockFetchFeed.mockReset().mockResolvedValue({ rumors: [staleRumor], error: null });
  mockGetMyChoice.mockReset().mockResolvedValue(null);
  mockGetMyHandle.mockReset().mockResolvedValue('fofoqueiro');
  mockPlaceBet.mockReset().mockResolvedValue({ ok: true });
  mockEconomy.mockReset().mockResolvedValue({
    featureEnabled: true,
    predictionPlacementKilled: false,
    subscriptionPurchasesKilled: false,
    walletGrantsKilled: false,
    balance: 2000,
    proActive: false,
    standardStakeCoins: 100,
    quickStakeCoins: [50, 100, 250],
    minStakeCoins: 50,
    absoluteMaxStakeCoins: 500,
    recommendedWalletFraction: 0.05,
    maxWalletFraction: 0.1,
    quoteTtlSeconds: 30,
  });
  mockQuote.mockReset().mockResolvedValue({
    outcome: 'true',
    probability: 0.75,
    decimalOdds: 1.266666,
    probabilityVersion: 1,
    quoteId: 'quote-1',
    expiresAt: '2026-06-01T00:00:30Z',
  });
});

test('open feed cards show odds before trading and cannot submit a free vote', async () => {
  await render(<FeedScreen />);

  expect(await screen.findByText('Bruna vai lançar música nova?')).toBeTruthy();
  expect(screen.getByText('VERDADE')).toBeTruthy();
  expect(screen.getByText('MENTIRA')).toBeTruthy();
  expect(screen.getByText('Retorno atual: 1.27x')).toBeTruthy();
  expect(screen.getByText('Retorno atual: 3.80x')).toBeTruthy();
  expect(screen.getByText('20 volume negociado · 1 fonte')).toBeTruthy();
  expect(screen.getByText('Moedas não têm valor em dinheiro.')).toBeTruthy();
  expect(screen.queryByText('Palpite para ver odds e gráficos')).toBeNull();

  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));

  expect(await screen.findByText('Confirmar palpite')).toBeTruthy();
  await waitFor(() => expect(mockQuote).toHaveBeenCalledWith('rumor-1', 'true'));
  expect(mockPlaceBet).not.toHaveBeenCalled();
});
