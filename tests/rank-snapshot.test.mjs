import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDryRunFlag,
  parseSnapshotDate,
  summarizeSnapshotResult,
  todayUtcDate,
} from '../scripts/snapshot-leaderboard-ranks.mjs';

test('todayUtcDate formats the UTC calendar date', () => {
  assert.equal(todayUtcDate(new Date('2026-06-09T23:59:59.000Z')), '2026-06-09');
});

test('parseSnapshotDate defaults to today UTC and accepts valid dates', () => {
  const now = new Date('2026-06-09T12:00:00.000Z');
  assert.equal(parseSnapshotDate(undefined, now), '2026-06-09');
  assert.equal(parseSnapshotDate('2026-02-28', now), '2026-02-28');
});

test('parseSnapshotDate rejects malformed or impossible dates', () => {
  assert.throws(() => parseSnapshotDate('06/09/2026'), /YYYY-MM-DD/);
  assert.throws(() => parseSnapshotDate('2026-02-31'), /real calendar date/);
});

test('parseDryRunFlag defaults to false and only true enables dry run', () => {
  assert.equal(parseDryRunFlag(undefined), false);
  assert.equal(parseDryRunFlag('false'), false);
  assert.equal(parseDryRunFlag('TRUE'), true);
});

test('summarizeSnapshotResult explains dry-run and live outcomes', () => {
  assert.equal(
    summarizeSnapshotResult(0, '2026-06-09', true),
    'Dry run: would snapshot leaderboard ranks for 2026-06-09.',
  );
  assert.equal(
    summarizeSnapshotResult(42, '2026-06-09', false),
    'Snapshot complete: 42 leaderboard rank row(s) upserted for 2026-06-09.',
  );
});

test('rank snapshot script exports helpers even when runtime env is malformed', async () => {
  const originalDate = process.env.RANK_SNAPSHOT_DATE;
  process.env.RANK_SNAPSHOT_DATE = '2026-02-31';

  try {
    const module = await import(`../scripts/snapshot-leaderboard-ranks.mjs?invalid-env=${Date.now()}`);
    assert.equal(module.todayUtcDate(new Date('2026-06-10T00:00:00.000Z')), '2026-06-10');
    assert.equal(module.parseDryRunFlag('TRUE'), true);
  } finally {
    if (originalDate === undefined) delete process.env.RANK_SNAPSHOT_DATE;
    else process.env.RANK_SNAPSHOT_DATE = originalDate;
  }
});
