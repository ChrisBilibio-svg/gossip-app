import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  buildDeadlineConfig,
  parseDeadlineLimit,
  parseDryRunFlag,
  validateDeadlineConfig,
} from '../scripts/resolve-deadlines.mjs';

test('parseDeadlineLimit defaults to 25 when unset', () => {
  assert.equal(parseDeadlineLimit(undefined), 25);
});

test('parseDeadlineLimit accepts integers from 1 to 250', () => {
  assert.equal(parseDeadlineLimit('1'), 1);
  assert.equal(parseDeadlineLimit('250'), 250);
});

test('parseDeadlineLimit rejects invalid limits', () => {
  for (const value of ['0', '251', 'abc', '2.5']) {
    assert.throws(() => parseDeadlineLimit(value), /RESOLVE_DEADLINES_LIMIT/);
  }
});

test('parseDryRunFlag defaults to true unless explicitly false', () => {
  assert.equal(parseDryRunFlag(undefined), true);
  assert.equal(parseDryRunFlag('true'), true);
  assert.equal(parseDryRunFlag('FALSE'), false);
  assert.equal(parseDryRunFlag('false'), false);
});

test('buildDeadlineConfig parses supplied env without reading process.env', () => {
  const original = process.env.RESOLVE_DEADLINES_LIMIT;
  process.env.RESOLVE_DEADLINES_LIMIT = '999';
  try {
    assert.deepEqual(
      buildDeadlineConfig({
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        RESOLVE_DEADLINES_LIMIT: '7',
        RESOLVE_DEADLINES_DRY_RUN: 'false',
      }),
      {
        supabaseUrl: 'https://example.supabase.co',
        serviceKey: 'service-role-key',
        limit: 7,
        dryRun: false,
      },
    );
  } finally {
    if (original === undefined) delete process.env.RESOLVE_DEADLINES_LIMIT;
    else process.env.RESOLVE_DEADLINES_LIMIT = original;
  }
});

test('validateDeadlineConfig fails closed without leaking service keys', () => {
  assert.throws(
    () => validateDeadlineConfig({
      supabaseUrl: 'https://example.supabase.co',
      serviceKey: '',
      limit: 25,
      dryRun: true,
    }),
    (error) => {
      assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY/);
      assert.doesNotMatch(error.message, /service-role-key|example\.supabase\.co/);
      return true;
    },
  );
});

test('resolve-deadlines module stays import-safe even with invalid runtime env', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "await import('./scripts/resolve-deadlines.mjs');"],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, RESOLVE_DEADLINES_LIMIT: 'abc' },
    },
  );

  assert.equal(result.status, 0, result.stderr);
});
