import test from 'node:test';
import assert from 'node:assert/strict';

import { isMissingRpcError, rpcFallbackMessage } from '../src/lib/rpcFallback.ts';

test('isMissingRpcError recognizes Supabase/PostgREST missing function shapes', () => {
  assert.equal(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function public.get_feed' }), true);
  assert.equal(isMissingRpcError({ code: '42883', message: 'function get_leaderboard does not exist' }), true);
  assert.equal(isMissingRpcError({ message: 'cache lookup failed for function get_feed' }), true);
});

test('isMissingRpcError ignores unrelated database errors', () => {
  assert.equal(isMissingRpcError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isMissingRpcError(null), false);
});

test('rpcFallbackMessage gives a human-safe migration hint', () => {
  assert.equal(
    rpcFallbackMessage('get_feed'),
    'Backend update still applying: get_feed RPC is unavailable, using the legacy path for now.',
  );
});
