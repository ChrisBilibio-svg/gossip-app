/**
 * UI-side adapter: maps the real backend `Rumor` onto the prediction-market
 * presentation the redesigned screens render. Lives in the UI lane — it only
 * READS lib exports (never edits them).
 *
 * Backend gaps (filed as handoffs): probability-over-time history (`sparkline`)
 * and `category` are not yet surfaced by the lib, so they are derived/omitted
 * here until the backend provides them.
 */
import { splitPercent, type Rumor, type RumorStatus } from '../lib/rumors';
import type { Choice } from '../lib/predictions';
import type { MarketStatus } from './StatusChip';

export function toMarketStatus(status: RumorStatus): MarketStatus {
  if (status === 'confirmed') return 'CONFIRMADO';
  if (status === 'debunked') return 'CAP';
  if (status === 'void') return 'VOID';
  return 'ABERTO';
}

export function marketOdds(r: Pick<Rumor, 'trueTotal' | 'falseTotal'>): { teaPct: number; capPct: number } {
  const { tea, cap } = splitPercent(r);
  return { teaPct: tea, capPct: cap };
}

export function marketVolume(r: Pick<Rumor, 'trueTotal' | 'falseTotal'>): number {
  return r.trueTotal + r.falseTotal;
}

export type MarketStatsVisibilityInput = {
  status: RumorStatus;
  myChoice: Choice | null;
  viewerIsPro?: boolean;
};

/**
 * Open-market crowd predictions are an earned/pro insight: free users unlock
 * them only after committing a TEA/CAP position. Terminal markets are public.
 */
export function canSeeMarketStats({ status, myChoice, viewerIsPro = false }: MarketStatsVisibilityInput): boolean {
  if (viewerIsPro) return true;
  if (status !== 'speculated') return true;
  return myChoice != null;
}

/** Compact "fecha em 3d 14h" countdown from an ISO deadline, or null if none/past. */
export function deadlineLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * A placeholder probability history until the backend surfaces real movement.
 * Eases from a neutral 50 toward the current TEA % so the sparkline reads as
 * "drifted toward the current split" rather than flat. Deterministic (no RNG).
 */
export function placeholderSparkline(teaPct: number, points = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    out.push(Math.round(50 + (teaPct - 50) * t));
  }
  return out;
}
