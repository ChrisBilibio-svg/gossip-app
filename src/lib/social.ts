import { supabase, supabaseConfigured } from './supabase';
import { type ReactionValue } from './reactions';
import { type RumorStatus } from './rumors';
import { validateUserText, validateUuid } from './inputValidation';
export { ratingLabel, socialScore } from './socialFormat';

export type SocialSort = 'recent' | 'top';

export interface SocialRepost {
  id: string;
  rumorId: string;
  userId: string;
  handle: string | null;
  avatar: string | null;
  caption: string;
  rating: number;
  likeCount: number;
  dislikeCount: number;
  replyCount: number;
  myReaction: ReactionValue | null;
  createdAt: string;
  rumorSummary: string;
  rumorStatus: RumorStatus;
}

export interface SocialRepostReply {
  id: string;
  repostId: string;
  userId: string;
  handle: string | null;
  avatar: string | null;
  body: string;
  status: 'visible' | 'removed';
  createdAt: string;
}

interface SocialRepostRow {
  id: string;
  rumor_id: string;
  user_id: string;
  handle: string | null;
  avatar?: string | null;
  caption: string;
  rating: number;
  like_count: number;
  dislike_count: number;
  reply_count: number;
  created_at: string;
  rumor_summary: string;
  rumor_status: RumorStatus;
}

interface SocialRepostReplyRow {
  id: string;
  repost_id: string;
  user_id: string;
  body: string;
  status: 'visible' | 'removed';
  created_at: string;
}

interface MyRepostReactionRow {
  repost_id: string;
  value: ReactionValue;
}

export async function createRepost(rumorId: string, caption: string, rating: number): Promise<{ ok: boolean; error?: string }> {
  const rumorIdResult = validateUuid(rumorId, 'Fofoca');
  if (!rumorIdResult.ok) return { ok: false, error: rumorIdResult.error };
  const captionResult = validateUserText(caption, { max: 280, label: 'Legenda' });
  if (!captionResult.ok) return { ok: false, error: captionResult.error };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Escolha uma nota de 1 a 5.' };

  const { error } = await supabase.from('social_reposts').insert({ rumor_id: rumorIdResult.value!, caption: captionResult.value!, rating });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getSocialFeed(sort: SocialSort): Promise<{ posts: SocialRepost[]; error: string | null }> {
  if (!supabaseConfigured) {
    return { posts: [], error: 'Supabase não está configurado.' };
  }

  let q = supabase.from('social_repost_feed').select('*');
  q = sort === 'top'
    ? q.order('like_count', { ascending: false }).order('created_at', { ascending: false })
    : q.order('created_at', { ascending: false });

  const { data, error } = await q.limit(80);
  if (error) return { posts: [], error: error.message };

  const rows = (data ?? []) as SocialRepostRow[];
  const postIds = rows.map((row) => row.id);
  const mine = new Map<string, ReactionValue>();
  if (postIds.length) {
    const { data: reactions } = await supabase
      .from('social_repost_reactions')
      .select('repost_id, value')
      .in('repost_id', postIds);
    ((reactions ?? []) as MyRepostReactionRow[]).forEach((r) => mine.set(r.repost_id, r.value));
  }

  return {
    error: null,
    posts: rows.map((row) => ({
      id: row.id,
      rumorId: row.rumor_id,
      userId: row.user_id,
      handle: row.handle,
      avatar: row.avatar ?? null,
      caption: row.caption,
      rating: row.rating,
      likeCount: row.like_count,
      dislikeCount: row.dislike_count,
      replyCount: row.reply_count,
      createdAt: row.created_at,
      rumorSummary: row.rumor_summary,
      rumorStatus: row.rumor_status,
      myReaction: mine.get(row.id) ?? null,
    })),
  };
}

export async function getRepostReplies(repostId: string): Promise<SocialRepostReply[]> {
  const repostIdResult = validateUuid(repostId, 'Repost');
  if (!repostIdResult.ok) return [];
  const { data } = await supabase
    .from('social_repost_replies')
    .select('id, repost_id, user_id, body, status, created_at')
    .eq('repost_id', repostIdResult.value!)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as SocialRepostReplyRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
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

  return rows.map((row) => ({
    id: row.id,
    repostId: row.repost_id,
    userId: row.user_id,
    handle: handles.get(row.user_id) ?? null,
    avatar: avatars.get(row.user_id) ?? null,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function createRepostReply(repostId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const repostIdResult = validateUuid(repostId, 'Repost');
  if (!repostIdResult.ok) return { ok: false, error: repostIdResult.error };
  const bodyResult = validateUserText(body, { max: 280, label: 'Resposta' });
  if (!bodyResult.ok) return { ok: false, error: bodyResult.error };

  const { error } = await supabase.from('social_repost_replies').insert({ repost_id: repostIdResult.value!, body: bodyResult.value! });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setRepostReaction(postId: string, current: ReactionValue | null, next: ReactionValue): Promise<void> {
  const postIdResult = validateUuid(postId, 'Repost');
  if (!postIdResult.ok) return;
  if (current === next) {
    await supabase.from('social_repost_reactions').delete().eq('repost_id', postIdResult.value!);
    return;
  }

  await supabase.from('social_repost_reactions').upsert({ repost_id: postIdResult.value!, value: next }, { onConflict: 'repost_id,user_id' });
}

function isMissingAvatarColumnError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null | undefined;
  const message = String(maybe?.message ?? '').toLowerCase();
  return message.includes('avatar') && (maybe?.code === '42703' || maybe?.code === 'PGRST204' || message.includes('column'));
}
