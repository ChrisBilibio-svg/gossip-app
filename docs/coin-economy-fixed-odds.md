# Coin economy + fixed-odds operations

Status: code-ready, feature-flagged OFF by default. Do not activate before platform age-rating review and Brazil-specific legal review.

## Product boundaries

- Coins are closed-loop entertainment currency only.
- Coins have no cash value.
- Coins cannot be withdrawn, redeemed, transferred, sold, traded, converted to crypto, or used for real-world prizes.
- No loot boxes, gacha, jackpots, randomized paid rewards, peer-to-peer betting, or post-loss buy-more prompts.
- Purchased coin balance must never be used as the primary leaderboard skill metric.

## Migration

Apply manually only after review:

```sql
supabase/migrations/0043_coin_economy_fixed_odds.sql
supabase/migrations/0044_coin_trading_quotes.sql
```

Safe rollout sequence:

1. Apply migration.
2. Keep `economy_configs.is_active=false` and all kill switches `true`.
3. Configure Apple/Google products and provider secrets in server/webhook infrastructure.
4. Run dry-run reconciliation job.
5. Approve legal/product copy in Portuguese and store review screenshots.
6. Flip `is_active=true` only for internal testers.
7. Disable individual kill switches one at a time.

Emergency disable:

```sql
update economy_configs
set purchases_killed = true,
    subscription_grants_killed = true,
    recovery_grants_killed = true,
    prediction_placement_killed = true,
    prediction_settlement_killed = true,
    is_active = false
where version = 1;
```

## Economy config v1

- Starter grant: 2,000 coins once.
- Free recovery floor: refill to 500 only when below 500.
- Pro: 300 upfront + 40/day × 30 days = 1,500 scheduled coins.
- Pro daily order: recovery to 1,000 first, then +40.
- Standard stake: 100.
- Quick stakes: 50, 100, 250.
- Recommended stake: floor(balance × 0.05).
- Hard max stake: min(500, floor(balance × 0.10)).
- House edge: 0.05.
- Probability bounds: 0.10–0.90.
- Store odds: 4 decimals; display odds: 2 decimals.

## Coin Store catalog

Visible entry point: persistent top-right `Coin Store` control on main screens showing a store icon and current balance.

Products that must use Apple/Google localized prices before checkout:

- 125 coins — localized equivalent of US $0.99.
- 750 coins — localized equivalent of US $4.99.
- 1,650 coins — localized equivalent of US $9.99.
- Pro — localized equivalent of US $4.99/month.
- Pro grant schedule: 300 coins immediately + 40 coins daily for 30 service days = 1,500 scheduled coins total.

One-time coin packs are available to both free and Pro users. Pro is not required to trade.

## Wallet ledger

All mutations go through `apply_wallet_transaction(...)` and are:

- server-controlled
- atomic
- idempotent by `idempotency_key`
- protected from negative balances
- append-only in `wallet_transactions`
- tied to `economy_config_version`
- traceable through `source_reference` and metadata

Client UI reads `get_coin_economy_state()` and `get_wallet_history()` only.

## Purchase verification

The app must never grant coins from client purchase success alone.

Production purchase flow:

1. Client asks Apple/Google/existing billing provider for localized product metadata.
2. Checkout UI displays provider-localized recurring/pack price.
3. Client sends receipt/transaction reference to a server endpoint or waits for webhook.
4. Server verifies receipt with the provider.
5. Server stores only non-sensitive payment metadata and a payload hash.
6. Server calls `service_record_verified_purchase(...)` with service-role credentials.
7. Replay uses `(provider, provider_transaction_id)` uniqueness and transaction idempotency keys.

Events supported in code-ready service hooks:

- purchase
- renewal
- billing retry / grace period metadata
- cancellation
- expiration
- refund / revocation
- restoration

Provider-specific webhook signature verification is intentionally not faked in the client repo; it must live in server/edge infrastructure with Apple/Google credentials.

## Grant reconciliation

Workflow: `.github/workflows/reconcile-coin-grants.yml`

Script: `scripts/reconcile-coin-grants.mjs`

Defaults are safe:

- `COIN_GRANT_LIVE=false` prints a dry-run message only.
- Live mode requires Supabase service-role secrets and calls `apply_due_economy_grants(p_limit)`.

The scheduler reconciles missed service days; idempotency keys prevent double grants.

## Fixed-odds markets

Operators or approved data sources must authorize a probability version before a fixed-odds market can be used. AI probabilities are drafts only and cannot publish odds or mutate balances.

Odds formula:

```text
fairOdds = 1 / p
offeredOdds = (1 - houseEdge) / p
potentialTotalReturn = floor(stake * lockedOdds)
potentialNetWin = potentialTotalReturn - stake
```

Required examples:

- 50%: 1.9000x, stake 100 → 190 total / 90 net.
- 25%: 3.8000x, stake 100 → 380 total / 280 net.
- 10%: 9.5000x, stake 100 → 950 total / 850 net.

Current odds are public before trading. Do not hide odds from free users. Before placement, the UI says `Current Odds` / `Live Odds`; after execution positions say `Your Locked Odds`.

Quote-backed placement uses `request_fixed_prediction_quote(...)` and `place_fixed_prediction(..., p_quote_id)`:

1. validate open market and lock time
2. issue a 45-second server quote containing quote id, probability version, odds, and expiry
3. revalidate quote id, expiry, outcome, probability version, probability, and odds at confirmation
4. reject changed/expired quotes and require the user to confirm the new return
5. validate stake, wallet balance, and bankroll hard max
6. snapshot locked probability, locked odds, config version, potential return
7. deduct stake in ledger
8. create fixed position
9. commit once with idempotency

Free Yes/No voting is retired in the prediction UI. Every Yes/No prediction must go through the trading sheet with a positive whole-number coin stake.

Settlement is service-only via `settle_fixed_prediction_market(...)`:

- WON: credit `floor(stake * lockedOdds)`
- LOST: credit zero
- VOID: refund original stake
- Replay does not pay twice because only `OPEN` rows are processed and credit keys are position-scoped.

## Analytics

Economy code logs only non-sensitive analytics properties:

- `wallet_transaction_created`
- `recovery_floor_applied`
- `pro_entitlement_started`
- `pro_daily_grant_applied`
- `pro_grant_reconciled`
- `purchase_verified`
- `purchase_restored`
- `market_probability_versioned`
- `prediction_placed`
- `prediction_settled`
- `prediction_voided`
- `subscription_started`
- `subscription_refunded`

Do not log receipts, card data, raw payment tokens, or provider secrets.

Operational dashboards should calculate coins granted by source, recovery injections, total handle, payouts, hold, sinks, median/P90 balances, conversion, refunds, renewals, pack cannibalization, purchases after losses, meaningful resolved predictions, and reward-only sessions.
