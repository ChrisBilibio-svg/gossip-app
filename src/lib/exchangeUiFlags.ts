/**
 * Build-time flag for the exchange v2 trading UI (Claude/UI lane).
 *
 * The casual buy & cash-out surfaces are scaffolded ahead of the legal/platform
 * approval that gates production trading, so the real-market entry point must
 * ship *nothing* to production by default. This flag decides only whether the
 * UI is MOUNTED — it is never a trading authorization. Even when it is on,
 * `place_order_v2` stays server-gated (`exchange_unavailable` / "em breve")
 * until the backend `exchange_feature_gates` are flipped, which is a separate,
 * lawyer-gated decision.
 *
 * - Dev builds (`__DEV__`): on, so we can exercise the surfaces locally.
 * - Preview/QA builds: opt in with `EXPO_PUBLIC_EXCHANGE_V2_UI=1`.
 * - Production builds: off unless that env var is explicitly set at build time.
 *
 * This is a NEW UI-lane module; it does not touch the backend/client contract
 * in `exchangeV2.ts` or any of Hermes's lib/migrations.
 */
export const exchangeV2UiEnabled: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_EXCHANGE_V2_UI === '1';

/**
 * The environment tag sent with orders/quotes from real-market surfaces. Dev
 * builds tag `development` so a dev-only gate could exercise the flow; every
 * other build tags `production`, which the server gate keeps closed.
 */
export function resolveExchangeEnvironment(): 'development' | 'production' {
  return __DEV__ ? 'development' : 'production';
}
