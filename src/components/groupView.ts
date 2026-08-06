/**
 * View-model helpers for the Grupos (private friend-league) UI. Pure functions
 * only — no backend — so they're easy to reason about and reuse across the
 * groups tab, the create sheet, and the group detail modal.
 */

export interface DurationPreset {
  key: string;
  label: string;
  days: number;
}

/** Presets the create sheet offers; "custom" is handled separately (1–365 days). */
export const DURATION_PRESETS: DurationPreset[] = [
  { key: 'w1', label: '1 semana', days: 7 },
  { key: 'm1', label: '1 mês', days: 30 },
  { key: 'm3', label: '3 meses', days: 90 },
  { key: 'm6', label: '6 meses', days: 180 },
];

export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 365;

/** Curated, on-theme emoji set for a group's icon (optional, matches avatar vibe). */
export const GROUP_EMOJIS = ['📰', '👑', '🔥', '🎯', '💅', '⚽', '📺', '🎬', '🌟', '🐍', '🎉', '💬'];

/** end-date `days` from now, as a Date for `createGroup`. */
export function endsAtFromDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** "encerra em 5d" / "encerra em 8h" / "encerrado" — the countdown shown on cards. */
export function groupTimeLabel(endsAt: string, isActive: boolean): string {
  if (!isActive) return 'encerrado';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'encerrando…';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `encerra em ${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `encerra em ${hours}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `encerra em ${mins}min`;
}

/** Accuracy string from a leaderboard row's counts. */
export function accuracyLabel(correctCount: number, resolvedCount: number): string {
  if (resolvedCount <= 0) return '—';
  return `${Math.round((correctCount / resolvedCount) * 100)}%`;
}
