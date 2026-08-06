# Spec — Automating the Admin Approval Page

Status: **plan only, nothing built here.** Written for the next work session.

## Goal

Move the admin flow from "a human clicks approve on every draft" to "the pipeline
auto-publishes markets that pass every safety + quality check, and a human only
handles exceptions and oversight." We are **not removing the admin page** — we
repurpose it from a data-entry queue into a **monitor + exception + audit
dashboard**.

Guiding principle: **auto-publish only what is unambiguously safe and resolvable;
route everything uncertain to a human; keep an instant kill switch and a full
audit trail.**

## What already exists (so this is mostly wiring, not new building)

On the `feat/fresh-market-approval-pipeline` branch (not yet merged to `main`):
- `scripts/screen.mjs` — deterministic safety + market-suitability screening
  (minors, doxxing, sensitive-claim corroboration, future-event requirement,
  objective resolvability, duplicates, stale, expired-on-publish, opinion/politics/
  service-journalism exclusions). Returns approve_candidate | needs_review | reject.
- `scripts/draft-candidates.mjs` — AI-drafts headlines into binary questions,
  then **re-screens the drafted question** and marks it insertable only if it
  passes every check.
- Migrations `0045–0047` (already applied to the live DB):
  - `market_approval_audit` (immutable), `rumors` lifecycle columns.
  - `record_market_decision` (approve/schedule/reject/request_changes).
  - `publish_approved_market` — atomic: auth → lock → deadline = publish+7d →
    fixed Verdade/Mentira odds summing to 1 → audit → publish, all-or-nothing.
  - `publish_due_scheduled_markets` — **service-role scheduler that already
    auto-publishes** due items using the same atomic RPC.
- `gossip-admin/admin.html` — wired to the RPCs (no service key in client).

So the auto-publish machinery is built. Automation = feeding it from screening
on a schedule, with guardrails.

## Target automated flow

```
RSS/news → AI draft → screen.mjs (re-screen drafted question)
   ├─ approve_candidate + passes guardrails → AUTO-PUBLISH via publish_approved_market
   ├─ needs_review                          → stays a DRAFT in the human queue
   └─ reject                                → quarantined (logged, not shown)
```

## Safety guardrails (must all hold before anything auto-publishes)

1. **approve-only** — only `approve_candidate` from the re-screen of the *drafted
   question* (never the raw headline; never needs_review).
2. **Kill switch** — a config flag (e.g. `economy_configs.auto_publish_killed`
   or a new `automation_config` row). Flip it → auto-publish stops instantly,
   human queue still works. Mirror the existing `purchases_killed` pattern.
3. **Daily cap** — max N auto-published markets per UTC day (start N=1–2).
4. **Duplicate/cluster guard** — skip if it matches an open market's event_key.
5. **Atomic init** — `publish_approved_market` already fails closed if fixed-odds
   init fails (draft stays unpublished).
6. **Category allowlist** — only auto-publish "safe" categories to start
   (e.g. Música, Novelas, Celebridades-entertainment); route Futebol/anything
   sensitive to human review.
7. **Probability default** — auto-set initial Verdade probability (start 0.50,
   clamped to economy bounds 0.10–0.90); revisit once we have data.
8. **Audit + reversibility** — every auto-publish writes `market_approval_audit`;
   admin can **pull/VOID** a bad one (refund bets).

## Components to build (next session)

- **A. `scripts/auto-curate.mjs`** — the automated pipeline: gather → AI draft →
  re-screen → for approve+guardrails call `publish_approved_market` (service_role);
  else insert as draft (needs_review). Dry-run mode that reports decisions with
  no writes. Idempotent (idempotency key per source URL/event).
- **B. Automation config** — kill switch + daily cap + category allowlist +
  default probability. New migration `0048_automation_config.sql` (additive).
- **C. Scheduler** — run auto-curate on a schedule. Reuse the GitHub Actions
  pattern (guarded like the others), OR pg_cron + an edge function. Also wire
  `publish_due_scheduled_markets` to a cron so scheduled items publish on time.
- **D. Admin dashboard changes** — sections for: auto-published today (with
  Pull/VOID), the needs_review queue (unchanged), the immutable audit trail, and
  an **auto-publish ON/OFF toggle** + cap display.
- **E. Merge prerequisite** — merge `feat/fresh-market-approval-pipeline` to
  `main` first, so scheduled ingest/auto-curate use the tightened `screen.mjs`
  (today's `main` ingest has no screening → produces stale/past-tense drafts).
- **F. Tests** — auto-curate publishes only approve_candidate; respects cap +
  kill switch + allowlist; never auto-publishes minors/stale/dupes/needs_review;
  idempotent; VOID/pull refunds correctly.

## Rollout phases (de-risked)

1. **Shadow / dry-run** — auto-curate runs, logs what it *would* publish, but only
   inserts drafts. Human still approves. Validate screening precision on the live
   feed for a few days.
2. **Assisted auto-publish** — enable with cap N=1–2/day + kill switch + category
   allowlist. Watch the audit trail; pull any misses.
3. **Scale** — raise the cap and widen categories as confidence grows; keep the
   human queue for needs_review forever.

## Open decisions for Chris (answer next session)

- Auto-publish daily cap to start with? (suggest 1–2)
- Which categories auto vs. human-only to start? (suggest auto: Música/Novelas/
  entertainment; human: Futebol, anything sensitive)
- Default initial Verdade probability, or derive per market? (suggest flat 0.50)
- Kill switch location: reuse `economy_configs` or a dedicated `automation_config`?
- Scheduler: GitHub Actions (consistent with current jobs) or Supabase pg_cron?
- Merge the feature branch to `main` now, or keep iterating on the branch first?

## First concrete step next session

Merge the branch to `main` (unblocks clean screening in the scheduled ingest),
then build A + B behind the kill switch in **dry-run** and watch it for a day
before letting it publish anything on its own.
