import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/0049_rpc_execute_hardening.sql', import.meta.url), 'utf8');

function has(pattern, message) {
  assert.match(sql, pattern, message);
}

test('0049 explicitly revokes PUBLIC/anon execute on sensitive auth and economy RPCs', () => {
  for (const signature of [
    'set_handle\\(text\\)',
    'set_avatar\\(text\\)',
    'set_profile_location\\(text, text\\)',
    'delete_my_account\\(\\)',
    'place_bet\\(uuid, bet_choice\\)',
    'request_fixed_prediction_quote\\(uuid, bet_choice\\)',
    'place_fixed_prediction\\(uuid, bet_choice, integer, integer, text, uuid\\)',
    'get_my_fixed_positions\\(integer\\)',
  ]) {
    has(new RegExp(`revoke all on function ${signature} from public, anon`, 'i'), `${signature} must revoke public/anon`);
    has(new RegExp(`grant execute on function ${signature} to authenticated`, 'i'), `${signature} must preserve authenticated execute`);
  }
});

test('0049 narrows curator and moderation RPC execution without removing service-role publish access', () => {
  for (const signature of [
    'resolve_rumor\\(uuid, boolean\\)',
    'resolve_rumor_with_evidence\\(uuid, boolean\\)',
    'record_market_decision\\(uuid, text, numeric, numeric, timestamptz, jsonb\\)',
    'get_moderation_queue\\(integer\\)',
  ]) {
    has(new RegExp(`revoke all on function ${signature} from public, anon`, 'i'), `${signature} must revoke public/anon`);
    has(new RegExp(`grant execute on function ${signature} to authenticated`, 'i'), `${signature} must preserve authenticated execute`);
  }
  assert.doesNotMatch(sql, /grant execute on function publish_approved_market\(uuid, numeric, numeric, timestamptz, text, text\) to authenticated, service_role/i);
  has(/Only the current signature is hardened/i);
  has(/grant execute on function publish_approved_market\(uuid, numeric, numeric, timestamptz, text, text, timestamptz\) to authenticated, service_role/i);
});

test('0049 keeps private group management RPCs authenticated-only', () => {
  for (const signature of [
    'create_group\\(text, timestamptz, text\\)',
    'join_group\\(text\\)',
    'leave_group\\(uuid\\)',
    'get_my_groups\\(\\)',
    'rename_group\\(uuid, text, text\\)',
    'remove_group_member\\(uuid, uuid\\)',
    'delete_group\\(uuid\\)',
    'regenerate_group_invite\\(uuid\\)',
  ]) {
    has(new RegExp(`revoke all on function ${signature} from public, anon`, 'i'), `${signature} must revoke public/anon`);
    has(new RegExp(`grant execute on function ${signature} to authenticated`, 'i'), `${signature} must preserve authenticated execute`);
  }
});
