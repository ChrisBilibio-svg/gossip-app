import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoPublishDecision, buildAutoConfig } from '../scripts/auto-curate.mjs';

const autoCurateSource = readFileSync(new URL('../scripts/auto-curate.mjs', import.meta.url), 'utf8');

const approve = (over = {}) => ({
  decision: 'approve_candidate', sensitive_claim: false, public_figure_confirmed: true,
  objective_resolution_rule: 'resolve by evidence in 7d', duplicate_market_id: null, ...over,
});
const ctx = (over = {}) => ({
  autoPublishKilled: false, dailyCap: 2, publishedToday: 0,
  allowlist: ['Música', 'Novelas'], openEventKeys: new Set(), eventKey: 'anitta turne mundial', category: 'Música', ...over,
});

test('clean approve within all guardrails auto-publishes', () => {
  const d = autoPublishDecision(approve(), ctx());
  assert.equal(d.action, 'auto_publish');
  assert.equal(d.reason, 'passed_all_guardrails');
});

test('market publishing remains independent from optional editorial image APIs', () => {
  assert.doesNotMatch(autoCurateSource, /PEXELS_API_KEY|api\.pexels\.com/i);
});

test('kill switch keeps it in the human queue', () => {
  const d = autoPublishDecision(approve(), ctx({ autoPublishKilled: true }));
  assert.equal(d.action, 'queue_draft');
  assert.equal(d.reason, 'auto_publish_killed');
});

test('daily cap sends overflow to the human queue', () => {
  const d = autoPublishDecision(approve(), ctx({ publishedToday: 2, dailyCap: 2 }));
  assert.equal(d.action, 'queue_draft');
  assert.equal(d.reason, 'daily_cap_reached');
});

test('duplicate of an open market is skipped (never created)', () => {
  const byKey = autoPublishDecision(approve(), ctx({ openEventKeys: new Set(['anitta turne mundial']) }));
  assert.equal(byKey.action, 'skip');
  const byId = autoPublishDecision(approve({ duplicate_market_id: 'x' }), ctx());
  assert.equal(byId.action, 'skip');
});

test('non-approve decisions go to the human queue, never auto-publish', () => {
  assert.equal(autoPublishDecision(approve({ decision: 'needs_review' }), ctx()).reason, 'needs_review');
  assert.equal(autoPublishDecision(approve({ decision: 'reject' }), ctx()).reason, 'screen_reject');
  for (const dec of ['needs_review', 'reject']) {
    assert.equal(autoPublishDecision(approve({ decision: dec }), ctx()).action, 'queue_draft');
  }
});

test('sensitive claims never auto-publish', () => {
  const d = autoPublishDecision(approve({ sensitive_claim: true }), ctx());
  assert.equal(d.action, 'queue_draft');
  assert.equal(d.reason, 'sensitive_claim');
});

test('unconfirmed public figure never auto-publishes', () => {
  assert.equal(autoPublishDecision(approve({ public_figure_confirmed: false }), ctx()).reason, 'public_figure_unconfirmed');
});

test('missing objective resolution rule never auto-publishes', () => {
  assert.equal(autoPublishDecision(approve({ objective_resolution_rule: null }), ctx()).reason, 'no_objective_rule');
});

test('categories off the allowlist go to the human queue', () => {
  const d = autoPublishDecision(approve(), ctx({ category: 'Futebol' }));
  assert.equal(d.action, 'queue_draft');
  assert.equal(d.reason, 'category_not_allowlisted');
});

test('buildAutoConfig defaults are safe (auto-publish OFF, cap 2)', () => {
  const c = buildAutoConfig({});
  assert.equal(c.autoPublishKilled, true, 'kill switch must default ON');
  assert.equal(c.dailyCap, 2);
  assert.equal(c.trueProbability, 0.5);
  assert.ok(c.allowlist.includes('Música'));
});

test('buildAutoConfig honors explicit overrides', () => {
  const c = buildAutoConfig({ AUTO_PUBLISH_KILLED: 'false', AUTO_PUBLISH_DAILY_CAP: '5', AUTO_PUBLISH_CATEGORIES: 'Novelas, BBB' });
  assert.equal(c.autoPublishKilled, false);
  assert.equal(c.dailyCap, 5);
  assert.deepEqual(c.allowlist, ['Novelas', 'BBB']);
});
