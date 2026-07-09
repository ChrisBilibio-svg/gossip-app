import { supabase, supabaseConfigured } from './supabase';
export { formatReactionCount, netScore } from './socialFormat';

export type ReactionValue = 1 | -1;

export interface RumorReactionStats {
  rumorId: string;
  likeCount: number;
  dislikeCount: number;
  myReaction: ReactionValue | null;
}

interface RumorReactionCountRow {
  id: string;
  like_count: number | null;
  dislike_count: number | null;
}

interface MyRumorReactionRow {
  rumor_id: string;
  value: ReactionValue;
}

export async function getRumorReactionStats(rumorIds: string[]): Promise<Record<string, RumorReactionStats>> {
  const base = Object.fromEntries(
    rumorIds.map((id) => [id, { rumorId: id, likeCount: 0, dislikeCount: 0, myReaction: null }]),
  ) as Record<string, RumorReactionStats>;

  if (!supabaseConfigured || rumorIds.length === 0) return base;

  const { data: counts } = await supabase
    .from('rumors')
    .select('id, like_count, dislike_count')
    .in('id', rumorIds);

  ((counts ?? []) as RumorReactionCountRow[]).forEach((row) => {
    if (!base[row.id]) return;
    base[row.id].likeCount = row.like_count ?? 0;
    base[row.id].dislikeCount = row.dislike_count ?? 0;
  });

  const { data: mine } = await supabase
    .from('rumor_reactions')
    .select('rumor_id, value')
    .in('rumor_id', rumorIds);

  ((mine ?? []) as MyRumorReactionRow[]).forEach((row) => {
    if (!base[row.rumor_id]) return;
    base[row.rumor_id].myReaction = row.value;
  });

  return base;
}

export async function setRumorReaction(rumorId: string, current: ReactionValue | null, next: ReactionValue): Promise<void> {
  if (current === next) {
    await supabase.from('rumor_reactions').delete().eq('rumor_id', rumorId);
    return;
  }

  await supabase.from('rumor_reactions').upsert({ rumor_id: rumorId, value: next }, { onConflict: 'rumor_id,user_id' });
}
