import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/0042_state_leaderboards.sql', import.meta.url), 'utf8');
const leaderboardSource = readFileSync(new URL('../src/lib/leaderboard.ts', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8');
const screenSource = readFileSync(new URL('../src/screens/LeaderboardScreen.tsx', import.meta.url), 'utf8');
const projectStatus = readFileSync(new URL('../PROJECT_STATUS.md', import.meta.url), 'utf8');

test('0042 stores only coarse profile location and exposes authenticated setter', () => {
  assert.match(migration, /alter\s+table\s+profiles[\s\S]*add\s+column\s+if\s+not\s+exists\s+country_code\s+text/i);
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+state_code\s+text/i);
  assert.doesNotMatch(migration, /latitude|longitude|gps|geography|geometry/i, 'state leaderboard must not store precise coordinates');
  assert.match(migration, /profiles_country_code_format/i);
  assert.match(migration, /profiles_state_code_format/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+set_profile_location\s*\(/i);
  assert.match(migration, /where\s+id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+set_profile_location\s*\(\s*text\s*,\s*text\s*\)\s+to\s+authenticated/i);
});

test('0042 replaces get_leaderboard with state/world scoped ranking', () => {
  assert.match(migration, /drop\s+function\s+if\s+exists\s+get_leaderboard\s*\(\s*integer\s*\)/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+get_leaderboard\s*\(\s*p_limit\s+integer\s+default\s+100\s*,\s*p_scope\s+text\s+default\s+'world'/i);
  assert.match(migration, /returns\s+table\s*\([\s\S]*state_code\s+text[\s\S]*current_streak\s+integer/i);
  assert.match(migration, /v_scope\s+text\s*:=\s*lower\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_scope\s*,\s*'world'/i);
  assert.match(migration, /v_state_code\s+text\s*:=\s*upper\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_state_code[\s\S]*profiles[\s\S]*auth\.uid\s*\(\s*\)/i);
  assert.match(migration, /where\s+v_scope\s*=\s*'world'\s+or\s+\(\s*v_scope\s*=\s*'state'[\s\S]*p\.state_code\s*=\s*v_state_code/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+get_leaderboard\s*\(\s*integer\s*,\s*text\s*,\s*text\s*\)\s+to\s+anon\s*,\s*authenticated/i);
});

test('client leaderboard contract supports state/world scope with pre-migration fallbacks', () => {
  assert.match(leaderboardSource, /export\s+type\s+LeaderboardScope\s*=\s*'state'\s*\|\s*'world'/);
  assert.match(leaderboardSource, /stateCode:\s*string\s*\|\s*null/);
  assert.match(leaderboardSource, /supabase\.rpc\(\s*'get_leaderboard'\s*,\s*\{\s*p_limit:\s*limit,\s*p_scope:\s*scope/i);
  assert.match(leaderboardSource, /getLeaderboardLegacy\(\s*limit\s*,\s*scope\s*,\s*stateCode/i);
  assert.match(leaderboardSource, /getMyLeaderboardLocation/);
  assert.match(leaderboardSource, /select\(\s*'country_code, state_code'\s*\)/);
  assert.match(profileSource, /export\s+type\s+SetProfileLocationResult/);
  assert.match(profileSource, /setProfileLocation\s*\(/);
});

test('leaderboard screen defaults to state leaderboard and lets players switch state/world', () => {
  assert.match(screenSource, /type\s+LeaderboardScopeTab\s*=\s*'state'\s*\|\s*'world'/);
  assert.match(screenSource, /useState<LeaderboardScopeTab>\('state'\)/);
  assert.match(screenSource, /getMyLeaderboardLocation\(\)/);
  assert.match(screenSource, /const\s+activeScope\s*=\s*leaderboardScope\s*===\s*'state'\s*&&\s*!location\.stateCode\s*\?\s*'world'\s*:\s*leaderboardScope/i);
  assert.match(screenSource, /getLeaderboard\(\{\s*scope:\s*activeScope/i);
  assert.match(screenSource, /\['state',\s*'world'\]/);
  assert.match(screenSource, /Estado/);
  assert.match(screenSource, /Mundo/);
});

test('source of truth documents 0042 as code-ready pending manual apply', () => {
  assert.match(projectStatus, /`0042` state leaderboards/i);
  assert.match(projectStatus, /0042_state_leaderboards\.sql/i);
  assert.match(projectStatus, /pending manual apply/i);
});
