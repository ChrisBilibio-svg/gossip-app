/**
 * Leaderboard mapping. Guards the get_leaderboard RPC → LeaderRow contract the
 * Leaderboard screen renders (snake_case→camelCase incl. rankDelta), and that a
 * generic RPC error degrades to an empty list rather than throwing. supabase is
 * mocked so no network/DB is touched.
 */
jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
  supabaseConfigured: true,
}));

import { getLeaderboard } from '../../src/lib/leaderboard';
import { supabase } from '../../src/lib/supabase';

const mockRpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  mockRpc.mockReset();
});

test('maps RPC rows to the camelCase LeaderRow shape including rankDelta', async () => {
  mockRpc.mockResolvedValue({
    data: [
      {
        id: 'u1',
        handle: 'anitta',
        total_points: 1200,
        correct_count: 30,
        resolved_count: 40,
        rank: 1,
        previous_rank: 3,
        rank_delta: 2,
      },
    ],
    error: null,
  });

  const rows = await getLeaderboard(10);
  expect(mockRpc).toHaveBeenCalledWith('get_leaderboard', { p_limit: 10, p_scope: 'world', p_state_code: null });
  expect(rows).toEqual([
    {
      id: 'u1',
      handle: 'anitta',
      avatar: null,
      stateCode: null,
      totalPoints: 1200,
      correctCount: 30,
      currentStreak: 0,
      resolvedCount: 40,
      rank: 1,
      previousRank: 3,
      rankDelta: 2,
    },
  ]);
});

test('returns an empty list (no throw) on a generic RPC error', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
  await expect(getLeaderboard()).resolves.toEqual([]);
});

test('returns an empty list when the RPC yields no data', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await expect(getLeaderboard()).resolves.toEqual([]);
});
