import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../supabase/migrations/0048_variable_market_windows.sql', import.meta.url);
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8').replace(/\r\n/g, '\n') : '';

test('0048 migration is drafted for human handoff and adds market framing fields', () => {
  assert.equal(existsSync(migrationUrl), true, 'expected 0048_variable_market_windows.sql to exist');
  assert.match(sql, /Draft only: Chris applies this manually/i);
  assert.match(sql, /add column if not exists resolve_by_at timestamptz/i);
  assert.match(sql, /add column if not exists resolution_criteria text/i);
  assert.match(sql, /add column if not exists suggested_timeframe text/i);
  assert.match(sql, /rumors_resolve_by_not_before_close/i);
});

test('0048 clamps betting close to min 6h, max 45d, with null 7d fallback', () => {
  assert.match(sql, /create or replace function clamp_market_betting_close\s*\(/i);
  assert.match(sql, /p_requested_close_at is null then p_publish_at \+ interval '7 days'/i);
  assert.match(sql, /p_requested_close_at < p_publish_at \+ interval '6 hours' then p_publish_at \+ interval '6 hours'/i);
  assert.match(sql, /p_requested_close_at > p_publish_at \+ interval '45 days' then p_publish_at \+ interval '45 days'/i);
});

test('0048 replaces publish_approved_market hardcoded 7-day deadline with per-market close', () => {
  assert.match(sql, /drop function if exists publish_approved_market\(uuid, numeric, numeric, timestamptz, text, text\)/i);
  assert.match(sql, /p_betting_closes_at timestamptz default null/i);
  assert.match(sql, /v_requested_close := coalesce\(p_betting_closes_at, v_rumor\.prediction_deadline\)/i);
  assert.match(sql, /v_deadline := clamp_market_betting_close\(v_publish, v_requested_close\)/i);
  assert.doesNotMatch(sql, /v_deadline\s*:=\s*v_publish\s*\+\s*interval '7 days'/i);
  assert.match(sql, /'resolve_by_at', v_resolve_by/i);
  assert.match(sql, /resolve_by_at = v_resolve_by/i);
  assert.match(sql, /grant execute on function publish_approved_market\(uuid, numeric, numeric, timestamptz, text, text, timestamptz\) to authenticated, service_role/i);
});

test('0048 resolver uses resolve_by_at with prediction_deadline fallback and preserves VOID tie-breaker', () => {
  assert.match(sql, /coalesce\(rr\.resolve_by_at, rr\.prediction_deadline\) <= now\(\)/i);
  assert.match(sql, /if r\.resolution_policy = 'deadline' then[\s\S]*status = 'debunked'/i);
  assert.match(sql, /else\s*\n\s*perform void_rumor\(r\.id, 'resolve_by_window_closed_no_verdict'\)/i);
  assert.match(sql, /create index if not exists rumors_resolve_by_at_open_idx/i);
});
