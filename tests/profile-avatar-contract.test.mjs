import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const leaderboardSource = readFileSync(new URL('../src/lib/leaderboard.ts', import.meta.url), 'utf8');
const commentsSource = readFileSync(new URL('../src/lib/comments.ts', import.meta.url), 'utf8');
const socialSource = readFileSync(new URL('../src/lib/social.ts', import.meta.url), 'utf8');
const profileUrl = new URL('../src/lib/profile.ts', import.meta.url);

function readProfileAvatarMigration() {
  const migrationUrl = new URL('../supabase/migrations/0033_profile_avatar.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0033_profile_avatar.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('profile avatar migration adds bounded server-side avatar storage and set_avatar RPC', () => {
  const migration = readProfileAvatarMigration();

  assert.match(migration, /alter\s+table\s+profiles[\s\S]*add\s+column\s+if\s+not\s+exists\s+avatar\s+text/i);
  assert.match(migration, /profiles_avatar_safe_text/i);
  assert.match(migration, /char_length\s*\(\s*avatar\s*\)\s*<=\s*8/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+set_avatar\s*\(\s*p_avatar\s+text\s*\)/i);
  assert.match(migration, /auth\.uid\s*\(\s*\)\s+is\s+null/i);
  assert.match(migration, /v_avatar\s+is\s+not\s+null[\s\S]*v_avatar\s+not\s+in\s*\([\s\S]*'🔮'[\s\S]*'🃏'/i);
  assert.match(migration, /update\s+profiles[\s\S]*set\s+avatar\s*=/i);
  assert.match(migration, /where\s+id\s*=\s*auth\.uid\s*\(\s*\)/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+set_avatar\s*\(\s*text\s*\)\s+to\s+authenticated/i);
});

test('profile avatar migration exposes avatar on leaderboard and social repost feed', () => {
  const migration = readProfileAvatarMigration();

  assert.match(migration, /drop\s+function\s+if\s+exists\s+get_leaderboard\s*\(\s*integer\s*\)/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+get_leaderboard[\s\S]*avatar\s+text/i);
  assert.match(migration, /cr\.avatar/i);
  assert.match(migration, /create\s+or\s+replace\s+view\s+social_repost_feed\s+as[\s\S]*p\.avatar/i);
});

test('leaderboard comments and social lib contracts surface nullable avatars safely', () => {
  assert.match(leaderboardSource, /avatar:\s*string\s*\|\s*null/);
  assert.match(leaderboardSource, /avatar:\s*r\.avatar\s*\?\?\s*null/);
  assert.match(leaderboardSource, /select\(\s*'id, handle, avatar, total_points/);

  assert.match(commentsSource, /avatar:\s*string\s*\|\s*null/);
  assert.match(commentsSource, /select\(\s*'id, handle, avatar'\s*\)/);
  assert.match(commentsSource, /avatar:\s*avatars\.get\(r\.user_id\)\s*\?\?\s*null/);

  assert.match(socialSource, /avatar:\s*string\s*\|\s*null/);
  assert.match(socialSource, /avatar:\s*row\.avatar\s*\?\?\s*null/);
  assert.match(socialSource, /select\(\s*'id, handle, avatar'\s*\)/);
});

test('profile lib exposes setAvatar RPC wrapper for the picker handoff', () => {
  assert.equal(existsSync(profileUrl), true, 'expected src/lib/profile.ts to exist');
  const profileSource = readFileSync(profileUrl, 'utf8');

  assert.match(profileSource, /export\s+async\s+function\s+setAvatar\s*\(\s*avatar:\s*string\s*\|\s*null\s*\)/);
  assert.match(profileSource, /supabase\.rpc\(\s*'set_avatar'\s*,\s*\{\s*p_avatar:\s*avatar\s*\}/);
  assert.match(profileSource, /return\s+\{\s*ok:\s*true\s*\}/);
});
