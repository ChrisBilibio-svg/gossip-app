import { supabase, supabaseConfigured } from './supabase';
import { isMissingRpcError } from './rpcFallback';
import { validateUserText, validateUuid } from './inputValidation';

const groupsUnavailable = 'Grupos ainda não disponíveis. Atualização do backend pendente.';

type RpcError = { message?: string | null; code?: string | null; details?: string | null; hint?: string | null };
type RpcResult = { data: unknown; error: RpcError | null };

async function callRpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult> {
  const rawRpc = supabase.rpc as unknown as (name: string, params?: Record<string, unknown>) => PromiseLike<RpcResult>;
  return rawRpc(fn, args);
}

interface GroupSummaryRow {
  id: string;
  name: string;
  emoji: string | null;
  member_count: number;
  my_rank: number | null;
  is_owner: boolean;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
}

interface GroupMetaRow {
  id: string;
  name: string;
  emoji: string | null;
  owner_id: string;
  invite_code: string;
  member_count: number;
  is_owner: boolean;
  starts_at: string;
  ends_at: string;
  created_at: string;
  is_active: boolean;
}

interface GroupLeaderboardRpcRow {
  id: string;
  handle: string | null;
  avatar: string | null;
  points: number;
  correct_count: number;
  resolved_count: number;
  rank: number;
}

export interface GroupSummary {
  id: string;
  name: string;
  emoji: string | null;
  memberCount: number;
  myRank: number | null;
  isOwner: boolean;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface GroupMeta {
  id: string;
  name: string;
  emoji: string | null;
  ownerId: string;
  inviteCode: string;
  memberCount: number;
  isOwner: boolean;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  isActive: boolean;
}

export interface GroupLeaderboardRow {
  id: string;
  handle: string | null;
  avatar: string | null;
  points: number;
  correctCount: number;
  resolvedCount: number;
  rank: number;
}

export interface GroupMutationResult {
  ok: boolean;
  group?: GroupMeta | null;
  inviteCode?: string;
  error?: string;
  unavailable?: boolean;
}

export interface GroupsResult {
  groups: GroupSummary[];
  error?: string | null;
  unavailable?: boolean;
}

export interface GroupResult {
  group: GroupMeta | null;
  error?: string | null;
  unavailable?: boolean;
}

export interface GroupLeaderboardResult {
  rows: GroupLeaderboardRow[];
  error?: string | null;
  unavailable?: boolean;
}

export async function createGroup(name: string, endsAt: string | Date, emoji: string | null = null): Promise<GroupMutationResult> {
  const nameResult = validateUserText(name, { min: 1, max: 30, label: 'Nome do grupo' });
  if (!nameResult.ok) return { ok: false, error: nameResult.error };

  const endsAtIso = normalizeEndsAt(endsAt);
  if (!endsAtIso) return { ok: false, error: 'Duração inválida.' };
  const emojiResult = normalizeEmoji(emoji);
  if (!emojiResult.ok) return { ok: false, error: emojiResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { data, error } = await callRpc('create_group', {
    p_name: nameResult.value!,
    p_ends_at: endsAtIso,
    p_emoji: emojiResult.value,
  });
  if (error) return mutationError(error);
  return { ok: true, group: mapGroupMeta(firstRow(data as GroupMetaRow[] | GroupMetaRow | null)) };
}

export async function joinGroup(inviteCode: string): Promise<GroupMutationResult> {
  const code = inviteCode.trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code)) return { ok: false, error: 'Código inválido.' };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { data, error } = await callRpc('join_group', { p_invite_code: code });
  if (error) return mutationError(error);
  return { ok: true, group: mapGroupMeta(firstRow(data as GroupMetaRow[] | GroupMetaRow | null)) };
}

export async function leaveGroup(groupId: string): Promise<GroupMutationResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { ok: false, error: groupIdResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { error } = await callRpc('leave_group', { p_group_id: groupIdResult.value! });
  if (error) return mutationError(error);
  return { ok: true };
}

export async function getMyGroups(): Promise<GroupsResult> {
  if (!supabaseConfigured) return { groups: [], error: groupsUnavailable, unavailable: true };
  const { data, error } = await callRpc('get_my_groups');
  if (error) {
    if (isMissingRpcError(error)) return { groups: [], error: groupsUnavailable, unavailable: true };
    return { groups: [], error: errorMessage(error) };
  }
  return { groups: ((data ?? []) as GroupSummaryRow[]).map(mapGroupSummary), error: null };
}

export async function getGroup(groupId: string): Promise<GroupResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { group: null, error: groupIdResult.error };
  if (!supabaseConfigured) return { group: null, error: groupsUnavailable, unavailable: true };

  const { data, error } = await callRpc('get_group', { p_group_id: groupIdResult.value! });
  if (error) {
    if (isMissingRpcError(error)) return { group: null, error: groupsUnavailable, unavailable: true };
    return { group: null, error: errorMessage(error) };
  }
  return { group: mapGroupMeta(firstRow(data as GroupMetaRow[] | GroupMetaRow | null)), error: null };
}

export async function getGroupLeaderboard(groupId: string, limit = 100): Promise<GroupLeaderboardResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { rows: [], error: groupIdResult.error };
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100;
  if (!supabaseConfigured) return { rows: [], error: groupsUnavailable, unavailable: true };

  const { data, error } = await callRpc('get_group_leaderboard', {
    p_group_id: groupIdResult.value!,
    p_limit: safeLimit,
  });
  if (error) {
    if (isMissingRpcError(error)) return { rows: [], error: groupsUnavailable, unavailable: true };
    return { rows: [], error: errorMessage(error) };
  }
  return { rows: ((data ?? []) as GroupLeaderboardRpcRow[]).map(mapLeaderboardRow), error: null };
}

export async function renameGroup(groupId: string, name: string, emoji: string | null = null): Promise<GroupMutationResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { ok: false, error: groupIdResult.error };
  const nameResult = validateUserText(name, { min: 1, max: 30, label: 'Nome do grupo' });
  if (!nameResult.ok) return { ok: false, error: nameResult.error };
  const emojiResult = normalizeEmoji(emoji);
  if (!emojiResult.ok) return { ok: false, error: emojiResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { error } = await callRpc('rename_group', {
    p_group_id: groupIdResult.value!,
    p_name: nameResult.value!,
    p_emoji: emojiResult.value,
  });
  if (error) return mutationError(error);
  return { ok: true };
}

export async function removeGroupMember(groupId: string, userId: string): Promise<GroupMutationResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { ok: false, error: groupIdResult.error };
  const userIdResult = validateUuid(userId, 'Membro');
  if (!userIdResult.ok) return { ok: false, error: userIdResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { error } = await callRpc('remove_group_member', {
    p_group_id: groupIdResult.value!,
    p_user_id: userIdResult.value!,
  });
  if (error) return mutationError(error);
  return { ok: true };
}

export async function deleteGroup(groupId: string): Promise<GroupMutationResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { ok: false, error: groupIdResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { error } = await callRpc('delete_group', { p_group_id: groupIdResult.value! });
  if (error) return mutationError(error);
  return { ok: true };
}

export async function regenerateGroupInvite(groupId: string): Promise<GroupMutationResult> {
  const groupIdResult = validateUuid(groupId, 'Grupo');
  if (!groupIdResult.ok) return { ok: false, error: groupIdResult.error };
  if (!supabaseConfigured) return { ok: false, error: groupsUnavailable, unavailable: true };

  const { data, error } = await callRpc('regenerate_group_invite', { p_group_id: groupIdResult.value! });
  if (error) return mutationError(error);
  return { ok: true, inviteCode: typeof data === 'string' ? data : nullToUndefined(data) };
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : 'Não foi possível carregar os grupos.';
}

function mutationError(error: unknown): GroupMutationResult {
  if (isMissingRpcError(error)) return { ok: false, error: groupsUnavailable, unavailable: true };
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  return { ok: false, error: message || 'Não foi possível atualizar o grupo.' };
}

function firstRow<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function mapGroupSummary(row: GroupSummaryRow): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? null,
    memberCount: row.member_count ?? 0,
    myRank: row.my_rank ?? null,
    isOwner: Boolean(row.is_owner),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: Boolean(row.is_active),
  };
}

function mapGroupMeta(row: GroupMetaRow | null): GroupMeta | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji ?? null,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    memberCount: row.member_count ?? 0,
    isOwner: Boolean(row.is_owner),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    isActive: Boolean(row.is_active),
  };
}

function mapLeaderboardRow(row: GroupLeaderboardRpcRow): GroupLeaderboardRow {
  return {
    id: row.id,
    handle: row.handle,
    avatar: row.avatar ?? null,
    points: row.points ?? 0,
    correctCount: row.correct_count ?? 0,
    resolvedCount: row.resolved_count ?? 0,
    rank: row.rank,
  };
}

function normalizeEndsAt(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeEmoji(value: string | null): { ok: boolean; value: string | null; error?: string } {
  if (value == null || value.trim() === '') return { ok: true, value: null };
  const trimmed = value.trim();
  if (Array.from(trimmed).length > 4) return { ok: false, value: null, error: 'Emoji deve ter até 4 caracteres.' };
  return { ok: true, value: trimmed };
}

function nullToUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
