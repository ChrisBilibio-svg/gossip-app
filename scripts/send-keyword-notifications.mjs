#!/usr/bin/env node

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Reads notification_queue joined to push_devices through service-role RPCs.

export function parseLimit(rawLimit = '100') {
  const text = String(rawLimit ?? '100').trim();
  if (!/^\d+$/.test(text)) {
    throw new Error('KEYWORD_NOTIFICATION_LIMIT must be an integer between 1 and 500');
  }
  const limit = Number.parseInt(text, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('KEYWORD_NOTIFICATION_LIMIT must be an integer between 1 and 500');
  }
  return limit;
}

export function buildConfig(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    limit: parseLimit(env.KEYWORD_NOTIFICATION_LIMIT || '100'),
    dryRun: env.DRY_RUN === 'true',
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || !config.supabaseUrl) throw new Error('Missing env: SUPABASE_URL');
  if (!config.serviceKey) throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 500) {
    throw new Error('KEYWORD_NOTIFICATION_LIMIT must be an integer between 1 and 500');
  }
}

async function rpc(config, name, body) {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${name} failed ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function sendExpoPush(messages) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Expo push failed ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  return Array.isArray(json.data) ? json.data : [];
}

export async function sendKeywordNotifications(config = buildConfig()) {
  validateConfig(config);
  const pending = await rpc(config, 'get_pending_keyword_notifications', { p_limit: config.limit });
  const rows = Array.isArray(pending) ? pending : [];
  if (!rows.length) {
    console.log('No pending keyword notifications.');
    return { pending: 0, delivered: 0, failed: 0 };
  }

  let delivered = 0;
  let failed = 0;
  for (const batch of chunk(rows, 100)) {
    if (config.dryRun) {
      console.log(`[dry-run] would send ${batch.length} keyword notifications`);
      continue;
    }

    const tickets = await sendExpoPush(batch.map((row) => ({
      to: row.expo_push_token,
      title: row.title,
      body: row.body,
      data: row.data ?? { rumorId: row.rumor_id, kind: 'keyword_match' },
      sound: 'default',
      channelId: 'default',
    })));

    await Promise.all(batch.map((row, index) => {
      const ticket = tickets[index];
      if (ticket?.status === 'ok') {
        delivered++;
        return rpc(config, 'mark_notification_delivered', { p_notification_id: row.id });
      }
      failed++;
      return rpc(config, 'mark_notification_failed', {
        p_notification_id: row.id,
        p_error: ticket?.message || ticket?.details?.error || 'Expo push ticket failed',
      });
    }));
  }

  console.log(`Keyword notifications: pending=${rows.length} delivered=${delivered} failed=${failed}`);
  return { pending: rows.length, delivered, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sendKeywordNotifications().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
