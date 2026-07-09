import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { clusterDecisionForDraft, normalizeEventKey } from '../scripts/ingest.mjs';

const migrationUrl = new URL('../supabase/migrations/0037_source_clustering.sql', import.meta.url);
const rumorsSource = readFileSync(new URL('../src/lib/rumors.ts', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../gossip-admin/admin.html', import.meta.url), 'utf8');

function readMigration() {
  assert.equal(existsSync(migrationUrl), true, 'expected migration 0037_source_clustering.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('normalizeEventKey is accent/case insensitive and strips tracking words', () => {
  assert.equal(
    normalizeEventKey('Anitta confirma novo namoro?'),
    normalizeEventKey('ANITTA confirma o novo namoro!'),
  );
  assert.equal(
    normalizeEventKey('Influenciadora fala sobre término após boatos'),
    'influenciadora termino boatos',
  );
});

test('clusterDecisionForDraft conservatively clusters exact normalized events only', () => {
  const draft = { summary: 'Anitta confirma novo namoro?', article: 'contexto' };
  const candidates = [
    { id: 'a', summary: 'Outra história sem relação', event_key: normalizeEventKey('Outra história sem relação') },
    { id: 'b', summary: 'ANITTA confirma o novo namoro!', event_key: normalizeEventKey('ANITTA confirma o novo namoro!') },
  ];

  assert.deepEqual(clusterDecisionForDraft(draft, candidates), {
    action: 'cluster',
    rumorId: 'b',
    eventKey: normalizeEventKey(draft.summary),
    reason: 'event_key',
  });

  assert.deepEqual(clusterDecisionForDraft({ summary: 'Será que Anitta termina namoro?' }, candidates), {
    action: 'create',
    eventKey: normalizeEventKey('Será que Anitta termina namoro?'),
    reason: 'no_conservative_match',
  });
});

test('source clustering migration adds source_count/event_key and maintains counts from evidence sources', () => {
  const migration = readMigration();

  assert.match(migration, /alter\s+table\s+rumors[\s\S]*add\s+column\s+if\s+not\s+exists\s+source_count\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+event_key\s+text/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+refresh_rumor_source_count\s*\(\s*p_rumor_id\s+uuid\s*\)/i);
  assert.match(migration, /from\s+rumor_evidence_sources\s+es[\s\S]*where\s+es\.rumor_id\s*=\s*p_rumor_id/i);
  assert.match(migration, /create\s+trigger\s+rumor_evidence_sources_source_count_insert/i);
  assert.match(migration, /create\s+trigger\s+rumor_evidence_sources_source_count_update/i);
  assert.match(migration, /create\s+trigger\s+rumor_evidence_sources_source_count_delete/i);
});

test('feed/search RPCs and client mapping expose Rumor.sourceCount with pre-migration fallback', () => {
  const migration = readMigration();

  assert.match(migration, /create\s+or\s+replace\s+function\s+get_feed[\s\S]*source_count\s+integer/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+search_rumors[\s\S]*source_count\s+integer/i);
  assert.match(rumorsSource, /sourceCount:\s*number/);
  assert.match(rumorsSource, /source_count\?:\s*number\s*\|\s*null/);
  assert.match(rumorsSource, /sourceCount:\s*r\.source_count\s*\?\?\s*\(r\.rumor_evidence_sources\?\.length\s*\?\?\s*0\)/);
});

test('admin exposes cluster review split and merge controls', () => {
  assert.match(adminHtml, /N fontes/);
  assert.match(adminHtml, /data-split-source-id/);
  assert.match(adminHtml, /data-merge-cluster-id/);
  assert.match(adminHtml, /splitClusterSource/);
  assert.match(adminHtml, /mergeCluster/);
});
