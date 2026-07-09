import { supabase } from './supabase';
import { isMissingRpcError } from './rpcFallback';

interface LeaderboardRpcRow {
  id: string;
  handle: string | null;
  avatar?: string | null;
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
  totalPoints: number;
  correctCount: number;
  resolvedCount: number;
  currentStreak: number;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
}

/** Top profiles by points (Story 3.6 / FR17). */
export async function getLeaderboard(limit = 100): Promise<LeaderRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: limit });
  if (error) {
    if (isMissingRpcError(error)) return getLeaderboardLegacy(limit);
    return [];
  }
  return mapLeaderboardRows((data ?? []) as LeaderboardRpcRow[]);
}

async function getLeaderboardLegacy(limit: number): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, avatar, total_points, correct_count, resolved_count, current_streak')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  if (error && isMissingStreakColumnError(error)) return getLeaderboardLegacyWithoutStreaks(limit);
  if (error && isMissingOptionalLeaderboardColumnError(error)) return getLeaderboardLegacyWithoutOptionalColumns(limit);
  if (error) return [];

  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

async function getLeaderboardLegacyWithoutStreaks(limit: number): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, avatar, total_points, correct_count, resolved_count')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  if (error && isMissingOptionalLeaderboardColumnError(error)) return getLeaderboardLegacyWithoutOptionalColumns(limit);
  if (error) return [];
  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

async function getLeaderboardLegacyWithoutOptionalColumns(limit: number): Promise<LeaderRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, total_points, correct_count, resolved_count')
    .order('total_points', { ascending: false })
    .order('correct_count', { ascending: false })
    .limit(limit);

  if (error) return [];
  return mapLegacyRows((data ?? []) as Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]);
}

function mapLegacyRows(rows: Omit<LeaderboardRpcRow, 'rank' | 'previous_rank' | 'rank_delta'>[]): LeaderRow[] {
  return rows.map((r, index) => ({
    id: r.id,
    handle: r.handle,
    avatar: r.avatar ?? null,
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
  const mentionsOptionalLeaderboardColumn = message.includes('avatar') || message.includes('current_streak');
  return mentionsOptionalLeaderboardColumn && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function mapLeaderboardRows(rows: LeaderboardRpcRow[]): LeaderRow[] {
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    avatar: r.avatar ?? null,
    totalPoints: r.total_points,
    correctCount: r.correct_count,
    resolvedCount: r.resolved_count,
    currentStreak: r.current_streak ?? 0,
    rank: r.rank,
    previousRank: r.previous_rank,
    rankDelta: r.rank_delta,
  }));
}

/** The current user's global rank (1-based) = how many profiles have more points + 1. */
export async function getMyRank(myPoints: number): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .gt('total_points', myPoints);
  return (count ?? 0) + 1;
}
