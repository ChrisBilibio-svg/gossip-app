import {
  AD_IMPLEMENTATION_GUARDRAILS,
  canShowPlacement,
  nextFeedNativeAdIndex,
  shouldRequestPersonalizedAds,
  shouldShowAds,
} from '../../src/lib/monetization';

test('ads are disabled for Pro users and users without ad consent', () => {
  expect(shouldShowAds({ isPro: true, consentState: 'personalized' })).toBe(false);
  expect(shouldShowAds({ consentState: 'unknown' })).toBe(false);
  expect(shouldShowAds({ consentState: 'rejected' })).toBe(false);
  expect(shouldShowAds({ consentState: 'non_personalized' })).toBe(true);
  expect(shouldShowAds({ consentState: 'personalized' })).toBe(true);
});

test('personalized ad requests require explicit personalized consent', () => {
  expect(shouldRequestPersonalizedAds('personalized')).toBe(true);
  expect(shouldRequestPersonalizedAds('non_personalized')).toBe(false);
  expect(shouldRequestPersonalizedAds('rejected')).toBe(false);
  expect(shouldRequestPersonalizedAds(undefined)).toBe(false);
});

test('placement caps prevent spammy sessions and early repeat interstitials', () => {
  const user = { consentState: 'non_personalized' as const };
  expect(canShowPlacement('feed_native', user, { nowMs: 10_000, placementImpressions: { feed_native: 3 } })).toBe(true);
  expect(canShowPlacement('feed_native', user, { nowMs: 10_000, placementImpressions: { feed_native: 4 } })).toBe(false);
  expect(canShowPlacement('feed_native', user, { nowMs: 10_000, sessionImpressions: 8 })).toBe(false);

  expect(
    canShowPlacement('post_resolution_interstitial', user, {
      nowMs: 100_000,
      lastInterstitialAtMs: 10_000,
    }),
  ).toBe(false);
  expect(
    canShowPlacement('post_resolution_interstitial', user, {
      nowMs: 200_000,
      lastInterstitialAtMs: 10_000,
    }),
  ).toBe(true);
});

test('rewarded ads stay disabled until a future explicit rewarded opt-in feature ships', () => {
  expect(canShowPlacement('rewarded_bonus_insight', { consentState: 'personalized' }, { nowMs: 0 })).toBe(false);
  expect(
    canShowPlacement('rewarded_bonus_insight', { consentState: 'personalized', rewardedAdsOptIn: true }, { nowMs: 0 }),
  ).toBe(false);
});

test('feed native ad spacing keeps the first screen product-only', () => {
  expect(nextFeedNativeAdIndex(0)).toBe(false);
  expect(nextFeedNativeAdIndex(6)).toBe(false);
  expect(nextFeedNativeAdIndex(7)).toBe(true);
  expect(nextFeedNativeAdIndex(15)).toBe(true);
});

test('guardrails keep monetization away from scoring and truth', () => {
  expect(AD_IMPLEMENTATION_GUARDRAILS.join(' ')).toMatch(/never affect Verdade\/Mentira\/VOID/);
  expect(AD_IMPLEMENTATION_GUARDRAILS.join(' ')).toMatch(/Pro users are ad-free/);
  expect(AD_IMPLEMENTATION_GUARDRAILS.join(' ')).toMatch(/pre-bet odds/);
  expect(AD_IMPLEMENTATION_GUARDRAILS.join(' ')).toMatch(/never pay-to-win/);
});
