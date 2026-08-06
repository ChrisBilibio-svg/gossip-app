// ingest.mjs — pull free gossip sources, let Claude draft rumors, insert as drafts.
// Runs in GitHub Actions (Node 20) or any Node host. Dependency-free (global fetch).
// Secrets (env): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   [ANTHROPIC_MODEL], [AUTO_PUBLISH=true|false], [MAX_DRAFTS],
//   [NEWS_API_KEY], [NEWS_API_PROVIDER=gnews], [REDDIT_CLIENT_ID], [REDDIT_CLIENT_SECRET],
//   [X_BEARER_TOKEN], [XAI_API_KEY], [XAI_MAX_SEARCHES_PER_RUN=2], [ENABLE_4CHAN=true]

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const MIN_MARKET_WINDOW_MS = 6 * HOUR_MS;
const MAX_MARKET_WINDOW_MS = 45 * DAY_MS;
const EVIDENCE_RESOLUTION_GRACE_MS = 24 * HOUR_MS;

export function isTrustedSupabaseUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:') return false;
    if (!url.hostname.endsWith('.supabase.co')) return false;
    const projectRef = url.hostname.slice(0, -'.supabase.co'.length);
    return /^[a-z0-9-]{6,}$/.test(projectRef);
  } catch {
    return false;
  }
}

export function validateIngestConfig(config = {}) {
  const candidate = config && typeof config === 'object' ? config : {};
  for (const [name, value] of Object.entries({
    ANTHROPIC_API_KEY: candidate.anthropicKey,
    SUPABASE_URL: candidate.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: candidate.serviceKey,
  })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }
  if (!isTrustedSupabaseUrl(candidate.supabaseUrl)) {
    throw new Error('SUPABASE_URL must be an https://*.supabase.co project URL');
  }
}

export function parseXaiMaxSearches(value = '2') {
  const raw = value == null || value === '' ? '2' : String(value);
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(parsed) || parsed < 1 || parsed > 5) return 2;
  return parsed;
}

export function buildIngestConfig(env = process.env) {
  const rawMaxDrafts = env.MAX_DRAFTS || '12';
  const maxDrafts = Number(rawMaxDrafts);
  if (!/^\d+$/.test(rawMaxDrafts) || !Number.isInteger(maxDrafts) || maxDrafts < 1 || maxDrafts > 50) {
    throw new Error('MAX_DRAFTS must be an integer between 1 and 50');
  }

  const config = {
    anthropicKey: env.ANTHROPIC_API_KEY,
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    autoPublish: env.AUTO_PUBLISH === 'true', // false = drafts for curator review
    maxDrafts,
    newsApiKey: env.NEWS_API_KEY,
    newsApiProvider: (env.NEWS_API_PROVIDER || 'gnews').toLowerCase(),
    redditClientId: env.REDDIT_CLIENT_ID,
    redditClientSecret: env.REDDIT_CLIENT_SECRET,
    xBearerToken: env.X_BEARER_TOKEN,
    xaiApiKey: env.XAI_API_KEY,
    xaiMaxSearchesPerRun: parseXaiMaxSearches(env.XAI_MAX_SEARCHES_PER_RUN),
    enable4chan: env.ENABLE_4CHAN === 'true',
  };
  validateIngestConfig(config);
  return config;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Curated Brazilian outlet feeds are source-of-record: real publisher URLs only.
export const OUTLET_FEEDS = Object.freeze([
  { source: 'g1', url: 'https://g1.globo.com/rss/g1/pop-arte/', hosts: ['g1.globo.com'] },
  { source: 'Extra', url: 'https://extra.globo.com/rss/extra/famosos/', hosts: ['extra.globo.com'] },
  { source: 'Gshow', url: 'https://gshow.globo.com/rss/gshow/', hosts: ['gshow.globo.com'] },
  { source: 'Metrópoles', url: 'https://www.metropoles.com/feed', hosts: ['www.metropoles.com', 'metropoles.com'] },
  { source: 'Terra', url: 'https://www.terra.com.br/diversao/rss.xml', hosts: ['www.terra.com.br', 'terra.com.br'] },
  { source: 'Rolling Stone Brasil', url: 'https://rollingstone.com.br/feed/', hosts: ['rollingstone.com.br'] },
]);

// Google News RSS is discovery-only. Its opaque news.google.com/rss/articles links are never stored as source_url.
const NEWS_QUERIES = [
  'fofoca', 'fofoca famosos', 'celebridades brasil', 'affair famosos',
  'novela bastidores', 'bbb polêmica', 'sertanejo polêmica', 'funk polêmica',
  'influenciador polêmica', 'término famosos', 'rumor namoro famosos', 'briga famosos',
];
const googleNews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

const RELIABLE_SOURCE_PATTERNS = [
  /\bg1\b/i,
  /globo/i,
  /\buol\b/i,
  /folha/i,
  /estad[aã]o/i,
  /veja/i,
  /cnn\s*brasil/i,
  /metrópoles|metropoles/i,
  /terra/i,
  /r7/i,
  /rolling\s*stone\s*(brasil|br)?/i,
  /extra/i,
  /gshow/i,
  /gnews/i,
];

const UNVERIFIED_SOURCE_PATTERNS = [
  /reddit|\br\//i,
  /twitter|\bx\b|x\.com|tweet/i,
  /4chan|4cdn|boards\.4chan/i,
  /xai|grok/i,
  /google\s*news|news\.google\.com/i,
  /fórum|forum|social/i,
];

const CATEGORY_PATTERNS = [
  ['BBB', /\bbbb\b|big brother/i],
  ['Futebol', /futebol|jogador|técnic[oa]|tecnico|cartola|flamengo|corinthians|palmeiras|santos|são paulo|sao paulo|vasco|botafogo|grêmio|gremio|internacional|atlético|atletico/i],
  ['Música', /m[úu]sica|cantor|cantora|sertanejo|funk|show|turn[êe]|festival|feat\b|álbum|album|single/i],
  ['Novelas', /novela|ator|atriz|bastidores|elenco/i],
  ['Influencers', /influenciador|influenciadora|influencer|tiktoker|youtuber|instagram/i],
];

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'cmpid',
]);

const EVENT_STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
  'e', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'para', 'por', 'sobre', 'com',
  'sera', 'será', 'que', 'vai', 'deve', 'deveria', 'novo', 'nova', 'novos', 'novas',
  'apos', 'após', 'confirma', 'confirmar', 'confirmou', 'diz', 'fala', 'falou', 'rumor',
  'boato', 'fofoca', 'mercado', 'palpite', 'previsao', 'previsão', 'noticia', 'notícia',
]);

const SOCIAL_SAFETY_PATTERNS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF-ish
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ-ish
  /\b(rua|avenida|av\.|alameda|travessa)\b.+\b\d{1,5}\b/i,
  /\b(endere[cç]o|cpf|rg|documento|prontu[aá]rio|diagn[oó]stico|hiv|c[aâ]ncer)\b/i,
  /\b(assassinou|estuprou|traficou|roubou|matou|crime|criminos[ao])\b/i,
];

export function classifySource(source = '') {
  const text = String(source ?? '');
  if (UNVERIFIED_SOURCE_PATTERNS.some((pattern) => pattern.test(text))) return 'unverified';
  return RELIABLE_SOURCE_PATTERNS.some((pattern) => pattern.test(text)) ? 'reliable' : 'unverified';
}

export function inferCategory(title = '', source = '') {
  const text = `${title} ${source}`;
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'Celebridades';
}

export function normalizeCategory(value) {
  const category = typeof value === 'string' ? value.trim() : '';
  if (!category) return null;
  if (category.length < 2 || category.length > 32) return null;
  if (/[<>{}]/.test(category) || /javascript:/i.test(category)) return null;
  return category;
}

export function normalizeNewsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function hostOf(rawUrl = '') {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isAuthoritativeUrl(rawUrl = '') {
  const host = hostOf(rawUrl);
  if (!host) return false;
  if (host === 'news.google.com' || host.endsWith('.news.google.com')) return false;
  if (/reddit\.com|x\.com|twitter\.com|4cdn\.org|4chan\.org$/i.test(host)) return false;
  return OUTLET_FEEDS.some((feed) => feed.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)))
    || RELIABLE_SOURCE_PATTERNS.some((pattern) => pattern.test(host));
}

function isExpectedPublisherUrl(rawUrl = '', feed) {
  const host = hostOf(rawUrl);
  return Boolean(host && feed?.hosts?.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)));
}

export function normalizeEventKey(text = '') {
  const normalized = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !EVENT_STOPWORDS.has(token));

  return [...new Set(normalized)].slice(0, 8).join(' ');
}

function candidateKey(candidate = {}) {
  const eventKey = normalizeEventKey(candidate.title || candidate.summary || '');
  return eventKey || normalizeNewsUrl(candidate.url || candidate.referenceUrl || '').toLowerCase();
}

export function dedupeCandidates(candidates = [], existing = new Set()) {
  const existingSet = new Set([...existing].filter(Boolean).map(normalizeNewsUrl));
  const byKey = new Map();
  for (const raw of candidates) {
    const candidate = normalizeCandidate(raw);
    if (!candidate || !candidate.title) continue;
    if (candidate.url && existingSet.has(normalizeNewsUrl(candidate.url))) continue;
    if (candidate.url && !isAuthoritativeUrl(candidate.url)) {
      candidate.referenceUrl = candidate.referenceUrl || candidate.url;
      candidate.url = null;
      candidate.discovery = true;
    }

    const key = candidateKey(candidate);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, candidate);
      continue;
    }
    const previousReal = Boolean(previous.url && !previous.discovery);
    const candidateReal = Boolean(candidate.url && !candidate.discovery);
    if (candidateReal && !previousReal) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

const ENTITY_STOPWORDS = new Set([...EVENT_STOPWORDS, 'sera', 'será', 'ate', 'até', 'publico', 'público']);

function significantTokens(text = '') {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !ENTITY_STOPWORDS.has(token));
}

export function clusterDecisionForDraft(draft, candidates = []) {
  const eventKey = normalizeEventKey(draft?.summary ?? '');
  if (eventKey.length < 8) {
    return { action: 'create', eventKey, reason: 'weak_event_key' };
  }

  const match = candidates.find((candidate) => {
    const candidateKeyValue = normalizeEventKey(candidate?.event_key || candidate?.summary || '');
    return candidate?.id && candidateKeyValue && candidateKeyValue === eventKey;
  });

  if (!match) return { action: 'create', eventKey, reason: 'no_conservative_match' };
  return { action: 'cluster', rumorId: match.id, eventKey, reason: 'event_key' };
}

export function updateMarketDecisionForDraft(draft, candidates = []) {
  const draftTokens = new Set(significantTokens(draft?.summary ?? ''));
  if (draftTokens.size < 2) return { action: 'none', reason: 'weak_entities' };

  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const candidateTokens = new Set(significantTokens(candidate.summary ?? ''));
    const shared = [...draftTokens].filter((token) => candidateTokens.has(token));
    if (shared.length < 2) continue;

    const draftKey = normalizeEventKey(draft?.summary ?? '');
    const existingKey = normalizeEventKey(candidate.event_key || candidate.summary || '');
    if (draftKey && existingKey && draftKey === existingKey) continue;

    const overlapRatio = shared.length / Math.min(draftTokens.size, candidateTokens.size);
    if (overlapRatio >= 0.4) {
      return { action: 'update', rumorId: candidate.id, updateRumorId: candidate.id, reason: 'same_entities_changed_claim' };
    }
  }

  return { action: 'none', reason: 'no_conservative_update_match' };
}

export function clampMarketCloseAt(publishAt = new Date(), requestedCloseAt = null) {
  const publishDate = publishAt instanceof Date ? publishAt : new Date(publishAt);
  const fallback = new Date(publishDate.getTime() + SEVEN_DAYS_MS);
  const requested = requestedCloseAt ? new Date(requestedCloseAt) : fallback;
  if (Number.isNaN(publishDate.getTime())) return fallback.toISOString();
  const requestedTime = Number.isNaN(requested.getTime()) ? fallback.getTime() : requested.getTime();
  const minTime = publishDate.getTime() + MIN_MARKET_WINDOW_MS;
  const maxTime = publishDate.getTime() + MAX_MARKET_WINDOW_MS;
  return new Date(Math.min(maxTime, Math.max(minTime, requestedTime))).toISOString();
}

export function predictionDeadlineForPublish(publishAt = new Date(), timeframeDays = 7) {
  const publishDate = publishAt instanceof Date ? publishAt : new Date(publishAt);
  const days = normalizeTimeframeDays(timeframeDays) ?? 7;
  return clampMarketCloseAt(publishDate, new Date(publishDate.getTime() + days * DAY_MS));
}

export function resolveByForBettingClose(bettingClosesAt, resolutionPolicy = 'evidence') {
  const close = bettingClosesAt instanceof Date ? bettingClosesAt : new Date(bettingClosesAt);
  if (Number.isNaN(close.getTime())) return null;
  if (resolutionPolicy === 'deadline') return close.toISOString();
  return new Date(close.getTime() + EVIDENCE_RESOLUTION_GRACE_MS).toISOString();
}

export function normalizeTimeframeDays(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(45, Math.max(1, Math.round(value)));
  const text = String(value).trim().toLowerCase();
  const explicitDays = text.match(/(\d{1,2})\s*(dias?|days?|d)\b/);
  if (explicitDays) return Math.min(45, Math.max(1, Number(explicitDays[1])));
  const explicitWeeks = text.match(/(\d{1,2})\s*(semanas?|weeks?|w)\b/);
  if (explicitWeeks) return Math.min(45, Math.max(1, Number(explicitWeeks[1]) * 7));
  const explicitHours = text.match(/(\d{1,3})\s*(horas?|hours?|h)\b/);
  if (explicitHours) return Math.min(45, Math.max(1, Math.ceil(Number(explicitHours[1]) / 24)));
  if (/24\s*[-–]\s*48h|um\s+ou\s+dois\s+dias|pr[oó]ximas?\s+48h/.test(text)) return 2;
  if (/semana/.test(text)) return 7;
  if (/m[eê]s|mes/.test(text)) return 30;
  return null;
}

export function defaultResolutionCriteria(summary = 'o evento descrito', resolveByAt = null) {
  const suffix = resolveByAt ? ` até ${new Date(resolveByAt).toISOString()}` : ' até o resolve-by definido pelo mercado';
  return `Resolve TEA se fonte brasileira confiável ou confirmação oficial confirmar o evento (${String(summary).trim() || 'o evento descrito'})${suffix}. Resolve CAP se houver negação confiável ou o evento verificavelmente não acontecer no prazo. VOID se não houver veredito confiável até o resolve-by.`;
}

export function normalizeResolutionCriteria(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < 40 || text.length > 1000) return null;
  if (/[<>\u0000-\u001F\u007F]|javascript:|data:text\/html|on\w+\s*=|\bscript\b/i.test(text)) return null;
  if (!/\bTEA\b/i.test(text) || !/\bCAP\b/i.test(text) || !/\bVOID\b/i.test(text)) return null;
  return text;
}

export function shouldUseDraft(d) {
  if (!d || d.use !== true) return false;
  if (d.status !== 'speculated') return false;

  const summary = typeof d.summary === 'string' ? d.summary.trim() : '';
  const article = typeof d.article === 'string' ? d.article.trim() : '';

  return summary.length >= 20 && summary.length <= 180 && article.length <= 1200;
}

function isSafeDiscoveryText(text = '') {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (/[<>\u0000-\u001F\u007F]|javascript:|data:text\/html|on\w+\s*=|\bscript\b/i.test(value)) return false;
  return !SOCIAL_SAFETY_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeCandidate(candidate = {}) {
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!title || !isSafeDiscoveryText(title)) return null;
  const discovery = candidate.discovery === true || !candidate.url;
  const url = candidate.url ? normalizeNewsUrl(candidate.url) : null;
  const referenceUrl = candidate.referenceUrl ? normalizeNewsUrl(candidate.referenceUrl) : null;
  return {
    title,
    url: discovery ? null : url,
    source: String(candidate.source || 'Unknown').trim() || 'Unknown',
    discovery,
    referenceUrl: referenceUrl || (discovery && url ? url : null),
    sourceType: candidate.sourceType || (discovery ? 'discovery' : 'publisher'),
  };
}

export function buildRumorPayload(d, link, source, options = {}) {
  if (link && !isAuthoritativeUrl(link)) {
    throw new Error(`Refusing to store non-authoritative source_url: ${hostOf(link) || 'invalid-url'}`);
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const autoPublish = options.autoPublish ?? false;
  const publishAt = options.publishAt ?? now.toISOString();

  const timeframeDays = normalizeTimeframeDays(d.suggested_timeframe_days ?? d.timeframe_days ?? d.expected_resolution_window) ?? 7;
  const bettingClosesAt = predictionDeadlineForPublish(publishAt, timeframeDays);
  const resolveByAt = resolveByForBettingClose(bettingClosesAt, 'evidence');
  const resolutionCriteria = normalizeResolutionCriteria(d.resolution_criteria)
    ?? defaultResolutionCriteria(d.summary, resolveByAt);
  return {
    summary: d.summary.trim(),
    article: typeof d.article === 'string' && d.article.trim() ? d.article.trim() : null,
    category: normalizeCategory(d.category) ?? inferCategory(d.summary, source),
    // Hybrid resolution default: gathered gossip is evidence-first. The
    // prediction_deadline is now the betting/quote close; resolve_by_at is the
    // latest determination timestamp. If no credible verdict exists by then, the
    // market VOIDs instead of becoming a false CAP.
    status: 'speculated',
    is_draft: !autoPublish,
    publish_at: publishAt,
    resolution_policy: 'evidence',
    prediction_deadline: bettingClosesAt,
    resolve_by_at: resolveByAt,
    resolution_criteria: resolutionCriteria,
    suggested_timeframe: d.suggested_timeframe || `${timeframeDays} dias — janela sugerida pelo draft; curador pode ajustar antes de publicar`,
    required_source_count: 2,
    seed_true: Math.max(0, d.seed_true | 0),
    seed_false: Math.max(0, d.seed_false | 0),
    source_url: link,
    source_label: source || 'Fonte em curadoria',
    event_key: normalizeEventKey(d.summary),
    updates_rumor_id: options.updatesRumorId ?? null,
  };
}

function decode(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

export async function fetchRss(url, label, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,*/*' } });
    const xml = await res.text();
    const items = [];
    // RSS <item> and Atom <entry>
    for (const m of xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g)) {
      const b = m[1];
      const title = decode((b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
      let link = decode((b.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1]);
      if (!link) link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
      link = normalizeNewsUrl(link);
      const source = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]) || label;
      if (title && link) items.push({ title, link, source });
    }
    console.log(`  [${label}] ${res.status} -> ${items.length} items`);
    return items.slice(0, 8);
  } catch (e) {
    console.log(`  [${label}] ERROR ${e.message}`);
    return [];
  }
}

export async function fetchOutletFeed(feed, fetchImpl = fetch) {
  const items = await fetchRss(feed.url, feed.source, fetchImpl);
  return items
    .filter((item) => isExpectedPublisherUrl(item.link, feed))
    .map((item) => ({ title: item.title, url: item.link, source: item.source || feed.source, discovery: false, sourceType: 'publisher' }));
}

export async function fetchGoogleDiscovery(fetchImpl = fetch) {
  const candidates = [];
  for (const query of NEWS_QUERIES) {
    for (const item of await fetchRss(googleNews(query), `Google News: ${query}`, fetchImpl)) {
      candidates.push({ title: item.title, url: null, referenceUrl: item.link, source: item.source || 'Google News', discovery: true, sourceType: 'google' });
    }
  }
  return candidates;
}

export async function fetchNewsApi(config = {}, fetchImpl = fetch) {
  if (!config.newsApiKey) return [];
  // Provider is intentionally env-gated and defaults to GNews; unsupported paid
  // providers stay no-op instead of risking surprise calls or hard failures.
  if ((config.newsApiProvider || 'gnews').toLowerCase() !== 'gnews') return [];
  const params = new URLSearchParams({
    q: 'fofoca OR celebridades OR BBB OR famosos',
    lang: 'pt',
    country: 'br',
    max: '10',
    apikey: config.newsApiKey,
  });
  try {
    const res = await fetchImpl(`https://gnews.io/api/v4/search?${params}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles || [])
      .map((article) => ({
        title: article.title,
        url: article.url ? normalizeNewsUrl(article.url) : null,
        source: article.source?.name || 'GNews',
        discovery: !isAuthoritativeUrl(article.url || ''),
        sourceType: 'news-api',
      }))
      .filter((candidate) => candidate.title && (candidate.discovery || isAuthoritativeUrl(candidate.url)));
  } catch {
    return [];
  }
}

async function fetchRedditToken(config = {}, fetchImpl = fetch) {
  if (!config.redditClientId || !config.redditClientSecret) return null;
  const credentials = Buffer.from(`${config.redditClientId}:${config.redditClientSecret}`).toString('base64');
  try {
    const res = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function fetchRedditDiscovery(config = {}, fetchImpl = fetch) {
  const subreddits = ['popculturechat', 'Fauxmoi', 'brasil', 'BBB'];
  const token = await fetchRedditToken(config, fetchImpl);
  const headers = token ? { Authorization: `Bearer ${token}`, 'User-Agent': UA } : { 'User-Agent': UA };
  const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
  const endpoints = [
    ...subreddits.map((sub) => `${base}/r/${sub}/hot.json?limit=8`),
    `${base}/search.json?q=${encodeURIComponent('celebridades OR BBB OR fofoca')}&restrict_sr=false&limit=8`,
  ];
  const candidates = [];
  for (const endpoint of endpoints) {
    try {
      const res = await fetchImpl(endpoint, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      for (const child of data?.data?.children || []) {
        const post = child?.data || {};
        const title = String(post.title || '').trim();
        if (!isSafeDiscoveryText(title)) continue;
        const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : null;
        candidates.push({ title, url: null, referenceUrl: permalink, source: `Reddit${post.subreddit ? ` r/${post.subreddit}` : ''}`, discovery: true, sourceType: 'reddit' });
      }
    } catch {
      // Source is optional and should never break the publisher-feed pipeline.
    }
  }
  return candidates;
}

export async function fetchXDiscovery(config = {}, fetchImpl = fetch) {
  // X API v2 recent search is paid/pay-per-use (Basic/Pro tiers were killed in
  // Feb 2026), so this adapter is fully token-gated and never scrapes.
  if (!config.xBearerToken) return [];
  const query = '(celebridades OR famosos OR fofoca OR BBB) lang:pt -is:retweet';
  const params = new URLSearchParams({
    query,
    max_results: '10',
    'tweet.fields': 'created_at,lang',
  });
  try {
    const res = await fetchImpl(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${config.xBearerToken}`, 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .map((tweet) => ({
        title: tweet.text,
        url: null,
        referenceUrl: tweet.id ? `https://x.com/i/web/status/${tweet.id}` : null,
        source: 'X/Twitter',
        discovery: true,
        sourceType: 'x',
      }))
      .filter((candidate) => isSafeDiscoveryText(candidate.title));
  } catch {
    return [];
  }
}

export function xPostUrlFromValue(value = '') {
  try {
    const u = new URL(String(value));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (!['x.com', 'twitter.com'].includes(host)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === 'status');
    const id = statusIndex >= 0 ? parts[statusIndex + 1] : null;
    if (!/^\d{5,}$/.test(id || '')) return null;
    return `https://x.com/i/web/status/${id}`;
  } catch {
    return null;
  }
}

export async function fetchXaiDiscovery(config = {}, fetchImpl = fetch) {
  if (!config.xaiApiKey) return [];
  const maxSearches = parseXaiMaxSearches(config.xaiMaxSearchesPerRun ?? config.xaiMaxSearches ?? '2');
  const queries = [
    'fofoca celebridades Brasil resolvível próxima semana site:x.com',
    'BBB famosos namoro término rumor Brasil verificável site:x.com',
    'cantor atriz influencer vai anunciar lançar participar Brasil site:x.com',
  ].slice(0, maxSearches);
  const candidates = [];
  for (const query of queries) {
    try {
      const res = await fetchImpl('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.xaiApiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': UA,
        },
        body: JSON.stringify({
          model: config.xaiModel || 'grok-4-latest',
          messages: [{
            role: 'user',
            content: `Use live search to find up to 5 Portuguese/Brazil-relevant celebrity/gossip leads from X posts for today. Only include leads that are timely and could become a resolvable Viddi market. Return strict JSON only: [{"title":"short pt-BR lead framed as a public question/probability, not an accusation","source_url":"https://x.com/.../status/..."}]. Query focus: ${query}`,
          }],
          search_parameters: { mode: 'on', max_search_results: 5 },
          temperature: 0,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = String(data?.choices?.[0]?.message?.content || '');
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const items = JSON.parse(match[0]);
      for (const item of Array.isArray(items) ? items : []) {
        const title = String(item?.title || '').trim();
        const referenceUrl = xPostUrlFromValue(item?.source_url || item?.url || '');
        if (!title || !referenceUrl || !isSafeDiscoveryText(title)) continue;
        candidates.push({ title, url: null, referenceUrl, source: 'xAI/Grok Live Search', discovery: true, sourceType: 'xai' });
      }
    } catch {
      // Optional paid discovery source. Never break free publisher-feed ingest.
    }
  }
  return candidates;
}

function stripChanHtml(value = '') {
  return decode(String(value).replace(/<br\s*\/?\>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export async function fetch4chanDiscovery(config = {}, fetchImpl = fetch) {
  // 4chan is English/US-centric, low-signal for Brazilian gossip, and
  // high-toxicity. Keep explicit-flag gated; Chris must approve before enabling
  // ENABLE_4CHAN in the scheduled workflow.
  if (config.enable4chan !== true) return [];
  const boards = ['tv', 'mu'];
  const candidates = [];
  for (const board of boards) {
    try {
      const res = await fetchImpl(`https://a.4cdn.org/${board}/catalog.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) continue;
      const pages = await res.json();
      for (const thread of pages.flatMap((page) => page.threads || []).slice(0, 20)) {
        const rawTitle = String(thread.sub || thread.com || '');
        if (/[<>]|javascript:|data:text\/html|on\w+\s*=|\bscript\b/i.test(rawTitle)) continue;
        const title = stripChanHtml(rawTitle);
        if (!isSafeDiscoveryText(title)) continue;
        candidates.push({
          title,
          url: null,
          referenceUrl: thread.no ? `https://boards.4chan.org/${board}/thread/${thread.no}` : null,
          source: `4chan /${board}/`,
          discovery: true,
          sourceType: '4chan',
        });
      }
    } catch {
      // Flag-gated optional discovery only.
    }
  }
  return candidates;
}

async function existingLinks(config) {
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rumors?select=source_url&created_at=gte.${since}`, {
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
    });
    const rows = await res.json();
    return new Set((rows || []).map((r) => r.source_url).filter(Boolean).map(normalizeNewsUrl));
  } catch {
    return new Set();
  }
}

export async function gatherCandidates(config = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const existing = options.existingLinks || new Set();
  const candidates = [];

  for (const feed of OUTLET_FEEDS) candidates.push(...await fetchOutletFeed(feed, fetchImpl));
  candidates.push(...await fetchNewsApi(config, fetchImpl));
  candidates.push(...await fetchGoogleDiscovery(fetchImpl));
  candidates.push(...await fetchRedditDiscovery(config, fetchImpl));
  candidates.push(...await fetchXDiscovery(config, fetchImpl));
  candidates.push(...await fetchXaiDiscovery(config, fetchImpl));
  candidates.push(...await fetch4chanDiscovery(config, fetchImpl));

  return dedupeCandidates(candidates, existing);
}

export async function draftFromHeadline(title, source, config) {
  const sourceReliability = classifySource(source);
  const prompt = `Você é curador do Viddi, um jogo brasileiro de mercados de palpites sobre cultura pop e celebridades. Dada a manchete e a fonte, transforme em uma previsão clara que pode ser resolvida por evidência confiável.
Manchete: "${title}"
Fonte: "${source}"
Classificação local da fonte: "${sourceReliability}"
REGRA DE ENQUADRAMENTO (importante):
- Todo item usado deve virar um mercado evidence-first: TEA/CAP só com fontes confiáveis.
- Escolha uma janela por mercado a partir do evento, não uma janela fixa. Defina suggested_timeframe_days entre 1 e 45 (mínimo prático 6h; use 1 dia para 6-24h) e explique brevemente em suggested_timeframe por que esse prazo é plausível.
- Escreva resolution_criteria com regra explícita: "Resolve TEA se..., CAP se..., VOID se...". Ela deve citar fonte brasileira confiável/declaração oficial/evento público como critério de resolução.
- prediction_deadline fecha apostas/cotações; resolve_by_at será calculado pelo app a partir da janela sugerida; sem veredito confiável até lá, o mercado será VOID (push), NÃO CAP automático.
- Escreva o resumo como pergunta/palpite verificável, sem afirmar acusação como fato.
- Não marque como confirmado no JSON; o app sempre publica como "speculated" até TEA/CAP/VOID ser resolvido.
- Mesmo se a fonte parecer confiável, trate como base para uma previsão/verificação futura, sem acusar como fato além da fonte.
- TRANSPARÊNCIA DA FONTE: se a "Classificação local da fonte" acima for "unverified" (ou seja, NÃO é um veículo de referência como Globo, g1, CNN Brasil, UOL, Folha, Estadão, Terra, Metrópoles, Extra, Gshow ou Rolling Stone Brasil), AVISE isso explicitamente dentro do "article" — algo como: "Atenção: esta informação vem de [nome da fonte], que não é uma fonte plenamente verificada; por ora é apenas o que essa fonte afirma e o palpite depende de confirmação por veículos confiáveis." Se for "reliable", NÃO inclua esse aviso.
- DISCOVERY-ONLY: se a fonte vier de Google News, Reddit, X/Twitter, xAI/Grok Live Search ou 4chan, ela é apenas pista não verificada para rascunho; o curador precisa anexar fonte jornalística real antes de aprovar/resolver.
- DIREITOS AUTORAIS: escreva com SUAS PRÓPRIAS PALAVRAS. NÃO copie o título nem trechos literais da matéria — a manchete é só insumo. A fonte original é creditada por link/atribuição no app, nunca reproduzida em texto corrido.
- HONRA (anti-calúnia/difamação): nunca impute um crime a alguém como fato; enquadre como pergunta/probabilidade pública ("será que...?"), nunca como acusação. Não inclua dados pessoais sensíveis (endereço, documento, saúde, etc.).
Responda SOMENTE JSON: {"use": true|false, "summary": "1 frase curta pt-BR em forma de palpite/previsão verificável", "article": "parágrafo de 3-5 frases pt-BR com mais contexto do mercado, explicando que a aposta depende de fontes confiáveis e que sem veredito no resolve-by vira VOID/push", "category": "Celebridades|BBB|Futebol|Música|Novelas|Influencers", "status": "speculated", "suggested_timeframe_days": int, "suggested_timeframe": "1 frase explicando por que esse mercado deve fechar/resolver nesse prazo", "resolution_criteria": "Resolve TEA se... Resolve CAP se... VOID se...", "seed_true": int, "seed_false": int}
Se não der para transformar em previsão verificável por fontes confiáveis ou não for fofoca de celebridade interessante, {"use": false}. Seeds: total ~300-1500, divididos de forma plausível.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      console.log(`  anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const data = await res.json();
    const txt = (data.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
    return txt ? JSON.parse(txt[0]) : null;
  } catch (e) {
    console.log('  anthropic error', e.message);
    return null;
  }
}

async function recentOpenRumors(config) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  try {
    const params = new URLSearchParams({
      select: 'id,summary,event_key,created_at',
      status: 'eq.speculated',
      is_draft: 'eq.false',
      created_at: `gte.${since}`,
      order: 'created_at.desc',
      limit: '80',
    });
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rumors?${params}`, {
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function attachEvidenceSource(rumorId, link, source, draft, config) {
  if (!link || !isAuthoritativeUrl(link)) {
    console.log('  skipped non-authoritative evidence source attach');
    return false;
  }
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rumor_evidence_sources`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify({
      rumor_id: rumorId,
      source_url: link,
      source_label: source || 'Fonte jornalística',
      supports_outcome: true,
      note: `Cluster automático do ingest: ${String(draft?.summary ?? '').slice(0, 180)}`,
    }),
  });
  if (!res.ok) console.log('  cluster evidence attach failed', res.status, (await res.text()).slice(0, 120));
  return res.ok;
}

async function insertRumor(d, link, source, config, openRumors = []) {
  const hasAuthoritativeSource = Boolean(link && isAuthoritativeUrl(link));
  const clusterDecision = hasAuthoritativeSource ? clusterDecisionForDraft(d, openRumors) : { action: 'create', eventKey: normalizeEventKey(d?.summary), reason: 'discovery_only' };
  if (clusterDecision.action === 'cluster') {
    const ok = await attachEvidenceSource(clusterDecision.rumorId, link, source, d, config);
    if (ok) console.log(`  ↳ clustered source onto ${clusterDecision.rumorId} (${clusterDecision.reason})`);
    return ok;
  }

  const decision = updateMarketDecisionForDraft(d, openRumors);
  const payload = buildRumorPayload(d, hasAuthoritativeSource ? link : null, source, {
    autoPublish: hasAuthoritativeSource ? config.autoPublish : false,
    updatesRumorId: decision.updateRumorId ?? null,
  });
  let res = await fetch(`${config.supabaseUrl}/rest/v1/rumors`, {
    method: 'POST',
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/event_key|updates_rumor_id|schema cache|column/i.test(text)) {
      const {
        event_key: _eventKey,
        updates_rumor_id: _updatesRumorId,
        resolve_by_at: _resolveByAt,
        resolution_criteria: _resolutionCriteria,
        suggested_timeframe: _suggestedTimeframe,
        ...legacyPayload
      } = payload;
      res = await fetch(`${config.supabaseUrl}/rest/v1/rumors`, {
        method: 'POST',
        headers: {
          apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(legacyPayload),
      });
      if (!res.ok) console.log('  insert failed', res.status, (await res.text()).slice(0, 120));
    } else {
      console.log('  insert failed', res.status, text.slice(0, 120));
    }
  }
  if (res.ok) {
    try {
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.id) openRumors.push({ id: row.id, summary: row.summary ?? d.summary, event_key: row.event_key ?? clusterDecision.eventKey });
    } catch {
      // Non-fatal: the insert succeeded; future runs can still cluster from DB state.
    }
  }
  return res.ok;
}

async function main() {
  const config = buildIngestConfig();

  console.log('Fetching sources...');
  const seen = await existingLinks(config);
  const openRumors = await recentOpenRumors(config);
  const candidates = await gatherCandidates(config, { existingLinks: seen });

  console.log(`Unique candidates: ${candidates.length}. Drafting up to ${config.maxDrafts}...`);

  let made = 0;
  for (const it of candidates) {
    if (made >= config.maxDrafts) break;
    const d = await draftFromHeadline(it.title, it.source, config);
    if (shouldUseDraft(d) && (await insertRumor(d, it.url, it.source, config, openRumors))) {
      made++;
      console.log(`  ✓ [${d.status}] ${d.summary.trim().slice(0, 60)}${it.discovery ? ' (discovery-only)' : ''}`);
    }
  }
  console.log(`Done. ${made} ${config.autoPublish ? 'published' : 'draft(s)'} created from ${candidates.length} candidates.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
