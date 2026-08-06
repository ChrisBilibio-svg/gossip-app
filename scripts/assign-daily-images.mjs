import {
  CANONICAL_IMAGE_CATEGORIES,
  canonicalImageCategory,
  deriveNeutralDescriptor,
  searchPexelsImage,
} from './editorial-images.mjs';
import { pathToFileURL } from 'node:url';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

function isTrustedSupabaseUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co') && url.pathname === '/';
  } catch {
    return false;
  }
}

export function saoPauloDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function saoPauloDayBounds(now = new Date()) {
  const date = saoPauloDate(now);
  // São Paulo has observed UTC-03 without DST since 2019. Calculating through
  // Intl keeps the calendar date correct; these bounds keep the REST request
  // bounded to the day's publication candidates.
  const noon = new Date(`${date}T12:00:00Z`);
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TIME_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(noon);
  const offset = offsetParts.find((item) => item.type === 'timeZoneName')?.value.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '-03:00';
  const start = new Date(`${date}T00:00:00${offset}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date, start: start.toISOString(), end: end.toISOString() };
}

export function selectDailyCategoryWinners(markets = [], { now = new Date() } = {}) {
  const { start, end } = saoPauloDayBounds(now);
  const nowMs = now.getTime();
  const eligible = markets.filter((market) => {
    const category = canonicalImageCategory(market.category);
    const publishedAt = Date.parse(market.publish_at ?? market.created_at ?? '');
    const deadline = market.prediction_deadline ? Date.parse(market.prediction_deadline) : Infinity;
    return category
      && market.is_draft === false
      && market.status === 'speculated'
      && Number.isFinite(publishedAt)
      && publishedAt >= Date.parse(start)
      && publishedAt < Date.parse(end)
      && publishedAt <= nowMs
      && deadline > nowMs;
  });

  eligible.sort((a, b) => {
    const publishDifference = Date.parse(b.publish_at ?? b.created_at) - Date.parse(a.publish_at ?? a.created_at);
    if (publishDifference) return publishDifference;
    const createdDifference = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (createdDifference) return createdDifference;
    return String(b.id).localeCompare(String(a.id));
  });

  const winners = new Map();
  for (const market of eligible) {
    const category = canonicalImageCategory(market.category);
    if (category && !winners.has(category)) winners.set(category, { ...market, category });
  }
  return CANONICAL_IMAGE_CATEGORIES.flatMap((category) => winners.has(category) ? [winners.get(category)] : []);
}

export function buildAssignmentConfig(env = process.env, argv = process.argv.slice(2)) {
  return {
    live: argv.includes('--live'),
    supabaseUrl: env.SUPABASE_URL || null,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    pexelsApiKey: env.PEXELS_API_KEY || null,
  };
}

function serviceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchDailyCandidates(config, fetchImpl, now) {
  if (!isTrustedSupabaseUrl(config.supabaseUrl) || !config.serviceKey) throw new Error('missing_server_config');
  const { start, end } = saoPauloDayBounds(now);
  const candidates = [];
  const pageSize = 1_000;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const url = new URL('/rest/v1/rumors', config.supabaseUrl);
    url.searchParams.set('select', 'id,summary,category,status,is_draft,publish_at,created_at,prediction_deadline,editorial_image_url,editorial_image_feature_date');
    url.searchParams.set('is_draft', 'eq.false');
    url.searchParams.set('status', 'eq.speculated');
    url.searchParams.set('publish_at', `gte.${start}`);
    url.searchParams.append('publish_at', `lt.${end}`);
    url.searchParams.set('order', 'publish_at.desc,created_at.desc,id.desc');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetchImpl(url, { headers: serviceHeaders(config.serviceKey), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`candidate_http_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('candidate_malformed_response');
    candidates.push(...payload);
    if (payload.length < pageSize) return candidates;
  }
  throw new Error('candidate_page_limit');
}

async function assignImage(config, winner, image, featureDate, fetchImpl) {
  const url = new URL('/rest/v1/rpc/service_assign_daily_editorial_image', config.supabaseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: serviceHeaders(config.serviceKey),
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      p_rumor_id: winner.id,
      p_feature_date: featureDate,
      p_image_url: image.imageUrl,
      p_image_alt: image.alt,
      p_image_page_url: image.pageUrl,
      p_photographer: image.photographer,
      p_photographer_url: image.photographerUrl,
      p_provider_id: image.providerId,
      p_descriptor: image.descriptor,
    }),
  });
  if (!response.ok) throw new Error(`assignment_http_${response.status}`);
}

export async function runDailyImageAssignment({
  config = buildAssignmentConfig(),
  fetchImpl = fetch,
  now = new Date(),
  logger = console,
  markets,
} = {}) {
  if (!config.pexelsApiKey) {
    logger.info?.('Editorial images skipped: missing_api_key.');
    return { assigned: 0, attempted: 0, skipped: 'missing_api_key' };
  }

  let candidates;
  try {
    candidates = markets ?? await fetchDailyCandidates(config, fetchImpl, now);
  } catch (error) {
    logger.warn?.(`Editorial images skipped: ${error instanceof Error ? error.message : 'candidate_error'}.`);
    return { assigned: 0, attempted: 0, skipped: 'candidate_error' };
  }

  const featureDate = saoPauloDate(now);
  const winners = selectDailyCategoryWinners(candidates, { now });
  let assigned = 0;
  let attempted = 0;
  let failed = 0;

  for (const winner of winners) {
    if (winner.editorial_image_url && winner.editorial_image_feature_date === featureDate) {
      logger.info?.(`Editorial image already assigned for ${winner.category}; skipping duplicate search.`);
      continue;
    }
    const descriptor = deriveNeutralDescriptor(winner.summary, winner.category);
    if (!descriptor) continue;
    attempted += 1;
    const result = await searchPexelsImage({ apiKey: config.pexelsApiKey, descriptor, fetchImpl });
    if (!result.image) {
      logger.warn?.(`Editorial image skipped for ${winner.category}: ${result.reason}.`);
      if (result.reason === 'rate_limited') break;
      continue;
    }
    if (!config.live) {
      logger.info?.(`Dry run: ${winner.category} would use Pexels photo ${result.image.providerId}.`);
      continue;
    }
    try {
      await assignImage(config, winner, result.image, featureDate, fetchImpl);
      assigned += 1;
      logger.info?.(`Editorial image assigned for ${winner.category}.`);
    } catch (error) {
      failed += 1;
      logger.warn?.(`Editorial image assignment failed for ${winner.category}: ${error instanceof Error ? error.message : 'assignment_error'}.`);
    }
  }

  return { assigned, attempted, failed, dryRun: !config.live };
}

async function main() {
  const result = await runDailyImageAssignment();
  console.log(`Editorial image job complete: ${result.assigned} assigned, ${result.attempted} searched${result.dryRun ? ' (dry run)' : ''}.`);
  if (result.skipped === 'candidate_error' || result.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.warn(`Editorial image job ended safely: ${error instanceof Error ? error.message : 'unknown_error'}.`);
    process.exitCode = 1;
  });
}
