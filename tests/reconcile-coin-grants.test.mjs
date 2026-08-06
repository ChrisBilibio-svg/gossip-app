import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCoinGrantConfig,
  parseLiveFlag,
  parsePositiveInteger,
  summarizeGrantResult,
} from '../scripts/reconcile-coin-grants.mjs';

test('coin grant scheduler parses safe dry-run defaults', () => {
  const cfg = buildCoinGrantConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', COIN_GRANT_LIVE: 'false' });
  assert.equal(cfg.live, false);
  assert.equal(cfg.limit, 500);
  assert.equal(parseLiveFlag('true'), true);
  assert.equal(parseLiveFlag('TRUE'), true);
  assert.equal(parseLiveFlag('false'), false);
});

test('coin grant scheduler validates bounded limits', () => {
  assert.equal(parsePositiveInteger('42', 'LIMIT'), 42);
  assert.throws(() => parsePositiveInteger('0', 'LIMIT'), /between 1/);
  assert.throws(() => parsePositiveInteger('5001', 'LIMIT'), /between 1/);
  assert.throws(() => parsePositiveInteger('1.5', 'LIMIT'), /whole number/);
});

test('coin grant scheduler summary distinguishes dry-run and live results', () => {
  assert.match(summarizeGrantResult(null, false), /DRY RUN/);
  assert.match(summarizeGrantResult([{ users_checked: 3, recovery_grants: 150, pro_daily_grants: 2 }], true), /users_checked: 3/);
});
