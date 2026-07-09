// bot-health-summary.mjs — read-only operational health report for Viddi bots.
//
// Checks recent Supabase state without changing data. Intended for Actions logs,
// Telegram copy/paste, or local smoke checks after ingest/deadline/rank jobs.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   [BOT_HEALTH_LOOKBACK_HOURS=24]

export function parseLookbackHours(value) {
  const raw = value || '24';
  const hours = Number.parseInt(raw, 10);
  if (!Number.isInteger(hours) || String(hours) !== String(raw) || hours < 1 || hours > 168) {
    throw new Error(`BOT_HEALTH_LOOKBACK_HOURS must be an integer from 1 to 168; got ${value}`);
  }
  return hours;
}

export function buildBotHealthConfig(env = process.env) {
  const config = {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    lookbackHours: parseLookbackHours(env.BOT_HEALTH_LOOKBACK_HOURS),
  };

  for (const [name, value] of Object.entries({
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
  })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }

  return config;
}

export function cutoffIso(hours, now = new Date()) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function countRows(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

export function statusEmoji(report) {
  if (report.expiredDeadlineCount > 0) return '⚠️';
  if (report.recentDraftCount === 0 && report.recentPublishedCount === 0) return '🟡';
  return '✅';
}

export function summarizeBotHealth(report) {
  const emoji = statusEmoji(report);
  const lines = [
    `${emoji} Viddi bot health — last ${report.lookbackHours}h`,
    `drafts_created: ${report.recentDraftCount}`,
    `published_created: ${report.recentPublishedCount}`,
    `expired_deadline_candidates: ${report.expiredDeadlineCount}`,
    `rank_snapshots_today: ${report.rankSnapshotCount}`,
  ];

  if (report.expiredDeadlineCount > 0) {
    lines.push('action: run/enable resolve-deadlines job to clear expired deadline predictions');
  } else if (report.recentDraftCount === 0 && report.recentPublishedCount === 0) {
    lines.push('action: inspect ingest job if this is unexpected');
  } else {
    lines.push('action: none');
  }

  return lines.join('\n');
}

function usage() {
  console.log(`Usage: node scripts/bot-health-summary.mjs

Read-only report for recent bot/backend health: fresh drafts/published rumors,
expired deadline candidates, and today's leaderboard rank snapshots.

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional env:
  BOT_HEALTH_LOOKBACK_HOURS   1..168, default 24
`);
}

async function supabaseFetch(config, path, options = {}) {
  const res = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
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

async function fetchHealthReport(config) {
  const since = cutoffIso(config.lookbackHours);
  const today = new Date().toISOString().slice(0, 10);

  const [recentDrafts, recentPublished, expiredDeadlines, rankSnapshots] = await Promise.all([
    supabaseFetch(config, `/rest/v1/rumors?select=id&created_at=gte.${encodeURIComponent(since)}&is_draft=eq.true`),
    supabaseFetch(config, `/rest/v1/rumors?select=id&created_at=gte.${encodeURIComponent(since)}&is_draft=eq.false`),
    supabaseFetch(config,
      `/rest/v1/rumors?select=id&status=eq.speculated&is_draft=eq.false&resolution_policy=eq.deadline&prediction_deadline=lte.${encodeURIComponent(new Date().toISOString())}`,
    ),
    supabaseFetch(config, `/rest/v1/leaderboard_rank_snapshots?select=profile_id&snapshot_date=eq.${today}`),
  ]);

  return {
    lookbackHours: config.lookbackHours,
    recentDraftCount: countRows(recentDrafts),
    recentPublishedCount: countRows(recentPublished),
    expiredDeadlineCount: countRows(expiredDeadlines),
    rankSnapshotCount: countRows(rankSnapshots),
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildBotHealthConfig(process.env);
  const report = await fetchHealthReport(config);
  console.log(summarizeBotHealth(report));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
