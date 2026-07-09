import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIngestConfig, buildRumorPayload, classifySource, inferCategory, normalizeCategory, predictionDeadlineForPublish, normalizeNewsUrl, shouldUseDraft, validateIngestConfig } from '../scripts/ingest.mjs';

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

test('predictionDeadlineForPublish returns exactly seven days after publish time', () => {
  assert.equal(
    predictionDeadlineForPublish('2026-06-01T12:30:00.000Z'),
    '2026-06-08T12:30:00.000Z',
  );
});

test('buildRumorPayload makes gathered gossip evidence-first with a resolve-by window', () => {
  const payload = buildRumorPayload(
    { summary: 'Vai rolar feat surpresa entre A e B?', article: 'contexto', status: 'confirmed', seed_true: 10, seed_false: 5 },
    'https://example.com/a',
    'G1',
    { autoPublish: true, now: new Date('2026-06-01T12:30:00.000Z') },
  );

  assert.equal(payload.status, 'speculated');
  assert.equal(payload.is_draft, false);
  assert.equal(payload.resolution_policy, 'evidence');
  assert.equal(payload.category, 'Música');
  assert.equal(payload.prediction_deadline, '2026-06-08T12:30:00.000Z');
  assert.equal(payload.required_source_count, 2);
});

test('buildRumorPayload falls back to inferred category when drafts provide unsafe category text', () => {
  const payload = buildRumorPayload(
    { summary: 'Jogador do Flamengo deve sair', article: 'Detalhes', category: '<script>' },
    'https://example.com/flamengo',
    'Blog',
    { autoPublish: true, now: new Date('2026-06-01T12:00:00.000Z') },
  );

  assert.equal(payload.category, 'Futebol');
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
  });

  assert.equal(config.model, 'claude-test');
  assert.equal(config.autoPublish, true);
  assert.equal(config.maxDrafts, 3);
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
