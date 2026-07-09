// cleanup-anonymous-users.mjs — dry-run anonymous auth user cleanup report.
//
// Safe by default: this script only reports stale anonymous Supabase Auth users.
// It does not delete users. If a live deletion mode is added later, keep it behind
// a separate explicit human approval + environment gate.
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   [ANON_CLEANUP_DAYS=30], [ANON_CLEANUP_LIMIT=100]

export function buildCleanupConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    staleDays: parseCleanupDays(env.ANON_CLEANUP_DAYS),
    limit: parseCleanupLimit(env.ANON_CLEANUP_LIMIT),
  };
}

export function parseCleanupDays(value) {
  const days = parseInt(value || '30', 10);
  if (!Number.isInteger(days) || String(days) !== String(value || '30') || days < 7 || days > 3650) {
    throw new Error(`ANON_CLEANUP_DAYS must be an integer from 7 to 3650; got ${value}`);
  }
  return days;
}

export function parseCleanupLimit(value) {
  const limit = parseInt(value || '100', 10);
  if (!Number.isInteger(limit) || String(limit) !== String(value || '100') || limit < 1 || limit > 1000) {
    throw new Error(`ANON_CLEANUP_LIMIT must be an integer from 1 to 1000; got ${value}`);
  }
  return limit;
}

export function cutoffIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isAnonymousAuthUser(user) {
  if (user?.is_anonymous === true) return true;
  if (user?.app_metadata?.provider === 'anonymous') return true;
  if (Array.isArray(user?.identities) && user.identities.some((identity) => identity?.provider === 'anonymous')) return true;
  return false;
}

export function isOlderThan(user, cutoff) {
  const createdAt = Date.parse(user?.created_at || '');
  return Number.isFinite(createdAt) && createdAt < Date.parse(cutoff);
}

export function uniqueIds(rows, key = 'user_id') {
  return new Set((rows ?? []).map((row) => row?.[key]).filter(Boolean));
}

export function hasActivity(userId, activitySets) {
  return activitySets.some((set) => set.has(userId));
}

export function selectCleanupCandidates(users, activitySets, cutoff, limit) {
  return (users ?? [])
    .filter((user) => isAnonymousAuthUser(user))
    .filter((user) => isOlderThan(user, cutoff))
    .filter((user) => !hasActivity(user.id, activitySets))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, limit);
}

function usage() {
  console.log(`Usage: node scripts/cleanup-anonymous-users.mjs

Dry-run report for stale anonymous Supabase Auth users with no app activity.
No users are deleted by this script.

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional env:
  ANON_CLEANUP_DAYS     Minimum account age in days (default: 30, min: 7)
  ANON_CLEANUP_LIMIT    Max candidates to print (default: 100, max: 1000)
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

async function listAuthUsers(config, page = 1, perPage = 1000) {
  return supabaseFetch(config, `/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
}

async function listAllAuthUsers(config) {
  const firstPage = await listAuthUsers(config, 1);
  const users = Array.isArray(firstPage?.users) ? [...firstPage.users] : [];
  const lastPage = Number(firstPage?.last_page || 1);
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await listAuthUsers(config, page);
    users.push(...(Array.isArray(next?.users) ? next.users : []));
  }
  return users;
}

async function listActivity(config, table, column = 'user_id') {
  const query = new URLSearchParams({
    select: column,
    limit: '10000',
  });
  return supabaseFetch(config, `/rest/v1/${table}?${query}`);
}

async function loadActivitySets(config) {
  const [profiles, predictions, comments, commentLikes, reports, blocks, rumorReactions, socialReposts, socialRepostReactions] = await Promise.all([
    listActivity(config, 'profiles', 'id'),
    listActivity(config, 'predictions'),
    listActivity(config, 'comments'),
    listActivity(config, 'comment_likes'),
    listActivity(config, 'comment_reports', 'reporter_id'),
    listActivity(config, 'blocks', 'blocker_id'),
    listActivity(config, 'rumor_reactions'),
    listActivity(config, 'social_reposts'),
    listActivity(config, 'social_repost_reactions'),
  ]);

  return [
    uniqueIds(profiles, 'id'),
    uniqueIds(predictions),
    uniqueIds(comments),
    uniqueIds(commentLikes),
    uniqueIds(reports, 'reporter_id'),
    uniqueIds(blocks, 'blocker_id'),
    uniqueIds(rumorReactions),
    uniqueIds(socialReposts),
    uniqueIds(socialRepostReactions),
  ];
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const config = buildCleanupConfig(process.env);
  requireEnv(config);
  const cutoff = cutoffIso(config.staleDays);
  console.log(`Anonymous cleanup dry run: staleDays=${config.staleDays}, limit=${config.limit}, cutoff=${cutoff}`);

  const [users, activitySets] = await Promise.all([listAllAuthUsers(config), loadActivitySets(config)]);
  const anonymousUsers = users.filter(isAnonymousAuthUser);
  const staleAnonymousUsers = anonymousUsers.filter((user) => isOlderThan(user, cutoff));
  const candidates = selectCleanupCandidates(users, activitySets, cutoff, config.limit);

  console.log(`Scanned ${users.length} auth user(s): ${anonymousUsers.length} anonymous, ${staleAnonymousUsers.length} stale anonymous.`);
  console.log(`Dry run: ${candidates.length} stale anonymous user(s) have no app activity and would be cleanup candidates.`);
  for (const user of candidates) {
    console.log(`  • ${user.id} created_at=${user.created_at}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
