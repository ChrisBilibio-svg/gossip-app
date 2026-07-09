# Viddi monetization: ads implementation plan

_Last updated: 2026-06-12_

## Executive recommendation

Use **Google AdMob** as the first ad network, but ship it as a secondary revenue line after retention looks real. For Viddi, ads should be a light monetization layer around the product loop — never the thesis and never connected to truth, scoring, odds, rank, or resolution.

Recommended launch order:

1. **Now:** keep this repo's ad policy scaffold (`src/lib/monetization.ts`) and plan in place.
2. **Before SDK install:** Chris creates the Google AdMob account/app, gets Android/iOS AdMob App IDs + ad unit IDs, and legal/privacy copy is updated for ads/LGPD.
3. **First live ad format:** inline native/feed card after every 6-8 organic market cards.
4. **Second format:** interstitial only after a natural completion moment — after the payoff/resolution celebration is closed, never before the score reveal.
5. **Later:** optional rewarded ads for cosmetic/educational extras only. No points, no better odds, no score boost.
6. **Pro:** ad-free by default.

## How app ads work

An ad network has three layers:

- **App account:** Viddi is registered in the ad network dashboard, e.g. AdMob.
- **Ad units:** each placement gets an ID, e.g. feed native ad, post-resolution interstitial, rewarded optional unit.
- **SDK:** the app includes the ad SDK, requests an ad for a unit ID, and the network returns an ad creative if inventory is available.

The ad request usually includes device/app context and, if allowed by consent, personalized-ad signals. For LGPD/store safety, Viddi should default to non-personalized ads unless the user clearly grants personalized consent.

## How Viddi gets paid

AdMob generally pays from advertiser spend using metrics like:

- **Impressions:** an ad was shown. Revenue is usually expressed as eCPM, meaning estimated earnings per 1,000 impressions.
- **Clicks:** some campaigns pay more when users click, but Viddi should never design dark patterns around clicks.
- **Rewarded completions:** for rewarded video units, revenue usually depends on completed views.

Money flow:

1. Advertiser pays Google to run ads.
2. Google serves ads in Viddi through AdMob.
3. AdMob records valid impressions/clicks/completions.
4. Google shares revenue with the app publisher.
5. Payments are sent through the configured AdSense/AdMob payment profile after verification and threshold requirements are met.

Practical expectation: early revenue is tiny until there is meaningful daily active usage. Ads are useful as incremental revenue and a proof of monetizable attention, not as the first company thesis.

## Brazil / LGPD / store policy guardrails

- Update Terms/Privacy before live ads: mention advertising, analytics, ad personalization, third-party SDKs, device identifiers, and how to opt out.
- Keep anonymous product identity: do not send real names, handles, comments, predictions, or rumor text as ad-targeting data.
- Request consent before personalized ads.
- If consent is missing/rejected, either show no ads or non-personalized ads only.
- Avoid sensitive-content targeting. Viddi talks about public celebrity/pop culture markets; do not pass gossip/entity names as ad keywords.
- Keep ad frequency humane. Retention beats short-term eCPM.
- Pro = ad-free and early insight access: Pro can see pre-bet odds, charts, and crowd stats.
- Free users unlock odds/charts/crowd stats only after placing a TEA/CAP bet on that market.
- Money never touches truth/scoring: no paid boosts, no paid odds movement, no ad reward that changes points/rank/accuracy.

## Recommended placements

### 1. Feed native card — first placement

- Format: native or banner-like sponsored card.
- Where: after card 8, then every 8 cards at most.
- Why: least disruptive; monetizes scrolling without interrupting a prediction.
- Guardrail: never before the first market, never between vote buttons and confirmation.

### 2. Post-resolution interstitial — second placement

- Format: interstitial.
- Where: after the user closes payoff/resolution celebration.
- Why: natural break point after dopamine moment.
- Frequency cap: max 2 per session and at least 3 minutes apart.
- Guardrail: never before TEA/CAP/VOID reveal; never block a vote.

### 3. Rewarded bonus insight — later / optional

- Format: rewarded video.
- Where: optional "watch to unlock extra context/analytics/cosmetic flair".
- Guardrail: no points, no better market access, no rank/accuracy advantage. Keep it cosmetic/educational.

## Implementation path in this Expo app

Preferred SDK: `react-native-google-mobile-ads`.

Current package check on 2026-06-12:

- `react-native-google-mobile-ads`: latest `16.3.3`, peer dependency `expo >=47.0.0`.
- Viddi currently uses Expo SDK 56 / React Native 0.85, so compatibility looks plausible.

Do **not** install native SDK until we have real AdMob IDs, because the Expo config plugin needs platform app IDs.

When ready:

```bash
npx expo install react-native-google-mobile-ads expo-tracking-transparency
```

Then update `app.json` plugins/config with real IDs from AdMob, for example:

```json
[
  "react-native-google-mobile-ads",
  {
    "androidAppId": "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY",
    "iosAppId": "ca-app-pub-XXXXXXXXXXXXXXXX~ZZZZZZZZZZ"
  }
]
```

Also add ad unit IDs by environment. Prefer non-secret public config names; AdMob unit IDs are not passwords, but should still be centralized:

- `EXPO_PUBLIC_ADMOB_ANDROID_FEED_NATIVE_UNIT_ID`
- `EXPO_PUBLIC_ADMOB_ANDROID_POST_RESOLUTION_INTERSTITIAL_UNIT_ID`
- `EXPO_PUBLIC_ADMOB_IOS_FEED_NATIVE_UNIT_ID`
- `EXPO_PUBLIC_ADMOB_IOS_POST_RESOLUTION_INTERSTITIAL_UNIT_ID`

Use Google's test ad unit IDs in development.

## Backend / data gating

Current safe scaffold:

- `src/lib/monetization.ts` defines placement policies, session caps, consent gating, personalized/non-personalized decision, Pro ad-free behavior, and the Pro/free insight rule.
- UI insight gating lives in `src/components/marketView.ts` (`canSeeMarketStats`): open-market stats are visible to Pro users or users who have already placed a bet; resolved-market stats remain public.
- Tests live in `tests-ui/lib/monetization.test.ts` and `tests-ui/components/marketView.test.ts`.
- Rewarded ads require a future dedicated `rewardedAdsOptIn` action in addition to general ad consent; the rewarded placement remains disabled until the feature is deliberately designed.

Future backend work, if Chris approves a migration:

- Add `profiles.is_pro boolean default false` or a dedicated `subscriptions` table.
- Add privacy-minimal `ad_events` table only for aggregate analytics: event type, placement, timestamp, anonymous user id, session id hash; no ad creative data, no rumor text.
- Add `ad_consent` / `privacy_consents` table if consent must be server-mirrored across devices.
- Keep RLS strict; clients can insert their own aggregate events but not read the table.

## What Chris needs to set up outside code

1. Create/verify Google AdMob account.
2. Register Viddi Android app package. Current package is `com.anonymous.gossipapp`; decide before production whether to rename package or keep it.
3. Register iOS bundle later when iOS is targeted.
4. Create ad units:
   - Feed native / native advanced or banner fallback.
   - Post-resolution interstitial.
   - Rewarded optional unit, later only.
5. Connect payment profile / tax / bank in Google payments.
6. Update Privacy Policy / Terms before production ads.

## Ship/no-ship checklist

Ship ads only when all are true:

- Retention is good enough that ads will not mask product problems.
- Legal/privacy copy explicitly covers ads and third-party SDKs.
- Consent UX exists.
- Real AdMob app IDs and unit IDs are configured.
- Test ads render in dev build.
- Frequency caps verified.
- Pro ad-free logic verified.
- Ads are not shown on sensitive moments: onboarding, before voting, before payoff reveal, account deletion, contact/support, or moderation/report flows.
