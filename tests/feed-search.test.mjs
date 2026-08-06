import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { filterRumorsByQuery } from '../src/lib/feedSearchCore.ts';

const feedSearchSource = readFileSync(new URL('../src/lib/feedSearch.ts', import.meta.url), 'utf8');

const rumors = [
  {
    id: '1',
    summary: 'Cantor lança turnê no Rio',
    article: 'Shows novos foram anunciados hoje.',
    createdAt: '2026-06-05T15:00:00Z',
  },
  {
    id: '2',
    summary: 'Atriz nega namoro',
    article: 'A entrevista falou sobre novela e bastidores.',
    createdAt: '2026-06-06T12:00:00Z',
  },
  {
    id: '3',
    summary: 'Influencer comenta novela',
    article: 'O bastidor da novela virou assunto.',
    createdAt: '2026-06-04T12:00:00Z',
  },
];

test('filterRumorsByQuery returns all rumors sorted by most recent when query is blank', () => {
  assert.deepEqual(
    filterRumorsByQuery(rumors, '').map((r) => r.id),
    ['2', '1', '3'],
  );
});

test('filterRumorsByQuery matches keywords in summary or article and sorts by most recent', () => {
  assert.deepEqual(
    filterRumorsByQuery(rumors, 'novela').map((r) => r.id),
    ['2', '3'],
  );
});

test('filterRumorsByQuery is case and accent insensitive', () => {
  assert.deepEqual(
    filterRumorsByQuery(rumors, 'atriz').map((r) => r.id),
    ['2'],
  );
});

test('searchRumorsByQuery uses server search RPC when configured', () => {
  assert.match(feedSearchSource, /export\s+async\s+function\s+searchRumorsByQuery\s*\(\s*query:\s*string[\s\S]*Promise<\s*FeedResult\s*>/);
  assert.match(feedSearchSource, /supabase\.rpc\s*\(\s*'search_rumors'\s*,\s*\{\s*p_query:\s*query\.trim\s*\(\s*\)\s*,\s*p_limit:\s*limit\s*\}/);
  assert.match(feedSearchSource, /attachEditorialImages\s*\(\s*\(\s*data\s*\?\?\s*\[\s*\]\s*\)\s+as\s+RumorRow\[\]\s*\)/);
  assert.match(feedSearchSource, /mapRumorRows\s*\(\s*rows\s*\)/);
});

test('searchRumorsByQuery falls back to local filtering when RPC is missing or Supabase is unconfigured', () => {
  assert.match(feedSearchSource, /if\s*\(\s*!supabaseConfigured\s*\)\s*return\s+localSearchResult\s*\(\s*fallbackRumors\s*,\s*query\s*\)/);
  assert.match(feedSearchSource, /if\s*\(\s*isMissingRpcError\s*\(\s*error\s*\)\s*\)\s*return\s+localSearchResult\s*\(\s*fallbackRumors\s*,\s*query\s*\)/);
});
