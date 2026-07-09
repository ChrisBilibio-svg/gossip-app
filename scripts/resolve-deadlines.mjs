// resolve-deadlines.mjs — resolve expired seven-day gossip predictions.
// Resolves time-bounded predictions whose prediction_deadline has passed as CAP.
// The 7-day product model is enforced at insert/publish time by migration 0028.
// Defaults to DRY RUN so no live data changes happen until
// RESOLVE_DEADLINES_DRY_RUN=false is explicitly set.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   [RESOLVE_DEADLINES_LIMIT=25], [RESOLVE_DEADLINES_DRY_RUN=true|false]

export function buildDeadlineConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    limit: parseDeadlineLimit(env.RESOLVE_DEADLINES_LIMIT),
    dryRun: parseDryRunFlag(env.RESOLVE_DEADLINES_DRY_RUN),
  };
}

export function parseDeadlineLimit(value) {
  const limit = parseInt(value || '25', 10);
  if (!Number.isInteger(limit) || String(limit) !== String(value || '25') || limit < 1 || limit > 250) {
    throw new Error(`RESOLVE_DEADLINES_LIMIT must be an integer from 1 to 250; got ${value}`);
  }
  return limit;
}

export function parseDryRunFlag(value) {
  return String(value ?? 'true').toLowerCase() !== 'false';
}

function usage() {
  console.log(`Usage: RESOLVE_DEADLINES_DRY_RUN=false node scripts/resolve-deadlines.mjs

Resolves expired seven-day predictions as CAP by calling
resolve_expired_prediction_deadlines(p_limit). New/open gossip is forced into
the seven-day deadline model by migration 0028. Defaults to dry-run mode.

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional env:
  RESOLVE_DEADLINES_LIMIT      Max predictions per run (default: 25)
  RESOLVE_DEADLINES_DRY_RUN    true by default; set false to resolve rows
`);
}

export function validateDeadlineConfig(config) {
  for (const [name, value] of Object.entries({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 250) {
    throw new Error('RESOLVE_DEADLINES_LIMIT must be an integer from 1 to 250');
  }
}

async function supabaseFetch(config, path, options = {}) {
  const res = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = typeof body === 'object' && body?.message ? body.message : text;
    throw new Error(`Supabase ${res.status}: ${message}`);
  }
  return body;
}

async function listExpiredDeadlineCandidates(config) {
  const now = new Date().toISOString();
  const query = new URLSearchParams({
    select: 'id,summary,prediction_deadline,publish_at',
    status: 'eq.speculated',
    is_draft: 'eq.false',
    resolution_policy: 'eq.deadline',
    prediction_deadline: `lte.${now}`,
    order: 'prediction_deadline.asc',
    limit: String(config.limit),
  });
  return supabaseFetch(config, `/rest/v1/rumors?${query}`);
}

async function runDeadlineResolver(config) {
  return supabaseFetch(config, '/rest/v1/rpc/resolve_expired_prediction_deadlines', {
    method: 'POST',
    body: JSON.stringify({ p_limit: config.limit }),
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildDeadlineConfig(process.env);
  validateDeadlineConfig(config);
  console.log(`Deadline resolver check: limit ${config.limit}, dryRun=${config.dryRun}`);

  if (config.dryRun) {
    const rows = await listExpiredDeadlineCandidates(config);
    console.log(`Dry run: ${rows.length} expired deadline prediction(s) would resolve as CAP.`);
    for (const row of rows) {
      console.log(`  • ${row.id} ${new Date(row.prediction_deadline).toISOString()} — ${String(row.summary).slice(0, 96)}`);
    }
    return;
  }

  const rows = await runDeadlineResolver(config);
  console.log(`Resolved ${rows.length} expired deadline prediction(s) as CAP.`);
  for (const row of rows) {
    console.log(`  ✓ ${row.rumor_id} — ${String(row.summary).slice(0, 96)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
