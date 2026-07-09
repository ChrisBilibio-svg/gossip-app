import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/0041_groups_leagues.sql', import.meta.url);
const groupsLibUrl = new URL('../src/lib/groups.ts', import.meta.url);

function migrationSql() {
  assert.equal(existsSync(migrationUrl), true, '0041_groups_leagues.sql should exist');
  return readFileSync(migrationUrl, 'utf8');
}

function groupsSource() {
  assert.equal(existsSync(groupsLibUrl), true, 'src/lib/groups.ts should exist');
  return readFileSync(groupsLibUrl, 'utf8');
}

test('0041 groups migration creates private league tables with constraints, indexes, and RLS', () => {
  const sql = migrationSql();

  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+groups\s*\(/i);
  assert.match(sql, /name\s+text\s+not\s+null/i);
  assert.match(sql, /char_length\s*\(\s*btrim\s*\(\s*name\s*\)\s*\)\s+between\s+1\s+and\s+30/i);
  assert.match(sql, /owner_id\s+uuid\s+not\s+null\s+references\s+profiles\s*\(\s*id\s*\)/i);
  assert.match(sql, /invite_code\s+text\s+not\s+null\s+unique/i);
  assert.match(sql, /starts_at\s+timestamptz\s+not\s+null\s+default\s+now\s*\(\s*\)/i);
  assert.match(sql, /ends_at\s+timestamptz\s+not\s+null/i);
  assert.match(sql, /ends_at\s*>=\s*starts_at\s*\+\s*interval\s+'1 day'/i);
  assert.match(sql, /ends_at\s*<=\s*starts_at\s*\+\s*interval\s+'1 year'/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+group_members\s*\(/i);
  assert.match(sql, /primary\s+key\s*\(\s*group_id\s*,\s*user_id\s*\)/i);
  assert.match(sql, /role\s+text\s+not\s+null\s+check\s*\(\s*role\s+in\s*\(\s*'owner'\s*,\s*'member'\s*\)\s*\)/i);
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+group_members_user_id_idx/i);
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+groups_invite_code_idx/i);
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+groups_ends_at_idx/i);
  assert.match(sql, /alter\s+table\s+groups\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /alter\s+table\s+group_members\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /create\s+policy\s+groups_select_members/i);
  assert.match(sql, /create\s+policy\s+group_members_select_members/i);
  assert.doesNotMatch(sql, /create\s+policy\s+[^;]*(insert|update|delete)/i, 'writes should go through RPCs, not direct RLS policies');
});

test('0041 group RPCs validate auth, handles, caps, duration, invite secrecy, and rate limits', () => {
  const sql = migrationSql();

  for (const fn of ['create_group', 'join_group', 'leave_group', 'get_my_groups', 'get_group', 'get_group_leaderboard', 'rename_group', 'remove_group_member', 'delete_group', 'regenerate_group_invite']) {
    assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+${fn}\\s*\\(`, 'i'), `${fn} should be defined`);
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fn}`, 'i'), `${fn} should grant execute explicitly`);
  }

  assert.match(sql, /security\s+definer/ig);
  assert.match(sql, /auth\.uid\s*\(\s*\)\s+is\s+null[\s\S]*raise\s+exception\s+'not_authenticated'/i);
  assert.match(sql, /perform\s+check_rate_limit\s*\(\s*'groups_create'/i);
  assert.match(sql, /perform\s+check_rate_limit\s*\(\s*'groups_join'/i);
  assert.match(sql, /raise\s+exception\s+'no_handle'/i);
  assert.match(sql, /raise\s+exception\s+'invalid_duration'/i);
  assert.match(sql, /raise\s+exception\s+'group_full'/i);
  assert.match(sql, /raise\s+exception\s+'over_cap'/i);
  assert.match(sql, /raise\s+exception\s+'already_member'/i);
  assert.match(sql, /raise\s+exception\s+'group_ended'/i);
  assert.match(sql, /raise\s+exception\s+'not_found'/i);
  assert.match(sql, /for\s+v_attempt\s+in\s+1\.\.10\s+loop/i, 'invite code should retry collisions');
  assert.match(sql, /translate\s*\([^;]*'23456789ABCDEFGHJKMNPQRSTUVWXYZ'/i, 'invite code alphabet should omit 0/O/1/I/L');
  assert.match(sql, /upper\s*\(\s*btrim\s*\(\s*p_invite_code\s*\)\s*\)/i, 'join should be case-insensitive without exposing enumerable table reads');
});

test('0041 defines get_group_leaderboard before get_my_groups references it', () => {
  const sql = migrationSql();
  const leaderboardIndex = sql.search(/create\s+or\s+replace\s+function\s+get_group_leaderboard\s*\(/i);
  const myGroupsIndex = sql.search(/create\s+or\s+replace\s+function\s+get_my_groups\s*\(/i);

  assert.notEqual(leaderboardIndex, -1, 'get_group_leaderboard should be defined');
  assert.notEqual(myGroupsIndex, -1, 'get_my_groups should be defined');
  assert.ok(
    leaderboardIndex < myGroupsIndex,
    'get_group_leaderboard must be created before SQL function get_my_groups calls it',
  );
});

test('0041 group leaderboard scores resolved predictions inside the group window and freezes ended groups', () => {
  const sql = migrationSql();

  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+awarded_at\s+timestamptz/i);
  assert.match(sql, /set\s+awarded_at\s*=\s*coalesce\s*\(\s*p\.scored_at\s*,\s*r\.resolved_at\s*\)/i);
  assert.match(sql, /awarded_at\s*=\s*now\s*\(\s*\)/i, 'resolve_rumor should stamp award timestamp');
  assert.match(sql, /v_window_end\s*:=\s*least\s*\(\s*v_group\.ends_at\s*,\s*now\s*\(\s*\)\s*\)/i);
  assert.match(sql, /pred\.awarded_at\s*>=\s*v_group\.starts_at/i);
  assert.match(sql, /pred\.awarded_at\s*<\s*v_window_end/i);
  assert.match(sql, /coalesce\s*\(\s*sum\s*\(\s*pred\.points_awarded\s*\)\s*,\s*0\s*\)::integer\s+as\s+points/i);
  assert.match(sql, /count\s*\(\s*pred\.id\s*\)\s+filter\s*\(\s*where\s+pred\.is_correct\s+is\s+true\s*\)::integer\s+as\s+correct_count/i);
  assert.match(sql, /count\s*\(\s*pred\.id\s*\)::integer\s+as\s+resolved_count/i);
  assert.match(sql, /order\s+by\s+points\s+desc\s*,\s+correct_count\s+desc\s*,\s+resolved_count\s+desc\s*,\s+scores\.joined_at\s+asc\s*,\s+scores\.id\s+asc/i);
  assert.match(sql, /MVP\s+counts\s+from\s+starts_at\s+regardless\s+of\s+join\s+date/i);
});

test('src/lib/groups exposes typed RPC wrappers with missing-RPC safe fallbacks', () => {
  const source = groupsSource();

  for (const name of ['GroupSummary', 'GroupMeta', 'GroupLeaderboardRow', 'GroupMutationResult']) {
    assert.match(source, new RegExp(`export\\s+interface\\s+${name}\\s*{`, 'i'), `${name} interface should be exported`);
  }
  for (const fn of ['createGroup', 'joinGroup', 'leaveGroup', 'getMyGroups', 'getGroup', 'getGroupLeaderboard', 'renameGroup', 'removeGroupMember', 'deleteGroup', 'regenerateGroupInvite']) {
    assert.match(source, new RegExp(`export\\s+async\\s+function\\s+${fn}\\s*\\(`, 'i'), `${fn} wrapper should exist`);
  }

  assert.match(source, /import\s+\{\s*isMissingRpcError\s*\}\s+from\s+'\.\/rpcFallback'/);
  assert.match(source, /groupsUnavailable/i);
  assert.match(source, /return\s+\{\s*groups:\s*\[\]\s*,\s*error:\s*groupsUnavailable/i);
  assert.match(source, /return\s+\{\s*rows:\s*\[\]\s*,\s*error:\s*groupsUnavailable/i);
  assert.match(source, /validateUserText\s*\(\s*name\s*,\s*\{\s*min:\s*1\s*,\s*max:\s*30\s*,\s*label:\s*'Nome do grupo'/i);
  assert.match(source, /validateUuid\s*\(\s*groupId\s*,\s*'Grupo'\s*\)/i);
});
