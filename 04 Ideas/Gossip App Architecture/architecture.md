---
stepsCompleted: [1, 2]
status: 'v1-architecture-complete'
inputDocuments:
  - "Brainstorm Abs/04 Ideas/Gossip App PRD/prd.md"
  - "Brainstorm Abs/04 Ideas/Gossip App Brief/brief.md"
  - "Brainstorm Abs/04 Ideas/Gossip App — Brainstorm Session 2026-06-02.md"
workflowType: 'architecture'
project_name: 'Gossip Prediction App (Brazil)'
user_name: 'Chris'
date: '2026-06-02'
---

# Architecture Decision Document — Gossip Prediction App (Brazil) v1

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Team & Constraints (context)

- **Team size:** 2 people (Chris + 1). Limited coding background; building with Claude Code as a force multiplier.
- **Platform:** Native iOS + Android (PRD decision).
- **UI/UX north star:** Tea-style / Twitter-style — clean, card-based, fast-scrolling feed. To be detailed in the UX-architecture section (and optionally formalized later by UX/Sally).
- **Operating posture:** v1 is a low-cost validation test; keep run-cost and ops load minimal (manual curation, ~30 min/day).

## Project Context Analysis

### Requirements Overview
**Functional:** 22 FRs / 5 features — feed (read-heavy, tagged cards, live-ish vote split), bet (binary, write-once, locked, one-per-user-per-rumor), resolution + skill-weighted scoring (curator-triggered batch), anonymous identity + global leaderboard, curator/admin tool.
**Non-functional:** native iOS+Android; anonymity + LGPD; perf (feed <2s, bet ack <500ms); modest scale (low-thousands users); low daily ops (~30 min curation); legal-framing copy (opinion data, never accusations).
**Scale & complexity:** low-to-medium. Domain = mobile client + managed backend. ~5–6 components.

### The one data-modelling trap
Skill-weighted scoring (contrarian + early-bird) is impossible to compute retroactively unless **every prediction stores, at cast time: the user's pick, the crowd vote-split at that moment, and a server-stamped timestamp.** Capture at write-time or rebuild later.

### Cross-cutting concerns
auth/anonymity · poll-based live aggregation (not websockets) · scoring pipeline · low ops cost · moderation audit trail · legal copy · App Store UGC compliance.

## Key Architectural Decisions (from collaborative review)

> Reached in a multi-perspective review (Amelia/Dev, Sally/UX, John/PM) on 2026-06-02.

1. **Stack — DECIDED:** **Expo (React Native) + Supabase (Postgres).** Rationale: Claude Code is strongest in TS/React; Expo+EAS hides the native toolchain (no Mac needed for iOS builds); Postgres gives correctness guarantees the scoring engine needs. Firestore/Flutter rejected for this team.
2. **Correctness in the DB, not the app — DECIDED:** write-once via `UNIQUE(user_id, rumor_id)`; prediction row stamps `server_now()` + current vote-split in the same transaction (never trust client clocks); **scoring = one idempotent batch function** at resolution time. RLS policies are the only backend security — test them adversarially.
3. **Platform sequencing — DECIDED:** one Expo codebase targets both; **Android ships to store first** (lenient, fast review); **iOS submitted a beat behind**, after the **content-safety trio** is built — report content, block user, moderation path + published contact email (Apple Guideline 1.2 for UGC, or rejection).
4. **UX priorities (Sally) — ADOPTED:** optimistic instant vote (haptic + local split update in-frame, network in background); frame the split as **"the crowd says 62%," not a fake-live ticker** (animate once on reveal); **over-invest in the win-payoff animation** (the dopamine core); a **"My Bets" home** for the open-loops pullback.
5. **Cold-start = density, not traffic (John) — ADOPTED:** **"1 + 6" daily format** — one "Fofoca do Dia" hero everyone votes on + ~6 supporting rumors. **Seed vote counts** so the feed is never empty in the first weeks. Hold the catalog small; expand only when the hero clears ~500 votes/day for a week; never let a card sit below ~50 votes/day.
6. **Beachhead — DECIDED (GTM):** dynamic, **AI-assisted daily hot-topic curation** (Chris/Claude Code research and pick the most divisive timely rumor as each day's hero). Concentrate early marketing (Instagram/X) on each day's hero to borrow synchronized audiences. Not an architecture blocker.

### New build requirements surfaced by the review
- **Daily date-stamped "set"** as the core content object; exactly **one hero flag** per day.
- **Future-scheduled publishing** (pre-load tonight → goes live on schedule).
- **Seedable vote counts/split** per card (set at creation; taper/zero once organic volume is healthy).
- **Content-safety trio** (report / block / moderate + contact email) — required for iOS.
- Admin/curator tool = a **simple gated web page**, NOT a native screen.

## v1 Data Model (Supabase / Postgres)

Five core tables. Design rules baked in: write-once via constraint, cast-time capture for scoring, denormalized counters so a card's split is a single-row read, seed counts for the no-empty-feed launch tactic.

### `users` — anonymous personas
| column | type | notes |
|---|---|---|
| `id` | uuid PK | = Supabase `auth.uid()` |
| `handle` | text UNIQUE | chosen display name; no real name |
| `is_curator` | bool default false | gates admin actions |
| `total_points` | int default 0 | denormalized for leaderboard (written only by scoring fn) |
| `correct_count` | int default 0 | denormalized |
| `resolved_count` | int default 0 | denormalized; accuracy = correct/resolved |
| `created_at` | timestamptz default now() | |

LGPD posture: this is essentially all the PII there is. Collect nothing else; recovery handled by Supabase auth (email/phone kept by auth, not exposed to other users).

### `rumors` — the gossip cards
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `summary` | text | the rumor text |
| `status` | enum(`speculated`,`confirmed`,`debunked`) | lifecycle |
| `set_date` | date | which daily set it belongs to |
| `is_hero` | bool default false | one hero per day (see index below) |
| `publish_at` | timestamptz | scheduled go-live (pre-load tonight, live tomorrow) |
| `source_url` | text null | shown on Confirmed for trust |
| `seed_true` / `seed_false` | int default 0 | launch seeding; displayed split = seed + real |
| `true_votes` / `false_votes` | int default 0 | REAL counts, incremented in the bet transaction |
| `resolved_at` | timestamptz null | when curator resolved |
| `resolved_outcome` | enum(`true`,`false`) null | matches confirmed/debunked |
| `created_by` | uuid FK→users | curator audit |
| `created_at` | timestamptz default now() | |

- **One hero per day:** partial unique index — `CREATE UNIQUE INDEX one_hero_per_day ON rumors (set_date) WHERE is_hero;`
- **Displayed split (cheap, single-row read):** `(seed_true + true_votes)` vs `(seed_false + false_votes)`. No aggregation over predictions needed → serves Sally's "split must be a cheap read."

### `predictions` — the bet (the correctness-critical table)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK→users | |
| `rumor_id` | uuid FK→rumors | |
| `choice` | enum(`true`,`false`) | 🍵 / 🧢 |
| `crowd_true_at_cast` | int | **cast-time capture** — split when the bet was placed |
| `crowd_false_at_cast` | int | **cast-time capture** |
| `cast_at` | timestamptz default now() | **server-stamped**, never client clock |
| `is_correct` | bool null | set by scoring fn at resolution |
| `points_awarded` | int null | set by scoring fn |
| `scored_at` | timestamptz null | idempotency guard |

- **Write-once:** `UNIQUE (user_id, rumor_id)` — the DB guarantees one locked bet per user per rumor.
- The three cast-time fields (`crowd_*_at_cast`, `cast_at`) are what make contrarian + early-bird scoring computable later. **Without them, scoring is impossible retroactively.**

### `comments` — flat text comments (v1 scope addition, 2026-06-02)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `rumor_id` | uuid FK→rumors | |
| `user_id` | uuid FK→users | author persona |
| `body` | text | text-only; length-capped; profanity-filtered on insert |
| `like_count` | int default 0 | denormalized |
| `status` | enum(`visible`,`hidden`,`removed`) | moderation state; `removed` shows tombstone |
| `created_at` | timestamptz default now() | |

### `comment_likes` — write-once like
`comment_id` FK, `user_id` FK, `created_at`; `UNIQUE(comment_id, user_id)`. Increments `comments.like_count` via the like RPC.

### `comment_reports` — moderation queue
`id`, `comment_id` FK, `reporter_id` FK, `reason` enum, `created_at`, `resolved` bool. Feeds the admin moderation queue.

### `blocks` — user-level blocking
`blocker_id` FK→users, `blocked_id` FK→users, `created_at`; `UNIQUE(blocker_id, blocked_id)`. Comment reads filter out `blocked_id` for the current user.

**Comment RLS & safety:** SELECT visible comments excluding blocked authors; INSERT own comment only after a `accepted_guidelines` flag on `users` is true (FR28 gate) and passing the profanity filter (a SECURITY DEFINER function or trigger); only curators set `status=hidden/removed`; `like_count`/`status` not user-writable. Report/block insert own rows only.

### `audit_log` — moderation/curator trail
`id`, `actor_id` FK→users, `action` (created/resolved/edited/removed), `rumor_id`, `detail` jsonb, `at` timestamptz. Lightweight; supports takedowns + NFR moderation defensibility.

### The bet path (one transaction / RPC `place_bet(rumor_id, choice)`)
1. Verify rumor is `speculated` and `publish_at <= now()` (else reject).
2. Read current `(seed_true+true_votes, seed_false+false_votes)`.
3. Insert prediction with `choice`, the captured split, `cast_at = now()`. `UNIQUE` blocks a second bet.
4. Increment the rumor's `true_votes`/`false_votes`.
All atomic → no double-vote, no lost count, split read stays a single row.

### The scoring function (`resolve_rumor(rumor_id, outcome)` — SECURITY DEFINER, idempotent)
1. Guard: if already resolved, no-op (idempotent).
2. Set rumor `status`, `resolved_at`, `resolved_outcome`.
3. For each prediction on the rumor **where `scored_at IS NULL`**:
   - `is_correct = (choice = outcome)`
   - if correct: `points = ROUND(BASE × contrarian_mult × earlybird_mult)`, else 0
     - **contrarian_mult** = `1 + (1 − pick_share_at_cast)` where `pick_share_at_cast = crowd_[pick]_at_cast / (crowd_true_at_cast + crowd_false_at_cast)` → being right against the crowd pays more. (Constants tunable.)
     - **earlybird_mult** = small capped bonus for low elapsed-life at cast (`cast_at` early relative to `publish_at`→`resolved_at`).
   - write `is_correct`, `points_awarded`, `scored_at = now()`
   - increment `users.total_points (+points)`, `correct_count (+1 if correct)`, `resolved_count (+1)`
4. No negative points in v1 (per PRD FR12c).

### RLS (the BaaS security spine — test adversarially)
- `rumors`: anyone authenticated reads rows where `publish_at <= now()`; INSERT/UPDATE only where `users.is_curator`.
- `predictions`: a user SELECTs only **their own** rows; INSERT only via `place_bet` (own `user_id`, checks enforced); `is_correct`/`points_awarded`/`scored_at` writable only by the SECURITY DEFINER scoring fn — never by the user. (Crowd split never comes from reading others' predictions; it comes from the counters on `rumors`.)
- `users`: anyone reads public leaderboard fields (`handle`, `total_points`, `correct_count`, `resolved_count`); a user UPDATEs only their own `handle`; point fields writable only by scoring fn.
- Counters/points updated through SECURITY DEFINER functions so RLS can't block legitimate writes — and users can't forge them.

### Leaderboard
Trivial at this scale: `SELECT handle, total_points FROM users ORDER BY total_points DESC LIMIT 100;` (index on `total_points`). Revisit only if it ever gets slow.

## Auth (Supabase Auth)

- **Flow:** on first open, create a session immediately (Supabase **anonymous sign-in**) so a user can browse and even bet with zero friction — critical for the cold-start funnel (no signup wall in front of the fun).
- **Persona:** prompt for a `handle` on first bet (cheap commitment moment), stored in `users`.
- **Recovery (optional, deferred-friendly):** let a user attach an email/phone later to keep their track record across devices. Supabase handles the credential; it's never shown to other users. If they never attach one, the persona lives on the device session.
- **Curator auth:** same auth, `is_curator = true` set manually for the 2 founders; the admin web app and RLS both check it.
- **LGPD:** anonymous-by-default means minimal PII. Provide an in-app **delete-my-account** path (also an Apple/Google store requirement) that hard-deletes the user row + cascades predictions, and a Portuguese privacy policy. `[flag: privacy policy + legal copy still needs the launch-gating legal review from the PRD's NFR1]`

## Cost Snapshot (v1, monthly)

Designed to run **near-free** until you have real traction — appropriate for a validation test.

| Item | Cost | Notes |
|---|---|---|
| Supabase | **$0** (Free tier) → **$25/mo** (Pro) | Free tier covers low-thousands users / 500MB DB / 50k MAU easily; jump to Pro only when you outgrow it |
| Expo / EAS Build | **$0** to start | Free build tier is enough for occasional releases; paid only if you build very frequently |
| Apple Developer | **~$8/mo** | $99/yr, amortized |
| Google Play | **~$2/mo** | $25 one-time, amortized |
| Domain (admin + landing) | **~$1–2/mo** | optional in v1 |
| **Total run-cost** | **≈ $10–35/mo** | excludes marketing spend (your real budget line) |

Headline: **infrastructure is not your cost problem.** Your spend is marketing/acquisition, not servers. That's exactly where it should be for a validation test.

## Project / Repo Shape

Three pieces, intentionally simple:

1. **`gossip-app/`** — the Expo (React Native + TypeScript) mobile app. iOS + Android from one codebase. Talks directly to Supabase via the client SDK.
2. **`gossip-admin/`** — a minimal **password/curator-gated web app** (plain React/Vite or Next.js) for: the daily curation workflow (create the 1+6 set, flag hero, schedule `publish_at`, set seed counts, resolve rumors) **AND the moderation queue** (review `comment_reports`, hide/remove comments) — moderation is now a v1 daily task (comments shipped in v1). Hits the same Supabase project with a curator session.
3. **`supabase/`** — database as code: SQL **migrations** (tables, enums, indexes, RLS policies), and the `place_bet` / `resolve_rumor` functions. Version-controlled so Claude Code can evolve the schema safely.

**Build sequence (for the epics handoff):** schema + RLS first (the foundation) → auth + feed (read path) → `place_bet` + optimistic vote UI → `resolve_rumor` + payoff screen → leaderboard + My Bets → **comments + like + report/block + guidelines gate** → admin tool (curation **+ moderation queue**) → profanity filter + content-safety trio (required pre-iOS) → Android release.

> **v1 scope note (2026-06-02):** Flat text comments + moderation added to v1 by founder decision. New tables: `comments`, `comment_likes`, `comment_reports`, `blocks` (+ `accepted_guidelines` flag on `users`). The content-safety trio (report/block/moderation) is no longer just an Apple checkbox — it's now load-bearing because v1 has real UGC. Flagged for John/Winston review; reflected in PRD Feature F + this data model.

## Cost Scaling (v1 → v2 → v3)

Scale assumptions: v1 = 1–5k users (manual); v2 = 10–50k MAU (social layer, push, AI-assisted resolution, partial auto-aggregation); v3 = 100–500k MAU (full automation, monetization, data sales).

| Cost line | v1 | v2 | v3 |
|---|---|---|---|
| Supabase | $0–25 | $25–150 | $500–2,000 (dedicated + cache) |
| Expo/EAS + push | $0 | $0–50 | $50–200 |
| LLM/AI (summarize, tag, hot-topic, auto-resolve) | ~$0 | $50–300 | $500–3,000 |
| Image/CDN bandwidth | ~$0 | $20–100 | $200–800 |
| 🔴 Social-source APIs (X/Twitter) | $0 (manual) | $0–200 | **$5,000+ (X Pro)** |
| Moderation (UGC from v2) | ~$0 | $50–300 | $500–3,000 |
| Data/BI (Gossip Pulse) | $0 | $0 | $100–500 |
| **Run-cost subtotal** | **$10–35** | **$200–1,100** | **$7,000–13,000+** |

> **v1 scope update (2026-06-02):** flat comments + moderation moved into v1 (founder decision). This adds a small **AI-moderation cost** (~$0–50/mo — e.g. OpenAI Moderation/Perspective API are cheap/free) and, more importantly, a **human moderation time cost** for the 2-person team (reviewing reports daily). Infra cost stays ~the same; the real cost is attention.

**Key findings:**
- 🔴 **The X/Twitter API is the cost cliff** — a $200→$5,000/mo step the moment you seriously automate X aggregation; can be ~70–80% of v3 run-cost. Everything else scales gracefully.
- **Stay hybrid longer:** free/cheap sources (news RSS, 4chan JSON API, Reddit) + human skimming X (free) feed the machine well into v2/early v3. Manual curation = X-API-avoidance moat.
- **Automate the brain (cheap LLMs), not the X intake (expensive).**
- **v2's hidden new cost is moderation** (UGC appears with the social layer), not infrastructure.
- **Gate the v3 X-automation jump on revenue:** don't pay $5k/mo until Pro subs + Gossip Pulse data cover it. Architecture supports staying cheap until the money's there.

## Outstanding (non-blocking) flags
- ⚖️ **Legal review (NFR1)** — privacy policy + "opinion data" framing; launch-gating, not build-gating.
- 🔔 **Push notifications** — deferred to v2 per PRD; when added, Expo Notifications + the deep-link-into-payoff that Sally wants.
- 🧊 **Beachhead** — dynamic daily hero (decided); first-weeks marketing concentration still to be planned (GTM, not architecture).
