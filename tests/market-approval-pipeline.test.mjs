import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Normalize line endings so literal "\n" assertions are robust to Git autocrlf.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('../supabase/migrations/0045_market_approval_pipeline.sql');
const fixSql = read('../supabase/migrations/0046_fix_publish_rpc.sql');
const rlSql = read('../supabase/migrations/0047_analytics_rate_limit_service_exempt.sql');
const admin = read('../gossip-admin/admin.html');

test('0045 backfills log_product_event with the exact live signature + security', () => {
  assert.match(sql, /create or replace function public\.log_product_event\(p_user_id uuid, p_event_name text, p_properties jsonb\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path to 'public'/);
  assert.match(sql, /perform log_economy_analytics\(p_user_id, p_event_name, coalesce\(p_properties, '\{\}'::jsonb\), 'app'\)/);
  assert.match(sql, /revoke all on function public\.log_product_event\(uuid, text, jsonb\) from public/);
  assert.match(sql, /grant execute on function public\.log_product_event\(uuid, text, jsonb\) to service_role/);
});

test('0045 is additive only (no drops / no destructive alters of existing objects)', () => {
  assert.doesNotMatch(sql, /drop table (?!if exists market_approval_audit)/i);
  assert.doesNotMatch(sql, /drop column/i);
  assert.doesNotMatch(sql, /alter column/i);
  // adds columns idempotently
  assert.match(sql, /add column if not exists market_state text/);
  assert.match(sql, /add column if not exists scheduled_publish_at timestamptz/);
});

test('market_state constraint enumerates the full lifecycle', () => {
  for (const state of ['draft', 'needs_review', 'approved', 'scheduled', 'published', 'rejected', 'publish_failed']) {
    assert.ok(sql.includes(`'${state}'`), `missing state ${state}`);
  }
});

test('approval audit table is append-only and curator-readable', () => {
  assert.match(sql, /create table if not exists market_approval_audit/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select using \(is_curator\(\)\)/);
  assert.match(sql, /before update or delete on market_approval_audit/);
  assert.match(sql, /raise exception 'market_approval_audit is append-only'/);
});

test('publish_approved_market is authorized and computes deadline from publish time', () => {
  assert.match(sql, /if not \(is_curator\(\) or v_role = 'service_role'\) then\s*\n\s*raise exception/);
  assert.match(sql, /v_deadline := v_publish \+ interval '7 days'/);
  assert.match(sql, /if v_deadline <= now\(\) then raise exception 'publication window already expired'/);
});

test('publish_approved_market uses the repo fixed-market mechanism and validates atomically', () => {
  assert.match(sql, /perform service_approve_fixed_market_probabilities\(/);
  // publishes the rumor only after the version/outcomes are created
  const pubIdx = sql.indexOf('update rumors set\n    is_draft = false');
  const svcIdx = sql.indexOf('perform service_approve_fixed_market_probabilities(');
  assert.ok(svcIdx > -1 && pubIdx > svcIdx, 'publish update must come after probability init');
  assert.match(sql, /is_draft = false,\s*\n\s*status = 'speculated',/);
  assert.match(sql, /market_state = 'published'/);
});

test('publish_approved_market is idempotent by key', () => {
  assert.match(sql, /a\.idempotency_key = p_idempotency_key and a\.action = 'publish'/);
});

test('record_market_decision is curator-only, never publishes, enforces prob sum', () => {
  assert.match(sql, /if not is_curator\(\) then raise exception 'curator authorization required'/);
  assert.match(sql, /must sum to 1\.0/);
  // it only touches unpublished drafts and never flips is_draft to false
  assert.match(sql, /where id = p_rumor_id and is_draft = true/);
  const body = sql.slice(sql.indexOf('function record_market_decision'), sql.indexOf('function publish_approved_market'));
  assert.doesNotMatch(body, /is_draft = false/);
});

test('scheduler reuses the atomic RPC and is service-role only', () => {
  assert.match(sql, /perform publish_approved_market\(/);
  assert.match(sql, /market_state = 'publish_failed'/);
  assert.match(sql, /revoke all on function publish_due_scheduled_markets\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function publish_due_scheduled_markets\(\) to service_role/);
});

test('privileged RPCs are not granted to public/anon', () => {
  assert.match(sql, /revoke all on function publish_approved_market\([^)]*\) from public/);
  assert.match(sql, /grant execute on function publish_approved_market\([^)]*\) to authenticated, service_role/);
  assert.match(sql, /revoke all on function record_market_decision\([^)]*\) from public/);
});

test('0045 never touches the purchase kill switch', () => {
  assert.doesNotMatch(sql, /purchases_killed/);
});

test('0046 fixes the OUT-column ambiguity (out_ prefixed return columns)', () => {
  for (const col of ['out_rumor_id', 'out_publish_at', 'out_prediction_deadline', 'out_probability_version']) {
    assert.ok(fixSql.includes(col), `missing renamed OUT column ${col}`);
  }
  // internal version lookup is table-qualified, not bare rumor_id
  assert.match(fixSql, /from prediction_market_probability_versions v where v\.rumor_id = p_rumor_id/);
});

test('0046 revokes execute on privileged RPCs from anon', () => {
  assert.match(fixSql, /revoke all on function publish_approved_market\([^)]*\) from public, anon/);
  assert.match(fixSql, /revoke all on function record_market_decision\([^)]*\) from public, anon/);
  assert.doesNotMatch(fixSql, /grant execute on function publish_approved_market\([^)]*\) to [^;]*anon/);
});

test('0047 exempts service_role from the analytics rate limit (keeps users limited)', () => {
  assert.match(rlSql, /= 'service_role' then\s*\n\s*return new;/);
  assert.match(rlSql, /perform check_rate_limit\('analytics_events'/);
});

test('admin queue publishes via the atomic RPC, never a direct is_draft update', () => {
  assert.match(admin, /sb\.rpc\('publish_approved_market'/);
  assert.match(admin, /sb\.rpc\('record_market_decision'/);
  // the old direct-update approve path is gone
  assert.doesNotMatch(admin, /update\(\{\s*\n?\s*is_draft: false/);
  assert.doesNotMatch(admin, /data-approve-draft-id/);
});

test('admin queue offers approve/schedule/reject/request_changes + editable probability', () => {
  for (const action of ['schedule', 'request_changes', 'reject']) {
    assert.ok(admin.includes(`data-action="${action}"`), `missing action ${action}`);
  }
  assert.match(admin, /id="prob-/); // editable Verdade probability input
  assert.match(admin, /id="sched-/); // schedule time input
});

test('no service-role key is embedded in the migration or admin client', () => {
  assert.doesNotMatch(sql, /service_role_key|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(admin, /SERVICE_ROLE|service_role_key/);
  // client uses the anon key only
  assert.match(admin, /supabaseAnonKey|SUPABASE_ANON_KEY/);
});
