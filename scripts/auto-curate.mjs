// Automated curator: gather -> AI draft -> re-screen -> decide auto-publish /
// queue for human / skip. Defaults to DRY-RUN and to auto-publish DISABLED.
//
//   node scripts/auto-curate.mjs            # dry-run (no writes), reports decisions
//   node scripts/auto-curate.mjs --live     # perform writes (needs service key)
//
// Safety model (see docs/spec-admin-automation.md):
//   - only approve_candidate (re-screened DRAFTED question) can auto-publish;
//   - a kill switch (AUTO_PUBLISH_KILLED, default "true") disables auto-publish;
//   - a per-UTC-day cap (AUTO_PUBLISH_DAILY_CAP) bounds how many can auto-publish;
//   - a category allowlist keeps sensitive/sports out of the auto path;
//   - anything not auto-published is QUEUED as a draft for the human admin.
// Nothing is ever lost: capped/killed/off-allowlist items become drafts.

import { pathToFileURL } from 'node:url';
import { gatherCandidates, draftFromHeadline, isTrustedSupabaseUrl, normalizeEventKey } from './ingest.mjs';
import { screenCandidate } from './screen.mjs';

const DEFAULT_ALLOWLIST = ['Música', 'Novelas', 'Celebridades', 'Influencers'];

export function buildAutoConfig(env = process.env) {
  const cap = Number.parseInt(env.AUTO_PUBLISH_DAILY_CAP ?? '2', 10);
  const prob = Number.parseFloat(env.AUTO_PUBLISH_TRUE_PROBABILITY ?? '0.5');
  return {
    // kill switch defaults to ON (auto-publish OFF) until explicitly enabled
    autoPublishKilled: (env.AUTO_PUBLISH_KILLED ?? 'true') !== 'false',
    dailyCap: Number.isFinite(cap) && cap >= 0 ? cap : 2,
    trueProbability: prob >= 0.1 && prob <= 0.9 ? prob : 0.5,
    allowlist: (env.AUTO_PUBLISH_CATEGORIES
      ? env.AUTO_PUBLISH_CATEGORIES.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_ALLOWLIST),
    anthropicKey: env.ANTHROPIC_API_KEY || null,
    model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    supabaseUrl: env.SUPABASE_URL || null,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    newsApiKey: env.NEWS_API_KEY || null,
    newsApiProvider: (env.NEWS_API_PROVIDER || 'gnews').toLowerCase(),
  };
}

/**
 * Pure guardrail decision for a drafted+re-screened market. No I/O.
 * @param {object} screen  screenCandidate() result for the DRAFTED question
 * @param {object} ctx
 * @param {boolean} ctx.autoPublishKilled  kill switch
 * @param {number}  ctx.dailyCap
 * @param {number}  ctx.publishedToday      auto-published so far this UTC day
 * @param {string[]|Set} ctx.allowlist      allowed categories
 * @param {Set}     ctx.openEventKeys        event_keys of currently-open markets
 * @param {string}  ctx.eventKey             this candidate's event_key
 * @param {string}  ctx.category
 * @returns {{action:'auto_publish'|'queue_draft'|'skip', reason:string}}
 */
export function autoPublishDecision(screen, ctx = {}) {
  const allow = ctx.allowlist instanceof Set ? ctx.allowlist : new Set(ctx.allowlist || []);
  const openKeys = ctx.openEventKeys instanceof Set ? ctx.openEventKeys : new Set(ctx.openEventKeys || []);

  // duplicates never get created (auto or manual)
  if (screen.duplicate_market_id || (ctx.eventKey && openKeys.has(ctx.eventKey))) {
    return { action: 'skip', reason: 'duplicate_of_open_market' };
  }
  // only a clean approve_candidate is even eligible; everything else -> human queue
  if (screen.decision !== 'approve_candidate') {
    return { action: 'queue_draft', reason: screen.decision === 'reject' ? 'screen_reject' : 'needs_review' };
  }
  if (screen.sensitive_claim) return { action: 'queue_draft', reason: 'sensitive_claim' };
  if (!screen.public_figure_confirmed) return { action: 'queue_draft', reason: 'public_figure_unconfirmed' };
  if (!screen.objective_resolution_rule) return { action: 'queue_draft', reason: 'no_objective_rule' };
  if (!allow.has(ctx.category)) return { action: 'queue_draft', reason: 'category_not_allowlisted' };

  // passed suitability; now the operational guardrails
  if (ctx.autoPublishKilled) return { action: 'queue_draft', reason: 'auto_publish_killed' };
  if ((ctx.publishedToday ?? 0) >= (ctx.dailyCap ?? 0)) return { action: 'queue_draft', reason: 'daily_cap_reached' };

  return { action: 'auto_publish', reason: 'passed_all_guardrails' };
}

// --- live I/O helpers (used only in --live mode) ----------------------------
async function sbGet(config, path) {
  if (!isTrustedSupabaseUrl(config?.supabaseUrl)) throw new Error('SUPABASE_URL must be an https://*.supabase.co project URL');
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
  });
  return res.ok ? res.json() : [];
}

async function fetchOpenEventKeys(config) {
  if (!config.supabaseUrl || !config.serviceKey) return new Set();
  const rows = await sbGet(config, 'rumors?select=event_key&is_draft=eq.false&status=eq.speculated');
  return new Set(rows.map((r) => r.event_key).filter(Boolean));
}

async function fetchPublishedToday(config) {
  if (!config.supabaseUrl || !config.serviceKey) return 0;
  const since = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
  const rows = await sbGet(config, `market_approval_audit?select=id&action=eq.publish&approval_reference=eq.auto_curate&at=gte.${since}`);
  return Array.isArray(rows) ? rows.length : 0;
}

async function insertDraft(config, draft, candidate, eventKey) {
  if (!isTrustedSupabaseUrl(config?.supabaseUrl)) throw new Error('SUPABASE_URL must be an https://*.supabase.co project URL');
  const body = {
    summary: draft.summary, article: draft.article ?? null, category: draft.category ?? null,
    status: 'speculated', is_draft: true, market_state: 'needs_review', publish_at: new Date().toISOString(),
    resolution_policy: 'evidence', required_source_count: 2,
    seed_true: Math.max(0, draft.seed_true | 0), seed_false: Math.max(0, draft.seed_false | 0),
    source_url: candidate.url, source_label: candidate.source, event_key: eventKey,
  };
  await fetch(`${config.supabaseUrl}/rest/v1/rumors`, {
    method: 'POST',
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
}

async function autoPublish(config, rumorId) {
  if (!isTrustedSupabaseUrl(config?.supabaseUrl)) throw new Error('SUPABASE_URL must be an https://*.supabase.co project URL');
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/publish_approved_market`, {
    method: 'POST',
    headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_rumor_id: rumorId, p_true_probability: config.trueProbability, p_false_probability: Math.round((1 - config.trueProbability) * 1e4) / 1e4,
      p_publish_at: new Date().toISOString(), p_approval_reference: 'auto_curate', p_idempotency_key: `auto_${rumorId}`,
    }),
  });
  if (!res.ok) throw new Error(`publish failed ${res.status}: ${(await res.text()).slice(0, 140)}`);
}

async function main() {
  const dryRun = !process.argv.includes('--live');
  const config = buildAutoConfig();
  console.log(`=== AUTO-CURATE (${dryRun ? 'DRY-RUN, no writes' : 'LIVE'}) ===`);
  console.log(`kill switch: ${config.autoPublishKilled ? 'ON (auto-publish disabled)' : 'off'} | daily cap: ${config.dailyCap} | allowlist: ${config.allowlist.join(', ')}`);

  const openEventKeys = await fetchOpenEventKeys(config);
  let publishedToday = await fetchPublishedToday(config);
  const now = new Date();

  const candidates = await gatherCandidates(config, { existingLinks: new Set() });
  const eligible = candidates
    .map((c) => ({ c, s: screenCandidate(c, { now }) }))
    .filter((x) => x.s.decision === 'approve_candidate' ||
      (x.s.decision === 'needs_review' && x.s.reason_codes.length > 0 &&
       x.s.reason_codes.every((code) => code === 'no_future_event_signal') &&
       x.s.public_figure_confirmed && !x.s.sensitive_claim && !x.c.discovery));

  const summary = { auto_publish: 0, queue_draft: 0, skip: 0 };
  const reasons = {};
  for (const { c } of eligible) {
    if (!config.anthropicKey) break; // drafting requires the model
    let draft = null;
    try { draft = await draftFromHeadline(c.title, c.source, config); } catch { /* skip */ }
    if (!draft || draft.use !== true || !draft.summary) continue;

    const reScreen = screenCandidate({ title: draft.summary, summary: draft.summary, article: draft.article, url: c.url, source: c.source, discovery: c.discovery }, { now });
    const eventKey = normalizeEventKey(draft.summary);
    const decision = autoPublishDecision(reScreen, {
      autoPublishKilled: config.autoPublishKilled, dailyCap: config.dailyCap, publishedToday,
      allowlist: config.allowlist, openEventKeys, eventKey, category: draft.category,
    });
    summary[decision.action]++;
    reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
    // count auto-publishes against the daily cap for the rest of THIS batch,
    // in dry-run and live alike, so the report reflects real behavior.
    if (decision.action === 'auto_publish') publishedToday++;
    console.log(`  ${decision.action === 'auto_publish' ? '🟢' : decision.action === 'queue_draft' ? '🟡' : '⚪'} ${decision.action} (${decision.reason}) :: ${String(draft.summary).slice(0, 70)}`);

    if (!dryRun) {
      try {
        if (decision.action === 'queue_draft') { await insertDraft(config, draft, c, eventKey); }
        else if (decision.action === 'auto_publish') {
          // insert as draft first, then publish it atomically
          await insertDraft(config, draft, c, eventKey);
          const [row] = await sbGet(config, `rumors?select=id&event_key=eq.${encodeURIComponent(eventKey)}&is_draft=eq.true&order=created_at.desc&limit=1`);
          if (row?.id) { await autoPublish(config, row.id); }
        }
      } catch (e) { console.log(`     write error: ${e.message}`); }
    }
  }

  console.log(`\n=== SUMMARY === auto_publish:${summary.auto_publish} queue_draft:${summary.queue_draft} skip:${summary.skip}`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${r}`);
  if (dryRun) console.log('\nDry-run: no database writes were performed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('auto-curate error:', e); process.exit(1); });
}
