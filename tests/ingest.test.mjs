import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIngestConfig, buildRumorPayload, clampMarketCloseAt, classifySource, dedupeCandidates, defaultResolutionCriteria, fetch4chanDiscovery, fetchGoogleDiscovery, fetchNewsApi, fetchOutletFeed, fetchRedditDiscovery, fetchXaiDiscovery, fetchXDiscovery, gatherCandidates, inferCategory, isAuthoritativeUrl, isTrustedSupabaseUrl, normalizeCategory, normalizeResolutionCriteria, normalizeTimeframeDays, OUTLET_FEEDS, parseXaiMaxSearches, predictionDeadlineForPublish, resolveByForBettingClose, normalizeNewsUrl, shouldUseDraft, validateIngestConfig, xPostUrlFromValue } from '../scripts/ingest.mjs';

test('classifySource identifies established Brazilian news outlets as reliable', () => {
  for (const source of ['G1', 'Globo', 'UOL', 'Folha de S.Paulo', 'Estadão', 'CNN Brasil']) {
    assert.equal(classifySource(source), 'reliable', source);
  }
});

test('classifySource treats social and unknown sources as unverified', () => {
  for (const source of ['Twitter/X', 'Reddit', 'Blog anônimo', 'Perfil de fofoca']) {
    assert.equal(classifySource(source), 'unverified');
  }
});

test('inferCategory assigns lightweight topic labels for ingested rumors', () => {
  assert.equal(inferCategory('Briga no BBB esquenta durante festa'), 'BBB');
  assert.equal(inferCategory('Jogador do Flamengo negocia saída'), 'Futebol');
  assert.equal(inferCategory('Cantora prepara turnê surpresa'), 'Música');
  assert.equal(inferCategory('Rumor genérico de bastidor'), 'Celebridades');
});

test('normalizeCategory rejects unsafe labels before inserts', () => {
  assert.equal(normalizeCategory(' BBB '), 'BBB');
  assert.equal(normalizeCategory('A'), null);
  assert.equal(normalizeCategory('x'.repeat(33)), null);
  assert.equal(normalizeCategory('<script>'), null);
  assert.equal(normalizeCategory('javascript:alert(1)'), null);
});

test('normalizeNewsUrl removes tracking params but keeps article identity params', () => {
  const url = normalizeNewsUrl('https://example.com/noticia?id=123&utm_source=google&fbclid=abc&ref=home');
  assert.equal(url, 'https://example.com/noticia?id=123');
});

test('normalizeNewsUrl returns the original string when the input is not a valid URL', () => {
  assert.equal(normalizeNewsUrl('not a url'), 'not a url');
});

test('predictionDeadlineForPublish returns exactly seven days after publish time by default', () => {
  assert.equal(
    predictionDeadlineForPublish('2026-06-01T12:30:00.000Z'),
    '2026-06-08T12:30:00.000Z',
  );
});

test('market timeframe helpers clamp close windows and build resolution criteria', () => {
  const publishAt = '2026-06-01T12:00:00.000Z';
  assert.equal(clampMarketCloseAt(publishAt, '2026-06-01T13:00:00.000Z'), '2026-06-01T18:00:00.000Z');
  assert.equal(clampMarketCloseAt(publishAt, '2026-08-01T12:00:00.000Z'), '2026-07-16T12:00:00.000Z');
  assert.equal(predictionDeadlineForPublish(publishAt, 21), '2026-06-22T12:00:00.000Z');
  assert.equal(resolveByForBettingClose('2026-06-22T12:00:00.000Z'), '2026-06-23T12:00:00.000Z');
  assert.equal(normalizeTimeframeDays('2 semanas'), 14);
  const criteria = defaultResolutionCriteria('Cantora vai lançar álbum?', '2026-06-23T12:00:00.000Z');
  assert.match(criteria, /TEA/i);
  assert.match(criteria, /CAP/i);
  assert.match(criteria, /VOID/i);
  assert.equal(normalizeResolutionCriteria(criteria), criteria);
  assert.equal(normalizeResolutionCriteria('sem regras'), null);
});

test('buildRumorPayload makes gathered gossip evidence-first with a resolve-by window', () => {
  const payload = buildRumorPayload(
    { summary: 'Vai rolar feat surpresa entre A e B?', article: 'contexto', status: 'confirmed', seed_true: 10, seed_false: 5 },
    'https://g1.globo.com/pop-arte/noticia/2026/06/01/a.ghtml',
    'G1',
    { autoPublish: true, now: new Date('2026-06-01T12:30:00.000Z') },
  );

  assert.equal(payload.status, 'speculated');
  assert.equal(payload.is_draft, false);
  assert.equal(payload.resolution_policy, 'evidence');
  assert.equal(payload.category, 'Música');
  assert.equal(payload.prediction_deadline, '2026-06-08T12:30:00.000Z');
  assert.equal(payload.resolve_by_at, '2026-06-09T12:30:00.000Z');
  assert.match(payload.resolution_criteria, /Resolve TEA/i);
  assert.match(payload.resolution_criteria, /CAP/i);
  assert.match(payload.resolution_criteria, /VOID/i);
  assert.match(payload.suggested_timeframe, /7 dias/);
  assert.equal(payload.required_source_count, 2);
});

test('buildRumorPayload falls back to inferred category when drafts provide unsafe category text', () => {
  const payload = buildRumorPayload(
    { summary: 'Jogador do Flamengo deve sair', article: 'Detalhes', category: '<script>' },
    'https://www.terra.com.br/diversao/flamengo.html',
    'Blog',
    { autoPublish: true, now: new Date('2026-06-01T12:00:00.000Z') },
  );

  assert.equal(payload.category, 'Futebol');
});

test('buildRumorPayload stores AI-proposed timeframe and resolution criteria when safe', () => {
  const criteria = 'Resolve TEA se o lançamento for confirmado por fonte confiável. Resolve CAP se houver negativa oficial ou o lançamento não ocorrer no prazo. VOID se não houver veredito confiável.';
  const payload = buildRumorPayload(
    {
      summary: 'Cantora vai lançar feat surpresa?',
      article: 'Contexto',
      category: 'Música',
      suggested_timeframe_days: 21,
      suggested_timeframe: 'Deve ser verificável durante o ciclo de divulgação das próximas três semanas.',
      resolution_criteria: criteria,
    },
    'https://rollingstone.com.br/musica/feat/',
    'Rolling Stone Brasil',
    { autoPublish: false, publishAt: '2026-06-01T12:00:00.000Z' },
  );

  assert.equal(payload.prediction_deadline, '2026-06-22T12:00:00.000Z');
  assert.equal(payload.resolve_by_at, '2026-06-23T12:00:00.000Z');
  assert.equal(payload.resolution_criteria, criteria);
  assert.equal(payload.suggested_timeframe, 'Deve ser verificável durante o ciclo de divulgação das próximas três semanas.');
});

test('shouldUseDraft rejects unsafe or overlong Claude draft output before insert', () => {
  const validDraft = {
    use: true,
    summary: 'Vai rolar feat surpresa entre A e B?',
    article: 'A aposta depende de confirmação por fonte confiável; sem veredito no resolve-by, vira VOID.',
    status: 'speculated',
    seed_true: 10,
    seed_false: 8,
  };
  assert.equal(shouldUseDraft(validDraft), true);
  assert.equal(shouldUseDraft({ ...validDraft, status: 'confirmed' }), false);
  assert.equal(shouldUseDraft({ ...validDraft, summary: 'Curto demais' }), false);
  assert.equal(shouldUseDraft({ ...validDraft, summary: 'x'.repeat(181) }), false);
  assert.equal(shouldUseDraft({ ...validDraft, article: 'x'.repeat(1201) }), false);
  assert.equal(shouldUseDraft({ ...validDraft, status: 'debunked' }), false);
  assert.equal(shouldUseDraft({ ...validDraft, use: 'true' }), false);
});

test('buildIngestConfig parses CLI env without exposing secret values', () => {
  const config = buildIngestConfig({
    ANTHROPIC_API_KEY: 'anthropic-secret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    ANTHROPIC_MODEL: 'claude-test',
    AUTO_PUBLISH: 'true',
    MAX_DRAFTS: '3',
    XAI_API_KEY: 'xai-secret',
    XAI_MAX_SEARCHES_PER_RUN: '4',
  });

  assert.equal(config.model, 'claude-test');
  assert.equal(config.autoPublish, true);
  assert.equal(config.maxDrafts, 3);
  assert.equal(config.xaiApiKey, 'xai-secret');
  assert.equal(config.xaiMaxSearchesPerRun, 4);
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
});

test('buildIngestConfig rejects invalid MAX_DRAFTS at CLI config time', () => {
  for (const maxDrafts of ['nope', '3abc', '12.5']) {
    assert.throws(
      () => buildIngestConfig({
        ANTHROPIC_API_KEY: 'anthropic-secret',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
        MAX_DRAFTS: maxDrafts,
      }),
      /MAX_DRAFTS must be an integer between 1 and 50/,
      maxDrafts,
    );
  }
});

test('buildIngestConfig rejects untrusted Supabase URLs before service-key requests', () => {
  assert.equal(isTrustedSupabaseUrl('https://abc123.supabase.co'), true);
  for (const url of ['http://abc123.supabase.co', 'https://example.com', 'https://abc.supabase.co', 'not-a-url']) {
    assert.equal(isTrustedSupabaseUrl(url), false, url);
    assert.throws(
      () => buildIngestConfig({
        ANTHROPIC_API_KEY: 'anthropic-secret',
        SUPABASE_URL: url,
        SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
      }),
      /SUPABASE_URL must be an https:\/\/\*\.supabase\.co project URL/,
      url,
    );
  }
});

test('validateIngestConfig fails closed without leaking supplied secrets', () => {
  const config = {
    anthropicKey: 'sk-ant...3456',
    supabaseUrl: 'https://secret-project.supabase.co',
    serviceKey: 'service-role-secret-value-123456',
    model: 'claude-test',
    autoPublish: false,
    maxDrafts: 12,
  };

  assert.doesNotThrow(() => validateIngestConfig(config));
  assert.throws(() => validateIngestConfig(null), /Missing env: ANTHROPIC_API_KEY/);

  for (const missingField of ['anthropicKey', 'supabaseUrl', 'serviceKey']) {
    const invalid = { ...config, [missingField]: '' };
    assert.throws(
      () => validateIngestConfig(invalid),
      (error) => {
        assert.match(error.message, /Missing env: (ANTHROPIC_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)/);
        assert.doesNotMatch(error.message, /secret-project|service-role-secret|sk-ant/);
        return true;
      },
      missingField,
    );
  }
});

test('ingest helpers stay import-safe when local env has invalid runtime values', async () => {
  const previous = process.env.MAX_DRAFTS;
  process.env.MAX_DRAFTS = 'not-a-number';
  try {
    const mod = await import(`../scripts/ingest.mjs?invalid-env=${Date.now()}`);
    assert.equal(mod.normalizeNewsUrl('https://example.com/a?utm_source=x'), 'https://example.com/a');
  } finally {
    if (previous === undefined) {
      delete process.env.MAX_DRAFTS;
    } else {
      process.env.MAX_DRAFTS = previous;
    }
  }
});

test('OUTLET_FEEDS includes the minimum credible Brazilian publisher feeds', () => {
  const sources = OUTLET_FEEDS.map((feed) => feed.source.toLowerCase());
  for (const expected of ['g1', 'extra', 'gshow', 'metrópoles', 'terra', 'rolling stone brasil']) {
    assert.ok(sources.includes(expected), expected);
  }
});

test('fetchOutletFeed keeps only real publisher-host URLs from curated feeds', async () => {
  const feed = OUTLET_FEEDS.find((item) => item.source === 'g1');
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Vai rolar volta de casal famoso?</title><link>https://g1.globo.com/pop-arte/noticia/2026/07/01/casal.ghtml?utm_source=x</link><source>g1</source></item>
    <item><title>Google opaque redirect</title><link>https://news.google.com/rss/articles/CBMi123</link><source>Google News</source></item>
  </channel></rss>`;
  const candidates = await fetchOutletFeed(feed, async () => ({ status: 200, text: async () => xml }));

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://g1.globo.com/pop-arte/noticia/2026/07/01/casal.ghtml');
  assert.equal(candidates[0].discovery, false);
  assert.equal(isAuthoritativeUrl(candidates[0].url), true);
});

test('fetchGoogleDiscovery demotes opaque Google News links to non-authoritative references', async () => {
  const candidates = await fetchGoogleDiscovery(async () => ({
    status: 200,
    text: async () => `<?xml version="1.0"?><rss><channel>
      <item><title>Será que famoso entra no reality?</title><link>https://news.google.com/rss/articles/CBMiOpaque</link><source>Google News</source></item>
    </channel></rss>`,
  }));

  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].url, null);
  assert.equal(candidates[0].referenceUrl, 'https://news.google.com/rss/articles/CBMiOpaque');
  assert.equal(candidates[0].discovery, true);
  assert.equal(candidates[0].sourceType, 'google');
  assert.equal(isAuthoritativeUrl(candidates[0].referenceUrl), false);
});

test('fetchNewsApi is env-gated and parses GNews publisher URLs when configured', async () => {
  let calls = 0;
  const noKey = await fetchNewsApi({}, async () => {
    calls++;
    throw new Error('should not run without key');
  });
  assert.deepEqual(noKey, []);
  assert.equal(calls, 0);

  const unsupported = await fetchNewsApi({ newsApiKey: 'key', newsApiProvider: 'unsupported' }, async () => {
    calls++;
    throw new Error('should not run for unsupported provider');
  });
  assert.deepEqual(unsupported, []);
  assert.equal(calls, 0);

  const candidates = await fetchNewsApi({ newsApiKey: 'key', newsApiProvider: 'gnews' }, async () => ({
    ok: true,
    json: async () => ({ articles: [
      { title: 'Será que atriz entra em novela?', url: 'https://www.terra.com.br/diversao/tv/noticia.html?utm_campaign=x', source: { name: 'Terra' } },
      { title: 'Post social sem autoridade', url: 'https://x.com/example/status/1', source: { name: 'X' } },
    ] }),
  }));

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, 'https://www.terra.com.br/diversao/tv/noticia.html');
  assert.equal(candidates[0].discovery, false);
  assert.equal(candidates[1].discovery, true);
});

test('social and Google sources classify as unverified/discovery-only and never authoritative', () => {
  for (const source of ['Google News', 'Reddit r/popculturechat', 'X/Twitter', 'xAI/Grok Live Search', '4chan /tv/']) {
    assert.equal(classifySource(source), 'unverified', source);
  }
  for (const url of ['https://news.google.com/rss/articles/CBMi123', 'https://www.reddit.com/r/BBB/comments/abc/post', 'https://x.com/i/web/status/123', 'https://boards.4chan.org/tv/thread/123']) {
    assert.equal(isAuthoritativeUrl(url), false, url);
  }
});

test('dedupeCandidates prefers real publisher URL candidates over Google/social discovery duplicates', () => {
  const candidates = dedupeCandidates([
    { title: 'Atriz famosa vai entrar no BBB?', url: null, referenceUrl: 'https://news.google.com/rss/articles/opaque', source: 'Google News', discovery: true },
    { title: 'Atriz famosa vai entrar no BBB?', url: null, referenceUrl: 'https://www.reddit.com/r/BBB/comments/abc', source: 'Reddit r/BBB', discovery: true },
    { title: 'Atriz famosa vai entrar no BBB?', url: 'https://gshow.globo.com/realities/bbb/noticia/atriz-bbb.ghtml', source: 'Gshow', discovery: false },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'Gshow');
  assert.equal(candidates[0].url, 'https://gshow.globo.com/realities/bbb/noticia/atriz-bbb.ghtml');
  assert.equal(candidates[0].discovery, false);
});

test('dedupeCandidates drops URLs already ingested in the recent DB window', () => {
  const existing = new Set(['https://www.terra.com.br/diversao/noticia.html']);
  const candidates = dedupeCandidates([
    { title: 'Vai ter novidade na TV?', url: 'https://www.terra.com.br/diversao/noticia.html?utm_source=x', source: 'Terra', discovery: false },
    { title: 'Cantora deve lançar feat?', url: 'https://rollingstone.com.br/musica/feat/', source: 'Rolling Stone Brasil', discovery: false },
  ], existing);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'Rolling Stone Brasil');
});

test('gatherCandidates works on free feeds while gated paid/toxic adapters stay off', async () => {
  const called = [];
  const duplicateTitle = 'Atriz famosa vai entrar no BBB?';
  const fetchImpl = async (url) => {
    const href = String(url);
    called.push(href);
    if (href.includes('g1.globo.com/rss/g1/pop-arte')) {
      return {
        status: 200,
        text: async () => `<?xml version="1.0"?><rss><channel>
          <item><title>${duplicateTitle}</title><link>https://g1.globo.com/pop-arte/noticia/2026/07/01/atriz-bbb.ghtml</link><source>g1</source></item>
        </channel></rss>`,
      };
    }
    if (href.includes('news.google.com')) {
      return {
        status: 200,
        text: async () => `<?xml version="1.0"?><rss><channel>
          <item><title>${duplicateTitle}</title><link>https://news.google.com/rss/articles/opaque</link><source>Google News</source></item>
        </channel></rss>`,
      };
    }
    if (href.includes('reddit.com')) {
      return {
        ok: true,
        json: async () => ({ data: { children: [{ data: { title: duplicateTitle, subreddit: 'BBB', permalink: '/r/BBB/comments/abc/post/' } }] } }),
      };
    }
    return { status: 200, ok: true, text: async () => '<rss><channel></channel></rss>', json: async () => ({ data: { children: [] } }) };
  };

  const candidates = await gatherCandidates({}, { fetchImpl, existingLinks: new Set() });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://g1.globo.com/pop-arte/noticia/2026/07/01/atriz-bbb.ghtml');
  assert.equal(candidates[0].discovery, false);
  assert.ok(called.some((url) => url.includes('news.google.com')));
  assert.ok(called.some((url) => url.includes('reddit.com')));
  assert.ok(called.every((url) => !url.includes('gnews.io/api')));
  assert.ok(called.every((url) => !url.includes('api.twitter.com/2')));
  assert.ok(called.every((url) => !url.includes('a.4cdn.org')));
});

test('buildRumorPayload refuses Google and bare social links as authoritative source_url', () => {
  const draft = { summary: 'Vai rolar reconciliação pública entre famosos?', article: 'Contexto', seed_true: 1, seed_false: 1 };
  for (const url of ['https://news.google.com/rss/articles/opaque', 'https://www.reddit.com/r/Fauxmoi/comments/abc', 'https://x.com/i/web/status/1']) {
    assert.throws(() => buildRumorPayload(draft, url, 'unverified'), /Refusing to store non-authoritative source_url/);
  }
});

test('Reddit discovery parses public JSON permalinks as non-authoritative references', async () => {
  const candidates = await fetchRedditDiscovery({}, async () => ({
    ok: true,
    json: async () => ({ data: { children: [{ data: { title: 'Será que participante do BBB será cancelado?', subreddit: 'BBB', permalink: '/r/BBB/comments/abc/post/' } }] } }),
  }));

  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].url, null);
  assert.equal(candidates[0].discovery, true);
  assert.equal(candidates[0].referenceUrl, 'https://www.reddit.com/r/BBB/comments/abc/post/');
});

test('X discovery is bearer-token gated and parses recent search results as discovery-only', async () => {
  let calls = 0;
  assert.deepEqual(await fetchXDiscovery({}, async () => { calls++; }), []);
  assert.equal(calls, 0);

  const candidates = await fetchXDiscovery({ xBearerToken: 'token' }, async () => ({
    ok: true,
    json: async () => ({ data: [{ id: '123', text: 'Será que cantor vai anunciar feat surpresa?' }] }),
  }));

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, null);
  assert.equal(candidates[0].referenceUrl, 'https://x.com/i/web/status/123');
  assert.equal(candidates[0].discovery, true);
});

test('xAI Live Search is env-gated, capped, and parses X post references as discovery-only', async () => {
  assert.deepEqual(await fetchXaiDiscovery({}, async () => { throw new Error('should not fetch'); }), []);
  assert.equal(parseXaiMaxSearches('0'), 2);
  assert.equal(parseXaiMaxSearches('99'), 2);
  assert.equal(parseXaiMaxSearches('3'), 3);
  assert.equal(xPostUrlFromValue('https://twitter.com/foo/status/1234567890?s=20'), 'https://x.com/i/web/status/1234567890');

  const calls = [];
  const out = await fetchXaiDiscovery({ xaiApiKey: 'xai-test', xaiMaxSearchesPerRun: 1 }, async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify([
            { title: 'Cantora brasileira vai anunciar feat esta semana?', source_url: 'https://x.com/pop/status/1234567890' },
            { title: '<script>bad</script>', source_url: 'https://x.com/pop/status/2222222222' },
            { title: 'Sem URL real', source_url: 'https://example.com/post/1' },
          ]) } }],
        };
      },
    };
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].init.body).search_parameters.mode, 'on');
  assert.equal(out.length, 1);
  assert.equal(out[0].url, null);
  assert.equal(out[0].referenceUrl, 'https://x.com/i/web/status/1234567890');
  assert.equal(out[0].source, 'xAI/Grok Live Search');
  assert.equal(out[0].discovery, true);
  assert.equal(out[0].sourceType, 'xai');
  assert.equal(isAuthoritativeUrl(out[0].referenceUrl), false);
});

test('4chan discovery stays off unless explicitly flag-gated and parses read-only catalog safely', async () => {
  let calls = 0;
  assert.deepEqual(await fetch4chanDiscovery({}, async () => { calls++; }), []);
  assert.equal(calls, 0);

  const candidates = await fetch4chanDiscovery({ enable4chan: true }, async () => ({
    ok: true,
    json: async () => ([{ threads: [{ no: 999, sub: 'Rumor about a singer cameo' }, { no: 1000, sub: '<script>alert(1)</script>' }] }]),
  }));

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, null);
  assert.equal(candidates[0].referenceUrl, 'https://boards.4chan.org/tv/thread/999');
  assert.equal(candidates[0].discovery, true);
  assert.ok(candidates.every((candidate) => !/script|alert/i.test(candidate.title)));
});
