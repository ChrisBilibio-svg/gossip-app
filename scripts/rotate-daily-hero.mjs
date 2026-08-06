// Rotate the daily "fofoca / babado / VIDDI do dia" hero market.
//
//   node scripts/rotate-daily-hero.mjs            # dry-run (no writes)
//   node scripts/rotate-daily-hero.mjs --live     # set today's hero
//
// Picks one OPEN, BETTABLE market (published, future deadline, has a fixed
// probability version) to feature as is_hero for today, clears the previous
// hero, and stamps set_date=today (the app sorts is_hero first and badges it
// "VIDDI DO DIA"). No writes without --live and a service key.

import { pathToFileURL } from 'node:url';

const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Pure selection: choose today's hero from eligible open/bettable markets.
 * Prefers a market NOT already featured today (so it changes daily), then the
 * least-recently-featured (rotation), then the freshest publish. Deterministic.
 * @param {Array} markets  [{ id, summary, publish_at, set_date, is_hero }]
 * @param {object} opts   { today: 'YYYY-MM-DD' }
 * @returns {object|null}  chosen market, or null if none eligible
 */
export function pickDailyHero(markets = [], opts = {}) {
  const today = opts.today || todayUTC();
  if (!Array.isArray(markets) || markets.length === 0) return null;
  return [...markets].sort((a, b) => {
    // 1. avoid re-featuring a market already set as today's hero
    const at = a.is_hero && a.set_date === today ? 1 : 0;
    const bt = b.is_hero && b.set_date === today ? 1 : 0;
    if (at !== bt) return at - bt;
    // 2. least-recently featured first (null/older set_date wins rotation)
    const as = a.set_date || '';
    const bs = b.set_date || '';
    if (as !== bs) return as < bs ? -1 : 1;
    // 3. freshest publish, then newest row
    const ap = a.publish_at || a.created_at || '';
    const bp = b.publish_at || b.created_at || '';
    if (ap !== bp) return ap < bp ? 1 : -1;
    return String(b.id).localeCompare(String(a.id));
  })[0];
}

function cfg(env = process.env) {
  return { supabaseUrl: env.SUPABASE_URL || null, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || null };
}

async function sb(config, method, path, body) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return method === 'GET' ? res.json() : null;
}

async function main() {
  const dryRun = !process.argv.includes('--live');
  const config = cfg();
  const today = todayUTC();
  console.log(`=== ROTATE DAILY HERO (${dryRun ? 'DRY-RUN' : 'LIVE'}) — ${today} ===`);
  if (!config.supabaseUrl || !config.serviceKey) {
    console.log('No Supabase credentials configured; nothing to do.');
    return;
  }

  // eligible = published, open (future/none deadline), bettable (has a version)
  const eligible = await sb(config, 'GET',
    'rumors?select=id,summary,publish_at,created_at,set_date,is_hero,prediction_deadline'
    + '&is_draft=eq.false&status=eq.speculated'
    + `&or=(prediction_deadline.is.null,prediction_deadline.gt.${new Date().toISOString()})`
    + '&order=publish_at.desc.nullslast');

  // keep only those with a fixed probability version (bettable)
  const versions = await sb(config, 'GET', 'prediction_market_probability_versions?select=rumor_id');
  const bettable = new Set(versions.map((v) => v.rumor_id));
  const pool = eligible.filter((m) => bettable.has(m.id));
  console.log(`open bettable markets: ${pool.length}`);

  const hero = pickDailyHero(pool, { today });
  if (!hero) { console.log('No eligible open+bettable market — hero unchanged.'); return; }
  console.log(`fofoca do dia -> ${hero.id}  ::  ${String(hero.summary).slice(0, 70)}`);

  if (dryRun) { console.log('\nDry-run: no writes.'); return; }

  // single hero: clear any current hero, then set the chosen with today's set_date
  await sb(config, 'PATCH', 'rumors?is_hero=eq.true', { is_hero: false });
  await sb(config, 'PATCH', `rumors?id=eq.${hero.id}`, { is_hero: true, set_date: today });
  console.log('✅ hero updated.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('rotate-daily-hero error:', e); process.exit(1); });
}
