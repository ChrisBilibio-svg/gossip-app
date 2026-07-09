// snapshot-leaderboard-ranks.mjs — daily leaderboard rank movement snapshot.
//
// Calls the snapshot_leaderboard_ranks(date) RPC created by migration 0020 so
// get_leaderboard(p_limit) can expose previousRank/rankDelta. This writes only
// to leaderboard_rank_snapshots and is idempotent for the same date.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   [RANK_SNAPSHOT_DATE=YYYY-MM-DD], [RANK_SNAPSHOT_DRY_RUN=false]

export function buildRankSnapshotConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    snapshotDate: parseSnapshotDate(env.RANK_SNAPSHOT_DATE),
    dryRun: parseDryRunFlag(env.RANK_SNAPSHOT_DRY_RUN),
  };
}

export function parseDryRunFlag(value) {
  return String(value ?? 'false').toLowerCase() === 'true';
}

export function todayUtcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function parseSnapshotDate(value, now = new Date()) {
  const date = value || todayUtcDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`RANK_SNAPSHOT_DATE must use YYYY-MM-DD; got ${value}`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`RANK_SNAPSHOT_DATE must be a real calendar date; got ${value}`);
  }
  return date;
}

export function summarizeSnapshotResult(rowsUpdated, snapshotDate, dryRun) {
  if (dryRun) return `Dry run: would snapshot leaderboard ranks for ${snapshotDate}.`;
  return `Snapshot complete: ${rowsUpdated} leaderboard rank row(s) upserted for ${snapshotDate}.`;
}

function usage() {
  console.log(`Usage: node scripts/snapshot-leaderboard-ranks.mjs

Creates/upserts today's leaderboard rank snapshot by calling the Supabase RPC
snapshot_leaderboard_ranks(p_snapshot_date). Run daily after migration 0020 is
applied so rankDelta can compare current rank against the latest previous day.

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional env:
  RANK_SNAPSHOT_DATE      YYYY-MM-DD; defaults to today's UTC date
  RANK_SNAPSHOT_DRY_RUN   false by default; true prints intended action only
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

async function snapshotLeaderboardRanks(config) {
  return supabaseFetch(config, '/rest/v1/rpc/snapshot_leaderboard_ranks', {
    method: 'POST',
    body: JSON.stringify({ p_snapshot_date: config.snapshotDate }),
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildRankSnapshotConfig(process.env);
  if (config.dryRun) {
    console.log(summarizeSnapshotResult(0, config.snapshotDate, true));
    return;
  }

  requireEnv(config);
  const rowsUpdated = await snapshotLeaderboardRanks(config);
  console.log(summarizeSnapshotResult(rowsUpdated ?? 0, config.snapshotDate, false));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
