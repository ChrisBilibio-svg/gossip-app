# ADR: Prediction Exchange v2 (coin-only)

Status: code-ready design note, human/legal/platform approval required before production enablement.

## Scope

Viddi v2 prediction markets use a PostgreSQL-centered modular monolith. Users acquire and trade `VERDADE`/`MENTIRA` binary shares using Viddi coins only. Coins have no cash value and cannot be deposited, withdrawn, transferred as money, redeemed, converted to crypto, or used for real-world prizes.

Legacy fixed-odds positions remain engine-routed and are not reinterpreted as v2 shares.

## Precision

- Server authority uses PostgreSQL `numeric` with explicit scale:
  - prices/probabilities: `numeric(18,8)`, constrained to `[0, 1]` and fixed tick increments;
  - share quantity: `numeric(24,6)`, constrained to fixed quantity step;
  - coin ledger amounts: `numeric(24,6)` for v2 reservations/settlements, while legacy wallet integer coin flows remain unchanged.
- JavaScript may display parsed numbers but must not be the financial authority. RPC receipts are authoritative.

## Whole-coin wallet decision — Option 1 locked

M6 intentionally made the real `coin_wallets.balance` bridge fail closed on fractional COIN amounts because the legacy wallet balance is integer-backed. That prevents silent drift, but it conflicts with 0.01-tick prices when arbitrary quantities produce fractional notional (`quantity * price`).

Chris locked **Option 1: whole-coin lots** before M8. Rationale: preserve the integer wallet + legacy coin economy, keep accounting simple, and remain forward-compatible with any possible future loyalty/redemption model. Redemption, cash value, withdrawals, real prizes, or crypto conversion remain out of scope and require separate legal/product approval.

- Keep `coin_wallets.balance` integer and avoid fractional wallet schema support.
- Keep exchange prices on probability ticks for display and limit prices.
- Add per-market configurable `whole_coin_lot_size`, derived from `tick_size` by default so order quantities stay reasonably granular while every price tick and VOID payout can settle to a whole COIN amount.
- Constrain order sizes / complete-set lots so every real wallet debit/credit/release/settlement amount is a whole coin before 0056 sees it.
- Reject any v2 order path that would create fractional real-wallet COIN debits, credits, releases, or settlement payouts.
- If fractional support is ever reconsidered, STOP before drafting the schema change because it affects legacy wallet accounting, UI copy, receipts, and migration/backfill risk.

## Share payoff and settlement

- One winning v2 share settles for `1` Viddi coin unit.
- One losing v2 share settles for `0`.
- Neutral/VOID v2 settlement pays `0.5` per remaining YES/NO share.
- Legacy fixed-odds VOID remains its existing stake refund path.
- Maximum terminal payout is fully collateralized before any fill commits.

## Collateral and reservations

- Buy orders reserve the maximum spend implied by limit price × remaining quantity plus fees.
- Sell orders are reduce-only by default and reserve shares, not coins.
- No short/oversold inventory is allowed in v2.
- Reservations are explicit, append-only auditable, and released on fill/cancel/expiry/rejection/settlement.

## Matching order

- CLOB price-time priority:
  - buy orders match the lowest ask at or below the buyer limit;
  - sell orders match the highest bid at or above the seller limit;
  - ties sort by resting order `created_at`, then id.
- One transaction-scoped advisory lock is taken per `(market_id, outcome)` before book inspection/mutation.
- Lock order is: market advisory lock → market row → wallet/position reservations → orders → fills/ledger.
- Self-trades are rejected/skipped; a user cannot match against their own resting order.

## P&L and cost basis

- Positions aggregate per `(user_id, market_id, outcome)`.
- Average entry and cost basis update on buys using weighted average of filled quantity and net cost.
- Sells reduce quantity using the aggregate average-entry basis and record realized P&L as net proceeds minus disposed cost basis.
- Unrealized P&L uses current mark value minus remaining cost basis.
- Fees are modeled but remain zero unless `FEES_ENABLED=true` is approved and documented.

## Mark-price rule

The headline/display probability is not necessarily executable.

Default mark priority:
1. mid-point of best bid/best ask when both exist;
2. last trade price when no two-sided book exists;
3. configured initial mark/probability;
4. neutral `0.5` fallback.

UI must label mark/display probability separately from best bid, best ask, estimated execution, requested limit, actual fill, and cash-out estimate.

## Cash-out / selling

Cash-out is a sell order against available bids, not a refund/cancellation. Required PT-BR disclosure:

> Venda sua posição enquanto o mercado estiver aberto, sujeita à liquidez.

Immediate/full execution is never guaranteed. Outcome depends on liquidity, spread, depth, slippage, market state, order type, and price protection.

## V2 VOID settlement

At v2 neutral/VOID resolution, remaining YES and NO share inventory settles at `0.5` coin per share. Open orders are cancelled and reservations released before/finally with settlement. Settlement is idempotent and append-only.

## Liquidity provider behavior

Community resting orders ship first. A designated/house liquidity provider remains disabled behind `MARKET_MAKER_ENABLED=false` and requires owner/legal/platform approval before activation. If enabled later, it must be fully collateralized, disclosed, bounded by per-market/global inventory/loss/spread/order-size limits, kill-switchable, and protected against self-trading/wash behavior. No unlimited buyback and no hidden AMM.

## Share creation bootstrap — Option A approved

DECISION LOCKED: Chris approved **Option A — minting / complete-set creation (approved direction)** as the genesis-liquidity path before M8.

M4 confirmed the engine-design gap: sellers must already own shares (no shorting), but current matching only pairs same-outcome buyer + seller, so a fresh market cannot bootstrap its first trade by community orders alone.

Approved direction for the new `M-mint` milestone:

- Pair a VERDADE/TRUE buyer and a MENTIRA/FALSE buyer when their combined limit prices cross and collateralize exactly one complete set.
- Reserve exactly `1` coin per complete set, with strict tick, quantity-step, rounding, whole-coin-notional, and no-fractional-wallet-drift checks.
- Mint one TRUE share and one FALSE share, crediting each buyer their side through idempotent ledger entries and auditable fill/mint events.
- Preserve the settlement invariant: exactly one side pays `1` coin at TEA/CAP resolution; VOID pays `0.5` to both sides.
- Integrate with the existing matching engine as the genesis-liquidity path before the development end-to-end test.

M-mint must land before M8 as its own draft migration after M7. It should not enable production trading, should not touch legacy fixed-odds, and should include explicit rejection paths for fractional-wallet drift.

Rejected/deferred alternative: **Option B — market-maker share seeding** remains available only as a later owner/legal/platform-approved liquidity-provider mode behind `market_maker_enabled`; it is not the bootstrap direction.

## Risk and market controls

M7 adds server-side risk guardrails before the end-to-end test:

- per-environment limits for open orders, order rate, per-user/per-market gross notional, order notional, and per-outcome position quantity;
- append-only `exchange_risk_events` for allowed/blocked risk decisions and pause/resume actions;
- curator/service-gated `pause_exchange_market_v2` and `resume_exchange_market_v2` controls that move markets `open ↔ paused` without enabling production trading.

Risk limits are guardrails, not pricing/product promises; they do not imply production approval.

## Feature gates

Server-side gates fail closed:

- `TRADING_ENABLED`
- `SELLING_ENABLED`
- `MARKET_MAKER_ENABLED`
- `FEES_ENABLED`
- explicit production approval

UI hiding is convenience only; RPCs and jobs must enforce gates.
