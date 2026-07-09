/**
 * Profile track record — Chris wants the actual numbers visible, not just a
 * vague chart. This locks in accuracy numerator/denominator plus current/best
 * streak display.
 */
jest.mock('../../src/lib/profile', () => ({
  getMyProfile: jest.fn(),
  setAvatar: jest.fn(),
  deleteMyAccount: jest.fn(),
}));

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

jest.mock('../../src/components/avatar', () => ({
  AVATARS: ['🕵️', '🍵'],
  DEFAULT_AVATAR: '🕵️',
  getAvatar: jest.fn().mockResolvedValue('🕵️'),
  setAvatar: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';

import ProfileScreen from '../../src/screens/ProfileScreen';
import { getMyProfile } from '../../src/lib/profile';
import { supabase } from '../../src/lib/supabase';

const mockGetMyProfile = getMyProfile as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

beforeEach(() => {
  mockGetMyProfile.mockReset().mockResolvedValue({
    handle: 'profeta',
    avatar: '🍵',
    totalPoints: 1234,
    correctCount: 7,
    resolvedCount: 10,
    currentStreak: 3,
    bestStreak: 5,
  });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { email: 'user@example.com' } } });
});

test('shows detailed track-record numbers on the profile', async () => {
  await render(<ProfileScreen onOpenAccount={jest.fn()} />);

  expect(await screen.findByText('Histórico')).toBeTruthy();
  expect(screen.getByText('7 / 10')).toBeTruthy();
  expect(screen.getByText('acertos resolvidos')).toBeTruthy();
  expect(screen.getAllByText('70%').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('precisão')).toBeTruthy();
  expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('sequência atual')).toBeTruthy();
  expect(screen.getByText('5')).toBeTruthy();
  expect(screen.getByText('melhor sequência')).toBeTruthy();
});
