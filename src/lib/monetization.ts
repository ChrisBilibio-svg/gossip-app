export type AdPlacement = 'feed_native' | 'post_resolution_interstitial' | 'rewarded_bonus_insight';

export type ConsentState = 'unknown' | 'rejected' | 'non_personalized' | 'personalized';

export type MonetizationUser = {
  isPro?: boolean;
  consentState?: ConsentState;
  adsEnabled?: boolean;
  rewardedAdsOptIn?: boolean;
};

export type AdFrequencyState = {
  sessionImpressions?: number;
  placementImpressions?: Partial<Record<AdPlacement, number>>;
  lastInterstitialAtMs?: number | null;
  nowMs: number;
};

export type AdPlacementPolicy = {
  placement: AdPlacement;
  enabled: boolean;
  format: 'native' | 'interstitial' | 'rewarded';
  requiresExplicitOptIn: boolean;
  maxPerSession: number;
  minSecondsBetween?: number;
  notes: string;
};

const MINUTE_MS = 60_000;

export const AD_PLACEMENT_POLICIES: Record<AdPlacement, AdPlacementPolicy> = {
  feed_native: {
    placement: 'feed_native',
    enabled: true,
    format: 'native',
    requiresExplicitOptIn: false,
    maxPerSession: 4,
    notes: 'Inline sponsored card after every 6-8 organic market cards; never before the first market.',
  },
  post_resolution_interstitial: {
    placement: 'post_resolution_interstitial',
    enabled: true,
    format: 'interstitial',
    requiresExplicitOptIn: false,
    maxPerSession: 2,
    minSecondsBetween: 180,
    notes: 'Only after the payoff/resolution celebration closes, never before score reveal or truth resolution.',
  },
  rewarded_bonus_insight: {
    placement: 'rewarded_bonus_insight',
    enabled: false,
    format: 'rewarded',
    requiresExplicitOptIn: true,
    maxPerSession: 3,
    notes: 'Future optional rewarded unit for cosmetic/insight unlocks only; never grants points or prediction edge.',
  },
};

export function shouldRequestPersonalizedAds(consentState: ConsentState | undefined): boolean {
  return consentState === 'personalized';
}

export function shouldShowAds(user: MonetizationUser): boolean {
  if (user.isPro) return false;
  if (user.adsEnabled === false) return false;
  return user.consentState === 'non_personalized' || user.consentState === 'personalized';
}

export function canShowPlacement(
  placement: AdPlacement,
  user: MonetizationUser,
  frequency: AdFrequencyState,
): boolean {
  if (!shouldShowAds(user)) return false;

  const policy = AD_PLACEMENT_POLICIES[placement];
  if (!policy.enabled) return false;

  if (policy.requiresExplicitOptIn && !user.rewardedAdsOptIn) return false;

  const sessionImpressions = frequency.sessionImpressions ?? 0;
  if (sessionImpressions >= 8) return false;

  const placementImpressions = frequency.placementImpressions?.[placement] ?? 0;
  if (placementImpressions >= policy.maxPerSession) return false;

  if (placement === 'post_resolution_interstitial' && policy.minSecondsBetween) {
    const last = frequency.lastInterstitialAtMs;
    if (typeof last === 'number' && frequency.nowMs - last < policy.minSecondsBetween * 1000) return false;
  }

  return true;
}

export function nextFeedNativeAdIndex(cardIndex: number): boolean {
  // 0-based: render after cards 8, 16, 24... so the first screen stays pure product.
  return cardIndex > 0 && (cardIndex + 1) % 8 === 0;
}

export const AD_IMPLEMENTATION_GUARDRAILS = [
  'Ads never affect Verdade/Mentira/VOID resolution, odds, score, rank, or truth copy.',
  'Pro users are ad-free.',
  'Pro can reveal pre-bet odds, graphs, and crowd stats; free users unlock those insights only after placing a bet.',
  'No personalized ads until consent is explicit; non-personalized ads are the fallback.',
  'Interstitials appear only after a natural completion moment, never before a vote or payoff reveal.',
  'Rewarded ads must be optional and cosmetic/educational only, never pay-to-win.',
] as const;
