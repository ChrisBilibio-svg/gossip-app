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

import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import VoteBlock from '../../src/components/VoteBlock';
import type { Rumor } from '../../src/lib/rumors';
import { getMyChoice, placeBet } from '../../src/lib/predictions';
import { getMyHandle } from '../../src/lib/profile';
import { getCoinEconomyState, requestFixedPredictionQuote, placeFixedPrediction, DEFAULT_DISABLED_ECONOMY_STATE } from '../../src/lib/economy';

const mockGetMyChoice = getMyChoice as jest.Mock;
const mockPlaceBet = placeBet as jest.Mock;
const mockGetMyHandle = getMyHandle as jest.Mock;
const mockEconomy = getCoinEconomyState as jest.Mock;
const mockQuote = requestFixedPredictionQuote as jest.Mock;
const mockPlaceFixed = placeFixedPrediction as jest.Mock;

function makeRumor(overrides: Partial<Rumor> = {}): Rumor {
  const { category = null, ...rest } = overrides;
  return {
    id: 'rumor-1',
    summary: 'Will Team A win?',
    article: null,
    status: 'speculated',
    isHero: false,
    sourceUrl: null,
    predictionDeadline: '2026-08-01T00:00:00Z',
    resolutionPolicy: 'deadline',
    requiredSourceCount: 2,
    evidenceSources: [],
    createdAt: '2026-06-01T00:00:00Z',
    resolvedAt: null,
    trueTotal: 40,
    falseTotal: 60,
    myChoice: null,
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    sourceCount: 1,
    oddsHistory: [],
    updatesRumor: null,
    myReaction: null,
    ...rest,
    category: category ?? null,
  };
}

const economyState = {
  ...DEFAULT_DISABLED_ECONOMY_STATE,
  featureEnabled: true,
  predictionPlacementKilled: false,
  purchasesKilled: false,
  balance: 2000,
  standardStakeCoins: 100,
  quickStakeCoins: [50, 100, 250],
  recommendedWalletFraction: 0.05,
  maxWalletFraction: 0.1,
  absoluteMaxStakeCoins: 500,
};

beforeEach(() => {
  mockGetMyChoice.mockReset().mockResolvedValue(null);
  mockGetMyHandle.mockReset().mockResolvedValue('estrela');
  mockPlaceBet.mockReset().mockResolvedValue({ ok: true });
  mockEconomy.mockReset().mockResolvedValue(economyState);
  mockQuote.mockReset().mockResolvedValue({ quoteId: 'q1', rumorId: 'rumor-1', probabilityVersion: 2, outcomeId: 'o1', outcomeKey: 'true', label: 'Verdade', probability: 0.4, decimalOdds: 2.375, economyConfigVersion: 1, expiresAt: '2026-07-21T00:00:45Z' });
  mockPlaceFixed.mockReset().mockResolvedValue({ ok: true, positionId: 'pos1' });
});

test('shows current odds on every open market before trading', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  expect(await screen.findByText('Probabilidade: 40%')).toBeTruthy();
  expect(screen.getAllByText(/Retorno atual:/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Retorno atual: 2.38x')).toBeTruthy();
});

test('free Yes/No voting is no longer possible; selecting an outcome opens the trading sheet', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  await waitFor(() => expect(mockQuote).toHaveBeenCalledWith('rumor-1', 'true'));
  expect(await screen.findByText('Confirmar palpite')).toBeTruthy();
  expect(mockPlaceBet).not.toHaveBeenCalled();
});

test('every submitted prediction requires a positive coin stake and placement uses quote id', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  const stakeInput = await screen.findByLabelText('Stake em moedas');
  fireEvent.changeText(stakeInput, '0');
  expect(await screen.findByText(/inteira e positiva/)).toBeTruthy();
  fireEvent.changeText(stakeInput, '100');
  fireEvent.press(await screen.findByText('Confirmar 100 moedas'));
  await waitFor(() => expect(mockPlaceFixed).toHaveBeenCalledWith(expect.objectContaining({ stakeCoins: 100, quoteId: 'q1', probabilityVersion: 2 })));
});

test('changing the stake updates potential return and less likely outcomes produce higher returns', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  expect(await screen.findByText('237 moedas')).toBeTruthy();
  expect(screen.getByText('137 moedas')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Stake em moedas'), '50');
  expect(await screen.findByText('118 moedas')).toBeTruthy();
  expect(screen.getByText('68 moedas')).toBeTruthy();
});

test('expired or changed quotes require reconfirmation with refreshed return', async () => {
  mockPlaceFixed.mockResolvedValueOnce({ ok: false, quoteChanged: true, error: 'quote expired' });
  mockQuote
    .mockResolvedValueOnce({ quoteId: 'q1', rumorId: 'rumor-1', probabilityVersion: 2, outcomeId: 'o1', outcomeKey: 'true', label: 'Verdade', probability: 0.4, decimalOdds: 2.375, economyConfigVersion: 1, expiresAt: '2026-07-21T00:00:45Z' })
    .mockResolvedValueOnce({ quoteId: 'q2', rumorId: 'rumor-1', probabilityVersion: 3, outcomeId: 'o1', outcomeKey: 'true', label: 'Verdade', probability: 0.5, decimalOdds: 1.9, economyConfigVersion: 1, expiresAt: '2026-07-21T00:01:45Z' });
  await render(<VoteBlock rumor={makeRumor()} />);
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  fireEvent.press(await screen.findByText('Confirmar 100 moedas'));
  expect(await screen.findByText(/odds mudaram/i)).toBeTruthy();
  expect(await screen.findByText('190 moedas')).toBeTruthy();
});

test('insufficient balance disables confirmation and all UI states include no-cash copy', async () => {
  mockEconomy.mockResolvedValue({ ...economyState, balance: 40 });
  await render(<VoteBlock rumor={makeRumor()} />);
  expect(await screen.findByText(/Moedas não têm valor em dinheiro/)).toBeTruthy();
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  expect(await screen.findByText(/Saldo insuficiente/)).toBeTruthy();
  expect(screen.getByText('Ver opções de moedas')).toBeTruthy();
  expect(screen.getByText(/não têm valor em dinheiro, não podem ser sacadas/i)).toBeTruthy();
});

test('current odds are relabeled as locked odds after execution', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  fireEvent.press(await screen.findByLabelText('Escolher Verdade'));
  fireEvent.press(await screen.findByText('Confirmar 100 moedas'));
  expect(await screen.findByText(/Odds fixadas/)).toBeTruthy();
});
