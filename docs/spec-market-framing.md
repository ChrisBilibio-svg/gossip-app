# Spec — Market framing & variable resolution windows (Kalshi/Polymarket-style) + Grok discovery source

_Status: DESIGN (no code yet). Owner lane: backend (Hermes). UI-facing pieces are flagged as [handoff → UI]._
_Author: design pass 2026-07-29. Supersedes the hardcoded 7-day betting window._

## 0. Premise (read first)
Viddi's game is **betting on unreliable gossip**. Unreliable sourcing is a *feature*, not a bug — if a rumor turns out fake, that's the fun. So this spec is **not** about making gossip "true" or peer-reviewed.

The only real design constraint is: **a market must be *resolvable* and *timely***. Players need to eventually find out whether they were right (the payoff / leaderboard dopamine). A rumor that can never get an answer just VOIDs and nobody wins — a dead market. So the job of the pipeline is to dress a junk-tweet rumor as a **clean, time-boxed, checkable bet**, exactly the way Kalshi and Polymarket do.

References: Kalshi [Market Rules](https://help.kalshi.com/en/articles/13823822-market-rules); Polymarket [Resolution docs](https://docs.polymarket.com/concepts/resolution).

## 1. The 5-part market anatomy (copy this)
Every published market must carry all five. The **title is not the market — the rules are.**

1. **Binary question** — a concrete, checkable event. "Will [event] happen?" — never "Is [person] shady?"
2. **Written resolution criteria** — explicit text: *resolves TEA if [X], CAP if [Y], VOID if no credible verdict by [resolve-by]*. Includes edge cases.
3. **Named resolution source** — what will settle it: a credible outlet, an official confirmation, or a specific public event. (Discovery source ≠ resolution source — see §4.)
4. **Per-market timeframe** — set from the *event itself*, not a fixed window. Two timestamps (Kalshi-style):
   - `betting_closes_at` — trading/quotes lock.
   - `resolve_by_at` — latest determination; VOID if unresolved by then.
5. **Tie-breaker** — VOID (already implemented via `void_rumor()` / status `void`). Keep as-is.

## 2. Kill the hardcoded 7-day window (core change)
Today `publish_approved_market(...)` hardcodes `v_deadline := v_publish + interval '7 days'`. Replace with a **per-market** window.

**DB (new migration, next number = `0048`):**
- Add/confirm columns on `rumors`: keep `prediction_deadline` as `betting_closes_at` (betting/quote lock). Add `resolve_by_at timestamptz null` (determination deadline) if not already covered by the evidence resolve-by window.
- Change `publish_approved_market` to accept an explicit close timestamp (new param, e.g. `p_betting_closes_at timestamptz default null`) OR read a per-rumor value set at draft time. **Clamp** it to a safe range to prevent abuse/mistakes:
  - min close horizon: **6 hours** from publish
  - max close horizon: **45 days** from publish
  - if null/out of range → fall back to a sane default (e.g. 7 days) rather than error.
- `resolve_by_at` = `betting_closes_at` + policy grace (evidence policy default; VOID if no verdict by then). Keep the existing hybrid/evidence/deadline policy semantics from migration `0028`.
- `request_fixed_prediction_quote` already raises `market is locked` when the deadline has passed — it works unchanged with a variable deadline. Verify with a test.

**Pipeline (`scripts/`):**
- `ingest.mjs` / `draft-candidates` / `auto-curate.mjs`: the AI draft must output a **suggested timeframe** per rumor ("this should settle within ~N days because [event]") plus the resolution-criteria text. Store both.
- `screen.mjs`: strengthen `objective_resolution_rule` — **reject** rumors with no plausible resolve-by horizon or no checkable outcome ("is a bad person", open-ended feuds). This is the resolvability gate, not an accuracy gate.

**[handoff → UI]:** the card + detail screens should display the resolution-criteria text and the per-market close/resolve-by dates (Polymarket shows these prominently). Backend adds a BACKLOG `[handoff]` item; UI lane (Claude) implements the display.

## 3. Resolution-criteria text (per market)
The drafting model must generate and store a short rule string, shown to users, e.g.:
> "Resolves **TEA** if a credible Brazilian outlet or official statement confirms [event] by [resolve_by]. Resolves **CAP** if credibly denied or it does not occur by then. **VOID** (stake returned, no score impact) if no credible verdict lands."

Store on the rumor; surface in the market detail.

## 4. Grok as an added discovery source (not the only egg)
Add Grok/xAI **Live Search** as **one** discovery source among several — RSS/news feeds stay as the source of record. Grok is additive resilience, never a single point of failure.

- **Off by default**, env-gated behind `XAI_API_KEY` (same pattern as `X_BEARER_TOKEN` today). If the key is absent, the source is skipped — no behavior change.
- **Self-selecting**: give Grok a standing brief so it decides *what* to look for daily (no per-run hand-prompting). Example brief: _"Find emerging Brazilian celebrity/novela/influencer rumors gaining traction on X in the last 24–48h that could plausibly be settled within a few weeks. Return each as {claim, why_timely, expected_resolution_window, x_post_url}."_
- **Discovery only** — Grok output seeds **curator-review drafts**; it is *never* a resolution source and cannot resolve TEA/CAP. (Same rule X/social already follow.)
- **Citations required**: capture the actual X post URL as `source_url` so drafts stay auditable; drop items with no permalink (consistent with the existing "no opaque links" rule).
- **Cost guard**: cap Grok Live Search calls per run (e.g. `XAI_MAX_SEARCHES_PER_RUN`, default small) so the bill can't run away. Realistic cost at once-daily is ~$2–5/mo.

## 5. Guardrails that stay (legal safety, not accuracy)
Keep the screening that blocks a **real named person + a serious accusation** (crime, etc.). This is not about reliability — it's to keep Viddi out of a defamation/LGPD problem in Brazil, and it ties to the pending NDA/IP/legal review on the launch roadmap. Auto-publish of these categories stays behind the existing kill switch + daily cap. Everything else — flaky, wrong, "haha it was cap all along" — is the game; leave it.

## 6. Non-goals / constraints
- No change to the coin-economy math or fixed-odds quote flow beyond honoring the variable deadline.
- VOID remains the only tie-breaker.
- **Migrations are applied by Chris by hand** — Hermes drafts `0048` but must NOT apply it; STOP and hand it over.
- Backward compatible: existing open markets keep working; default fallback = current 7-day behavior.

## 7. Acceptance / tests
- Unit: deadline clamp (min 6h / max 45d / null-fallback); `request_fixed_prediction_quote` locks exactly at `betting_closes_at`.
- Unit: `screen.mjs` rejects non-resolvable claims; accepts checkable ones with a horizon.
- Unit: Grok source parses `{claim, x_post_url, window}`, skips items without a permalink, respects the per-run cap, and is fully skipped when `XAI_API_KEY` is unset.
- `node ./node_modules/typescript/bin/tsc --noEmit` clean; `node --test tests/*.test.mjs` green. Never commit red.
