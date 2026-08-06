// Dry-run: fetch + screen + report. NEVER writes to the database.
//
//   node scripts/ingest-dryrun.mjs            # human summary
//   node scripts/ingest-dryrun.mjs --json     # + machine-readable JSON report
//
// Safe to run with no secrets: it fetches public RSS/discovery sources, runs the
// deterministic market-suitability screening, and prints a candidate + rejection
// summary. It performs no inserts, no updates, no AI drafting. If a read-only
// Supabase key is present it also checks candidates against recent open markets
// for duplicates; otherwise that check is skipped and noted.

import { pathToFileURL } from 'node:url';
import { gatherCandidates, isTrustedSupabaseUrl } from './ingest.mjs';
import { screenCandidate, summarizeScreening } from './screen.mjs';

const asJson = process.argv.includes('--json');

// Dry-run needs no mandatory secrets: it does not draft with the AI model and
// never writes to Supabase. Build a tolerant config from whatever optional
// source keys exist (news API, Reddit, X); missing ones just disable that
// source. supabaseUrl/serviceKey are used only for the read-only duplicate check.
function buildDryRunConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL || null,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    newsApiKey: env.NEWS_API_KEY || null,
    newsApiProvider: (env.NEWS_API_PROVIDER || 'gnews').toLowerCase(),
    redditClientId: env.REDDIT_CLIENT_ID || null,
    redditClientSecret: env.REDDIT_CLIENT_SECRET || null,
    xBearerToken: env.X_BEARER_TOKEN || null,
    enable4chan: env.ENABLE_4CHAN === 'true',
  };
}

async function fetchOpenRumors(config) {
  if (!config?.supabaseUrl || !config?.serviceKey) return { rumors: [], checked: false };
  if (!isTrustedSupabaseUrl(config.supabaseUrl)) return { rumors: [], checked: false };
  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const params = new URLSearchParams({
      select: 'id,summary,event_key',
      status: 'eq.speculated',
      is_draft: 'eq.false',
      created_at: `gte.${since}`,
      order: 'created_at.desc',
      limit: '80',
    });
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rumors?${params}`, {
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
    });
    if (!res.ok) return { rumors: [], checked: false };
    return { rumors: await res.json(), checked: true };
  } catch {
    return { rumors: [], checked: false };
  }
}

async function main() {
  const config = buildDryRunConfig();
  console.log('=== INGEST DRY-RUN (no writes) ===');

  const { rumors: openRumors, checked: dupChecked } = await fetchOpenRumors(config);
  console.log(dupChecked
    ? `Duplicate check: against ${openRumors.length} recent open market(s).`
    : 'Duplicate check: SKIPPED (no read key configured locally).');

  let candidates = [];
  try {
    candidates = await gatherCandidates(config, { existingLinks: new Set() });
  } catch (e) {
    console.log(`Source gather failed (non-fatal in dry-run): ${e.message}`);
  }
  console.log(`Fetched ${candidates.length} unique candidate(s).\n`);

  const now = new Date();
  const results = candidates.map((c) => ({ candidate: c, result: screenCandidate(c, { now, openRumors }) }));

  const order = { reject: 0, needs_review: 1, approve_candidate: 2 };
  results.sort((a, b) => order[a.result.decision] - order[b.result.decision]);

  const icon = { approve_candidate: '✅', needs_review: '🟡', reject: '⛔' };
  for (const { candidate, result } of results) {
    const src = candidate.source || 'desconhecida';
    const title = String(candidate.title || '').slice(0, 72);
    console.log(`${icon[result.decision]} ${result.decision.toUpperCase()} · ${result.proposed_category} · ${src}`);
    console.log(`   "${title}"`);
    if (result.reason_codes.length) console.log(`   codes: ${result.reason_codes.join(', ')}`);
    console.log('');
  }

  const summary = summarizeScreening(results.map((r) => r.result));
  console.log('=== SUMMARY ===');
  console.log(`total: ${summary.total}  |  ✅ approve: ${summary.byDecision.approve_candidate}  🟡 review: ${summary.byDecision.needs_review}  ⛔ reject: ${summary.byDecision.reject}`);
  if (Object.keys(summary.reasonTally).length) {
    console.log('reason codes:');
    for (const [code, n] of Object.entries(summary.reasonTally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}  ${code}`);
    }
  }
  console.log('\nNo database writes were performed. Approve candidates only via the human queue.');

  if (asJson) {
    console.log('\n=== JSON ===');
    console.log(JSON.stringify({
      generated_at: now.toISOString(),
      duplicate_check: dupChecked,
      summary,
      candidates: results.map(({ candidate, result }) => ({
        title: candidate.title,
        source: candidate.source,
        url: candidate.url,
        discovery: Boolean(candidate.discovery),
        screening: result,
      })),
    }, null, 2));
  }
}

// Windows-safe main guard (backslash paths break `file://` + argv comparison).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('dry-run error:', e);
    process.exit(1);
  });
}
