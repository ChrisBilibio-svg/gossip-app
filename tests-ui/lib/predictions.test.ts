/**
 * place_bet client wrapper. The "write-once" promise is enforced in Postgres
 * (UNIQUE constraint → 23505); this guards that the client translates that, and
 * other RPC errors, into the right user-facing result. supabase is mocked so no
 * network/DB is touched.
 */
jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
  supabaseConfigured: true,
}));

import { placeBet } from '../../src/lib/predictions';
import { supabase } from '../../src/lib/supabase';

const mockRpc = supabase.rpc as jest.Mock;

beforeEach(() => {
  mockRpc.mockReset();
});

test('a successful bet calls place_bet with the rumor id and choice', async () => {
  mockRpc.mockResolvedValue({ error: null });
  const res = await placeBet('rumor-1', 'true');
  expect(res).toEqual({ ok: true });
  expect(mockRpc).toHaveBeenCalledWith('place_bet', { p_rumor_id: 'rumor-1', p_choice: 'true' });
});

test('a duplicate (Postgres 23505) is reported as already-bet, not a hard error', async () => {
  mockRpc.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } });
  const res = await placeBet('rumor-1', 'false');
  expect(res.ok).toBe(false);
  expect(res.alreadyBet).toBe(true);
  expect(res.error).toMatch(/já palpitou/i);
});

test('a duplicate detected by message (no code) is also already-bet', async () => {
  mockRpc.mockResolvedValue({ error: { message: 'unique constraint violated' } });
  const res = await placeBet('rumor-1', 'true');
  expect(res.alreadyBet).toBe(true);
});

test('any other RPC error surfaces as a generic failure', async () => {
  mockRpc.mockResolvedValue({ error: { code: 'P0001', message: 'rumor is a draft' } });
  const res = await placeBet('rumor-1', 'true');
  expect(res.ok).toBe(false);
  expect(res.alreadyBet).toBeUndefined();
  expect(res.error).toBe('rumor is a draft');
});
