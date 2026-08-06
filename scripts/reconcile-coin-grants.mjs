import { createClient } from '@supabase/supabase-js';

const DEFAULT_LIMIT = 500;

export function parsePositiveInteger(value, name, defaultValue = DEFAULT_LIMIT, max = 5000) {
  if (value == null || value === '') return defaultValue;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be a whole number`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > max) throw new Error(`${name} must be between 1 and ${max}`);
  return parsed;
}

export function parseLiveFlag(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

export function buildCoinGrantConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL ?? '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    limit: parsePositiveInteger(env.COIN_GRANT_LIMIT, 'COIN_GRANT_LIMIT', DEFAULT_LIMIT, 5000),
    live: parseLiveFlag(env.COIN_GRANT_LIVE),
  };
}

export function validateCoinGrantConfig(config) {
  const missing = [];
  if (!config || typeof config !== 'object') missing.push('config');
  if (!config?.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config?.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) throw new Error(`Missing required coin grant config: ${missing.join(', ')}`);
}

export function summarizeGrantResult(result, live) {
  if (!live) return `DRY RUN: would reconcile coin grants if COIN_GRANT_LIVE=true.`;
  const row = Array.isArray(result) ? result[0] : result;
  return [
    'Coin grant reconciliation complete.',
    `users_checked: ${row?.users_checked ?? 0}`,
    `recovery_grants: ${row?.recovery_grants ?? 0}`,
    `pro_daily_grants: ${row?.pro_daily_grants ?? 0}`,
  ].join('\n');
}

export async function runCoinGrantReconciliation(config = buildCoinGrantConfig()) {
  validateCoinGrantConfig(config);
  if (!config.live) return summarizeGrantResult(null, false);

  const supabase = createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('apply_due_economy_grants', { p_limit: config.limit });
  if (error) throw new Error(`apply_due_economy_grants failed: ${error.message}`);
  return summarizeGrantResult(data, true);
}

async function main() {
  try {
    const message = await runCoinGrantReconciliation(buildCoinGrantConfig());
    console.log(message);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
