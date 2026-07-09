import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPreflightResult,
  collectLocalEnvFiles,
  findMissingRequiredEnv,
  isPlaceholderValue,
  parsePreflightArgs,
  redactSecretLikeText,
  validateEnvFileSecurity,
  validateSupabaseUrl,
} from '../scripts/config-preflight.mjs';

test('findMissingRequiredEnv reports absent and blank env vars', () => {
  assert.deepEqual(findMissingRequiredEnv({ A: 'ok', B: '', C: undefined }, ['A', 'B', 'C']), ['B', 'C']);
});

test('isPlaceholderValue catches common fake config values', () => {
  assert.equal(isPlaceholderValue('https://example.supabase.co'), true);
  assert.equal(isPlaceholderValue('your-service-role-key'), true);
  assert.equal(isPlaceholderValue('changeme'), true);
  assert.equal(isPlaceholderValue('https://real-project.supabase.co'), false);
});

test('validateSupabaseUrl accepts only real-looking Supabase project URLs', () => {
  assert.equal(validateSupabaseUrl('https://abc123.supabase.co').ok, true);
  assert.equal(validateSupabaseUrl('http://abc123.supabase.co').ok, false);
  assert.equal(validateSupabaseUrl('https://example.supabase.co').ok, false);
  assert.equal(validateSupabaseUrl('not-a-url').ok, false);
});

test('redactSecretLikeText masks JWTs and long token-looking values', () => {
  const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'payload', 'signature'].join('.');
  const fakeSk = `sk_live_${'abcdefghijklmnopqrstuvwxyz'}`;
  const text = `SUPABASE_SERVICE_ROLE_KEY=${fakeJwt} jwt=${fakeJwt} token=${fakeSk}`;
  const redacted = redactSecretLikeText(text);
  assert.doesNotMatch(redacted, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(redacted, /sk_live_abcdefghijklmnopqrstuvwxyz/);
  assert.match(redacted, /SUPABASE_SERVICE_ROLE_KEY=\[REDACTED_SECRET\]/);
  assert.match(redacted, /\[REDACTED_JWT\]/);
  assert.match(redacted, /\[REDACTED_SECRET\]/);
});

test('validateEnvFileSecurity allows only example env files to be tracked', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env', '.env.example', '.env.production', '.env.local'],
    trackedFiles: ['.env.example', '.env.production'],
    gitignoreText: '.env\n.env.*\n!.env.example\n',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Tracked non-example env file: .env.production']);
});

test('validateEnvFileSecurity catches nested tracked non-example env files', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['config/.env.production'],
    trackedFiles: ['config/.env.production'],
    gitignoreText: '.env\n.env.*\n!.env.example\n',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Tracked non-example env file: config/.env.production']);
});

test('validateEnvFileSecurity fails closed when git tracked-file inventory fails', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env.example'],
    trackedFiles: [],
    gitignoreText: '.env\n.env.*\n!.env.example\n',
    gitInventoryError: 'not a git repository',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Could not inspect git-tracked env files: not a git repository']);
});

test('validateEnvFileSecurity requires broad env ignore coverage with example allowlist', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env.example'],
    trackedFiles: ['.env.example'],
    gitignoreText: '.env\n.env*.local\n',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Missing gitignore pattern: \.env\.\*/);
  assert.match(result.errors.join('\n'), /Missing gitignore allowlist: !\.env\.example/);
});

test('validateEnvFileSecurity passes when env files are ignored and only example is tracked', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env.example'],
    trackedFiles: ['.env.example'],
    gitignoreText: '.env\n.env.*\n!.env.example\n',
  });

  assert.deepEqual(result, { ok: true, errors: [], warnings: [] });
});

test('collectLocalEnvFiles recursively finds env files while skipping dependency folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'gossip-env-'));
  writeFileSync(join(root, '.env.example'), 'EXAMPLE=1\n');
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', '.env.production'), 'SECRET=placeholder\n');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', '.env'), 'IGNORED=1\n');

  assert.deepEqual(collectLocalEnvFiles(root).sort(), ['.env.example', 'config/.env.production']);
});


test('validateEnvFileSecurity fails when effective gitignore allows sensitive env files', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env.example'],
    trackedFiles: ['.env.example'],
    gitignoreText: '.env\n.env.*\n!.env.example\n!.env.production\n',
    effectiveIgnore: {
      ignored: ['.env', '.env.local', '.env.staging'],
      notIgnored: ['.env.production', '.env.example'],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Sensitive env file is not effectively ignored: \.env\.production/);
});

test('validateEnvFileSecurity fails when .env.example is effectively ignored', () => {
  const result = validateEnvFileSecurity({
    envFiles: ['.env.example'],
    trackedFiles: ['.env.example'],
    gitignoreText: '.env\n.env.*\n!.env.example\n',
    effectiveIgnore: {
      ignored: ['.env', '.env.local', '.env.production', '.env.staging', '.env.example'],
      notIgnored: [],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Example env file should remain trackable: \.env\.example/);
});

test('parsePreflightArgs rejects unknown or malformed CLI options', () => {
  assert.deepEqual(parsePreflightArgs(['--env-file-security-only']), {
    ok: true,
    envFileSecurityOnly: true,
    showHelp: false,
    errors: [],
  });

  assert.deepEqual(parsePreflightArgs(['--env-file-security-only=true']), {
    ok: false,
    envFileSecurityOnly: false,
    showHelp: false,
    errors: ['Unknown config-preflight option: --env-file-security-only=true'],
  });

  assert.deepEqual(parsePreflightArgs(['--bogus']), {
    ok: false,
    envFileSecurityOnly: false,
    showHelp: false,
    errors: ['Unknown config-preflight option: --bogus'],
  });
});

test('buildPreflightResult fails closed on unknown CLI options without requiring Supabase secrets', () => {
  const result = buildPreflightResult({
    env: {},
    args: ['--env-file-security-only', '--bogus'],
    envFileSecurityInput: {
      envFiles: ['.env.example'],
      trackedFiles: ['.env.example'],
      gitignoreText: '.env\n.env.*\n!.env.example\n',
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Unknown config-preflight option: --bogus']);
});

test('buildPreflightResult can run env-file security without requiring Supabase secrets', () => {
  const result = buildPreflightResult({
    env: {},
    args: ['--env-file-security-only'],
    envFileSecurityInput: {
      envFiles: ['.env.example'],
      trackedFiles: ['.env.example'],
      gitignoreText: '.env\n.env.*\n!.env.example\n',
    },
  });

  assert.deepEqual(result, { ok: true, errors: [], warnings: [] });
});
