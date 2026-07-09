import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/0038_keyword_notifications.sql', import.meta.url);
const notificationsLibUrl = new URL('../src/lib/notifications.ts', import.meta.url);
const senderUrl = new URL('../scripts/send-keyword-notifications.mjs', import.meta.url);
const workflowUrl = new URL('../.github/workflows/send-keyword-notifications.yml', import.meta.url);

function readMigration() {
  assert.equal(existsSync(migrationUrl), true, 'expected 0038_keyword_notifications.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('keyword notification migration creates LGPD-minimal subscriptions with own-row RLS and caps', () => {
  const migration = readMigration();

  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+keyword_subscriptions/i);
  assert.match(migration, /user_id\s+uuid\s+not\s+null\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  assert.match(migration, /keyword\s+text\s+not\s+null/i);
  assert.match(migration, /unique\s*\(\s*user_id\s*,\s*keyword\s*\)/i);
  assert.match(migration, /alter\s+table\s+keyword_subscriptions\s+enable\s+row\s+level\s+security/i);
  assert.match(migration, /using\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  assert.match(migration, /keyword_subscription_limit/i);
  assert.match(migration, /normalize_keyword\s*\(/i);
});

test('keyword notification migration enqueues opted-in capped notifications on publish', () => {
  const migration = readMigration();

  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+notification_queue/i);
  assert.match(migration, /kind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(\s*'keyword_match'/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+enqueue_keyword_notifications_for_rumor\s*\(\s*p_rumor_id\s+uuid\s*\)/i);
  assert.match(migration, /notification_preferences[\s\S]*breaking_news\s*=\s*true/i);
  assert.match(migration, /count\s*\(\s*\*\s*\)[\s\S]*notification_queue[\s\S]*created_at\s*>\s*now\s*\(\s*\)\s*-\s*interval\s+'1 hour'/i);
  assert.match(migration, /create\s+trigger\s+rumors_keyword_notifications_insert/i);
  assert.match(migration, /create\s+trigger\s+rumors_keyword_notifications_publish/i);
});

test('notifications client API exposes keyword subscription functions with normalized keywords', () => {
  assert.equal(existsSync(notificationsLibUrl), true, 'expected src/lib/notifications.ts to exist');
  const source = readFileSync(notificationsLibUrl, 'utf8');

  assert.match(source, /export\s+function\s+normalizeKeyword\s*\(\s*keyword:\s*string\s*\)/);
  assert.match(source, /export\s+async\s+function\s+subscribeKeyword\s*\(\s*keyword:\s*string\s*\)/);
  assert.match(source, /export\s+async\s+function\s+unsubscribeKeyword\s*\(\s*keyword:\s*string\s*\)/);
  assert.match(source, /export\s+async\s+function\s+listKeywords\s*\(\s*\)/);
  assert.match(source, /\.normalize\(\s*'NFD'\s*\)[\s\S]*[\\u0300-\\u036f]/);
  assert.match(source, /keyword_subscriptions/);
  assert.match(source, /ignoreDuplicates:\s*true/);
});

test('keyword notification sender parses config strictly without exposing secrets', async () => {
  const mod = await import('../scripts/send-keyword-notifications.mjs?config-test=' + Date.now());

  assert.equal(typeof mod.buildConfig, 'function');
  assert.equal(typeof mod.validateConfig, 'function');
  assert.deepEqual(
    mod.buildConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-service-key',
      KEYWORD_NOTIFICATION_LIMIT: '25',
      DRY_RUN: 'true',
    }),
    {
      supabaseUrl: 'https://example.supabase.co',
      serviceKey: 'secret-service-key',
      limit: 25,
      dryRun: true,
    },
  );

  assert.throws(
    () => mod.buildConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-service-key',
      KEYWORD_NOTIFICATION_LIMIT: '25abc',
    }),
    /KEYWORD_NOTIFICATION_LIMIT must be an integer between 1 and 500/,
  );
  assert.throws(() => mod.validateConfig(null), /Missing env: SUPABASE_URL/);
});

test('Expo push sender and scheduled workflow deliver queued notifications without native client dep', () => {
  assert.equal(existsSync(senderUrl), true, 'expected send-keyword-notifications script to exist');
  assert.equal(existsSync(workflowUrl), true, 'expected keyword notification workflow to exist');

  const script = readFileSync(senderUrl, 'utf8');
  const workflow = readFileSync(workflowUrl, 'utf8');

  assert.match(script, /https:\/\/exp\.host\/--\/api\/v2\/push\/send/);
  assert.match(script, /notification_queue/);
  assert.match(script, /push_devices/);
  assert.match(script, /mark_notification_delivered/);
  assert.match(workflow, /cron:\s*'\*\/15 \* \* \* \*'/);
  assert.match(workflow, /node\s+scripts\/send-keyword-notifications\.mjs/);
  assert.match(workflow, /^permissions:\r?\n\s+contents:\s+read\s*$/m);
});
