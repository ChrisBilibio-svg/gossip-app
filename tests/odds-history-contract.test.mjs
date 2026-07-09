import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const rumorsSource = readFileSync(new URL('../src/lib/rumors.ts', import.meta.url), 'utf8');
const workflowUrl = new URL('../.github/workflows/snapshot-rumor-odds.yml', import.meta.url);
const scriptUrl = new URL('../scripts/snapshot-rumor-odds.mjs', import.meta.url);

function readOddsHistoryMigration() {
  const migrationUrl = new URL('../supabase/migrations/0034_rumor_odds_history.sql', import.meta.url);
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0034_rumor_odds_history.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('odds history migration stores TEA probability snapshots for open rumors', () => {
  const migration = readOddsHistoryMigration();

  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+rumor_odds_snapshots/i);
  assert.match(migration, /rumor_id\s+uuid\s+not\s+null\s+references\s+rumors\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  assert.match(migration, /tea_pct\s+integer\s+not\s+null\s+check\s*\(\s*tea_pct\s+between\s+0\s+and\s+100\s*\)/i);
  assert.match(migration, /volume\s+integer\s+not\s+null\s+check\s*\(\s*volume\s*>=\s*0\s*\)/i);
  assert.match(migration, /create\s+index\s+if\s+not\s+exists\s+rumor_odds_snapshots_recent_idx/i);
});

test('odds history migration snapshots current open rumor odds and exposes recent history', () => {
  const migration = readOddsHistoryMigration();

  assert.match(migration, /create\s+or\s+replace\s+function\s+snapshot_rumor_odds\s*\(\s*\)/i);
  assert.match(migration, /where\s+r\.status\s*=\s*'speculated'[\s\S]*coalesce\s*\(\s*r\.is_draft\s*,\s*false\s*\)\s*=\s*false[\s\S]*r\.publish_at\s*<=\s*now\s*\(\s*\)/i);
  assert.match(migration, /round\s*\(\s*\(\s*r\.seed_true\s*\+\s*r\.true_votes\s*\)\s*\*\s*100\.0\s*\//i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+get_rumor_odds_history\s*\(\s*p_rumor_id\s+uuid\s*,\s*p_limit\s+integer\s+default\s+8\s*\)/i);
  assert.match(migration, /order\s+by\s+captured_at\s+asc/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+get_rumor_odds_history\s*\(\s*uuid\s*,\s*integer\s*\)\s+to\s+anon,\s*authenticated/i);
});

test('odds history migration appends odds_history to feed and search RPCs', () => {
  const migration = readOddsHistoryMigration();

  assert.match(migration, /drop\s+function\s+if\s+exists\s+get_feed\s*\(\s*integer\s*\)/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+get_feed[\s\S]*odds_history\s+integer\[\]/i);
  assert.match(migration, /array_agg\s*\(\s*recent\.tea_pct\s+order\s+by\s+recent\.captured_at\s+asc\s*\)/i);
  assert.match(migration, /drop\s+function\s+if\s+exists\s+search_rumors\s*\(\s*text\s*,\s*integer\s*\)/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+search_rumors[\s\S]*odds_history\s+integer\[\]/i);
});

test('rumors lib exposes oddsHistory and falls back to an empty array pre-migration', () => {
  assert.match(rumorsSource, /oddsHistory:\s*number\[\]/);
  assert.match(rumorsSource, /odds_history\?:\s*number\[\]\s*\|\s*null/);
  assert.match(rumorsSource, /oddsHistory:\s*r\.odds_history\s*\?\?\s*\[\]/);
  assert.match(rumorsSource, /get_rumor_odds_history/);
  assert.match(rumorsSource, /p_rumor_id:\s*row\.id,\s*p_limit:\s*8/);
});

test('rumor odds snapshot script and workflow are scheduled with concurrency guards', () => {
  assert.equal(existsSync(scriptUrl), true, 'expected scripts/snapshot-rumor-odds.mjs to exist');
  assert.equal(existsSync(workflowUrl), true, 'expected snapshot-rumor-odds workflow to exist');
  const workflow = readFileSync(workflowUrl, 'utf8');

  assert.match(workflow, /cron:\s*'0 \*\/3 \* \* \*'/);
  assert.match(workflow, /^permissions:\r?\n\s+contents:\s+read\s*$/m);
  assert.match(workflow, /^concurrency:\r?\n\s+group:\s+\$\{\{ github\.workflow \}\}\s*\r?\n\s+cancel-in-progress:\s+false\s*$/m);
  assert.match(workflow, /node\s+scripts\/snapshot-rumor-odds\.mjs/);
});
