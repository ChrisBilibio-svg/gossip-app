import { supabase, supabaseConfigured } from './supabase';
import { getMyChoices, type Choice } from './predictions';
import { getRumorReactionStats, type ReactionValue } from './reactions';
import { isMissingRpcError } from './rpcFallback';

export type RumorStatus = 'speculated' | 'confirmed' | 'debunked' | 'void';

export interface EvidenceSource {
  id: string;
  sourceUrl: string;
  sourceLabel: string | null;
  supportsOutcome: boolean;
  note: string | null;
}

export interface UpdatedRumorReference {
  id: string;
  summary: string;
}

export interface EditorialImage {
  url: string;
  alt: string;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  provider: 'pexels';
  providerId: string;
  descriptor: string;
  featureDate: string;
}

export interface Rumor {
  id: string;
  summary: string;
  article: string | null;
  category: string | null;
  status: RumorStatus;
  isHero: boolean;
  sourceUrl: string | null;
  predictionDeadline: string | null;
  resolutionPolicy: 'evidence' | 'deadline';
  requiredSourceCount: number;
  evidenceSources: EvidenceSource[];
  /** when the rumor was posted to the feed */
  createdAt: string;
  /** when it was resolved (confirmed/debunked), or null if still open */
  resolvedAt: string | null;
  /** seed + real votes — what the UI displays so the split is never 0/0 */
  trueTotal: number;
  falseTotal: number;
  /** the current user's locked pick on this rumor, or null if they haven't bet */
  myChoice: Choice | null;
  /** lightweight popularity reactions, separate from TEA/CAP truth predictions */
  likeCount: number;
  dislikeCount: number;
  /** visible comment count used by the "Mais comentados" feed sort */
  commentCount: number;
  /** denormalized number of attached/source links for cheap "N fontes" UI */
  sourceCount: number;
  /** TEA probability history, oldest → newest, for market sparklines */
  oddsHistory: number[];
  /** prior market/story that this rumor clearly updates, when present */
  updatesRumor: UpdatedRumorReference | null;
  myReaction: ReactionValue | null;
  /** Complete, attributed stock artwork. Partial/missing metadata maps to null. */
  editorialImage?: EditorialImage | null;
}

export interface EvidenceSourceRow {
  id: string;
  source_url: string;
  source_label: string | null;
  supports_outcome: boolean;
  note: string | null;
}

export interface RumorRow {
  id: string;
  summary: string;
  article: string | null;
  category?: string | null;
  status: RumorStatus;
  is_hero: boolean;
  source_url: string | null;
  prediction_deadline: string | null;
  resolution_policy: 'evidence' | 'deadline';
  required_source_count: number;
  created_at: string;
  resolved_at: string | null;
  rumor_evidence_sources?: EvidenceSourceRow[] | null;
  seed_true: number;
  seed_false: number;
  true_votes: number;
  false_votes: number;
  like_count: number | null;
  dislike_count: number | null;
  comment_count?: number | null;
  source_count?: number | null;
  updates_rumor_id?: string | null;
  updates_rumor_summary?: string | null;
  updates_rumor?: UpdatedRumorReference | null;
  odds_history?: number[] | null;
  my_choice: Choice | null;
  my_reaction: ReactionValue | null;
  editorial_image_url?: string | null;
  editorial_image_alt?: string | null;
  editorial_image_page_url?: string | null;
  editorial_image_photographer?: string | null;
  editorial_image_photographer_url?: string | null;
  editorial_image_provider?: string | null;
  editorial_image_provider_id?: string | null;
  editorial_image_descriptor?: string | null;
  editorial_image_feature_date?: string | null;
}

export interface FeedResult {
  rumors: Rumor[];
  error: string | null;
}

const RUMOR_SELECT =
  'id, summary, article, category, status, is_hero, source_url, prediction_deadline, resolution_policy, required_source_count, created_at, resolved_at, seed_true, seed_false, true_votes, false_votes, like_count, dislike_count, comment_count, source_count, updates_rumor_id, updates_rumor:rumors!rumors_updates_rumor_id_fkey(id, summary), rumor_evidence_sources(id, source_url, source_label, supports_outcome, note)';

const RUMOR_SELECT_WITHOUT_OPTIONAL_UPDATES =
  'id, summary, article, category, status, is_hero, source_url, prediction_deadline, resolution_policy, required_source_count, created_at, resolved_at, seed_true, seed_false, true_votes, false_votes, like_count, dislike_count, comment_count, source_count, rumor_evidence_sources(id, source_url, source_label, supports_outcome, note)';

const RUMOR_SELECT_WITHOUT_COMMENT_COUNT =
  'id, summary, article, category, status, is_hero, source_url, prediction_deadline, resolution_policy, required_source_count, created_at, resolved_at, seed_true, seed_false, true_votes, false_votes, like_count, dislike_count, rumor_evidence_sources(id, source_url, source_label, supports_outcome, note)';

const EDITORIAL_IMAGE_SELECT =
  'id, editorial_image_url, editorial_image_alt, editorial_image_page_url, editorial_image_photographer, editorial_image_photographer_url, editorial_image_provider, editorial_image_provider_id, editorial_image_descriptor, editorial_image_feature_date';

function isMissingOptionalUpdateError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  const mentionsOptionalUpdate = message.includes('updates_rumor') || message.includes('rumors_updates_rumor_id_fkey');
  return mentionsOptionalUpdate && (maybe?.code === '42703' || maybe?.code === 'PGRST200' || maybe?.code === 'PGRST204' || message.includes('column') || message.includes('relationship'));
}

function isMissingOptionalCountError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  const mentionsOptionalCount = message.includes('comment_count') || message.includes('source_count');
  return mentionsOptionalCount && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function isMissingCommentCountError(error: unknown): boolean {
  return isMissingOptionalCountError(error);
}

/**
 * Today's published feed (Story 1.5). RLS already restricts to publish_at <= now().
 * Hero first, then most-recent. Displayed totals = seed + real votes.
 */
export async function fetchFeed(): Promise<FeedResult> {
  if (!supabaseConfigured) {
    return {
      rumors: [],
      error: 'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env, then restart Expo.',
    };
  }

  const { data, error } = await supabase.rpc('get_feed', { p_limit: 30 });

  if (error) {
    if (isMissingRpcError(error)) return fetchFeedLegacy();
    const fallbackError = error as { message?: string };
    return { rumors: [], error: String(fallbackError.message ?? 'Feed unavailable') };
  }

  const rows = await attachEditorialImages((data ?? []) as RumorRow[]);
  return { rumors: mapRumorRows(rows), error: null };
}

async function fetchFeedLegacy(): Promise<FeedResult> {
  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .order('is_hero', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  if (error && isMissingOptionalUpdateError(error)) return fetchFeedLegacyWithoutOptionalUpdates();
  if (error && isMissingCommentCountError(error)) return fetchFeedLegacyWithoutCommentCount();
  if (error) return { rumors: [], error: error.message };

  const rows = (data ?? []) as unknown as RumorRow[];
  const rowsWithMine = await attachCallerState(rows);

  const rowsWithImages = await attachEditorialImages(rowsWithMine);
  return { rumors: mapRumorRows(rowsWithImages), error: null };
}

async function fetchFeedLegacyWithoutOptionalUpdates(): Promise<FeedResult> {
  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT_WITHOUT_OPTIONAL_UPDATES)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .order('is_hero', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  if (error && isMissingCommentCountError(error)) return fetchFeedLegacyWithoutCommentCount();
  if (error) return { rumors: [], error: error.message };

  const rows = (data ?? []) as unknown as RumorRow[];
  const rowsWithMine = await attachCallerState(rows);

  const rowsWithImages = await attachEditorialImages(rowsWithMine);
  return { rumors: mapRumorRows(rowsWithImages), error: null };
}

async function fetchFeedLegacyWithoutCommentCount(): Promise<FeedResult> {
  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT_WITHOUT_COMMENT_COUNT)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .order('is_hero', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return { rumors: [], error: error.message };

  const rows = (data ?? []) as unknown as RumorRow[];
  const rowsWithMine = await attachCallerState(rows);

  const rowsWithImages = await attachEditorialImages(rowsWithMine);
  return { rumors: mapRumorRows(rowsWithImages), error: null };
}

export async function getRumorById(id: string): Promise<Rumor | null> {
  if (!supabaseConfigured) return null;

  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT)
    .eq('id', id)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .maybeSingle();

  if (error && isMissingOptionalUpdateError(error)) return getRumorByIdWithoutOptionalUpdates(id);
  if (error && isMissingCommentCountError(error)) return getRumorByIdWithoutCommentCount(id);
  if (error || !data) return null;

  const rowsWithMine = await attachCallerState([data as unknown as RumorRow]);
  const rowsWithImages = await attachEditorialImages(rowsWithMine, { currentDateOnly: false });
  const rowsWithOdds = await attachOddsHistory(rowsWithImages);
  return mapRumorRows(rowsWithOdds)[0] ?? null;
}

async function getRumorByIdWithoutOptionalUpdates(id: string): Promise<Rumor | null> {
  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT_WITHOUT_OPTIONAL_UPDATES)
    .eq('id', id)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .maybeSingle();

  if (error && isMissingCommentCountError(error)) return getRumorByIdWithoutCommentCount(id);
  if (error || !data) return null;

  const rowsWithMine = await attachCallerState([data as unknown as RumorRow]);
  const rowsWithImages = await attachEditorialImages(rowsWithMine, { currentDateOnly: false });
  const rowsWithOdds = await attachOddsHistory(rowsWithImages);
  return mapRumorRows(rowsWithOdds)[0] ?? null;
}

async function getRumorByIdWithoutCommentCount(id: string): Promise<Rumor | null> {
  const { data, error } = await supabase
    .from('rumors')
    .select(RUMOR_SELECT_WITHOUT_COMMENT_COUNT)
    .eq('id', id)
    .eq('is_draft', false)
    .lte('publish_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  const rowsWithMine = await attachCallerState([data as unknown as RumorRow]);
  const rowsWithImages = await attachEditorialImages(rowsWithMine, { currentDateOnly: false });
  const rowsWithOdds = await attachOddsHistory(rowsWithImages);
  return mapRumorRows(rowsWithOdds)[0] ?? null;
}

async function attachCallerState(rows: RumorRow[]): Promise<RumorRow[]> {
  const ids = rows.map((row) => row.id);
  const [choices, reactions] = await Promise.all([getMyChoices(ids), getRumorReactionStats(ids)]);

  return rows.map((row) => ({
    ...row,
    my_choice: choices[row.id] ?? null,
    my_reaction: reactions[row.id]?.myReaction ?? null,
    like_count: reactions[row.id]?.likeCount ?? row.like_count ?? 0,
    dislike_count: reactions[row.id]?.dislikeCount ?? row.dislike_count ?? 0,
  }));
}

async function attachOddsHistory(rows: RumorRow[]): Promise<RumorRow[]> {
  if (!rows.length) return rows;

  const enriched = await Promise.all(
    rows.map(async (row) => {
      if (row.odds_history?.length) return row;

      const { data, error } = await supabase.rpc('get_rumor_odds_history', { p_rumor_id: row.id, p_limit: 8 });
      if (error || !Array.isArray(data)) return { ...row, odds_history: [] };

      return {
        ...row,
        odds_history: data.map((point: { tea_pct?: number | null }) => point.tea_pct).filter((value): value is number => typeof value === 'number'),
      };
    }),
  );

  return enriched;
}

function currentSaoPauloDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Enriches RPC/legacy rows without making the new migration a feed dependency.
 * A missing column/schema-cache error simply returns the original rows.
 */
export async function attachEditorialImages(
  rows: RumorRow[],
  { currentDateOnly = true }: { currentDateOnly?: boolean } = {},
): Promise<RumorRow[]> {
  if (!rows.length) return rows;

  let query = supabase
    .from('rumors')
    .select(EDITORIAL_IMAGE_SELECT)
    .in('id', rows.map((row) => row.id));
  if (currentDateOnly) query = query.eq('editorial_image_feature_date', currentSaoPauloDate());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const { data, error } = await query.abortSignal(controller.signal);
    if (error || !Array.isArray(data)) return rows;
    const imagesById = new Map((data as unknown as RumorRow[]).map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, ...(imagesById.get(row.id) ?? {}) }));
  } catch {
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

function isTrustedEditorialUrl(value: string, kind: 'image' | 'pexels'): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (kind === 'image') return url.hostname === 'images.pexels.com';
    return url.hostname === 'pexels.com' || url.hostname === 'www.pexels.com';
  } catch {
    return false;
  }
}

export function mapEditorialImage(row: RumorRow): EditorialImage | null {
  const values = [
    row.editorial_image_url,
    row.editorial_image_alt,
    row.editorial_image_page_url,
    row.editorial_image_photographer,
    row.editorial_image_photographer_url,
    row.editorial_image_provider_id,
    row.editorial_image_descriptor,
    row.editorial_image_feature_date,
  ];
  if (row.editorial_image_provider !== 'pexels' || values.some((value) => typeof value !== 'string' || !value.trim())) return null;
  if (!isTrustedEditorialUrl(row.editorial_image_url!, 'image')
    || !isTrustedEditorialUrl(row.editorial_image_page_url!, 'pexels')
    || !isTrustedEditorialUrl(row.editorial_image_photographer_url!, 'pexels')) return null;

  return {
    url: row.editorial_image_url!,
    alt: row.editorial_image_alt!,
    pageUrl: row.editorial_image_page_url!,
    photographer: row.editorial_image_photographer!,
    photographerUrl: row.editorial_image_photographer_url!,
    provider: 'pexels',
    providerId: row.editorial_image_provider_id!,
    descriptor: row.editorial_image_descriptor!,
    featureDate: row.editorial_image_feature_date!,
  };
}

export function mapRumorRows(rows: RumorRow[]): Rumor[] {
  return rows.map((r) => ({
    id: r.id,
    summary: r.summary,
    article: r.article,
    category: r.category ?? null,
    status: r.status,
    isHero: r.is_hero,
    sourceUrl: r.source_url,
    predictionDeadline: r.prediction_deadline,
    resolutionPolicy: r.resolution_policy ?? 'evidence',
    requiredSourceCount: r.required_source_count ?? 2,
    evidenceSources: (r.rumor_evidence_sources ?? []).map((s) => ({
      id: s.id,
      sourceUrl: s.source_url,
      sourceLabel: s.source_label,
      supportsOutcome: s.supports_outcome,
      note: s.note,
    })),
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    trueTotal: r.seed_true + r.true_votes,
    falseTotal: r.seed_false + r.false_votes,
    myChoice: r.my_choice ?? null,
    likeCount: r.like_count ?? 0,
    dislikeCount: r.dislike_count ?? 0,
    commentCount: r.comment_count ?? 0,
    sourceCount: r.source_count ?? (r.rumor_evidence_sources?.length ?? 0),
    oddsHistory: r.odds_history ?? [],
    updatesRumor: r.updates_rumor_id && r.updates_rumor_summary
      ? { id: r.updates_rumor_id, summary: r.updates_rumor_summary }
      : r.updates_rumor?.id && r.updates_rumor.summary
        ? { id: r.updates_rumor.id, summary: r.updates_rumor.summary }
        : null,
    myReaction: r.my_reaction ?? null,
    editorialImage: mapEditorialImage(r),
  }));
}

/** Crowd split as integer percentages (true, false), summing to 100. */
export function splitPercent(r: Pick<Rumor, 'trueTotal' | 'falseTotal'>): { tea: number; cap: number } {
  const total = r.trueTotal + r.falseTotal;
  if (total === 0) return { tea: 50, cap: 50 };
  const tea = Math.round((r.trueTotal / total) * 100);
  return { tea, cap: 100 - tea };
}

export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Just the day, e.g. "5 de jun. de 2026" — used for "posted" dates. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Day + time, e.g. "5 de jun. de 2026, 14:32" — used for "confirmed" timestamps. */
export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
