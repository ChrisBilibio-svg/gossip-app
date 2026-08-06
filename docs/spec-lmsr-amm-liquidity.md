# Spec — LMSR House AMM (liquidity seed for Exchange v2)

Status: DRAFT for Hermes (backend lane). Author: Claude (UI lane) as product/architecture handoff.
Depends on: exchange v2 engine (migrations 0050–0063). Next exchange migration = **0065**
(0064 is the unrelated editorial-images feature).

**Product decisions locked (Chris, 2026-08-05):**
1. Liquidity = **volume-adaptive** (liquidity-sensitive LMSR, with a base floor so new markets seed).
2. Casual path = **AMM + CLOB coexist** (casual trades hit the AMM; limit orders still rest in the book).
3. Opening price = **seeded from crowd odds** (open at the market's current TEA%, not flat 50/50).

---

## 1. Goal & non-goals

**Goal.** Give every `exchange_v2` market an always-available, two-sided price by making a
**house LMSR automated market maker** the permanent counterparty. A casual user can buy or sell
Verdade/Mentira at any time without waiting for another human — solving the empty-book problem
(observed live on the BTS market: taps return "sem liquidez suficiente"). This is the concrete
enabler for the single-model "trading replaces legacy" direction.

**Non-goals (hard guardrails — do not change):**
- Do **not** enable production trading. `exchange_feature_gates.trading_enabled` /
  `production_approved` stay **false**; the AMM is active only in dev/preview until legal clears.
- Do **not** give coins cash value. AMM mint is house-internal play money, closed-loop, **capped
  per market**.
- Do **not** touch or degrade legacy fixed-odds betting.
- Do **not** remove the CLOB or settlement — the AMM is an additive pricing/counterparty layer.

---

## 2. Core model — liquidity-sensitive (volume-adaptive) LMSR

LMSR maintains, per market, the shares the **house has net sold**: `q_yes`, `q_no` (in shares).
Instead of a fixed liquidity constant, `b` is a **function of outstanding volume** so markets
deepen automatically as they get more active (Othman–Sandholm liquidity-sensitive LMSR):

```
b(q) = b0 + alpha * (q_yes + q_no)
```

- `b0` — **base floor** (coins). Guarantees a brand-new market (q=0) still has a finite, live
  price; without it the pure form is degenerate at zero volume. This is the seed.
- `alpha` — the **adaptivity dial** (dimensionless, e.g. ~0.03–0.07). Higher = deepens faster with
  volume + larger overround; lower = stays thin longer + smaller overround.

Cost and price use the *current* `b(q)`:
- **Cost function:** `C(q) = b(q) * ln( exp(q_yes/b(q)) + exp(q_no/b(q)) )`
- **Instantaneous price:** `price_yes = exp(q_yes/b(q)) / (exp(q_yes/b(q)) + exp(q_no/b(q)))`
- **Cost to buy Δ shares:** `C(q_after) - C(q_before)` (buys ≥ 0; sells return curve value).

> **IMPORTANT — reference the source.** The exact liquidity-sensitive equations (and the precise
> overround / bounded-loss expressions) come from Othman, Pennock, Reeves, Sandholm,
> *"A Practical Liquidity-Sensitive Automated Market Maker."* Hermes should implement from that
> paper's equations, not from an approximation, so the invariants below hold exactly.

### Property changes vs fixed-b LMSR (by design)
- **Prices sum to > 1.** The overround (roughly `1 + alpha*n*ln(n)`; for binary ≈ `1 + 1.386*alpha`)
  is the spread that funds the auto-deepening and makes the house break-even-to-positive rather than
  always subsidizing. **UI must normalize** displayed probabilities (`price_i / Σ price`) so users
  still see "38% / 62%".
- **Loss/inflation bound differs** from the simple `b*ln2`; it is bounded and knowable per the paper,
  and the overround makes it *tighter*. Store the computed per-market max house mint at open.

### Numeric stability (REQUIRED)
`exp(q/b)` overflows when `q ≫ b`. Implement with log-sum-exp: let `a=q_yes/b(q)`, `c=q_no/b(q)`,
`m=max(a,c)`; then `C = b(q)*(m + ln(exp(a-m)+exp(c-m)))` and
`price_yes = exp(a-m)/(exp(a-m)+exp(c-m))`. Use `numeric` throughout; clamp normalized prices to
`[tick, 1-tick]` on output.

### Opening price seeding (from crowd odds)
Open each market at the curator-provided opening mark `p` = the market's current crowd TEA%
(the BTS market opens at 0.38, not 0.50). With the base floor `b0`, initialize `q_no = 0`,
`q_yes = b0 * ln( p / (1-p) )`, then store `q_yes`, `q_no`.

---

## 3. Integration with the existing engine

**AMM + CLOB coexist** (locked). AMM is the guaranteed liquidity floor; the CLOB is retained for
limit orders.

- **Quote:** `quote_amm_v2(market_id, outcome, action, quantity)` → unit price, total coin cost
  (rounded per §4), price impact, resulting normalized `price_yes`, and a short-TTL quote row
  (reuse `exchange_order_quotes` shape + expiry so the client's countdown just works).
- **Execute:** casual market orders route to `execute_amm_trade_v2(...)`: recompute cost from
  current `q_*` under the existing book_version guard, move `q_yes`/`q_no`, mint the user's shares
  (reuse complete-set minting from 0059 where possible), debit/credit the user coin wallet via the
  wallet bridge (0056), update the user `exchange_positions`.
- **CLOB coexists:** resting limit orders still match each other via `place_order_v2`; casual buys
  hit the AMM. (Later: post the AMM as a virtual resting order so both share one path — out of scope
  for v1.)
- **Settlement unchanged:** `resolve_market_v2` (0055) pays every position, including the house's
  residual. House realized coin P&L over the market's life must be ≥ the paper's loss bound (i.e.
  never mint beyond the stored cap).

---

## 4. Coin accounting & whole-coin reconciliation

Coins are whole-lot only (0058). LMSR cost is fractional, so:
- **Round every user-facing amount in the house's favor:** buys round coin cost **up**, sells round
  proceeds **down**, to the market's whole-coin lot. Users never extract beyond the bounded mint.
- Track a **house ledger scope** (reserved `house_account_id` system principal) so AMM mint/burn is
  auditable and separate from users.
- **Invariant (enforce in the e2e test):** for each market, cumulative house net mint ≤ the stored
  per-market cap + total user collateral in. The overround should make the realized house position
  ≥ break-even in most flows.

---

## 5. Data model additions (Hermes, in 0065)

`exchange_markets` (add columns):
- `amm_enabled boolean not null default false`
- `amm_b0 numeric` (base floor, coins; null when AMM off)
- `amm_alpha numeric` (adaptivity dial; null when AMM off)
- `amm_max_house_mint_coins numeric` (per-market cap, computed at open)
- `amm_q_yes numeric not null default 0`, `amm_q_no numeric not null default 0`

Plus: a reserved house account principal for AMM inventory/positions/ledger; new RPCs
`quote_amm_v2`, `execute_amm_trade_v2`; and an `open`-flow extension that accepts `b0`, `alpha`, and
opening mark, then initializes `amm_q_*`. All AMM inventory ops are `service_role`/system-only;
users only touch quote/execute (which internally act as the house).

---

## 6. Parameter policy — volume-adaptive (locked)

**v1 defaults (validated numerically against a market opened at 38%):**
`b0 = 2000`, `alpha = 0.05`. At these settings: a ~100-coin Verdade bet moves the price ~+2.6 pts
(50→+1.3, 250→+6.3, 500→+11.9, 1000→+21.1), overround ≈ 6.6%, and worst-case house mint ≈ 2000
coins/market (extreme one-sided flow pushed to 98%). Slippage on avg cost/share runs 42¢→52¢ as a
single order scales 100→1000 coins.

- **`b0` (base floor) = jumpiness dial.** Lower = livelier/noisier (b0=1000 → a 100-coin bet moves
  ~+5.1 pts); higher = calmer/deeper (b0=3000 → ~+1.8 pts but mints up to ~3k). Raise it as typical
  bet sizes grow.
- **`alpha` (adaptivity) = house-margin dial.** 0.05 ≈ 6.6% overround; 0.03 ≈ 4.0% (thinner margin,
  slightly jumpier). Higher deepens faster + widens spread; lower keeps markets thin longer.
- Both are per-market columns so we can adapt by category/volume once we see data. v1 sets the same
  `b0=2000`/`alpha=0.05` for all markets while keeping them configurable.
- The market deepens on its own as `q_yes+q_no` grows — no manual re-tuning needed mid-market.

---

## 7. Rollout & test (dev-gated, mirror the M8 live test)

Add a `maybeTest` e2e that, with the production gate **false** throughout:
1. Opens a market with `b0`, `alpha`, opening mark; asserts normalized `price_yes` == opening mark
   (±tick) and raw prices sum to ≈ `1 + 1.386*alpha`.
2. Buys Verdade against the AMM; asserts normalized price rises, paid coins == rounded
   `C(after)-C(before)` under the current `b(q)`.
3. Sells back; asserts price falls and proceeds rounded in the house's favor.
4. Drives heavy volume; asserts `b(q)` grows, the market visibly deepens (same-size bet moves price
   less than at open), and house net mint never exceeds `amm_max_house_mint_coins`.
5. Resolves; asserts settlement conserves, house realized position ≥ the loss bound, whole-coin
   invariants hold, and the production gate stayed false the entire time.

---

## 8. Resolved decisions (was §8 open questions)

1. Liquidity dial → **volume-adaptive** liquidity-sensitive LMSR with base floor `b0` + `alpha`.
2. Casual path → **AMM + CLOB coexist**.
3. Opening price → **seed from crowd TEA%**.

Remaining tuning (post-v1, after real trades): exact `b0`/`alpha` per category; whether to later
unify the AMM into the CLOB as a virtual resting order.
