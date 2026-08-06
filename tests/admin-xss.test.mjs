import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const adminHtml = await readFile(new URL('../gossip-admin/admin.html', import.meta.url), 'utf8');

test('admin dynamic content renders escaped inside innerHTML templates', () => {
  assert.match(adminHtml, /\$\{esc\(r\.summary\)\}/, 'draft/rumor summaries must be escaped');
  assert.match(adminHtml, /motivo: \$\{esc\(rep\.reason \|\| '—'\)\}/, 'report reasons must be escaped');
  assert.match(adminHtml, /\"\$\{esc\(rep\.comments\?\.body \?\? '\(removido\)'\)\}\"/, 'reported comment bodies must be escaped');
  assert.match(adminHtml, /sourceLink\(r\.source_url, r\.source_label\)/, 'draft source links must be URL-scheme validated before rendering');
  assert.match(adminHtml, /\$\{sourceLink\(s\.source_url, s\.source_label\)\}/, 'evidence source links must be URL-scheme validated before rendering');
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

test('admin source links reject unsafe or discovery-only URL schemes before storing/rendering evidence', () => {
  assert.match(adminHtml, /function\s+safeHttpUrl\s*\(/, 'admin should validate URLs centrally');
  assert.match(adminHtml, /!\['https:',\s*'http:'\]\.includes\(url\.protocol\)/, 'admin should reject javascript/data/blob/file URL schemes');
  assert.match(adminHtml, /DISCOVERY_ONLY_HOSTS[\s\S]*news\\\.google\\\.com[\s\S]*reddit[\s\S]*twitter[\s\S]*4cdn/, 'admin should reject discovery-only/social hosts as authoritative evidence');
  assert.doesNotMatch(adminHtml, /href=\"\$\{esc\((?:s|r)\.source_url\)\}/, 'admin must not render DB source_url directly into href');
  assert.match(adminHtml, /source_url:\s*safeSourceUrl/, 'manual create should store only validated authoritative source URLs');
  assert.match(adminHtml, /const\s+source_url\s*=\s*safeHttpUrl\(sourceUrl,\s*\{\s*authoritative:\s*true\s*\}\)/, 'addEvidence should validate source URL before insert');
});

test('admin draft publish goes through the atomic RPC (server computes resolve-by)', () => {
  // Publishing a draft is now an atomic, curator-authorized server RPC that
  // computes prediction_deadline = publish + 7d and initializes fixed odds.
  assert.match(adminHtml, /window\.publishDraft[\s\S]*sb\.rpc\('publish_approved_market'/, 'draft publish should call the atomic publication RPC');
  assert.match(adminHtml, /p_true_probability:\s*p\.t/, 'publish should pass the curator-set Verdade probability');
  // the legacy client-side direct-update approval path must be gone
  assert.doesNotMatch(adminHtml, /window\.approveDraft/, 'legacy direct is_draft update approval should be removed');
  assert.doesNotMatch(adminHtml, /update\(\{\s*\n?\s*is_draft: false/, 'client must not flip is_draft directly');
});
