import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveNeutralDescriptor,
  normalizePexelsPhoto,
  searchPexelsImage,
} from '../scripts/editorial-images.mjs';
import {
  fetchDailyCandidates,
  runDailyImageAssignment,
  saoPauloDate,
  selectDailyCategoryWinners,
} from '../scripts/assign-daily-images.mjs';

const NOW = new Date('2026-08-05T15:00:00.000Z');

function market(id, category, publishAt, overrides = {}) {
  return {
    id,
    summary: 'Uma pergunta sobre a notícia do dia?',
    category,
    status: 'speculated',
    is_draft: false,
    publish_at: publishAt,
    created_at: publishAt,
    prediction_deadline: '2026-08-06T15:00:00.000Z',
    ...overrides,
  };
}

function pexelsPhoto(overrides = {}) {
  return {
    id: 12345,
    width: 1600,
    height: 900,
    alt: 'Empty studio lights and microphone',
    url: 'https://www.pexels.com/photo/studio-lights-12345/',
    photographer: 'Fotógrafa Exemplo',
    photographer_url: 'https://www.pexels.com/@fotografa-exemplo',
    src: { landscape: 'https://images.pexels.com/photos/12345/example.jpeg?auto=compress&fit=crop' },
    ...overrides,
  };
}

function jsonResponse(payload, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('selects only the newest eligible market in each canonical category', () => {
  const winners = selectDailyCategoryWinners([
    market('old', 'Música', '2026-08-05T10:00:00.000Z'),
    market('new', 'Música', '2026-08-05T14:00:00.000Z'),
    market('bbb', 'BBB', '2026-08-05T13:00:00.000Z'),
    market('draft', 'Futebol', '2026-08-05T13:00:00.000Z', { is_draft: true }),
    market('resolved', 'Novelas', '2026-08-05T13:00:00.000Z', { status: 'confirmed' }),
    market('expired', 'Influencers', '2026-08-05T13:00:00.000Z', { prediction_deadline: '2026-08-05T14:00:00.000Z' }),
    market('unknown', 'Política', '2026-08-05T13:00:00.000Z'),
    market('previous-day', 'Celebridades', '2026-08-05T02:59:59.000Z'),
  ], { now: NOW });

  assert.deepEqual(winners.map(({ id }) => id), ['bbb', 'new']);
});

test('uses the São Paulo calendar day around UTC midnight', () => {
  assert.equal(saoPauloDate(new Date('2026-08-05T02:59:59Z')), '2026-08-04');
  assert.equal(saoPauloDate(new Date('2026-08-05T03:00:00Z')), '2026-08-05');
});

test('neutral descriptors are category-bound and omit headline names', () => {
  const descriptor = deriveNeutralDescriptor('Cantora Nome Próprio vai lançar álbum?', 'Música');
  assert.equal(descriptor, 'mesa de som em estúdio de gravação');
  assert.doesNotMatch(descriptor, /Nome Próprio|Cantora/i);
  assert.equal(deriveNeutralDescriptor('Qualquer coisa', 'Política'), null);
});

test('Pexels search sends one landscape pt-BR request and preserves attribution', async () => {
  const calls = [];
  const result = await searchPexelsImage({
    apiKey: 'server-secret',
    descriptor: 'microfone em palco de show',
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return jsonResponse({ photos: [pexelsPhoto()] });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://api.pexels.com');
  assert.equal(calls[0].url.searchParams.get('orientation'), 'landscape');
  assert.equal(calls[0].url.searchParams.get('locale'), 'pt-BR');
  assert.equal(calls[0].init.headers.Authorization, 'server-secret');
  assert.equal(result.image.photographer, 'Fotógrafa Exemplo');
  assert.equal(result.image.pageUrl, 'https://www.pexels.com/photo/studio-lights-12345/');
  assert.match(result.image.alt, /^Imagem ilustrativa:/);
});

test('rejects untrusted, portrait, or incomplete Pexels results', () => {
  assert.equal(normalizePexelsPhoto(pexelsPhoto({ src: { landscape: 'https://evil.example/photo.jpg' } }), 'palco vazio'), null);
  assert.equal(normalizePexelsPhoto(pexelsPhoto({ width: 800, height: 1200 }), 'palco vazio'), null);
  assert.equal(normalizePexelsPhoto(pexelsPhoto({ width: -800, height: -1200 }), 'palco vazio'), null);
  assert.equal(normalizePexelsPhoto(pexelsPhoto({ photographer_url: null }), 'palco vazio'), null);
});

test('rejects Pexels metadata that signals people, branding, text, crime, or medical imagery', () => {
  for (const alt of [
    'Portrait of a woman on stage',
    'Company logo on a billboard',
    'Police officer beside a hospital',
  ]) {
    assert.equal(normalizePexelsPhoto(pexelsPhoto({ alt }), 'luzes de estúdio'), null);
  }
});

test('API failures and missing keys fail open without retries', async () => {
  let calls = 0;
  const missing = await searchPexelsImage({ descriptor: 'palco vazio', fetchImpl: async () => { calls += 1; } });
  assert.equal(missing.reason, 'missing_api_key');
  assert.equal(calls, 0);

  const limited = await searchPexelsImage({
    apiKey: 'key',
    descriptor: 'palco vazio',
    fetchImpl: async () => { calls += 1; return jsonResponse({}, { status: 429 }); },
  });
  assert.equal(limited.reason, 'rate_limited');
  assert.equal(calls, 1);
});

test('daily assignment stops searching remaining categories after a rate limit', async () => {
  let calls = 0;
  const result = await runDailyImageAssignment({
    config: { live: false, pexelsApiKey: 'key', supabaseUrl: null, serviceKey: null },
    now: NOW,
    markets: ['Celebridades', 'BBB', 'Futebol'].map((category, index) => market(String(index), category, '2026-08-05T14:00:00.000Z')),
    fetchImpl: async () => { calls += 1; return jsonResponse({}, { status: 429 }); },
    logger: { info() {}, warn() {} },
  });
  assert.equal(result.attempted, 1);
  assert.equal(calls, 1);
});

test('daily assignment defaults to dry-run and searches each winner at most once', async () => {
  let calls = 0;
  const categories = ['Celebridades', 'BBB', 'Futebol', 'Música', 'Novelas', 'Influencers'];
  const result = await runDailyImageAssignment({
    config: { live: false, pexelsApiKey: 'key', supabaseUrl: null, serviceKey: null },
    now: NOW,
    markets: categories.map((category, index) => market(String(index), category, `2026-08-05T1${index}:00:00.000Z`)),
    fetchImpl: async () => { calls += 1; return jsonResponse({ photos: [pexelsPhoto({ id: 100 + calls })] }); },
    logger: { info() {}, warn() {} },
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.assigned, 0);
  assert.equal(result.attempted, 6);
  assert.equal(calls, 6);
});

test('reconciliation skips a winner that already has an image for the feature date', async () => {
  const result = await runDailyImageAssignment({
    config: { live: true, pexelsApiKey: 'key', supabaseUrl: 'https://project.supabase.co/', serviceKey: 'service-key' },
    now: NOW,
    markets: [market('music', 'Música', '2026-08-05T14:00:00.000Z', {
      editorial_image_url: 'https://images.pexels.com/photos/123/photo.jpeg',
      editorial_image_feature_date: '2026-08-05',
    })],
    fetchImpl: async () => { throw new Error('duplicate search should not run'); },
    logger: { info() {}, warn() {} },
  });
  assert.equal(result.attempted, 0);
  assert.equal(result.assigned, 0);
});

test('candidate loading paginates so a busy category cannot hide another winner', async () => {
  const offsets = [];
  const firstPage = Array.from({ length: 1_000 }, (_, index) => market(`music-${index}`, 'Música', '2026-08-05T14:00:00.000Z'));
  const finalCandidate = market('bbb-final', 'BBB', '2026-08-05T13:00:00.000Z');
  const candidates = await fetchDailyCandidates(
    { supabaseUrl: 'https://project.supabase.co/', serviceKey: 'service-key' },
    async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      offsets.push(offset);
      return jsonResponse(offset === 0 ? firstPage : [finalCandidate]);
    },
    NOW,
  );
  assert.deepEqual(offsets, [0, 1_000]);
  assert.equal(candidates.at(-1).id, 'bbb-final');
});

test('live assignment writes only after a valid image is ready', async () => {
  const calls = [];
  const result = await runDailyImageAssignment({
    config: { live: true, pexelsApiKey: 'key', supabaseUrl: 'https://project.supabase.co/', serviceKey: 'service-key' },
    now: NOW,
    markets: [market('music', 'Música', '2026-08-05T14:00:00.000Z')],
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: new URL(url), init });
      if (new URL(url).hostname === 'api.pexels.com') return jsonResponse({ photos: [pexelsPhoto()] });
      return jsonResponse(true);
    },
    logger: { info() {}, warn() {} },
  });
  assert.equal(result.assigned, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.pathname, '/rest/v1/rpc/service_assign_daily_editorial_image');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.p_rumor_id, 'music');
  assert.equal(body.p_feature_date, '2026-08-05');
  assert.equal(body.p_photographer, 'Fotógrafa Exemplo');
});
