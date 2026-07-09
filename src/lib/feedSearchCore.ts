export type FeedFilter =
  | 'recent'
  | 'closing-soon'
  | 'popular'
  | 'most-commented'
  | 'evidence'
  | 'deadline'
  | 'tea'
  | 'cap'
  | 'void';

export type SearchableRumor = {
  summary: string;
  article: string | null;
  category?: string | null;
  createdAt: string;
  status?: 'speculated' | 'confirmed' | 'debunked' | 'void';
  predictionDeadline?: string | null;
  resolutionPolicy?: 'evidence' | 'deadline';
  trueTotal?: number;
  falseTotal?: number;
  commentCount?: number;
  myChoice?: unknown | null;
};

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function createdAtMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function deadlineMs(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function volume(rumor: SearchableRumor): number {
  return (rumor.trueTotal ?? 0) + (rumor.falseTotal ?? 0);
}

function matchesQuery(rumor: SearchableRumor, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText(`${rumor.summary} ${rumor.article ?? ''} ${rumor.category ?? ''}`);
  return haystack.includes(normalizedQuery);
}

function matchesFilter(rumor: SearchableRumor, filter: FeedFilter, nowMs: number): boolean {
  switch (filter) {
    case 'closing-soon': {
      const deadline = deadlineMs(rumor.predictionDeadline);
      return deadline > nowMs && deadline <= nowMs + 48 * 60 * 60 * 1000;
    }
    case 'evidence':
      return rumor.resolutionPolicy === 'evidence';
    case 'deadline':
      return rumor.resolutionPolicy === 'deadline';
    case 'tea':
      return rumor.status === 'confirmed';
    case 'cap':
      return rumor.status === 'debunked';
    case 'void':
      return rumor.status === 'void';
    case 'popular':
    case 'recent':
    default:
      return true;
  }
}

function sortRumors<T extends SearchableRumor>(rumors: T[], filter: FeedFilter): T[] {
  if (filter === 'popular') {
    return [...rumors].sort((a, b) => volume(b) - volume(a) || createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
  }
  if (filter === 'most-commented') {
    return [...rumors].sort(
      (a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0) || createdAtMs(b.createdAt) - createdAtMs(a.createdAt),
    );
  }
  if (filter === 'closing-soon') {
    return [...rumors].sort((a, b) => deadlineMs(a.predictionDeadline) - deadlineMs(b.predictionDeadline));
  }
  return [...rumors].sort((a, b) => createdAtMs(b.createdAt) - createdAtMs(a.createdAt));
}

/**
 * Keyword search + product filters for the feed. Searches headline + article,
 * applies the selected filter, and returns deterministic ordering.
 */
export function filterRumors<T extends SearchableRumor>(
  rumors: T[],
  query: string,
  filter: FeedFilter = 'recent',
  nowMs = Date.now(),
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  const narrowed = rumors.filter((rumor) => matchesQuery(rumor, normalizedQuery) && matchesFilter(rumor, filter, nowMs));
  return sortRumors(narrowed, filter);
}

/**
 * Backward-compatible keyword-only helper used by server-search fallbacks.
 */
export function filterRumorsByQuery<T extends SearchableRumor>(rumors: T[], query: string): T[] {
  return filterRumors(rumors, query, 'recent');
}

// --- Filter redesign v2 (#25): sort dimension vs combinable quick toggles ---

export type FeedSort = 'hot' | 'recent' | 'closing-soon' | 'most-commented';
export type OpenQuickFilter = 'tied' | 'unbet' | 'discussion';
export type ResolvedSort = 'recent' | 'popular';
export type ResolvedOutcome = 'all' | 'tea' | 'cap' | 'void' | 'my-wins';

/** TEA share as a 0–100 percentage; a 0/0 market reads as 50 (perfectly split). */
function teaShare(rumor: SearchableRumor): number {
  const v = volume(rumor);
  if (v === 0) return 50;
  return ((rumor.trueTotal ?? 0) / v) * 100;
}

/** "Em alta": market volume plus a recency bonus that decays over the first ~72h. */
function hotScore(rumor: SearchableRumor, nowMs: number): number {
  const hoursOld = (nowMs - createdAtMs(rumor.createdAt)) / (60 * 60 * 1000);
  const freshness = Math.max(0, 72 - hoursOld);
  return volume(rumor) + freshness;
}

function byRecent(a: SearchableRumor, b: SearchableRumor): number {
  return createdAtMs(b.createdAt) - createdAtMs(a.createdAt);
}

/**
 * OPEN feed: text query + a single sort + zero-or-more combinable quick filters.
 * Quick filters AND together; the sort is applied last.
 */
export function applyOpenFeed<T extends SearchableRumor>(
  rumors: T[],
  query: string,
  sort: FeedSort,
  quick: OpenQuickFilter[] = [],
  nowMs = Date.now(),
): T[] {
  const nq = normalizeSearchText(query);
  let out = rumors.filter((r) => matchesQuery(r, nq));
  if (quick.includes('tied')) {
    out = out.filter((r) => {
      const share = teaShare(r);
      return volume(r) >= 10 && share >= 40 && share <= 60;
    });
  }
  if (quick.includes('unbet')) out = out.filter((r) => r.myChoice == null);
  if (quick.includes('discussion')) out = out.filter((r) => (r.commentCount ?? 0) > 0);

  if (sort === 'hot') return [...out].sort((a, b) => hotScore(b, nowMs) - hotScore(a, nowMs) || byRecent(a, b));
  if (sort === 'most-commented') {
    return [...out].sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0) || byRecent(a, b));
  }
  if (sort === 'closing-soon') {
    return [...out].sort((a, b) => deadlineMs(a.predictionDeadline) - deadlineMs(b.predictionDeadline) || byRecent(a, b));
  }
  return [...out].sort(byRecent);
}

/** RESOLVED feed: text query + outcome filter + recency/popularity sort. */
export function applyResolvedFeed<T extends SearchableRumor>(
  rumors: T[],
  query: string,
  sort: ResolvedSort,
  outcome: ResolvedOutcome = 'all',
): T[] {
  const nq = normalizeSearchText(query);
  let out = rumors.filter((r) => matchesQuery(r, nq));
  if (outcome === 'tea') out = out.filter((r) => r.status === 'confirmed');
  else if (outcome === 'cap') out = out.filter((r) => r.status === 'debunked');
  else if (outcome === 'void') out = out.filter((r) => r.status === 'void');
  else if (outcome === 'my-wins') {
    out = out.filter(
      (r) => (r.status === 'confirmed' && r.myChoice === 'true') || (r.status === 'debunked' && r.myChoice === 'false'),
    );
  }
  if (sort === 'popular') return [...out].sort((a, b) => volume(b) - volume(a) || byRecent(a, b));
  return [...out].sort(byRecent);
}
