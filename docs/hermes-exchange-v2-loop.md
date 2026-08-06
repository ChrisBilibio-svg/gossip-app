# Hermes loop — Prediction Exchange v2 (build + polish)

_Backend lane (Hermes). Standing loop prompt: keep advancing v2 from the `0050` foundation to a
test-ready CLOB exchange, then polish. Trading stays OFF in production the entire time._

## Where we are
- `0050`–`0060` are **applied**. DB is at `0060`: exchange v2 now has lifecycle, collateral/reservations, matching, positions/P&L, settlement payout, real coin-wallet bridge, risk/limits, whole-coin lots, complete-set minting, and enum-cast hardening while production trading remains disabled.
- M8 live development test remains blocked until `0063_exchange_v2_m8_settlement_state_enum_cast.sql` is reviewed/applied by the human Supabase path.
- M10 LMSR house AMM is **drafted / handoff** in `0065_exchange_v2_lmsr_house_amm.sql`: volume-adaptive liquidity-sensitive LMSR with `b0=2000`, `alpha=0.05`, crowd-TEA opening seeding, AMM quote/execute RPCs beside the CLOB, capped house mint accounting, and a skipped-by-default live e2e. It is not applied by Hermes.
- Whole-coin vs fractional is decided: keep integer `coin_wallets.balance`, preserve no-schema-change wallet safety, and constrain M-mint/trading notional to whole coins. Any future fractional-wallet or redemption/real-value work is out of scope and must STOP for legal/product approval.
- Feature gates default OFF; `exchange_gate_allows()` fails closed. ADR: `docs/exchange-v2-adr.md`.
- Legacy fixed-odds betting is a separate engine (`engine_version='legacy_fixed_odds'`) and must keep working.

## HARD GUARDRAILS (never violate)
1. **Never enable production trading.** `exchange_feature_gates.production_approved` stays `false` and
   `trading_enabled` for `production` stays `false`. You may enable **development**-env gates only, inside
   tests, to exercise the engine. Never write to the `production` gate row.
2. **Coins are closed-loop, no cash value.** No deposit/withdraw/transfer/redeem/crypto/real prizes. Ever.
3. **Do not break legacy.** Never reinterpret legacy fixed-odds positions as v2 shares. v2 lives only in
   `exchange_*` tables and `*_v2`/`*_v1` RPCs.
4. **Draft migrations, do NOT apply them.** Chris applies migrations by hand. Number them `0051`, `0052`, …
   in order. When a migration is ready, mark its BACKLOG item `[handoff: human — apply 00NN]` and STOP
   depending on it until it's applied (Claude applies + verifies, then the loop resumes).
5. **Pull + reconcile first, every iteration.** `git pull --rebase`, then check your change against the
   latest applied migrations (0048–0056) so you don't reference a dropped/renamed object (this already bit
   0049, which referenced the 6-arg `publish_approved_market` that 0048 removed).
6. **Never commit red.** `node ./node_modules/typescript/bin/tsc --noEmit` and `node --test tests/*.test.mjs`
   must pass. Small commits, `Co-Authored-By` trailer, check the item off in `BACKLOG.md`.
7. **UI is not your lane.** Order-entry / order-book / portfolio / cash-out screens are the UI agent's
   (Claude's) job — leave them as `[handoff → UI]` items in `BACKLOG.md`; don't edit `src/screens/**` or
   `src/components/**` beyond shared `src/lib/**` contracts.

## Roadmap (ordered — seed these into BACKLOG.md and work top-down)
Each milestone = one migration (0051+) drafted + its `src/lib` contract + tests. Keep each small.

- **M1 — Market lifecycle (0051):** RPC to promote a rumor into an `exchange_v2` market and move it
  `draft → open → closed`; set `tick_size`, `quantity_step`, `close_at`, `resolve_by_at`, opening `mark_price`.
  Curator/service-gated. Tests for state transitions + tick/step config.
- **M2 — Collateral & reservations (0052):** on `place_order_v2`, reserve coins for buys / shares for sells
  into `exchange_reservations` + `exchange_wallet_ledger` (idempotent); release on cancel/expire/reject.
  Enforce no oversell / no negative balance. Reduce-only sells reserve shares, not coins.
- **M3 — Matching engine (0053):** CLOB price-time priority in `place_order_v2` — match against resting
  opposing orders, write `exchange_fills`, update `filled/remaining/status`, handle partial fills and
  `GTC/GTD/IOC/FOK`, reject self-trades, respect the advisory-lock order in the ADR
  (market lock → market row → reservations → orders → fills/ledger). This is the core piece.
- **M4 — Positions & P&L (0054):** on each fill update maker+taker `exchange_positions` (quantity, weighted
  `average_entry_price`, `cost_basis`); on sells record `realized_pnl` = proceeds − disposed basis.
- **M5 — Settlement payout (0055):** extend `resolve_market_v2` to actually pay out — winning shares → coins
  via the ledger (1 / 0 / 0.5-VOID), release remaining reservations, mark positions settled. Idempotent.
- **M6 — Coin wallet integration (0056):** connect `exchange_wallet_ledger` COIN flows to the real coin
  balance so v2 reserve/spend/credit debits/credits the actual wallet, without touching legacy integer
  flows. Reconcile against the `0043/0044` coin economy.
- **M7 — Risk & limits (0057):** per-user position/exposure caps, order rate limits, `exchange_risk_events`
  logging, market pause/resume. Curator/service gated; production trading stays disabled.
- **M-whole-coin — Whole-coin guardrails (0058):** applied. Chris locked Option 1. Add per-market configurable `whole_coin_lot_size` derived from `tick_size`, reject any order whose limit notional or VOID payout would create fractional COIN movement, and add a final `exchange_wallet_ledger` whole-COIN CHECK before M8.
- **M-mint — Complete-set minting genesis liquidity (0059):** applied. Approved Option A. When a VERDADE/TRUE buyer and a MENTIRA/FALSE buyer cross such that their combined prices collateralize one complete set, reserve exactly `1` whole coin per complete-set lot, mint one TRUE share and one FALSE share, credit each buyer their side, enforce strict tick/rounding/whole-coin-lot/no-fractional-wallet-drift rules, write audit events + idempotent ledger entries, integrate with the existing matching engine, and preserve the invariant that exactly one side pays `1` at settlement.
- **M8 — Dev-env end-to-end test:** drafted but blocked on human apply of `0063_exchange_v2_m8_settlement_state_enum_cast.sql`. The test enables only the **development** gate and drives open → quote → buy → complete-set mint/match → position → same-outcome cash-out/sell → TEA settlement + VOID settlement, proving whole-coin conservation and asserting production stays false. First live run on DB-at-`0059` hit order-status enum-cast text literals; `0060` is applied. Second live run on DB-at-`0060` reached cash-out and hit the `exchange_positions` reserved-sell CHECK; `0061` keeps seller quantity/reserved decrement atomic, and `0062` removes the duplicate decrement from 0053's reservation helper. Chris confirmed `0061`/`0062` are applied. The latest live run reached settlement and hit a remaining `resolve_market_v2` market-state enum cast; `0063` recreates only that function with explicit `exchange_market_state` casts for `resolved`/`voided`.
- **M9 — Polish (backend):** in progress. First slice adds stable PT-BR `ExchangeClientErrorCode`/`normalizeExchangeV2Error()` mapping in `src/lib/exchangeV2.ts` so quote expiry, closed/paused markets, insufficient coins/shares, whole-coin lot failures, risk blocks, and duplicate/idempotent submits do not leak raw SQL text to clients. Second slice adds client-order idempotency helpers: `buildExchangeClientOrderId()` creates bounded safe-character IDs that satisfy the DB `client_order_id` constraint, `isValidExchangeClientOrderId()` guards invalid IDs before RPC calls, and `isDuplicateExchangeOrderResult()` gives UI a typed duplicate-submit branch. Third backend-polish slice adds `getTradeReceiptByClientOrderIdV1()` so duplicate submits can recover the authoritative receipt instead of blind resubmits. Fourth backend-polish slice adds `placeOrderWithReceiptV1()` so a UI trade sheet can submit, show the success receipt, or recover the duplicate-id receipt through one client-safe helper. Fifth backend-polish slice adds `validatePlaceOrderV2Input()` and decimal/UUID preflight checks so malformed quantities, prices, GTD expirations, quotes, and client-order IDs return stable PT-BR errors before order RPC submission. Remaining work: apply `0063`, rerun M8 live, then check off M8/M9.
- **M10 — LMSR house AMM liquidity seed (0065):** drafted / handoff. Adds a volume-adaptive liquidity-sensitive LMSR house AMM (`b(q)=b0+alpha*(q_yes+q_no)`, defaults `b0=2000`, `alpha=0.05`) that opens markets at the crowd TEA mark, provides `quote_amm_v2`/`execute_amm_trade_v2` for casual market orders, keeps `place_order_v2` as the CLOB limit-order path, rounds whole coins in the house's favor, tracks capped house mint/accounting separately, and leaves settlement, production gates, and legacy fixed odds unchanged. Claude/live-schema review must apply `0065`; Hermes must not apply it.

Handoffs to leave in BACKLOG for the UI lane (Claude): trading UI, order-book view, positions/portfolio
screen, cash-out flow + disclosures, and surfacing mark price vs best bid/ask distinctly.

## The loop (repeat until the roadmap is done or you hit a STOP)
1. `git pull --rebase` and reconcile against migrations 0048–0056 (and any newly applied ones).
2. Pick the top unchecked v2 item in your lane in `BACKLOG.md` (skip `[handoff: …]` / `[blocked]`).
3. Implement it small: migration (drafted only) + `src/lib` contract + tests.
4. `tsc --noEmit` + `node --test tests/*.test.mjs` green. Never commit red.
5. Commit + push (`Co-Authored-By`), check the item off in `BACKLOG.md`.
6. If the item produced a migration, mark it `[handoff: human — apply 00NN]` and do not build on it until applied.
7. STOP and ask Chris before: applying any migration, enabling any production gate, or any legal/product/pricing
   decision. Otherwise, go back to step 1.

## Definition of done (this milestone)
A coin-only CLOB exchange that, with the **development** gate on, can open a market, take orders, match them,
track positions/P&L, allow cash-out, and settle payouts — fully tested — while **production trading remains
off and unapproved**, legacy betting untouched, and all migrations drafted and handed off cleanly.
