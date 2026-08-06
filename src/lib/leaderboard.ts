import { supabase } from './supabase';
import { isMissingRpcError } from './rpcFallback';

export type LeaderboardScope = 'state' | 'world';

export interface LeaderboardLocation {
  countryCode: string | null;
  stateCode: string | null;
}

interface LeaderboardRpcRow {
  id: string;
  handle: string | null;
  avatar?: string | null;
  state_code?: string | null;
  total_points: number;
  correct_count: number;
  resolved_count: number;
  current_streak?: number | null;
  rank: number;
  previous_rank: number | null;
  rank_delta: number | null;
}

export interface LeaderRow {
  id: string;
  handle: string | null;
  avatar: string | null;
  stateCode: string | null;
  totalPoints: number;
  correctCount: number;
  resolvedCount: number;
  currentStreak: number;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
}

export interface GetLeaderboardOptions {
  limit?: number;
  scope?: LeaderboardScope;
  stateCode?: string | null;
}

/** Top profiles by points (Story 3.6 / FR17), scoped to world or caller/state. */
export async function getLeaderboard(options: number | GetLeaderboardOptions = 100): Promise<LeaderRow[]> {
  const { limit, scope, stateCode } = normalizeLeaderboardOptions(options);
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit, p_scope: scope, p_state_code: stateCode });
  if (error) {
    if (isMissingRpcError(error) || isMissingStateLeaderboardColumnError(error)) return getLeaderboardLegacy(limit, scope, stateCode);
    return [];
  }
  return mapLeaderboardRows((data ?? []) as LeaderboardRpcRow[]);
}

export async function getMyLeaderboardLocation(): Promise<LeaderboardLocation> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return { countryCode: null, stateCode: null };

  const { data, error } = await supabase
    .from('profiles')
    .select('country_code, state_code')
    .eq('id', uid)
    .maybeSingle();

  if (error && isMissingStateLeaderboardColumnError(error)) return { countryCode: null, stateCode: null };
  if (!data) return { countryCode: null, stateCode: null };

  return {
    countryCode: normalizeCode(data.country_code),
    stateCode: normalizeCode(data.state_code),
  };
}

function normalizeLeaderboardOptions(options: number | GetLeaderboardOptions): Required<GetLeaderboardOptions> {
  if (typeof options === 'number') return { limit: options, scope: 'world', stateCode: null };
  return {
    limit: options.limit ?? 100,
    scope: options.scope ?? 'world',
    stateCode: normalizeCode(options.stateCode),
  };
}

async function getLeaderboardLegacy(limit: number, scope: LeaderboardScope, stateCode: string | null): Promise<LeaderRow[]> {
  let query = supabase
    .from('profiles')
    .select('id, handle, avatar, state_code, total_points, correct_count, resolved_count, current_streak')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  if (scope === 'state' && stateCode) query = query.eq('state_code', stateCode);

  const { data, error } = await query;

  if (error && isMissingStreakColumnError(error)) return getLeaderboardLegacyWithoutStreaks(limit, scope, stateCode);
  if (error && isMissingOptionalLeaderboardColumnError(error)) return getLeaderboardLegacyWithoutOptionalColumns(limit, scope, stateCode);
  if (error) return [];

  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

async function getLeaderboardLegacyWithoutStreaks(limit: number, scope: LeaderboardScope, stateCode: string | null): Promise<LeaderRow[]> {
  let query = supabase
    .from('profiles')
    .select('id, handle, avatar, state_code, total_points, correct_count, resolved_count')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  if (scope === 'state' && stateCode) query = query.eq('state_code', stateCode);

  const { data, error } = await query;

  if (error && isMissingOptionalLeaderboardColumnError(error)) return getLeaderboardLegacyWithoutOptionalColumns(limit, scope, stateCode);
  if (error) return [];
  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

async function getLeaderboardLegacyWithoutOptionalColumns(limit: number, scope: LeaderboardScope, stateCode: string | null): Promise<LeaderRow[]> {
  let query = supabase
    .from('profiles')
    .select('id, handle, total_points, correct_count, resolved_count')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  // If the migration has not been applied yet, state scoped fallback cannot filter
  // by state_code. Return the world list rather than failing the leaderboard tab.
  if (scope === 'state' && stateCode) {
    // no-op: state_code is intentionally omitted in this oldest fallback shape
  }

  const { data, error } = await query;

  if (error) return [];
  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

function mapLegacyRows(rows: Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]): LeaderRow[] {
  return rows.map((r, index) => ({
    id: r.id,
    handle: r.handle,
    avatar: r.avatar ?? null,
    stateCode: normalizeCode(r.state_code),
    totalPoints: r.total_points,
    correctCount: r.correct_count,
    resolvedCount: r.resolved_count,
    currentStreak: r.current_streak ?? 0,
    rank: index + 1,
    previousRank: null,
    rankDelta: null,
  }));
}

function isMissingStreakColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  return message.includes('current_streak') && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function isMissingOptionalLeaderboardColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  const mentionsOptionalLeaderboardColumn = message.includes('avatar') || message.includes('current_streak') || message.includes('state_code');
  return mentionsOptionalLeaderboardColumn && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function isMissingStateLeaderboardColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  return (message.includes('state_code') || message.includes('country_code')) && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function mapLeaderboardRows(rows: LeaderboardRpcRow[]): LeaderRow[] {
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    avatar: r.avatar ?? null,
    stateCode: normalizeCode(r.state_code),
    totalPoints: r.total_points,
    correctCount: r.correct_count,
    resolvedCount: r.resolved_count,
    currentStreak: r.current_streak ?? 0,
    rank: r.rank,
    previousRank: r.previous_rank,
    rankDelta: r.rank_delta,
  }));
}

function normalizeCode(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/** The current user's global rank (1-based) = how many profiles have more points + 1. */
export async function getMyRank(myPoints: number): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .gt('total_points', myPoints);
  return (count ?? 0) + 1;
}
