import { supabase } from './supabase';

export type Choice = 'true' | 'false';

export interface PlaceBetResult {
  ok: boolean;
  alreadyBet?: boolean;
  error?: string;
}

/**
 * Place a locked bet (Story 2.1). Routes through the place_bet RPC which
 * validates the rumor, captures the cast-time split, and bumps the counter
 * atomically. The DB UNIQUE(user_id, rumor_id) makes it write-once.
 */
export async function placeBet(rumorId: string, choice: Choice): Promise<PlaceBetResult> {
  const { error } = await supabase.rpc('place_bet', {
    p_rumor_id: rumorId,
    p_choice: choice,
  });

  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      return { ok: false, alreadyBet: true, error: 'Você já palpitou nessa 🔒' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** The current user's existing choice for a rumor, or null. (RLS limits to own rows.) */
export async function getMyChoice(rumorId: string): Promise<Choice | null> {
  const { data } = await supabase
    .from('predictions')
    .select('choice')
    .eq('rumor_id', rumorId)
    .maybeSingle();
  return (data?.choice as Choice | undefined) ?? null;
}

/** The current user's picks across many rumors, keyed by rumor_id. (RLS → own rows only.) */
export async function getMyChoices(rumorIds: string[]): Promise<Record<string, Choice>> {
  if (rumorIds.length === 0) return {};
  const { data } = await supabase
    .from('predictions')
    .select('rumor_id, choice')
    .in('rumor_id', rumorIds);
  const map: Record<string, Choice> = {};
  for (const row of (data ?? []) as { rumor_id: string; choice: Choice }[]) {
    map[row.rumor_id] = row.choice;
  }
  return map;
}
