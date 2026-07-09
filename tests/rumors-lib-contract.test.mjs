import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rumorsSource = readFileSync(new URL('../src/lib/rumors.ts', import.meta.url), 'utf8');

test('rumors lib exposes getRumorById returning Rumor or null', () => {
  assert.match(rumorsSource, /export\s+async\s+function\s+getRumorById\s*\(\s*id:\s*string\s*\):\s*Promise<\s*Rumor\s*\|\s*null\s*>/);
});

test('getRumorById reads one published non-draft rumor through RLS-safe table query', () => {
  assert.match(rumorsSource, /\.from\(\s*'rumors'\s*\)[\s\S]*\.select\(\s*RUMOR_SELECT\s*\)/);
  assert.match(rumorsSource, /\.eq\(\s*'id'\s*,\s*id\s*\)/);
  assert.match(rumorsSource, /\.eq\(\s*'is_draft'\s*,\s*false\s*\)/);
  assert.match(rumorsSource, /\.lte\(\s*'publish_at'\s*,\s*new\s+Date\(\)\.toISOString\(\)\s*\)/);
  assert.match(rumorsSource, /\.maybeSingle\(\s*\)/);
});

test('getRumorById maps with the same caller-state and mapRumorRows path as fetchFeed legacy', () => {
  assert.match(rumorsSource, /const\s+rowsWithMine\s*=\s*await\s+attachCallerState\s*\(\s*\[\s*data\s+as\s+(?:unknown\s+as\s+)?RumorRow\s*\]\s*\)/);
  assert.match(rumorsSource, /const\s+rowsWithOdds\s*=\s*await\s+attachOddsHistory\s*\(\s*rowsWithMine\s*\)/);
  assert.match(rumorsSource, /return\s+mapRumorRows\s*\(\s*rowsWithOdds\s*\)\s*\[\s*0\s*\]\s*\?\?\s*null/);
});
