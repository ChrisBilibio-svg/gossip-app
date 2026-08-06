import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenCandidate, summarizeScreening } from '../scripts/screen.mjs';

const G1_URL = 'https://g1.globo.com/pop-arte/noticia/foo.ghtml';
const NOW = new Date('2026-07-23T12:00:00Z');

function benign(extra = {}) {
  return { title: 'Cantora vai lançar novo álbum solo?', url: G1_URL, source: 'g1', discovery: false, ...extra };
}

test('reliable, fresh, resolvable candidate is approved (advisory only)', () => {
  const r = screenCandidate(benign(), { now: NOW });
  assert.equal(r.decision, 'approve_candidate');
  assert.equal(r.source_quality, 'reliable');
  assert.equal(r.public_figure_confirmed, true);
  assert.ok(r.objective_resolution_rule);
});

test('minor-related story is rejected', () => {
  const r = screenCandidate(benign({ title: 'Filha de 12 anos de cantora aparece em foto polêmica' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('minor_subject'));
});

test('unknown-age subject escalates to needs_review', () => {
  const r = screenCandidate(benign({ title: 'Filho de sertanejo vai estrear projeto na TV' }), { now: NOW });
  assert.equal(r.decision, 'needs_review');
  assert.ok(r.reason_codes.includes('age_unknown_possible_minor'));
  assert.equal(r.adult_subjects_confirmed, false);
});

test('explicit adult marker cancels the unknown-age escalation', () => {
  const r = screenCandidate(benign({ title: 'Filho de 25 anos de sertanejo vai estrear projeto' }), { now: NOW });
  assert.equal(r.adult_subjects_confirmed, true);
  assert.ok(!r.reason_codes.includes('age_unknown_possible_minor'));
});

test('stale article escalates to confirm the future outcome is still open', () => {
  const publishedAt = new Date(NOW.getTime() - 10 * 864e5).toISOString();
  const r = screenCandidate(benign({ publishedAt }), { now: NOW });
  assert.equal(r.decision, 'needs_review');
  assert.ok(r.reason_codes.includes('stale_article_confirm_future_outcome'));
});

test('duplicate of an existing open market is rejected with the duplicate id', () => {
  const summary = 'Anitta vai anunciar nova turnê internacional mundial';
  const open = [{ id: 'dup-123', summary, event_key: null }];
  const r = screenCandidate(benign({ summary }), { now: NOW, openRumors: open });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('duplicate_market'));
  assert.equal(r.duplicate_market_id, 'dup-123');
});

test('non-discovery candidate with no working source is rejected (missing source)', () => {
  const r = screenCandidate({ title: 'Boato qualquer sobre famoso', url: 'https://randomblog.example/x', source: 'Blog Aleatório', discovery: false }, { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('missing_source'));
});

test('discovery-only lead with no checkable horizon is rejected before drafting', () => {
  const r = screenCandidate({ title: 'Suposto affair de cantor aparece em post', url: null, source: 'Reddit r/BBB', discovery: true }, { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('no_plausible_resolve_by'));
  assert.ok(!r.reason_codes.includes('missing_source'));
});

test('sensitive claim from discovery/anonymous source is rejected for insufficient sourcing', () => {
  const r = screenCandidate({ title: 'Ator é acusado de tráfico de drogas em post anônimo', url: null, source: 'Perfil X', discovery: true }, { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.equal(r.sensitive_claim, true);
  assert.ok(r.reason_codes.includes('sensitive_claim_insufficient_sourcing'));
});

test('sensitive claim from reliable, corroborated journalism is still blocked from auto-market framing', () => {
  const r = screenCandidate(benign({ title: 'Cantor foi indiciado por homicídio, diz reportagem', source: 'g1', source_count: 2 }), { now: NOW });
  assert.equal(r.sensitive_claim, true);
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('no_plausible_resolve_by'));
});

test('subjective / opinion-controlled question is rejected as not objectively resolvable', () => {
  const r = screenCandidate(benign({ title: 'Quem é a melhor cantora do Brasil?' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('subjective_opinion'));
  assert.equal(r.objective_resolution_rule, null);
});

test('prediction deadline is computed from the actual publish time, not the article time', () => {
  const publishAt = '2026-07-01T00:00:00Z';
  const r = screenCandidate(benign(), { now: new Date('2026-07-01T00:00:00Z'), publishAt });
  assert.equal(r._meta.proposed_prediction_deadline, '2026-07-22T00:00:00.000Z');
  assert.equal(r._meta.proposed_resolve_by_at, '2026-07-23T00:00:00.000Z');
  assert.equal(r._meta.proposed_timeframe_days, 21);
});

test('a market that would already be expired on publish is rejected', () => {
  const publishAt = new Date(NOW.getTime() - 22 * 864e5).toISOString(); // inferred 21d close = now - 1 day
  const r = screenCandidate(benign(), { now: NOW, publishAt });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('expired_on_publish'));
});

test('screening is pure/deterministic (idempotent for the same input)', () => {
  const c = benign();
  assert.deepEqual(screenCandidate(c, { now: NOW }), screenCandidate(c, { now: NOW }));
});

test('screening result never embeds credentials', () => {
  const json = JSON.stringify(screenCandidate(benign(), { now: NOW }));
  assert.ok(!/sk-ant|service_role|bearer\s|apikey/i.test(json));
});

// --- Phase 2: future-event requirement (dry-run false positives) ------------

test('generic economics/politics news is not approved as a market', () => {
  const r = screenCandidate(benign({ title: 'Governo estuda prorrogar subsídio de R$ 0,44 por litro da gasolina' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('not_market_suitable'));
  assert.equal(r.objective_resolution_rule, null);
});

test('service journalism / horoscope how-to is not approved', () => {
  const r = screenCandidate(benign({ title: 'Como descobrir seu signo Ascendente em 2 minutos' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('not_market_suitable'));
});

test('already-completed contract renewal is rejected as already known', () => {
  const r = screenCandidate(benign({ title: 'Luka Modric renova contrato com o Milan até junho de 2027' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('event_already_known'));
});

test('completed announcement (past tense) is rejected as already known', () => {
  const r = screenCandidate(benign({ title: 'Zeca Pagodinho lançou single do neto em homenagem ao Dia dos Avós' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('event_already_known'));
});

test('present-tense completed relationship event is rejected', () => {
  const r = screenCandidate(benign({ title: 'Maurício Prado se casa com Juliana Vaccaro em cerimônia no Rio' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('event_already_known'));
});

test('ordinary news summary with no future frame and no resolve-by horizon is rejected', () => {
  const r = screenCandidate(benign({ title: 'Atriz comenta bastidores em entrevista' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('no_plausible_resolve_by'));
});

test('a genuinely future, question-framed event is still approved', () => {
  const r = screenCandidate(benign({ title: 'Anitta vai anunciar nova turnê mundial em 2026?' }), { now: NOW });
  assert.equal(r.decision, 'approve_candidate');
  assert.ok(r.objective_resolution_rule);
});

test('a future-verb event without a question mark is still approved', () => {
  const r = screenCandidate(benign({ title: 'Cantora deve lançar novo álbum ainda neste mês' }), { now: NOW });
  assert.equal(r.decision, 'approve_candidate');
  assert.ok(!r.reason_codes.includes('no_future_event_signal'));
});

test('fan poll (enquete) is rejected as community opinion', () => {
  const r = screenCandidate(benign({ title: "Paolla faz enquete sobre o cabelo: 'Loira, ruiva ou morena?'" }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('subjective_opinion'));
});

test('service-journalism scheduling/trivia questions are rejected', () => {
  for (const title of [
    'Que horas estreia o 4º episódio da terceira temporada de Silo?',
    'Quantos episódios Stuart Não Consegue Salvar o Universo vai ter?',
    'Netflix: Elize Matsunaga era psicopata? Saiba o que dizem os testes',
  ]) {
    const r = screenCandidate(benign({ title }), { now: NOW });
    assert.equal(r.decision, 'reject', title);
    assert.ok(r.reason_codes.includes('not_market_suitable'), title);
  }
});

test('political stories are excluded from the celebrity-gossip domain', () => {
  const r = screenCandidate(benign({ title: 'Michelle grava vídeo aceitando desculpas de Flávio; ela deve entrar na campanha eleitoral' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('not_market_suitable'));
});

// --- auto-curate dry-run leak cases: past-tense reframes, death/body, trivia ---

test('past-tense reframes (terminaram/visitaram) are rejected as already known', () => {
  for (const title of [
    'Erika Januza e Arlindinho terminaram o namoro',
    'Mãe e irmã de Vini Jr. visitaram a mansão em Madri',
  ]) {
    const r = screenCandidate(benign({ title }), { now: NOW });
    assert.equal(r.decision, 'reject', title);
    assert.ok(r.reason_codes.includes('event_already_known'), title);
  }
});

test('an explicit past year is rejected as already known', () => {
  const r = screenCandidate(benign({ title: 'Casal famoso vai confirmar romance que rolou em 2024?' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('event_already_known'));
});

test('a current/future year is NOT treated as past', () => {
  const r = screenCandidate(benign({ title: 'Anitta vai anunciar turnê mundial em 2026?' }), { now: NOW });
  assert.ok(!r.reason_codes.includes('event_already_known'));
});

test('death/grief is a sensitive claim and does not auto-approve', () => {
  const r = screenCandidate(benign({ title: 'Cantor vai falar publicamente sobre a morte inesperada do produtor?' }), { now: NOW });
  assert.equal(r.sensitive_claim, true);
  assert.notEqual(r.decision, 'approve_candidate');
});

test('body/weight is a sensitive claim and does not auto-approve', () => {
  const r = screenCandidate(benign({ title: 'Cantora vai revelar a dieta que a fez emagrecer?' }), { now: NOW });
  assert.equal(r.sensitive_claim, true);
  assert.notEqual(r.decision, 'approve_candidate');
});

test('trivial paparazzi non-events are not market-suitable', () => {
  const r = screenCandidate(benign({ title: 'Lívia Andrade vai compartilhar fotos de férias em Ibiza?' }), { now: NOW });
  assert.equal(r.decision, 'reject');
  assert.ok(r.reason_codes.includes('not_market_suitable'));
});

test('confirmed concert listings from real feeds are not market-suitable', () => {
  const rejectCase = screenCandidate(benign({
    title: 'Ronnie Wood, dos Rolling Stones, vai fazer show único no Brasil; saiba tudo',
    source: 'Terra',
    url: 'https://www.terra.com.br/diversao/ronnie-wood-show-brasil.html',
  }), { now: NOW });
  assert.equal(rejectCase.decision, 'reject');
  assert.ok(rejectCase.reason_codes.includes('not_market_suitable'));

  const keepCase = screenCandidate(benign({ title: 'Cantora vai anunciar show extra no Brasil?' }), { now: NOW });
  assert.equal(keepCase.decision, 'approve_candidate');
});

test('media meta-opinion headlines from real feeds are not market-suitable', () => {
  const rejectCase = screenCandidate(benign({
    title: 'Hollywood já prepara seu próximo filme baseado em um fenômeno de terror, mas acho que eles ainda não entenderam como funcionam os sucessos virais',
    source: 'Terra',
    url: 'https://www.terra.com.br/diversao/cinema/hollywood-terror-viral.html',
  }), { now: NOW });
  assert.equal(rejectCase.decision, 'reject');
  assert.ok(rejectCase.reason_codes.includes('not_market_suitable'));

  const keepCase = screenCandidate(benign({ title: 'Atriz vai estrear em filme de terror viral?' }), { now: NOW });
  assert.equal(keepCase.decision, 'approve_candidate');
});

test('duration phrases like após 16 anos are not mistaken for minor subjects', () => {
  const keepCase = screenCandidate(benign({
    title: 'Social Distortion retorna ao Brasil após 16 anos com shows em São Paulo e Curitiba em novembro',
    source: 'Rolling Stone Brasil',
    url: 'https://rollingstone.com.br/musica/social-distortion-brasil.html',
  }), { now: NOW });
  assert.ok(!keepCase.reason_codes.includes('minor_subject'));
  assert.equal(keepCase.sensitive_claim, false);

  const rejectCase = screenCandidate(benign({ title: 'Cantora leva filha de 16 anos a festa polêmica' }), { now: NOW });
  assert.equal(rejectCase.decision, 'reject');
  assert.ok(rejectCase.reason_codes.includes('minor_subject'));
});

test('summarizeScreening tallies decisions and reason codes', () => {
  const results = [
    screenCandidate(benign(), { now: NOW }),
    screenCandidate(benign({ title: 'Filha de 10 anos de ator' }), { now: NOW }),
  ];
  const s = summarizeScreening(results);
  assert.equal(s.total, 2);
  assert.equal(s.byDecision.approve_candidate, 1);
  assert.equal(s.byDecision.reject, 1);
  assert.ok(s.reasonTally.minor_subject >= 1);
});
