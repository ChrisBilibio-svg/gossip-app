import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMigrationDriftConfig,
  compareMigrationDrift,
  formatDriftReport,
  parseMigrationFilename,
} from '../scripts/check-migration-drift.mjs';

test('parseMigrationFilename extracts version and name from numbered sql files', () => {
  assert.deepEqual(parseMigrationFilename('0019_server_search_rpc.sql'), {
    file: '0019_server_search_rpc.sql',
    version: '0019',
    name: 'server_search_rpc',
  });
  assert.equal(parseMigrationFilename('README.md'), null);
});

test('compareMigrationDrift reports unapplied local and unknown remote versions', () => {
  const local = [
    { file: '0018_rate_limit_writes.sql', version: '0018', name: 'rate_limit_writes' },
    { file: '0019_server_search_rpc.sql', version: '0019', name: 'server_search_rpc' },
  ];
  const remote = [{ version: '0018' }, { version: '9999' }];
  assert.deepEqual(compareMigrationDrift(local, remote), {
    unappliedLocal: [local[1]],
    unknownRemote: [{ version: '9999' }],
  });
});

test('formatDriftReport is clean when local and remote match', () => {
  const report = formatDriftReport({ unappliedLocal: [], unknownRemote: [] });
  assert.match(report, /✅ Migration drift check passed/);
});

test('formatDriftReport lists unapplied local migration filenames', () => {
  const report = formatDriftReport({
    unappliedLocal: [{ file: '0020_leaderboard_rank_delta.sql', version: '0020', name: 'leaderboard_rank_delta' }],
    unknownRemote: [],
  });
  assert.match(report, /⚠️ Migration drift detected/);
  assert.match(report, /0020_leaderboard_rank_delta\.sql/);
});

test('buildMigrationDriftConfig prefers explicit database urls and fails closed when missing', () => {
  assert.deepEqual(buildMigrationDriftConfig({ SUPABASE_DB_URL: 'postgres://primary', SUPABASE_DIRECT_URL: 'postgres://direct' }), {
    databaseUrl: 'postgres://primary',
  });
  assert.deepEqual(buildMigrationDriftConfig({ SUPABASE_DIRECT_URL: 'postgres://direct' }), {
    databaseUrl: 'postgres://direct',
  });
  assert.throws(() => buildMigrationDriftConfig({}), /Missing env: SUPABASE_DB_URL or SUPABASE_DIRECT_URL/);
});

test('migration drift helpers stay import-safe when local database env is malformed', async () => {
  const original = process.env.SUPABASE_DB_URL;
  process.env.SUPABASE_DB_URL = 'not a postgres url';
  try {
    const module = await import(`../scripts/check-migration-drift.mjs?invalid-env=${Date.now()}`);
    assert.equal(module.parseMigrationFilename('0028_hybrid_resolution_model.sql')?.version, '0028');
    assert.equal(typeof module.buildMigrationDriftConfig, 'function');
  } finally {
    if (original === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = original;
  }
});
