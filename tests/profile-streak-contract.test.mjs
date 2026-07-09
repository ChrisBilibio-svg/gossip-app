import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/0040_profile_streaks.sql', import.meta.url);
const profileSource = readFileSync(new URL('../src/lib/profile.ts', import.meta.url), 'utf8');
const leaderboardSource = readFileSync(new URL('../src/lib/leaderboard.ts', import.meta.url), 'utf8');

let applyStreakTransition;
try {
  ({ applyStreakTransition } = await import('../src/lib/streaks.ts'));
} catch {
  applyStreakTransition = null;
}

test('applyStreakTransition increments correct, resets wrong, and leaves void unchanged', () => {
  assert.equal(typeof applyStreakTransition, 'function');

  assert.deepEqual(
    applyStreakTransition({ currentStreak: 2, bestStreak: 5 }, true),
    { currentStreak: 3, bestStreak: 5 },
  );
  assert.deepEqual(
    applyStreakTransition({ currentStreak: 5, bestStreak: 5 }, true),
    { currentStreak: 6, bestStreak: 6 },
  );
  assert.deepEqual(
    applyStreakTransition({ currentStreak: 4, bestStreak: 7 }, false),
    { currentStreak: 0, bestStreak: 7 },
  );
  assert.deepEqual(
    applyStreakTransition({ currentStreak: 4, bestStreak: 7 }, null),
    { currentStreak: 4, bestStreak: 7 },
  );
});

test('0040 migration adds current/best streak columns and updates scoring without void accuracy changes', () => {
  assert.equal(existsSync(migrationUrl), true, '0040_profile_streaks.sql should exist');
  const sql = readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+current_streak\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(sql, /add\s+column\s+if\s+not\s+exists\s+best_streak\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(sql, /current_streak\s*=\s*case\s+when\s+v_correct\s+then\s+current_streak\s*\+\s*1\s+else\s+0\s+end/i);
  assert.match(sql, /best_streak\s*=\s*greatest\s*\(\s*best_streak\s*,\s*case\s+when\s+v_correct\s+then\s+current_streak\s*\+\s*1\s+else\s+0\s+end\s*\)/i);

  const voidBody = sql.match(/create\s+or\s+replace\s+function\s+void_rumor[\s\S]*?\$\$;/i)?.[0] ?? '';
  assert.match(voidBody, /is_correct\s*=\s*null/i);
  assert.match(voidBody, /points_awarded\s*=\s*0/i);
  assert.doesNotMatch(voidBody, /update\s+profiles/i, 'void_rumor must not change points, accuracy, or streaks');
});

test('0040 migration backfills current and best streaks from scored prediction history in chronological order', () => {
  assert.equal(existsSync(migrationUrl), true, '0040_profile_streaks.sql should exist');
  const sql = readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /create\s+or\s+replace\s+function\s+recompute_profile_streaks\s*\(/i);
  assert.match(sql, /order\s+by\s+coalesce\s*\(\s*r\.resolved_at\s*,\s*p\.scored_at\s*\)\s+asc\s*,\s*p\.scored_at\s+asc\s*,\s*p\.id\s+asc/i);
  assert.match(sql, /where\s+p\.scored_at\s+is\s+not\s+null[\s\S]*p\.is_correct\s+is\s+not\s+null/i);
  assert.match(sql, /select\s+recompute_profile_streaks\s*\(\s*\)/i);
});

test('profile and leaderboard client contracts expose streak fields with pre-migration zero fallback', () => {
  assert.match(profileSource, /currentStreak:\s*number/);
  assert.match(profileSource, /bestStreak:\s*number/);
  assert.match(profileSource, /current_streak/);
  assert.match(profileSource, /best_streak/);
  assert.match(profileSource, /isMissingOptionalProfileColumnError/);
  assert.match(profileSource, /currentStreak:\s*data\.current_streak\s*\?\?\s*0/);
  assert.match(profileSource, /bestStreak:\s*data\.best_streak\s*\?\?\s*0/);
  assert.match(profileSource, /currentStreak:\s*0/);
  assert.match(profileSource, /bestStreak:\s*0/);

  assert.match(leaderboardSource, /currentStreak:\s*number/);
  assert.match(leaderboardSource, /current_streak\??:\s*number\s*\|\s*null/);
  assert.match(leaderboardSource, /currentStreak:\s*r\.current_streak\s*\?\?\s*0/);
  assert.match(leaderboardSource, /isMissingOptionalLeaderboardColumnError/);
});
