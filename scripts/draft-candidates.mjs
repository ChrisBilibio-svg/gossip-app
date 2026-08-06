// Draft screened candidates into proper binary questions — NO database writes.
//
//   node scripts/draft-candidates.mjs [maxDrafts]
//
// Pipeline: fetch -> deterministic screen -> keep approve_candidate ->
// AI draft (draftFromHeadline) into a verifiable Verdade/Mentira question ->
// RE-SCREEN the drafted question -> emit JSON for human review + DB insert.
// Requires ANTHROPIC_API_KEY. Writes nothing to Supabase.

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { gatherCandidates, draftFromHeadline, normalizeEventKey } from './ingest.mjs';
import { screenCandidate } from './screen.mjs';

function cfg(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  return {
    anthropicKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    newsApiKey: env.NEWS_API_KEY || null,
    newsApiProvider: (env.NEWS_API_PROVIDER || 'gnews').toLowerCase(),
    redditClientId: env.REDDIT_CLIENT_ID || null,
    redditClientSecret: env.REDDIT_CLIENT_SECRET || null,
    xBearerToken: env.X_BEARER_TOKEN || null,
    xaiApiKey: env.XAI_API_KEY || null,
    xaiMaxSearchesPerRun: env.XAI_MAX_SEARCHES_PER_RUN || '2',
    enable4chan: env.ENABLE_4CHAN === 'true',
  };
}

async function main() {
  const maxDrafts = Math.min(Math.max(parseInt(process.argv[2] || '8', 10) || 8, 1), 20);
  const config = cfg();
  const now = new Date();

  const candidates = await gatherCandidates(config, { existingLinks: new Set() });
  // Draft from approve_candidate headlines AND benign needs_review headlines
  // whose ONLY concern is timing (no_future_event_signal) from a reliable,
  // non-sensitive, non-discovery source. Everything drafted is RE-SCREENED and
  // only insertable if the drafted question itself passes every requirement.
  const eligible = candidates
    .map((c) => ({ c, s: screenCandidate(c, { now }) }))
    .filter((x) =>
      x.s.decision === 'approve_candidate' ||
      (x.s.decision === 'needs_review' &&
        x.s.reason_codes.length > 0 &&
        x.s.reason_codes.every((code) => code === 'no_future_event_signal') &&
        x.s.public_figure_confirmed && !x.s.sensitive_claim && !x.c.discovery));

  const out = [];
  for (const { c, s } of eligible) {
    if (out.length >= maxDrafts) break;
    let draft = null;
    try {
      draft = await draftFromHeadline(c.title, c.source, config);
    } catch (e) {
      out.push({ title: c.title, url: c.url, source: c.source, error: `draft failed: ${e.message}` });
      continue;
    }
    if (!draft || draft.use !== true || !draft.summary) {
      out.push({ title: c.title, url: c.url, source: c.source, drafted: false, reason: 'ai_declined' });
      continue;
    }
    // Re-screen the DRAFTED question (not the raw headline).
    const reScreen = screenCandidate(
      { title: draft.summary, summary: draft.summary, article: draft.article, url: c.url, source: c.source, discovery: c.discovery },
      { now },
    );
    out.push({
      headline: c.title,
      url: c.url,
      source: c.source,
      discovery: Boolean(c.discovery),
      event_key: normalizeEventKey(draft.summary),
      draft: {
        question: draft.summary,
        article: draft.article,
        category: draft.category,
        suggested_timeframe_days: draft.suggested_timeframe_days,
        suggested_timeframe: draft.suggested_timeframe,
        resolution_criteria: draft.resolution_criteria,
        seed_true: draft.seed_true,
        seed_false: draft.seed_false,
      },
      insertable: reScreen.decision === 'approve_candidate',
      headline_screen: { decision: s.decision, reason_codes: s.reason_codes },
      drafted_question_screen: {
        decision: reScreen.decision,
        reason_codes: reScreen.reason_codes,
        objective_resolution_rule: reScreen.objective_resolution_rule,
        suggested_true_probability: reScreen.suggested_true_probability,
        sensitive_claim: reScreen.sensitive_claim,
        public_figure_confirmed: reScreen.public_figure_confirmed,
        adult_subjects_confirmed: reScreen.adult_subjects_confirmed,
      },
    });
  }

  const payload = JSON.stringify({ generated_at: now.toISOString(), screened_eligible: eligible.length, drafted: out.length, items: out }, null, 2);
  const outPath = process.env.DRAFT_OUT;
  if (outPath) {
    writeFileSync(outPath, payload);
    console.error(`wrote ${out.length} drafted item(s) (${eligible.length} screened-eligible) to ${outPath}`);
  } else {
    console.log(payload);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('draft error:', e); process.exit(1); });
}
