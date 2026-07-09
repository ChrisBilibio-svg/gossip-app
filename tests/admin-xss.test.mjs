import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const adminHtml = await readFile(new URL('../gossip-admin/admin.html', import.meta.url), 'utf8');

test('admin dynamic content renders escaped inside innerHTML templates', () => {
  assert.match(adminHtml, /\$\{esc\(r\.summary\)\}/, 'draft/rumor summaries must be escaped');
  assert.match(adminHtml, /motivo: \$\{esc\(rep\.reason \|\| '—'\)\}/, 'report reasons must be escaped');
  assert.match(adminHtml, /\"\$\{esc\(rep\.comments\?\.body \?\? '\(removido\)'\)\}\"/, 'reported comment bodies must be escaped');
  assert.match(adminHtml, /\$\{esc\(r\.source_label \|\| 'auto'\)\}/, 'draft source labels must be escaped');
  assert.match(adminHtml, /\$\{esc\(s\.source_label \|\| 'fonte'\)\}/, 'evidence source labels must be escaped');
});

test('admin action buttons avoid inline user-controlled onclick payloads', () => {
  assert.doesNotMatch(adminHtml, /onclick="editRumor\('/, 'edit buttons must not inject summaries into inline onclick attributes');
  assert.doesNotMatch(adminHtml, /JSON\.stringify\(r\.summary\)/, 'summary values must not be serialized into executable JS attributes');
  assert.match(adminHtml, /data-edit-rumor-id=/, 'edit buttons should use inert data attributes');
  assert.match(adminHtml, /addEventListener\('click', \(\) => editRumor/, 'edit actions should be wired with event listeners');
});

test('admin defaults manual gossip to evidence policy with a seven-day resolve-by fallback', () => {
  assert.match(adminHtml, /const\s+SEVEN_DAYS_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, 'admin should define the seven-day resolve-by window');
  assert.match(adminHtml, /function\s+sevenDayDeadlineFrom\s*\(\s*publishIso/i, 'admin should compute resolve-by windows from publish time');
  assert.match(adminHtml, /<option value="evidence">Evidência:[\s\S]*sem veredito no prazo = VOID/, 'manual create should expose evidence/VOID policy');
  assert.match(adminHtml, /<option value="deadline">Prazo "até data X":[\s\S]*CAP se não acontecer\/confirmar/, 'manual create should keep true deadline policy available');
  assert.match(adminHtml, /const\s+policy\s*=\s*\$\('resolutionPolicy'\)\.value\s*===\s*'deadline'\s*\?\s*'deadline'\s*:\s*'evidence'/, 'manual create should default to evidence but allow deadline');
  assert.match(adminHtml, /prediction_deadline:\s*deadline\s*\|\|\s*sevenDayDeadlineFrom\s*\(\s*publish\s*\)/, 'manual create should default missing resolve-by to publish + seven days');
  assert.doesNotMatch(adminHtml, /const\s+policy\s*=\s*'deadline'/, 'manual create must not force deadline policy');
});

test('admin approval stamps drafts with evidence policy and a fresh resolve-by window', () => {
  assert.match(adminHtml, /const\s+publishAt\s*=\s*new\s+Date\s*\(\s*\)\.toISOString\s*\(\s*\)/, 'draft approval should capture publish time');
  assert.match(adminHtml, /approveDraft[\s\S]*prediction_deadline:\s*sevenDayDeadlineFrom\s*\(\s*publishAt\s*\)/, 'draft approval should set resolve-by to publish time plus seven days');
  assert.match(adminHtml, /approveDraft[\s\S]*resolution_policy:\s*'evidence'/, 'draft approval should default to evidence policy');
  assert.doesNotMatch(adminHtml, /approveDraft[\s\S]*resolution_policy:\s*'deadline'/, 'draft approval must not force deadline policy');
});
