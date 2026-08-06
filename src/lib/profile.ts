import { supabase } from './supabase';

/** The current user's handle, or null if not set yet. */
export async function getMyHandle(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  const { data: prof } = await supabase.from('profiles').select('handle').eq('id', uid).maybeSingle();
  return (prof?.handle as string | null) ?? null;
}

/** Permanently delete the current account + all its data (LGPD / Story 6.3). */
export async function deleteMyAccount(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) return { ok: false, error: error.message };
  await supabase.auth.signOut();
  return { ok: true };
}

export interface SetHandleResult {
  ok: boolean;
  taken?: boolean;
  error?: string;
}

export type SetAvatarResult = Pick<SetHandleResult, 'ok' | 'error'>;
export type SetProfileLocationResult = Pick<SetHandleResult, 'ok' | 'error'>;

export interface MyProfile {
  handle: string | null;
  avatar: string | null;
  totalPoints: number;
  correctCount: number;
  resolvedCount: number;
  /** Consecutive correct resolved predictions. VOID/pushes do not change this. */
  currentStreak: number;
  /** All-time highest consecutive-correct streak. */
  bestStreak: number;
}

/** The current user's profile (handle + stats). */
export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('handle, avatar, total_points, correct_count, resolved_count, current_streak, best_streak')
    .eq('id', uid)
    .maybeSingle();
  if (error && isMissingStreakColumnError(error)) return getMyProfileWithoutStreaks(uid);
  if (error && isMissingOptionalProfileColumnError(error)) return getMyProfileWithoutOptionalColumns(uid);
  if (!data) return null;
  return {
    handle: data.handle,
    avatar: data.avatar ?? null,
    totalPoints: data.total_points,
    correctCount: data.correct_count,
    resolvedCount: data.resolved_count,
    currentStreak: data.current_streak ?? 0,
    bestStreak: data.best_streak ?? 0,
  };
}

async function getMyProfileWithoutStreaks(uid: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('handle, avatar, total_points, correct_count, resolved_count')
    .eq('id', uid)
    .maybeSingle();
  if (error && isMissingOptionalProfileColumnError(error)) return getMyProfileWithoutOptionalColumns(uid);
  if (!data) return null;
  return {
    handle: data.handle,
    avatar: data.avatar ?? null,
    totalPoints: data.total_points,
    correctCount: data.correct_count,
    resolvedCount: data.resolved_count,
    currentStreak: 0,
    bestStreak: 0,
  };
}

async function getMyProfileWithoutOptionalColumns(uid: string): Promise<MyProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('handle, total_points, correct_count, resolved_count')
    .eq('id', uid)
    .maybeSingle();
  if (!data) return null;
  return {
    handle: data.handle,
    avatar: null,
    totalPoints: data.total_points,
    correctCount: data.correct_count,
    resolvedCount: data.resolved_count,
    currentStreak: 0,
    bestStreak: 0,
  };
}

/** Set the current user's handle via the set_handle RPC (unique, anonymous). */
export async function setHandle(handle: string): Promise<SetHandleResult> {
  const { error } = await supabase.rpc('set_handle', { p_handle: handle });
  if (error) {
    if (error.code === '23505' || /unique|duplicate/i.test(error.message)) {
      return { ok: false, taken: true, error: 'Esse @ já está em uso' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Set the current user's server-side avatar via the set_avatar RPC. */
export async function setAvatar(avatar: string | null): Promise<SetAvatarResult> {
  const { error } = await supabase.rpc('set_avatar', { p_avatar: avatar });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Save a privacy-minimal location for state leaderboards: country/state codes only, no GPS. */
export async function setProfileLocation(countryCode: string | null, stateCode: string | null): Promise<SetProfileLocationResult> {
  const { error } = await supabase.rpc('set_profile_location', {
    p_country_code: normalizeLocationCode(countryCode),
    p_state_code: normalizeLocationCode(stateCode),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function normalizeLocationCode(value: string | null): string | null {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function isMissingStreakColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  const mentionsStreak = message.includes('current_streak') || message.includes('best_streak');
  return mentionsStreak && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}

function isMissingOptionalProfileColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  const mentionsOptionalProfileColumn = message.includes('avatar') || message.includes('current_streak') || message.includes('best_streak');
  return mentionsOptionalProfileColumn && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}
