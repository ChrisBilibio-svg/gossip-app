import { supabase } from './supabase';
import { validateUserText, validateUuid } from './inputValidation';

export type CommentStatus = 'visible' | 'removed';

export interface Comment {
  id: string;
  userId: string;
  handle: string | null;
  avatar: string | null;
  body: string;
  likeCount: number;
  status: CommentStatus;
  createdAt: string;
  likedByMe: boolean;
}

export type CommentSort = 'recent' | 'top';

interface CommentRow {
  id: string;
  user_id: string;
  body: string;
  like_count: number;
  status: CommentStatus;
  created_at: string;
}

export async function getComments(rumorId: string, sort: CommentSort): Promise<Comment[]> {
  const rumorIdResult = validateUuid(rumorId, 'Fofoca');
  if (!rumorIdResult.ok) return [];

  let q = supabase
    .from('comments')
    .select('id, user_id, body, like_count, status, created_at')
    .eq('rumor_id', rumorIdResult.value!);
  q = sort === 'top' ? q.order('like_count', { ascending: false }) : q.order('created_at', { ascending: false });
  const { data } = await q.limit(100);
  const rows = (data ?? []) as CommentRow[];

  // handles (fetched separately — comments has no direct FK to profiles)
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const handles = new Map<string, string | null>();
  const avatars = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profs, error } = await supabase.from('profiles').select('id, handle, avatar').in('id', userIds);
    if (error && isMissingAvatarColumnError(error)) {
      const { data: legacyProfs } = await supabase.from('profiles').select('id, handle').in('id', userIds);
      (legacyProfs ?? []).forEach((p: { id: string; handle: string | null }) => handles.set(p.id, p.handle));
    } else {
      (profs ?? []).forEach((p: { id: string; handle: string | null; avatar?: string | null }) => {
        handles.set(p.id, p.handle);
        avatars.set(p.id, p.avatar ?? null);
      });
    }
  }

  // which of these did I like?
  const ids = rows.map((r) => r.id);
  const liked = new Set<string>();
  if (ids.length) {
    const { data: likes } = await supabase.from('comment_likes').select('comment_id').in('comment_id', ids);
    (likes ?? []).forEach((l: { comment_id: string }) => liked.add(l.comment_id));
  }

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    handle: handles.get(r.user_id) ?? null,
    avatar: avatars.get(r.user_id) ?? null,
    body: r.body,
    likeCount: r.like_count,
    status: r.status,
    createdAt: r.created_at,
    likedByMe: liked.has(r.id),
  }));
}

export async function postComment(rumorId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const rumorIdResult = validateUuid(rumorId, 'Fofoca');
  if (!rumorIdResult.ok) return { ok: false, error: rumorIdResult.error };
  const bodyResult = validateUserText(body, { max: 500, label: 'Comentário' });
  if (!bodyResult.ok) return { ok: false, error: bodyResult.error };

  const { error } = await supabase.from('comments').insert({ rumor_id: rumorIdResult.value!, body: bodyResult.value! });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function toggleLike(commentId: string, liked: boolean): Promise<void> {
  const commentIdResult = validateUuid(commentId, 'Comentário');
  if (!commentIdResult.ok) return;
  if (liked) {
    await supabase.from('comment_likes').delete().eq('comment_id', commentIdResult.value!);
  } else {
    await supabase.from('comment_likes').insert({ comment_id: commentIdResult.value! });
  }
}

export async function reportComment(commentId: string, reason: string): Promise<void> {
  const commentIdResult = validateUuid(commentId, 'Comentário');
  const reasonResult = validateUserText(reason, { min: 3, max: 80, label: 'Motivo' });
  if (!commentIdResult.ok || !reasonResult.ok) return;
  await supabase.from('comment_reports').insert({ comment_id: commentIdResult.value!, reason: reasonResult.value! });
}

export async function blockUser(blockedId: string): Promise<void> {
  const blockedIdResult = validateUuid(blockedId, 'Usuário');
  if (!blockedIdResult.ok) return;
  await supabase.from('blocks').insert({ blocked_id: blockedIdResult.value! });
}

export async function hasAcceptedGuidelines(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { data } = await supabase.from('profiles').select('accepted_guidelines').eq('id', uid).maybeSingle();
  return Boolean(data?.accepted_guidelines);
}

export async function acceptGuidelines(): Promise<void> {
  await supabase.rpc('accept_guidelines');
}

function isMissingAvatarColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  return message.includes('avatar') && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}
