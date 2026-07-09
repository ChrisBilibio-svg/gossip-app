export type StreakVerdict = boolean | null;

export interface StreakState {
  currentStreak: number;
  bestStreak: number;
}

/**
 * Pure client/shared mirror of the DB streak transition:
 * correct => +1, incorrect => reset, void/push => unchanged.
 */
export function applyStreakTransition(state: StreakState, verdict: StreakVerdict): StreakState {
  const current = Math.max(0, Math.trunc(state.currentStreak || 0));
  const best = Math.max(0, Math.trunc(state.bestStreak || 0));

  if (verdict === null) {
    return { currentStreak: current, bestStreak: best };
  }

  if (!verdict) {
    return { currentStreak: 0, bestStreak: best };
  }

  const nextCurrent = current + 1;
  return { currentStreak: nextCurrent, bestStreak: Math.max(best, nextCurrent) };
}
