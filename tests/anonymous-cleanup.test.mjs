import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cutoffIso,
  hasActivity,
  isAnonymousAuthUser,
  parseCleanupDays,
  parseCleanupLimit,
  selectCleanupCandidates,
  uniqueIds,
} from '../scripts/cleanup-anonymous-users.mjs';

test('parseCleanupDays defaults safely and rejects unsafe ages', () => {
  assert.equal(parseCleanupDays(undefined), 30);
  assert.equal(parseCleanupDays('7'), 7);
  assert.equal(parseCleanupDays('3650'), 3650);

  for (const value of ['0', '6', '3651', 'abc', '2.5']) {
    assert.throws(() => parseCleanupDays(value), /ANON_CLEANUP_DAYS/);
  }
});

test('parseCleanupLimit defaults and caps batch size', () => {
  assert.equal(parseCleanupLimit(undefined), 100);
  assert.equal(parseCleanupLimit('1'), 1);
  assert.equal(parseCleanupLimit('1000'), 1000);

  for (const value of ['0', '1001', 'abc', '2.5']) {
    assert.throws(() => parseCleanupLimit(value), /ANON_CLEANUP_LIMIT/);
  }
});

test('cutoffIso subtracts whole days from the supplied clock', () => {
  assert.equal(cutoffIso(7, new Date('2026-06-08T12:00:00.000Z')), '2026-06-01T12:00:00.000Z');
});

test('isAnonymousAuthUser recognizes Supabase anonymous user shapes only', () => {
  assert.equal(isAnonymousAuthUser({ is_anonymous: true }), true);
  assert.equal(isAnonymousAuthUser({ app_metadata: { provider: 'anonymous' } }), true);
  assert.equal(isAnonymousAuthUser({ identities: [{ provider: 'anonymous' }] }), true);
  assert.equal(isAnonymousAuthUser({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] }), false);
  assert.equal(isAnonymousAuthUser(null), false);
});

test('selectCleanupCandidates keeps only stale anonymous users without activity', () => {
  const users = [
    { id: 'active-old-anon', is_anonymous: true, created_at: '2026-05-01T00:00:00.000Z' },
    { id: 'candidate-newer', is_anonymous: true, created_at: '2026-06-05T00:00:00.000Z' },
    { id: 'candidate-oldest', is_anonymous: true, created_at: '2026-04-01T00:00:00.000Z' },
    { id: 'email-old', app_metadata: { provider: 'email' }, created_at: '2026-04-01T00:00:00.000Z' },
    { id: 'candidate-older', app_metadata: { provider: 'anonymous' }, created_at: '2026-04-15T00:00:00.000Z' },
  ];
  const activitySets = [uniqueIds([{ user_id: 'active-old-anon' }])];

  assert.deepEqual(
    selectCleanupCandidates(users, activitySets, '2026-06-01T00:00:00.000Z', 10).map((user) => user.id),
    ['candidate-oldest', 'candidate-older'],
  );
  assert.deepEqual(
    selectCleanupCandidates(users, activitySets, '2026-06-01T00:00:00.000Z', 1).map((user) => user.id),
    ['candidate-oldest'],
  );
});

test('hasActivity checks all supplied activity sets', () => {
  assert.equal(hasActivity('u1', [new Set(), new Set(['u1'])]), true);
  assert.equal(hasActivity('u2', [new Set(), new Set(['u1'])]), false);
});

test('cleanup script exports helpers even when cleanup env vars are malformed', async () => {
  const originalDays = process.env.ANON_CLEANUP_DAYS;
  const originalLimit = process.env.ANON_CLEANUP_LIMIT;
  process.env.ANON_CLEANUP_DAYS = '3abc';
  process.env.ANON_CLEANUP_LIMIT = 'many';

  try {
    const module = await import(`../scripts/cleanup-anonymous-users.mjs?invalid-env=${Date.now()}`);
    assert.equal(module.isAnonymousAuthUser({ is_anonymous: true }), true);
    assert.equal(module.parseCleanupDays(undefined), 30);
  } finally {
    if (originalDays === undefined) delete process.env.ANON_CLEANUP_DAYS;
    else process.env.ANON_CLEANUP_DAYS = originalDays;
    if (originalLimit === undefined) delete process.env.ANON_CLEANUP_LIMIT;
    else process.env.ANON_CLEANUP_LIMIT = originalLimit;
  }
});
