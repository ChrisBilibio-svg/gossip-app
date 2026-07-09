// ingest.mjs — pull free gossip sources, let Claude draft rumors, insert as drafts.
// Runs in GitHub Actions (Node 20) or any Node host. Dependency-free (global fetch).
// Secrets (env): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   [ANTHROPIC_MODEL], [AUTO_PUBLISH=true|false], [MAX_DRAFTS]

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function validateIngestConfig(config = {}) {
  const candidate = config && typeof config === 'object' ? config : {};
  for (const [name, value] of Object.entries({
    ANTHROPIC_API_KEY: candidate.anthropicKey,
    SUPABASE_URL: candidate.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: candidate.serviceKey,
  })) {
    if (!value) throw new Error(`Missing env: ${name}`);
  }
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
  };
  validateIngestConfig(config);
  return config;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Google News RSS aggregates ALL outlets — broad coverage via many queries.
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

export function classifySource(source = '') {
  return RELIABLE_SOURCE_PATTERNS.some((pattern) => pattern.test(source)) ? 'reliable' : 'unverified';
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

export function clusterDecisionForDraft(draft, candidates = []) {
  const eventKey = normalizeEventKey(draft?.summary ?? '');
  if (eventKey.length < 8) {
    return { action: 'create', eventKey, reason: 'weak_event_key' };
  }

  const match = candidates.find((candidate) => {
    const candidateKey = normalizeEventKey(candidate?.event_key || candidate?.summary || '');
    return candidate?.id && candidateKey && candidateKey === eventKey;
  });

  if (!match) return { action: 'create', eventKey, reason: 'no_conservative_match' };
  return { action: 'cluster', rumorId: match.id, eventKey, reason: 'event_key' };
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

export function updateMarketDecisionForDraft(draft, candidates = []) {
  const draftTokens = new Set(significantTokens(draft?.summary ?? ''));
  if (draftTokens.size < 2) return { action: 'none', reason: 'weak_entities' };

  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const candidateTokens = new Set(significantTokens(candidate.summary ?? ''));
    const shared = [...draftTokens].filter((token) => candidateTokens.has(token));
    if (shared.length < 2) continue;

    const draftKey = normalizeEventKey(draft?.summary ?? '');
    const candidateKey = normalizeEventKey(candidate.event_key || candidate.summary || '');
    if (draftKey && candidateKey && draftKey === candidateKey) continue;

    const overlapRatio = shared.length / Math.min(draftTokens.size, candidateTokens.size);
    if (overlapRatio >= 0.4) {
      return { action: 'update', rumorId: candidate.id, updateRumorId: candidate.id, reason: 'same_entities_changed_claim' };
    }
  }

  return { action: 'none', reason: 'no_conservative_update_match' };
}

export function predictionDeadlineForPublish(publishAt = new Date()) {
  const publishDate = publishAt instanceof Date ? publishAt : new Date(publishAt);
  return new Date(publishDate.getTime() + SEVEN_DAYS_MS).toISOString();
}

export function shouldUseDraft(d) {
  if (!d || d.use !== true) return false;
  if (d.status !== 'speculated') return false;

  const summary = typeof d.summary === 'string' ? d.summary.trim() : '';
  const article = typeof d.article === 'string' ? d.article.trim() : '';

  return summary.length >= 20 && summary.length <= 180 && article.length <= 1200;
}

export function buildRumorPayload(d, link, source, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const autoPublish = options.autoPublish ?? false;
  const publishAt = options.publishAt ?? now.toISOString();

  return {
    summary: d.summary.trim(),
    article: typeof d.article === 'string' && d.article.trim() ? d.article.trim() : null,
    category: normalizeCategory(d.category) ?? inferCategory(d.summary, source),
    // Hybrid resolution default: gathered gossip is evidence-first. The
    // prediction_deadline is a resolve-by window; if no credible verdict exists
    // by then, the market VOIDs instead of becoming a false CAP.
    status: 'speculated',
    is_draft: !autoPublish,
    publish_at: publishAt,
    resolution_policy: 'evidence',
    prediction_deadline: predictionDeadlineForPublish(publishAt),
    required_source_count: 2,
    seed_true: Math.max(0, d.seed_true | 0),
    seed_false: Math.max(0, d.seed_false | 0),
    source_url: link,
    source_label: source || 'Google News',
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

async function fetchRss(url, label) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,*/*' } });
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

async function draftFromHeadline(title, source, config) {
  const sourceReliability = classifySource(source);
  const prompt = `Você é curador do Viddi, um jogo brasileiro de mercados de palpites sobre cultura pop e celebridades. Dada a manchete e a fonte, transforme em uma previsão clara que pode ser resolvida por evidência confiável.
Manchete: "${title}"
Fonte: "${source}"
Classificação local da fonte: "${sourceReliability}"
REGRA DE ENQUADRAMENTO (importante):
- Todo item usado deve virar um mercado evidence-first: TEA/CAP só com fontes confiáveis.
- O app atribui uma janela resolve-by padrão de 7 dias; se não houver veredito confiável até lá, o mercado será VOID (push), NÃO CAP automático.
- Escreva o resumo como pergunta/palpite verificável, sem afirmar acusação como fato.
- Não marque como confirmado no JSON; o app sempre publica como "speculated" até TEA/CAP/VOID ser resolvido.
- Mesmo se a fonte parecer confiável, trate como base para uma previsão/verificação futura, sem acusar como fato além da fonte.
- TRANSPARÊNCIA DA FONTE: se a "Classificação local da fonte" acima for "unverified" (ou seja, NÃO é um veículo de referência como Globo, g1, CNN Brasil, UOL, Folha, Estadão ou Terra), AVISE isso explicitamente dentro do "article" — algo como: "Atenção: esta informação vem de [nome da fonte], que não é uma fonte plenamente verificada; por ora é apenas o que essa fonte afirma e o palpite depende de confirmação por veículos confiáveis." Se for "reliable", NÃO inclua esse aviso.
- DIREITOS AUTORAIS: escreva com SUAS PRÓPRIAS PALAVRAS. NÃO copie o título nem trechos literais da matéria — a manchete é só insumo. A fonte original é creditada por link/atribuição no app, nunca reproduzida em texto corrido.
- HONRA (anti-calúnia/difamação): nunca impute um crime a alguém como fato; enquadre como pergunta/probabilidade pública ("será que...?"), nunca como acusação. Não inclua dados pessoais sensíveis (endereço, documento, saúde, etc.).
Responda SOMENTE JSON: {"use": true|false, "summary": "1 frase curta pt-BR em forma de palpite/previsão verificável", "article": "parágrafo de 3-5 frases pt-BR com mais contexto do mercado, explicando que a aposta depende de fontes confiáveis e que sem veredito no resolve-by vira VOID/push", "category": "Celebridades|BBB|Futebol|Música|Novelas|Influencers", "status": "speculated", "seed_true": int, "seed_false": int}
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
      source_label: source || 'Google News',
      supports_outcome: true,
      note: `Cluster automático do ingest: ${String(draft?.summary ?? '').slice(0, 180)}`,
    }),
  });
  if (!res.ok) console.log('  cluster evidence attach failed', res.status, (await res.text()).slice(0, 120));
  return res.ok;
}

async function insertRumor(d, link, source, config, openRumors = []) {
  const clusterDecision = clusterDecisionForDraft(d, openRumors);
  if (clusterDecision.action === 'cluster') {
    const ok = await attachEvidenceSource(clusterDecision.rumorId, link, source, d, config);
    if (ok) console.log(`  ↳ clustered source onto ${clusterDecision.rumorId} (${clusterDecision.reason})`);
    return ok;
  }

  const decision = updateMarketDecisionForDraft(d, openRumors);
  const payload = buildRumorPayload(d, link, source, {
    autoPublish: config.autoPublish,
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
      const { event_key: _eventKey, updates_rumor_id: _updatesRumorId, ...legacyPayload } = payload;
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
  const candidates = [];
  for (const q of NEWS_QUERIES) for (const it of await fetchRss(googleNews(q), q)) if (!seen.has(normalizeNewsUrl(it.link))) candidates.push(it);

  const byTitle = new Map();
  for (const c of candidates) if (!byTitle.has(c.title)) byTitle.set(c.title, c);
  console.log(`Unique candidates: ${byTitle.size}. Drafting up to ${config.maxDrafts}...`);

  let made = 0;
  for (const it of byTitle.values()) {
    if (made >= config.maxDrafts) break;
    const d = await draftFromHeadline(it.title, it.source, config);
    if (shouldUseDraft(d) && (await insertRumor(d, it.link, it.source, config, openRumors))) {
      made++;
      console.log(`  ✓ [${d.status}] ${d.summary.trim().slice(0, 60)}`);
    }
  }
  console.log(`Done. ${made} ${config.autoPublish ? 'published' : 'draft(s)'} created from ${byTitle.size} candidates.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
