import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { updateMarketDecisionForDraft } from '../scripts/ingest.mjs';

const migrationUrl = new URL('../supabase/migrations/0039_update_markets.sql', import.meta.url);
const rumorsSource = readFileSync(new URL('../src/lib/rumors.ts', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../gossip-admin/admin.html', import.meta.url), 'utf8');

function readMigration() {
  assert.equal(existsSync(migrationUrl), true, 'expected 0039_update_markets.sql to exist');
  return readFileSync(migrationUrl, 'utf8');
}

test('update markets migration adds nullable self-reference and exposes parent in feed RPCs', () => {
  const migration = readMigration();

  assert.match(migration, /alter\s+table\s+rumors[\s\S]*add\s+column\s+if\s+not\s+exists\s+updates_rumor_id\s+uuid/i);
  assert.match(migration, /foreign\s+key\s*\(\s*updates_rumor_id\s*\)\s+references\s+rumors\s*\(\s*id\s*\)/i);
  assert.match(migration, /check\s*\(\s*updates_rumor_id\s+is\s+null\s+or\s+updates_rumor_id\s*<>\s*id\s*\)/i);
  assert.match(migration, /returns\s+table[\s\S]*updates_rumor_id\s+uuid[\s\S]*updates_rumor_summary\s+text/i);
  assert.match(migration, /left\s+join\s+rumors\s+parent\s+on\s+parent\.id\s*=\s*r\.updates_rumor_id/i);
  assert.match(migration, /get_feed\s*\(\s*p_limit\s+integer/i);
  assert.match(migration, /search_rumors\s*\(\s*p_query\s+text/i);
});

test('rumors lib maps update parent reference with null pre-migration fallback', () => {
  assert.match(rumorsSource, /export\s+interface\s+UpdatedRumorReference\s*{[\s\S]*id:\s*string;[\s\S]*summary:\s*string;[\s\S]*}/);
  assert.match(rumorsSource, /updatesRumor:\s*UpdatedRumorReference\s*\|\s*null/);
  assert.match(rumorsSource, /updates_rumor_id\?:\s*string\s*\|\s*null/);
  assert.match(rumorsSource, /updates_rumor_summary\?:\s*string\s*\|\s*null/);
  assert.match(rumorsSource, /updatesRumor:\s*r\.updates_rumor_id\s*&&\s*r\.updates_rumor_summary\s*\?/);
  assert.match(rumorsSource, /updatesRumor:\s*[\s\S]*:\s*null/);
  assert.match(rumorsSource, /isMissingOptionalUpdateError/);
});

test('ingest update decision is conservative: same entities plus changed claim only', () => {
  const parent = {
    id: '11111111-1111-4111-8111-111111111111',
    summary: 'Será que Ana e Beto vão reatar o namoro até sexta?',
  };

  assert.deepEqual(
    updateMarketDecisionForDraft(
      { summary: 'Será que Ana e Beto vão aparecer juntos em público após os rumores de volta?' },
      [parent],
    ),
    {
      action: 'update',
      rumorId: parent.id,
      updateRumorId: parent.id,
      reason: 'same_entities_changed_claim',
    },
  );

  assert.equal(
    updateMarketDecisionForDraft(
      { summary: 'Será que Ana e Beto vão reatar o namoro até sexta?' },
      [parent],
    ).action,
    'none',
    'same claim should cluster/dedupe elsewhere, not create an update market',
  );

  assert.equal(
    updateMarketDecisionForDraft(
      { summary: 'Será que Carla vai lançar música nova?' },
      [parent],
    ).action,
    'none',
    'different entities must not link as update',
  );
});

test('ingest payload and admin expose curator-editable updates_rumor_id', () => {
  assert.match(adminSource, /updates_rumor_id/);
  assert.match(adminSource, /data-set-update-parent-id/);
  assert.match(adminSource, /setUpdateParent\s*=\s*async/);
  assert.match(adminSource, /Atualiza mercado/);

  const ingestSource = readFileSync(new URL('../scripts/ingest.mjs', import.meta.url), 'utf8');
  assert.match(ingestSource, /updatesRumorId:\s*decision\.updateRumorId\s*\?\?/);
  assert.match(ingestSource, /updates_rumor_id:\s*options\.updatesRumorId\s*\?\?/);
  assert.match(ingestSource, /updates_rumor_id|schema cache|column/i);
});
