// Market-suitability screening agent (deterministic, advisory-only).
//
// Runs BEFORE any AI drafting and BEFORE any write. It consumes normalized
// ingest candidates ({ title, url, source, discovery, referenceUrl, ... }) and
// produces a structured screening result. The result NEVER publishes anything —
// it only recommends approve_candidate | needs_review | reject for a human
// curator in the admin approval queue.
//
// It builds on the hardened ingest helpers (classifySource, isAuthoritativeUrl,
// normalizeEventKey, normalizeNewsUrl, inferCategory, predictionDeadlineForPublish)
// and adds the checks ingest.mjs does not do: minors, unknown-age escalation,
// objective resolvability, sensitive-claim corroboration, duplicate clustering,
// staleness and expired-on-publish.

import {
  classifySource,
  isAuthoritativeUrl,
  normalizeEventKey,
  normalizeNewsUrl,
  inferCategory,
  predictionDeadlineForPublish,
  resolveByForBettingClose,
  defaultResolutionCriteria,
} from './ingest.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_ARTICLE_DAYS = 3;

// A story that materially involves a person under 18. Portuguese + a few EN cues.
const MINOR_PATTERNS = [
  /\bmenor(es)? de idade\b/i,
  /\bcrian[çc]as?\b/i,
  /\badolescente(s)?\b/i,
  /\bbeb[êe]s?\b/i,
  /\brec[ée]m[- ]nascid[oa]/i,
  // Explicit age 0-17. Avoid duration phrases like "após 16 anos" / "há 10 anos",
  // which are common in concert-anniversary headlines and do not identify a minor.
  /(?<!ap[oó]s\s)(?<!h[áa]\s)(?<!faz\s)(?<!depois de\s)\b(1[0-7]|[0-9])\s*anos?\b/i,
  /\bteen(ager)?s?\b/i,
  /\bfilh[oa]s?\s+(rec[ée]m|beb[êe]|crian[çc]a)/i,
];

// Ambiguous "could be a minor" cues where age is not established -> escalate.
const UNKNOWN_AGE_HINT_PATTERNS = [
  /\bfilh[oa]s?\b/i,
  /\bestudante\b/i,
  /\bcalour[oa]\b/i,
  /\bjovem\b/i,
  /\bherdeir[oa]\b/i,
];
// An explicit adult marker cancels an unknown-age escalation.
const ADULT_CONFIRM_PATTERNS = [
  /\b(1[89]|[2-9]\d)\s*anos?\b/i, // explicit age >= 18
  /\bmaior de idade\b/i,
  /\badult[oa]\b/i,
];

// Doxxing / private data (CPF, CNPJ, street address, documents, health).
const DOXXING_PATTERNS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, // CPF-ish
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/, // CNPJ-ish
  /\b(rua|avenida|av\.|alameda|travessa|condom[íi]nio)\b[^.]*\bn?[ºo]?\s*\d{1,5}\b/i,
  /\b(endere[cç]o|cpf|rg|documento|placa|geolocaliza|localiza[çc][ãa]o em tempo real)\b/i,
];
const MEDICAL_PATTERNS = [
  /\b(hiv|c[aâ]ncer|c[aâ]ncer|doen[çc]a|internad[oa]|uti|overdose|diagn[oó]stic|prontu[aá]rio|sa[úu]de mental|depress[ãa]o)\b/i,
  // body/weight is personal & sensitive (body-image), not a pop-culture bet
  /\b(perdeu|ganhou|eliminou)\s+\d+\s?kg\b/i, /\bemagrec/i, /\bengord(ou|aram)\b/i, /\b(dieta|silhueta|celulite|lipoaspira)\b/i,
];
const CRIMINAL_PATTERNS = [/\b(assassin|homic[íi]dio|estupr|estupro|assédio|assedio|abuso sexual|pedofil|tr[áa]fico|traficant|estelionat|preso|pris[ãa]o|acusad[oa] de crime)\b/i];
const SEXUAL_PATTERNS = [/\b(estupr|assédio sexual|assedio sexual|abuso sexual|nudes vazad|sextape|conte[úu]do [íi]ntimo)\b/i];
// Death / grief is sensitive — route to human review, never auto-publish.
const DEATH_PATTERNS = [/\b(morte|morreu|faleceu|falecimento|[óo]bito|luto|vel[óo]rio|enterro|sepultamento|p[óo]stum[oa])\b/i];

// Sourced only from anonymous accounts / repost farms / aggregators.
const ANON_SOURCE_PATTERNS = [/an[ôo]nim|perfil fake|conta fake|blogueir[ao] an[ôo]nim|pket|repost|agregador/i];

// Community-opinion / subjective, not objectively resolvable.
const SUBJECTIVE_PATTERNS = [
  /\bmelhor\b/i,
  /\bpior\b/i,
  /\bmais (bonit|talentos|amad|odia)/i,
  /\bfavorit[oa]\b/i,
  /\bmerece\b/i,
  /\bdeveria\b/i,
  /\bmais bonit[oa]\b/i,
  /\benquete\b/i, // fan poll = community opinion, not objectively resolvable
  /\bvot(e|em|a[çc][ãa]o popular)\b/i,
];
const UNRESOLVABLE_PATTERNS = [
  /\bpara sempre\b/i,
  /\balgum dia\b/i,
  /\bem breve\b(?!.*\b(dia|semana|\d))/i,
  /\b(é|eh|seria)\s+(m[aá]|ruim|falso|shady|t[óo]xic[oa])\s+pessoa\b/i,
  /\b(clima pesado|treta eterna|segue a briga|pol[eê]mica continua)\b/i,
];
const TIMEFRAME_SIGNAL_PATTERNS = [
  /\b(hoje|amanh[ãa]|esta semana|pr[oó]xim[oa]s?\s+(dias?|semanas?|meses?|48h|24h))\b/i,
  /\b(at[eé]|antes de|durante|no dia|em)\s+\d{1,2}\b/i,
  /\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
  /\b(lan[çc]ar|estrear|anunciar|confirmar|assumir|entrar|voltar|participar|aparecer|se apresentar)[aá]?\b/i,
  /\b(festa|final|pared[ãa]o|show|turn[êe]|evento|casamento|novela|bbb)\b/i,
];
// The event has already happened / is already known (past, settled facts).
// A prediction market needs a still-open FUTURE outcome, so completed/past-tense
// headlines and announcements that already landed must not be approved.
const ALREADY_HAPPENED_PATTERNS = [
  /\b(morreu|faleceu|aconteceu|foi preso|foi condenad|terminou o casamento)\b/i,
  // completed announcements / actions (pretérito perfeito + present-perfective)
  /\b(estreou|estreia hoje|lan[çc]ou|anunciou|confirmou|revelou|assumiu|negou|reagiu|rebateu|desabafou|produziu|gravou|renovou|assinou|venceu|ganhou|recebeu|comemorou|celebrou|declarou|se pronunciou|se posicionou)\b/i,
  /\b(se casou|se casa|casou|reatou|terminou|separou|assumiu namoro|assumiu romance)\b/i,
  /\brenov(a|ou) contrato\b/i,
  // more completed past-tense verbs the AI reframe tends to leak through
  /\b(visitaram?|terminaram|posaram|concedeu|concederam|afirmou|afirmaram|compartilhou|compartilharam|perdeu|perderam|disseram|fizeram|apareceu|apareceram|surgiu|surgiram|flagrad[oa]s?|completaria|completou)\b/i,
];

// Generic / non-celebrity-market news: economics, politics, service journalism,
// how-tos, listicles, horoscopes. Not objectively-resolvable pop-culture bets.
const GENERIC_NEWS_PATTERNS = [
  /\b(governo|minist[ée]rio|senado|c[âa]mara|congresso|stf|stj|imposto|taxa[çc]|tarifa|subs[íi]dio|exporta|importa|infla[çc]|d[óo]lar|gasolina|pib|economia|elei[çc])\b/i,
  /\b(como (descobrir|fazer|saber|assistir|ver)|veja como|saiba como|passo a passo|guia|melhores (filmes|s[ée]ries|momentos)|s[ée]ries para assistir|curiosidades|relembre|retrospectiva)\b/i,
  /\b(signo|hor[óo]scopo|ascendente|mapa astral|numerologia)\b/i,
  // service-journalism question forms: factual/scheduling trivia, not predictions
  /\bque horas\b/i,
  /\bquantos?\s+(epis[óo]dios?|temporadas?|anos?|filhos?)/i,
  /\b(saiba o que|o que dizem|entenda por que|veja quem)\b/i,
  // politics is outside the celebrity-gossip domain
  /\b(campanha eleitoral|pr[ée][- ]?candidat|candidatura|bolsonaro|\blula\b|deputad|senador|governador)\b/i,
  // trivial paparazzi/social-media non-events (not objectively-resolvable bets)
  /\b(compartilhar[áa]? (fotos|registros|cliques|momentos)|posar[áa]?|fotos de f[ée]rias|clique (raro|rar[íi]?ssimo)|flagrad[oa] (curtindo|passeando|de biqu[íi]ni))\b/i,
  // confirmed entertainment listings / service copy: useful articles, bad markets.
  /\b(vai fazer|far[áa])\s+show\b.*\b(saiba tudo|ingressos?|datas?|novembro|dezembro|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro)\b/i,
  /\bretorna ao Brasil\b.*\bshows?\b/i,
  // meta/opinion headlines about media strategy are not public-figure outcome markets.
  /\b(acho que|opini[ãa]o|eles ainda n[ãa]o entenderam|como funcionam os sucessos virais)\b/i,
];

// Positive signal that the headline frames a still-open FUTURE outcome.
const FUTURE_EVENT_PATTERNS = [
  /\bvai\b|\bv[ãa]o\b|\bir[áa]\b/i,
  /\bdev(e|er[áa])\b|\bpod(e|er[áa])\b/i,
  /\bser[áa]\b|ser[áa] que/i,
  /\b(confirmar[áa]|anunciar[áa]|lan[çc]ar[áa]|estrear[áa]|voltar[áa]|assumir[áa]|entrar[áa])\b/i,
  /\bpr[óo]xim[oa]s?\b|\bem breve\b/i,
];

function textOf(candidate = {}) {
  return `${candidate.title ?? ''} ${candidate.summary ?? ''} ${candidate.article ?? ''}`.trim();
}

function matchAny(patterns, text) {
  return patterns.some((p) => p.test(text));
}

function inferResolveWindowDays(text = '') {
  if (/\b(24h|hoje|amanh[ãa])\b/i.test(text)) return 1;
  if (/\b(48h|esta semana|pared[ãa]o|festa)\b/i.test(text)) return 7;
  if (/\b(lan[çc]ar|estrear|anunciar|confirmar|assumir|entrar|voltar|participar|novela|show|turn[êe])\b/i.test(text)) return 21;
  if (/\b(pr[oó]xim[oa]s?\s+meses?|m[eê]s|mes)\b/i.test(text)) return 30;
  return null;
}

function classifyClaimType(text) {
  if (matchAny(SEXUAL_PATTERNS, text)) return 'sexual';
  if (matchAny(CRIMINAL_PATTERNS, text)) return 'criminal';
  if (matchAny(DEATH_PATTERNS, text)) return 'death';
  if (matchAny(MEDICAL_PATTERNS, text)) return 'medical';
  return 'entertainment';
}

/**
 * Screen one candidate. Pure + deterministic: same input -> same output.
 * @param {object} candidate normalized ingest candidate
 * @param {object} [opts]
 * @param {Date|string} [opts.now]
 * @param {Date|string} [opts.publishAt] proposed publication time (defaults to now)
 * @param {Array}  [opts.openRumors] recent open markets for duplicate detection
 *                 (each { id, summary, event_key })
 * @returns {object} structured screening result (advisory only)
 */
export function screenCandidate(candidate = {}, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const publishAt = opts.publishAt ? new Date(opts.publishAt) : now;
  const openRumors = Array.isArray(opts.openRumors) ? opts.openRumors : [];
  const text = textOf(candidate);
  const reason_codes = [];

  // --- source signals -------------------------------------------------------
  const source_quality = classifySource(candidate.source || '');
  const hasWorkingSource = Boolean(candidate.url) && isAuthoritativeUrl(candidate.url);
  // A candidate explicitly flagged discovery (Google/Reddit/X leads) is a known
  // unverified lead -> curator must attach a real source (needs_review). A
  // non-discovery item with no working authoritative URL is a broken/dead source
  // -> hard reject. These are different failures, so keep them distinct.
  const isDiscoveryOnly = Boolean(candidate.discovery);
  const source_count = hasWorkingSource ? Math.max(1, Number(candidate.source_count) || 1) : Number(candidate.source_count) || 0;

  // --- claim classification -------------------------------------------------
  const claim_type = classifyClaimType(text);
  const sensitive_claim = claim_type === 'sexual' || claim_type === 'criminal' || claim_type === 'medical' || claim_type === 'death';

  // --- safety signals -------------------------------------------------------
  const minorHit = matchAny(MINOR_PATTERNS, text);
  const adultConfirmed = matchAny(ADULT_CONFIRM_PATTERNS, text);
  const unknownAge = !adultConfirmed && !minorHit && matchAny(UNKNOWN_AGE_HINT_PATTERNS, text);
  const doxxing = matchAny(DOXXING_PATTERNS, text);
  const anonOnly = matchAny(ANON_SOURCE_PATTERNS, `${candidate.source ?? ''} ${text}`);

  // --- resolvability & future-event framing ---------------------------------
  const subjective = matchAny(SUBJECTIVE_PATTERNS, text);
  const unresolvable = matchAny(UNRESOLVABLE_PATTERNS, text);
  // a year strictly before "now" is a settled past event, however it's framed
  const pastYear = (text.match(/\b(20\d{2})\b/g) || []).some((y) => Number(y) < now.getFullYear());
  const alreadyHappened = matchAny(ALREADY_HAPPENED_PATTERNS, text) || pastYear;
  const genericNews = matchAny(GENERIC_NEWS_PATTERNS, text);
  // approve_candidate requires a genuinely future, still-open outcome. A question
  // frame ("...?") or an explicit future verb is the positive signal; without it
  // the timing/resolution is unclear -> needs_review (never auto-approve).
  const hasFutureSignal = /\?/.test(String(candidate.title || '')) || matchAny(FUTURE_EVENT_PATTERNS, text);
  const hasTimeframeSignal = matchAny(TIMEFRAME_SIGNAL_PATTERNS, text);
  const proposedWindowDays = inferResolveWindowDays(text) ?? (hasFutureSignal && hasTimeframeSignal ? 14 : null);
  const noPlausibleResolveBy = !proposedWindowDays;

  // --- freshness / deadline -------------------------------------------------
  const publishedAt = candidate.publishedAt ? new Date(candidate.publishedAt) : null;
  const articleAgeDays = publishedAt && !Number.isNaN(publishedAt.getTime())
    ? (now.getTime() - publishedAt.getTime()) / DAY_MS
    : null;
  const stale = articleAgeDays != null && articleAgeDays > STALE_ARTICLE_DAYS;
  const deadlineIso = proposedWindowDays ? predictionDeadlineForPublish(publishAt, proposedWindowDays) : predictionDeadlineForPublish(publishAt);
  const expiredOnPublish = new Date(deadlineIso).getTime() <= now.getTime();

  // --- duplicate / cluster --------------------------------------------------
  const eventKey = normalizeEventKey(candidate.summary || candidate.title || '');
  let duplicate_market_id = null;
  if (eventKey.length >= 8) {
    const dup = openRumors.find((r) => {
      const key = normalizeEventKey(r.event_key || r.summary || '');
      return r.id && key && key === eventKey;
    });
    if (dup) duplicate_market_id = dup.id;
  }

  // --- decision (reject > needs_review > approve) ---------------------------
  let decision = 'approve_candidate';
  const escalate = (code) => { reason_codes.push(code); if (decision === 'approve_candidate') decision = 'needs_review'; };
  const reject = (code) => { reason_codes.push(code); decision = 'reject'; };

  // hard rejects
  if (minorHit) reject('minor_subject');
  if (doxxing) reject('doxxing_private_data');
  if (!candidate.title || !String(candidate.title).trim()) reject('missing_title');
  if (!hasWorkingSource && !isDiscoveryOnly) reject('missing_source');
  if (anonOnly) reject('anonymous_or_aggregator_only');
  if (subjective) reject('subjective_opinion');
  if (unresolvable) reject('not_objectively_resolvable');
  if (noPlausibleResolveBy) reject('no_plausible_resolve_by');
  if (alreadyHappened) reject('event_already_known');
  if (genericNews) reject('not_market_suitable');
  if (expiredOnPublish) reject('expired_on_publish');
  if (duplicate_market_id) reject('duplicate_market');
  // sensitive claims require established journalism AND corroboration
  if (sensitive_claim && (source_quality !== 'reliable' || isDiscoveryOnly || source_count < 2)) {
    reject('sensitive_claim_insufficient_sourcing');
  }

  // escalations (only if not already rejected)
  if (decision !== 'reject') {
    if (!hasFutureSignal) escalate('no_future_event_signal');
    if (unknownAge) escalate('age_unknown_possible_minor');
    if (isDiscoveryOnly) escalate('discovery_only_needs_real_source');
    if (source_quality !== 'reliable' && !isDiscoveryOnly) escalate('unverified_source');
    if (stale) escalate('stale_article_confirm_future_outcome');
    if (sensitive_claim) escalate('sensitive_claim_needs_curator_review');
  }

  // --- advisory fields ------------------------------------------------------
  const proposed_category = inferCategory(candidate.title || '', candidate.source || '');
  const proposed_question = String(candidate.title || '').trim();
  const proposedResolveByIso = resolveByForBettingClose(deadlineIso, 'evidence');
  const objective_resolution_rule = (subjective || unresolvable || genericNews || alreadyHappened || !hasFutureSignal || noPlausibleResolveBy)
    ? null
    : defaultResolutionCriteria(proposed_question, proposedResolveByIso);

  // Advisory starting probability. Neutral default; nudged down for speculative
  // "vai/deve" framing. Clamped to the economy's [0.10, 0.90] bounds.
  let suggested_true_probability = 0.5;
  if (/\b(vai|deve|pode|rumor|boato|especula)/i.test(text)) suggested_true_probability = 0.4;
  suggested_true_probability = Math.min(0.9, Math.max(0.1, suggested_true_probability));

  let confidence = 0.5;
  if (source_quality === 'reliable' && hasWorkingSource) confidence = 0.8;
  if (isDiscoveryOnly) confidence = 0.3;
  if (decision === 'reject') confidence = 0.9;

  const review_notes = decision === 'reject'
    ? `Rejeitado automaticamente: ${reason_codes.join(', ')}. Requer decisão humana para reverter.`
    : decision === 'needs_review'
      ? `Precisa de revisão do curador: ${reason_codes.join(', ')}.`
      : 'Passou nas verificações determinísticas. Curador ainda deve aprovar antes de publicar.';

  return {
    decision,
    reason_codes,
    adult_subjects_confirmed: adultConfirmed,
    public_figure_confirmed: source_quality === 'reliable' && hasWorkingSource && !anonOnly,
    source_quality,
    source_count,
    duplicate_market_id,
    claim_type,
    objective_resolution_rule,
    proposed_question,
    proposed_category,
    suggested_true_probability,
    confidence,
    sensitive_claim,
    review_notes,
    // extra machine context (not required by spec, useful for the queue/audit)
    _meta: {
      event_key: eventKey,
      has_working_source: hasWorkingSource,
      discovery_only: isDiscoveryOnly,
      normalized_url: candidate.url ? normalizeNewsUrl(candidate.url) : null,
      proposed_publish_at: publishAt.toISOString(),
      proposed_prediction_deadline: deadlineIso,
      proposed_resolve_by_at: proposedResolveByIso,
      proposed_timeframe_days: proposedWindowDays,
      article_age_days: articleAgeDays,
    },
  };
}

/** Summarize a batch of screening results for a dry-run report. */
export function summarizeScreening(results = []) {
  const byDecision = { approve_candidate: 0, needs_review: 0, reject: 0 };
  const reasonTally = {};
  for (const r of results) {
    byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;
    for (const code of r.reason_codes) reasonTally[code] = (reasonTally[code] || 0) + 1;
  }
  return { total: results.length, byDecision, reasonTally };
}
