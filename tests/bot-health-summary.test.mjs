import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countRows,
  cutoffIso,
  parseLookbackHours,
  statusEmoji,
  summarizeBotHealth,
} from '../scripts/bot-health-summary.mjs';

test('parseLookbackHours defaults safely and accepts bounded integers', () => {
  assert.equal(parseLookbackHours(undefined), 24);
  assert.equal(parseLookbackHours('1'), 1);
  assert.equal(parseLookbackHours('168'), 168);
});

test('buildBotHealthConfig reads supplied env without relying on import-time globals', async () => {
  const imported = await import(`../scripts/bot-health-summary.mjs?config-api=${Date.now()}`);

  assert.equal(typeof imported.buildBotHealthConfig, 'function');
  assert.deepEqual(
    imported.buildBotHealthConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      BOT_HEALTH_LOOKBACK_HOURS: '6',
    }),
    {
      supabaseUrl: 'https://example.supabase.co',
      serviceKey: 'service-role-key',
      lookbackHours: 6,
    },
  );
  assert.throws(() => imported.buildBotHealthConfig({}), /Missing env: SUPABASE_URL/);
});

test('parseLookbackHours rejects malformed or unsafe windows', () => {
  assert.throws(() => parseLookbackHours('0'), /1 to 168/);
  assert.throws(() => parseLookbackHours('169'), /1 to 168/);
  assert.throws(() => parseLookbackHours('12.5'), /1 to 168/);
});

test('module import remains safe when local bot health env is malformed', async () => {
  const original = process.env.BOT_HEALTH_LOOKBACK_HOURS;
  process.env.BOT_HEALTH_LOOKBACK_HOURS = 'not-a-number';
  try {
    const imported = await import(`../scripts/bot-health-summary.mjs?invalid-env=${Date.now()}`);
    assert.equal(imported.parseLookbackHours(undefined), 24);
  } finally {
    if (original === undefined) {
      delete process.env.BOT_HEALTH_LOOKBACK_HOURS;
    } else {
      process.env.BOT_HEALTH_LOOKBACK_HOURS = original;
    }
  }
});

test('cutoffIso subtracts hours from the supplied clock', () => {
  assert.equal(cutoffIso(6, new Date('2026-06-09T12:00:00.000Z')), '2026-06-09T06:00:00.000Z');
});

test('countRows treats non-arrays as zero', () => {
  assert.equal(countRows([{ id: 1 }, { id: 2 }]), 2);
  assert.equal(countRows(null), 0);
});

test('statusEmoji prioritizes expired deadlines then stale ingest', () => {
  assert.equal(statusEmoji({ expiredDeadlineCount: 2, recentDraftCount: 3, recentPublishedCount: 0 }), '⚠️');
  assert.equal(statusEmoji({ expiredDeadlineCount: 0, recentDraftCount: 0, recentPublishedCount: 0 }), '🟡');
  assert.equal(statusEmoji({ expiredDeadlineCount: 0, recentDraftCount: 1, recentPublishedCount: 0 }), '✅');
});

test('summarizeBotHealth returns Telegram-friendly labeled lines', () => {
  const text = summarizeBotHealth({
    lookbackHours: 24,
    recentDraftCount: 5,
    recentPublishedCount: 1,
    expiredDeadlineCount: 0,
    rankSnapshotCount: 20,
  });
  assert.match(text, /✅ Viddi bot health/);
  assert.match(text, /drafts_created: 5/);
  assert.match(text, /action: none/);
});
