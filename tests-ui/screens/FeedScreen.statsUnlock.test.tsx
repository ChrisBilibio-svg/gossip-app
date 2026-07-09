/**
 * FeedScreen stats unlock regression. Free users should not see market stats
 * before betting, but a successful vote must unlock stats immediately and keep
 * them unlocked locally even if the refresh response is briefly stale.
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

const mockFetchFeed = fetchFeed as jest.Mock;
const mockGetMyChoice = getMyChoice as jest.Mock;
const mockPlaceBet = placeBet as jest.Mock;
const mockGetMyHandle = getMyHandle as jest.Mock;

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
});

test('free users unlock market card stats after voting even when refresh is stale', async () => {
  await render(<FeedScreen />);

  expect(await screen.findByText('Palpite para ver odds e gráficos')).toBeTruthy();
  fireEvent.press(screen.getByText('Bruna vai lançar música nova?'));

  fireEvent.press(await screen.findByLabelText('Palpitar que é verdade, tea'));
  await waitFor(() => expect(mockPlaceBet).toHaveBeenCalledWith('rumor-1', 'true'));
  await waitFor(() => expect(screen.queryByText('Estatísticas bloqueadas')).toBeNull());
  expect(screen.getAllByText(/21 palpites/).length).toBeGreaterThan(0);

  fireEvent.press(screen.getByLabelText('Voltar'));

  await waitFor(() => expect(screen.queryByText('Palpite para ver odds e gráficos')).toBeNull());
  expect(screen.getAllByText(/21 palpites/).length).toBeGreaterThan(0);
});
