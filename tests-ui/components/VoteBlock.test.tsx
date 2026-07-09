/**
 * VoteBlock — the core action of the whole app: casting a 🍵 TEA / 🧢 CAP
 * prediction. Verifies the un-voted state shows both buttons, and that tapping
 * (with a handle already set) places the bet through the predictions layer and
 * flips to the locked crowd-split view. The data layer is mocked.
 */
jest.mock('../../src/lib/predictions', () => ({
  getMyChoice: jest.fn(),
  placeBet: jest.fn(),
}));
jest.mock('../../src/lib/profile', () => ({
  getMyHandle: jest.fn(),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import VoteBlock from '../../src/components/VoteBlock';
import type { Rumor } from '../../src/lib/rumors';
import { getMyChoice, placeBet } from '../../src/lib/predictions';
import { getMyHandle } from '../../src/lib/profile';

const mockGetMyChoice = getMyChoice as jest.Mock;
const mockPlaceBet = placeBet as jest.Mock;
const mockGetMyHandle = getMyHandle as jest.Mock;

function makeRumor(overrides: Partial<Rumor> = {}): Rumor {
  const { category = null, ...rest } = overrides;
  return {
    id: 'rumor-1',
    summary: 'Anitta vai colaborar com a Beyoncé?',
    article: null,
    status: 'speculated',
    isHero: false,
    sourceUrl: null,
    predictionDeadline: null,
    resolutionPolicy: 'deadline',
    requiredSourceCount: 2,
    evidenceSources: [],
    createdAt: '2026-06-01T00:00:00Z',
    resolvedAt: null,
    trueTotal: 10,
    falseTotal: 10,
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

beforeEach(() => {
  mockGetMyChoice.mockReset().mockResolvedValue(null);
  mockGetMyHandle.mockReset().mockResolvedValue('estrela');
  mockPlaceBet.mockReset().mockResolvedValue({ ok: true });
});

test('shows TEA and CAP position buttons when the user has not voted yet', async () => {
  await render(<VoteBlock rumor={makeRumor()} />);
  expect(await screen.findByLabelText('Palpitar que é verdade, tea')).toBeTruthy();
  expect(screen.getByLabelText('Palpitar que é mentira, cap')).toBeTruthy();
});

test('hides pre-bet chance percentages from free users', async () => {
  await render(<VoteBlock rumor={makeRumor({ trueTotal: 15, falseTotal: 5 })} />);

  expect(await screen.findByLabelText('Palpitar que é verdade, tea')).toBeTruthy();
  expect(screen.queryByText('75% chance')).toBeNull();
  expect(screen.queryByText('25% chance')).toBeNull();
});

test('shows pre-bet chance percentages to Viddi Pro users', async () => {
  await render(<VoteBlock rumor={makeRumor({ trueTotal: 15, falseTotal: 5 })} viewerIsPro />);

  expect(await screen.findByText('75% chance')).toBeTruthy();
  expect(screen.getByText('25% chance')).toBeTruthy();
});

test('tapping TEA places a "true" bet and collapses to the locked position', async () => {
  const onVoted = jest.fn();
  await render(<VoteBlock rumor={makeRumor()} onVoted={onVoted} />);

  fireEvent.press(await screen.findByLabelText('Palpitar que é verdade, tea'));

  await waitFor(() => expect(mockPlaceBet).toHaveBeenCalledWith('rumor-1', 'true'));
  expect(await screen.findByText(/Seu palpite: Verdade/)).toBeTruthy();
  expect(screen.getByText(/Posição trancada/)).toBeTruthy();
  expect(onVoted).toHaveBeenCalled();
});

test('a pre-existing choice opens straight into the locked position (no buttons)', async () => {
  mockGetMyChoice.mockResolvedValue('false');
  await render(<VoteBlock rumor={makeRumor({ myChoice: 'false' })} />);

  expect(await screen.findByText(/Seu palpite: Mentira/)).toBeTruthy();
  expect(screen.queryByLabelText('Palpitar que é verdade, tea')).toBeNull();
  expect(mockPlaceBet).not.toHaveBeenCalled();
});
