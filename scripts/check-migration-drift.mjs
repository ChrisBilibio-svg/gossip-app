// check-migration-drift.mjs — read-only local vs Supabase migration drift report.
//
// Compares local supabase/migrations/*.sql files with rows from
// supabase_migrations.schema_migrations. This script does not mutate data.
// It uses psql because Supabase does not normally expose the internal
// supabase_migrations schema through PostgREST.
//
// Env:
//   SUPABASE_DB_URL or SUPABASE_DIRECT_URL — Postgres connection string

import { execFile as execFileCallback } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

export function buildMigrationDriftConfig(env = process.env) {
  const databaseUrl = env.SUPABASE_DB_URL || env.SUPABASE_DIRECT_URL;
  if (!databaseUrl) throw new Error('Missing env: SUPABASE_DB_URL or SUPABASE_DIRECT_URL');
  return { databaseUrl };
}

export function parseMigrationFilename(file) {
  const match = /^(\d{4,})_(.+)\.sql$/.exec(file);
  if (!match) return null;
  return { file, version: match[1], name: match[2] };
}

export function compareMigrationDrift(localMigrations, remoteMigrations) {
  const remoteVersions = new Set(remoteMigrations.map((migration) => migration.version));
  const localVersions = new Set(localMigrations.map((migration) => migration.version));
  return {
    unappliedLocal: localMigrations.filter((migration) => !remoteVersions.has(migration.version)),
    unknownRemote: remoteMigrations.filter((migration) => !localVersions.has(migration.version)),
  };
}

export function formatDriftReport(drift) {
  if (drift.unappliedLocal.length === 0 && drift.unknownRemote.length === 0) {
    return '✅ Migration drift check passed: local files match applied Supabase migration versions.';
  }

  const lines = ['⚠️ Migration drift detected.'];
  if (drift.unappliedLocal.length > 0) {
    lines.push('unapplied_local:');
    for (const migration of drift.unappliedLocal) lines.push(`- ${migration.file}`);
  }
  if (drift.unknownRemote.length > 0) {
    lines.push('unknown_remote:');
    for (const migration of drift.unknownRemote) {
      lines.push(`- ${migration.version}${migration.name ? `_${migration.name}` : ''}`);
    }
  }
  return lines.join('\n');
}

async function readLocalMigrations() {
  const files = await readdir(MIGRATIONS_DIR);
  return files.map(parseMigrationFilename).filter(Boolean).sort((a, b) => a.version.localeCompare(b.version));
}

function parsePsqlRows(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [version, name = ''] = line.split('|');
      return { version, name: name || null };
    });
}

async function readRemoteMigrations(databaseUrl) {
  const sql = "select version, coalesce(name, '') from supabase_migrations.schema_migrations order by version";
  const { stdout } = await execFile('psql', [databaseUrl, '-At', '-F', '|', '-c', sql], { timeout: 30_000 });
  return parsePsqlRows(stdout);
}

function usage() {
  console.log(`Usage: node scripts/check-migration-drift.mjs

Read-only check that local supabase/migrations/*.sql versions match applied rows
in supabase_migrations.schema_migrations.

Required env:
  SUPABASE_DB_URL or SUPABASE_DIRECT_URL

Requires:
  psql available on PATH
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildMigrationDriftConfig(process.env);

  const [localMigrations, remoteMigrations] = await Promise.all([readLocalMigrations(), readRemoteMigrations(config.databaseUrl)]);
  const drift = compareMigrationDrift(localMigrations, remoteMigrations);
  console.log(formatDriftReport(drift));
  if (drift.unappliedLocal.length > 0 || drift.unknownRemote.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
