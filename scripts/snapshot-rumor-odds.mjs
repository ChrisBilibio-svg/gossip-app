// snapshot-rumor-odds.mjs — periodic TEA probability snapshots for market sparklines.
//
// Calls the snapshot_rumor_odds() RPC created by migration 0034. The RPC writes
// one lightweight snapshot per currently open/published rumor, recording current
// TEA percentage plus volume. Run every few hours after Chris applies 0034.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   [RUMOR_ODDS_SNAPSHOT_DRY_RUN=false]

export function buildRumorOddsSnapshotConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    dryRun: parseDryRunFlag(env.RUMOR_ODDS_SNAPSHOT_DRY_RUN),
  };
}

export function parseDryRunFlag(value) {
  return String(value ?? 'false').toLowerCase() === 'true';
}

export function summarizeSnapshotResult(rowsInserted, dryRun) {
  if (dryRun) return 'Dry run: would snapshot current TEA odds for open rumors.';
  return `Snapshot complete: ${rowsInserted} rumor odds row(s) inserted.`;
}

function usage() {
  console.log(`Usage: node scripts/snapshot-rumor-odds.mjs

Creates current TEA-probability snapshots for open rumors by calling the Supabase
RPC snapshot_rumor_odds(). Run every 2–4 hours after migration 0034 is applied so
market cards/detail can render real probability history.

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional env:
  RUMOR_ODDS_SNAPSHOT_DRY_RUN   false by default; true prints intended action only
`);
}

function requireEnv(config) {
  for (const [name, value] of Object.entries({ SUPABASE_URL: config.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey })) {
    if (!value) throw new Error(`Missing env: ${name}`);
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

async function snapshotRumorOdds(config) {
  return supabaseFetch(config, '/rest/v1/rpc/snapshot_rumor_odds', {
    method: 'POST',
    body: '{}',
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildRumorOddsSnapshotConfig(process.env);
  if (config.dryRun) {
    console.log(summarizeSnapshotResult(0, true));
    return;
  }

  requireEnv(config);
  const rowsInserted = await snapshotRumorOdds(config);
  console.log(summarizeSnapshotResult(rowsInserted ?? 0, false));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
