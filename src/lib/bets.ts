import { supabase } from './supabase';
import type { RumorStatus } from './rumors';
import type { Choice } from './predictions';

export interface MyBet {
  rumorId: string;
  summary: string;
  status: RumorStatus;
  choice: Choice;
  resolved: boolean;
  isCorrect: boolean | null;
  pointsAwarded: number | null;
}

interface BetRow {
  rumor_id: string;
  choice: Choice;
  is_correct: boolean | null;
  points_awarded: number | null;
  scored_at: string | null;
  rumors: { summary: string; status: RumorStatus } | null;
}

/** The current user's bets, newest first, with the rumor embedded (Story 3.5 / FR18). */
export async function getMyBets(): Promise<MyBet[]> {
  const { data } = await supabase
    .from('predictions')
    .select('rumor_id, choice, is_correct, points_awarded, scored_at, rumors(summary, status)')
    .order('cast_at', { ascending: false });

  return ((data ?? []) as unknown as BetRow[]).map((r) => ({
    rumorId: r.rumor_id,
    summary: r.rumors?.summary ?? '(mercado removido)',
    status: r.rumors?.status ?? 'speculated',
    choice: r.choice,
    resolved: r.scored_at !== null,
    isCorrect: r.is_correct,
    pointsAwarded: r.points_awarded,
  }));
}
