import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/0036_security_input_rate_limits.sql', import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const authSource = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');
const validationSource = existsSync(new URL('../src/lib/inputValidation.ts', import.meta.url))
  ? readFileSync(new URL('../src/lib/inputValidation.ts', import.meta.url), 'utf8')
  : '';
const commentsSource = readFileSync(new URL('../src/lib/comments.ts', import.meta.url), 'utf8');
const socialSource = readFileSync(new URL('../src/lib/social.ts', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../gossip-admin/admin.html', import.meta.url), 'utf8');

test('security hardening migration rate-limits remaining writable tables and profile RPCs', () => {
  assert.equal(existsSync(migrationUrl), true, 'expected 0036_security_input_rate_limits.sql');
  for (const table of ['content_reports', 'analytics_events', 'notification_preferences', 'push_devices', 'blocks']) {
    assert.match(migration, new RegExp(`create\\s+trigger\\s+${table}_[a-z_]*rate_limit`, 'i'), `expected rate-limit trigger for ${table}`);
  }
  assert.match(migration, /perform\s+check_rate_limit\s*\(\s*'set_handle'\s*,\s*interval\s+'15 minutes'\s*,\s*5\s*\)/i);
  assert.match(migration, /perform\s+check_rate_limit\s*\(\s*'set_avatar'\s*,\s*interval\s+'15 minutes'\s*,\s*20\s*\)/i);
});

test('security hardening migration rejects malformed and oversized user payloads at the database boundary', () => {
  assert.match(migration, /create\s+or\s+replace\s+function\s+is_safe_user_text\s*\(/i);
  assert.match(migration, /not\s+valid/i, 'constraints should be pending-migration safe for existing rows');
  for (const table of ['comments', 'comment_reports', 'social_reposts', 'social_repost_replies', 'content_reports', 'push_devices', 'analytics_events']) {
    assert.match(migration, new RegExp(`alter\\s+table\\s+${table}[\\s\\S]*add\\s+constraint`, 'i'), `expected constraints for ${table}`);
  }
  assert.match(migration, /jsonb_typeof\s*\(\s*details\s*\)\s*=\s*'object'/i);
  assert.match(migration, /octet_length\s*\(\s*properties::text\s*\)\s*<=\s*4096/i);
});

test('auth routes are guarded by a five-attempt fifteen-minute client limiter', () => {
  assert.match(authSource, /AUTH_ATTEMPT_LIMIT\s*=\s*5/);
  assert.match(authSource, /AUTH_ATTEMPT_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  assert.match(authSource, /checkAuthAttemptLimit\s*\(/);
  assert.match(authSource, /recordAuthFailure\s*\(/);
  assert.match(authSource, /clearAuthFailures\s*\(/);
  assert.match(authSource, /signInWithEmail[\s\S]*checkAuthAttemptLimit[\s\S]*signInWithPassword[\s\S]*recordAuthFailure[\s\S]*clearAuthFailures/);
  assert.match(authSource, /secureAccount[\s\S]*checkAuthAttemptLimit[\s\S]*updateUser[\s\S]*recordAuthFailure[\s\S]*clearAuthFailures/);
});

test('shared input validation rejects html-like malformed payloads before Supabase writes', () => {
  assert.match(validationSource, /validateUserText/);
  assert.match(validationSource, /[<>]/);
  assert.match(validationSource, /javascript:/i);
  assert.match(validationSource, /Array\.from\s*\(/, 'must count emoji/4-byte Unicode by codepoint');
  assert.match(commentsSource, /validateUserText\s*\(\s*body[\s\S]*max:\s*500/);
  assert.match(commentsSource, /validateUuid\s*\(\s*rumorId/);
  assert.match(socialSource, /validateUserText\s*\(\s*caption[\s\S]*max:\s*280/);
  assert.match(socialSource, /validateUserText\s*\(\s*body[\s\S]*max:\s*280/);
  assert.match(socialSource, /validateUuid\s*\(\s*repostId/);
});

test('admin frontend does not commit Supabase project URL or publishable key literals', () => {
  assert.doesNotMatch(adminHtml, /https:\/\/[^'"`]+\.supabase\.co/);
  assert.doesNotMatch(adminHtml, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.match(adminHtml, /window\.__VIDDI_ADMIN_CONFIG__/);
  assert.match(adminHtml, /localStorage\.getItem\('VIDDI_ADMIN_SUPABASE_URL'\)/);
});
