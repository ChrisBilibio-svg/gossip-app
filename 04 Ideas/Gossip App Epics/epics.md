---
stepsCompleted: [1, 2, 3, 4]
status: final
inputDocuments:
  - "Brainstorm Abs/04 Ideas/Gossip App PRD/prd.md"
  - "Brainstorm Abs/04 Ideas/Gossip App Architecture/architecture.md"
  - "Brainstorm Abs/04 Ideas/Gossip App UX/EXPERIENCE.md"
  - "Brainstorm Abs/04 Ideas/Gossip App UX/DESIGN.md"
---

# Gossip Prediction App (Brazil) v1 - Epic Breakdown

## Overview

Complete epic and story breakdown for v1, decomposing the PRD (28 FRs), UX spines, and Architecture (Expo + Supabase) into implementable stories. Build order follows the architecture's sequence. Team: 2 people, limited coding, building with Claude Code.

## Requirements Inventory

### Functional Requirements

FR1: Display a reverse-chronological feed of rumor cards (summary, Speculated/Confirmed tag, time; for Speculated: crowd split + count).
FR2: Provide Speculated / Confirmed filtered views (tabs).
FR3: Rumor detail view; show source attribution for Confirmed.
FR4: Feed loads most-recent N and pages older.
FR5: Cast exactly one binary prediction (true/cap) on a Speculated rumor.
FR6: Lock a prediction once cast (no edit/withdraw).
FR7: Prevent predictions on resolved (Confirmed/Debunked) rumors.
FR8: After casting, show live crowd split (% true/cap) + total count.
FR9: Record each prediction with user, rumor, choice, cast-time crowd split, server timestamp.
FR10: Curator resolves a Speculated rumor to Confirmed(true)/Debunked(false) — manual in v1.
FR11: On resolution, score every prediction (correct/incorrect).
FR12: Skill-weighted scoring — (a) contrarian weighting, (b) early-bird bonus, (c) incorrect = 0, no negatives.
FR13: On resolution, update each user's score, leaderboard position, bet won/lost.
FR14: Show payoff result (won/lost, points delta, new rank).
FR15: Account with anonymous persona (handle, no real name) + auth on return.
FR16: Maintain per-user stats (points, correct/total, accuracy, open bets).
FR17: Global leaderboard ("O Profeta") by total points.
FR18: User profile/home surface (rank, stats, open + resolved bets).
FR19: In-app indicator on bet resolution (push deferred to v2).
FR20: Admin: create rumor (summary, status, optional source).
FR21: Admin: resolve a Speculated rumor; edit/remove rumors.
FR22: Timestamp + attribute curator actions (audit trail).
FR23: Post a text-only comment on a rumor (handle, text, timestamp).
FR24: Like a comment + sort Recent/Top; flat list, no nested replies.
FR25: Report a comment (with reason) → moderation queue.
FR26: Block another persona; blocked comments hidden from blocker.
FR27: Keyword/profanity filter on new comments; curator hide/delete (tombstone).
FR28: One-time community-guidelines gate before first comment.
FR29: Account login & sign-up (email or phone) so a user can recover their persona and retain points/track record across sessions and devices.
FR30: Terms & Conditions + Privacy Policy acceptance gate at first launch (before any use); user must accept to proceed; includes liability disclaimer (opinion-not-fact, no liability for user content or rumor accuracy). Record acceptance with policy version + timestamp.

### NonFunctional Requirements

NFR1: Legal posture — all copy frames rumors/predictions as crowd opinion/probabilities, never factual accusation. (Launch-gating legal review pending.)
NFR2: Anonymity & privacy — personas hide real identity; minimal PII; LGPD-compliant; delete-my-account path.
NFR3: Moderation — curator-only rumor model + audit trail; comment moderation queue (v1, comments added).
NFR4: Performance — feed render < ~2s; bet tap acknowledged < ~500ms (optimistic).
NFR5: Scale — support low-thousands users without rework as a launch precondition.
NFR6: Platform — native iOS + Android from one Expo codebase; Android ships first, iOS after content-safety trio.
NFR7: Operability — daily curation + moderation doable by one non-technical person in modest time.

### Additional Requirements (Architecture)

- **STARTER TEMPLATE (Epic 1, Story 1):** Expo (React Native + TypeScript) managed workflow + EAS Build; Supabase project (Postgres) — schema/migrations as version-controlled SQL.
- Data model: `users`, `rumors` (daily set_date + is_hero partial-unique + publish_at + seed counts + live counters), `predictions` (UNIQUE(user_id,rumor_id), cast-time capture), `comments`, `comment_likes`, `comment_reports`, `blocks`, `audit_log`.
- `place_bet()` — atomic RPC: validate open, capture split, insert locked bet, increment counter.
- `resolve_rumor()` — idempotent SECURITY DEFINER batch scorer (contrarian × early-bird), updates points/ranks once.
- RLS on every table (users see own predictions only; points/status not user-writable; blocked-author filter); adversarial RLS tests.
- Daily date-stamped set with one hero; future-scheduled publishing; seedable vote counts (taperable).
- `gossip-admin/` — gated web app: daily curation (1+6 set, hero flag, schedule, seed) + moderation queue.
- Profanity-filter function on comment insert; content-safety trio (report/block/moderate + contact email) required pre-iOS.

### UX Design Requirements

UX-DR1: Design tokens as a theme — colors (cream bg, pink primary, yellow/gold accent, teal/coral votes, green/amber tags), type (Baloo 2 display + Nunito Sans body), radius (pill/lg/md), 4px spacing.
UX-DR2: Rumor card component + hero "Fofoca do Dia" variant (larger, pink edge, elevated).
UX-DR3: Vote buttons (É TEA 🍵 / É CAP 🧢) with optimistic tap — in-frame haptic + state change, network in background, quiet reconcile on failure.
UX-DR4: Vote-reveal animation — buttons collapse into bar that springs once to crowd split with % count-up; "crowd says 62%" framing (not fake-live); user's vote moves bar immediately.
UX-DR5: Tag-pill (CONFIRMADO green / ESPECULADO amber) always visible.
UX-DR6: Win-payoff overlay — full-screen pink→yellow takeover, confetti, heavy haptic, "VOCÊ ACERTOU!", points count-up in gold, rank tick, "BORA DE NOVO" CTA back into feed.
UX-DR7: Loss state — kind, fast, no punishment, points at next open bet.
UX-DR8: My Bets surface — pending (anticipation/pulse) + resolved (won/lost) history.
UX-DR9: Leaderboard rows — self pinned/visible at any rank; top-3 flourish.
UX-DR10: Profile + stat chips (points, accuracy, open bets) + delete-account (LGPD).
UX-DR11: Bottom nav — Feed · Palpites · Ranking · Perfil.
UX-DR12: Comment section UI — flat list, compose bar, like, Recent/Top sort, overflow → report/block.
UX-DR13: Safety UX — first-post guidelines gate, report flow (reason picker), block, "comentário removido" tombstone.
UX-DR14: State patterns — loading skeletons, seeded (never 0/0), empty, error/offline optimistic reconcile.
UX-DR15: Accessibility floor — AA contrast, outcome never color-only (icon+label), Reduce-Motion downgrade (keep points count-up), ≥44pt targets, screen-reader labels.
UX-DR16: Voice/microcopy — pt-BR gossip slang + legal-safety guardrail copy ("opiniões, não acusações").
UX-DR17: Frictionless first-run — anonymous session on open (no signup wall), handle prompt at first vote.

### FR Coverage Map

- FR1, FR2, FR3, FR4 → Epic 1 (feed + tags + detail)
- FR15 (anonymous session) → Epic 1; FR15 (handle at first bet) → Epic 2
- FR29 (login/sign-up + account recovery) → Epic 1
- FR30 (T&C/Privacy acceptance gate + liability disclaimer) → Epic 1 (wording = lawyer; launch-gating)
- FR5, FR6, FR7, FR8, FR9 → Epic 2 (the bet + cast-time capture)
- FR10, FR11, FR12, FR13, FR14 → Epic 3 (resolution + scoring + payoff)
- FR16, FR17, FR18, FR19 → Epic 3 (stats, leaderboard, profile/My Bets, in-app indicator)
- FR23, FR24, FR25, FR26, FR27, FR28 → Epic 4 (comments + moderation)
- FR20, FR21, FR22 → Epic 5 (curator admin tool)
- NFR6 (platform/Expo+Supabase) → Epic 1 foundation
- NFR3 (moderation) → Epics 4 + 5
- NFR1, NFR2, NFR4, NFR5, NFR7 (legal copy, LGPD, perf, scale, operability) → distributed; hardened in Epic 6

## Epic List

### Epic 1: Foundation, Onboarding & The Daily Feed
On first launch a user accepts the **Terms & Conditions / Privacy** gate (liability shield), then enters the app and browses today's curated gossip feed: the "Fofoca do Dia" hero on top, supporting rumor cards below, each tagged Confirmado/Especulado with the crowd split, switchable via Speculated/Confirmed tabs, opening to a detail view. **Auth flow (frictionless, decided):** T&C gate → play immediately on an auto-created anonymous account → nudge to "secure your account & save your points" (add email/phone) → a **Log in** path for returning users on a new device. No signup wall in front of the fun; points persist once secured. Establishes the project foundation (Expo + Supabase, core schema, RLS, design-token theme) and the auth/onboarding spine the rest of the app builds on. Feed feels alive from day one via seeded vote counts.
**FRs covered:** FR1, FR2, FR3, FR4, FR15, FR29, FR30 · NFR6, NFR2 · UX-DR1, 2, 5, 11, 14, 17

### Epic 2: Make Your Call (Predict)
A user taps É TEA 🍵 / É CAP 🧢 on a Speculated rumor and places exactly one locked prediction, feeling an instant, delightful optimistic response as the buttons collapse into the revealed crowd split. The bet is captured with its cast-time crowd split + server timestamp (the data that makes skill-weighted scoring possible). First bet prompts the user to pick a handle.
**FRs covered:** FR5, FR6, FR7, FR8, FR9, FR15 (handle) · NFR4 · UX-DR3, 4, 16

### Epic 3: Resolution & The Payoff
When a rumor resolves, every bet is scored (contrarian × early-bird), and the user who was right gets the full-screen dopamine payoff — confetti, points counting up, rank climbing — while points and the O Profeta leaderboard come alive. Users track open/resolved bets in "My Bets" and see their standing in Profile.
**FRs covered:** FR10, FR11, FR12, FR13, FR14, FR16, FR17, FR18, FR19 · UX-DR6, 7, 8, 9, 10
**Note:** the `resolve_rumor()` scorer is built here and triggered via SQL/Studio for testing; the curator-facing resolve UI lands in Epic 5.

### Epic 4: Comments & Community Safety
Users discuss each rumor in a flat, text-only comment section — post, like, sort Recent/Top — with the mandatory safety net: report, block, profanity filter, and a first-post guidelines gate. (Safe-by-design: framed as opinion, never accusation.)
**FRs covered:** FR23, FR24, FR25, FR26, FR27, FR28 · NFR3 · UX-DR12, 13

### Epic 5: Curator Admin Tool
The two founders run the daily operation from a gated web app (`gossip-admin`): build the 1+6 daily set, flag the hero, schedule publishing, set seed counts, resolve rumors (wiring Epic 3's scorer), and work the comment-moderation queue (wiring Epic 4's reports). Replaces manual SQL/Studio curation.
**FRs covered:** FR20, FR21, FR22 · NFR3, NFR7 · (admin half of the audit trail)

### Epic 6: Launch Readiness (Ship to Brazil)
Make it shippable: accessibility floor (AA contrast, not-color-only, Reduce-Motion), pt-BR microcopy + legal-safety copy, profanity-filter hardening, the content-safety trio (report/block/moderation + contact email) required for stores, delete-account (LGPD), then the Android store release. iOS submitted a beat behind once the trio is verified.
**FRs covered:** NFR1, NFR2, NFR4, NFR5, NFR7 · UX-DR15, 16 · content-safety trio

---

## Epic 1: Foundation, Onboarding & The Daily Feed

Establish the Expo + Supabase foundation and let a user accept terms, enter, optionally secure an account, and browse a live (seeded) daily gossip feed.

### Story 1.1: Project scaffold + Supabase connection + design theme
As a developer, I want the Expo app scaffolded with the Supabase client and the design-token theme wired, so that all later stories build on a consistent foundation.
**Acceptance Criteria:**
**Given** a fresh clone, **When** the app is run on Android, **Then** it launches to a branded shell screen using the DESIGN.md tokens (cream bg, pink primary, Baloo 2 / Nunito Sans fonts loaded).
**And** the Supabase client connects with env-based keys; a health check query succeeds.
**And** the repo holds `supabase/` migrations as version-controlled SQL.

### Story 1.2: Terms & Conditions / Privacy acceptance gate (FR30)
As a first-time user, I want to review and accept Terms & Privacy before using the app, so that usage is consented and the company is protected.
**Acceptance Criteria:**
**Given** a first launch, **When** the app opens, **Then** a T&C + Privacy sheet is shown and the app is unusable until "Aceitar" is tapped.
**When** the user accepts, **Then** acceptance is recorded with policy version + timestamp and the gate does not reappear (unless version changes).
**And** the displayed text is sourced from a single editable content location `[NOTE: final wording = Brazilian lawyer; launch-gating]`.

### Story 1.3: Frictionless anonymous entry (FR15)
As a new user, I want to start using the app immediately after accepting terms, so that nothing blocks me from the fun.
**Acceptance Criteria:**
**Given** terms accepted, **When** I proceed, **Then** an anonymous Supabase session is created silently and I land in the feed.
**And** no email/password is required to browse or (later) vote.

### Story 1.4: Secure account — sign-up / log in / recover (FR29)
As a user with points, I want to attach a login (email or phone) and sign back in, so that I keep my account and points across devices.
**Acceptance Criteria:**
**Given** an anonymous account, **When** I choose "Salvar minha conta," **Then** I can attach email or phone and my existing persona/points are retained.
**Given** a returning user on a new device, **When** I tap "Entrar" and authenticate, **Then** my persona, points, and history load.
**And** a "secure your account" nudge appears after meaningful activity (e.g., first win) but is dismissible.

### Story 1.5: Rumor model + seeded daily feed (read path) (FR1, FR4)
As a user, I want to see today's rumors, so that I have gossip to engage with.
**Acceptance Criteria:**
**Given** the `rumors` table (with set_date, is_hero, publish_at, seed_true/false, true/false_votes) and seeded rows, **When** I open the feed, **Then** I see published rumors for today, hero flagged, ordered with hero first.
**And** the displayed crowd split = seed + real counts (never 0/0 when seeded).
**And** RLS exposes only rows where `publish_at <= now()`.

### Story 1.6: Feed UI — card, hero variant, tags, split (FR1, UX-DR2,5,14)
As a user, I want a clean, scrollable feed, so that browsing gossip feels fast and fun.
**Acceptance Criteria:**
**Given** rumors load, **When** the feed renders, **Then** each card shows summary, a CONFIRMADO/ESPECULADO tag, and (Speculated) the crowd split + count, styled per DESIGN.md; the hero card is larger with a pink edge.
**And** loading shows skeleton cards (never a blank screen); empty shows a friendly state.
**And** feed renders within the NFR4 budget on a mid-range Android.

### Story 1.7: Speculated/Confirmed tabs + rumor detail (FR2, FR3)
As a user, I want to filter and open rumors, so that I can focus and read more.
**Acceptance Criteria:**
**Given** the feed, **When** I switch tabs, **Then** I see only Speculated or only Confirmed items.
**When** I tap a card, **Then** a detail view opens with the full summary; Confirmed shows the source link.

---

## Epic 2: Make Your Call (Predict)

Let a user place one locked binary prediction with a delightful optimistic reveal, capturing the data scoring needs.

### Story 2.1: Predictions schema + `place_bet` RPC (FR5, FR6, FR9)
As a developer, I want an atomic, write-once bet path that captures cast-time data, so that scoring is possible and double-votes are impossible.
**Acceptance Criteria:**
**Given** the `predictions` table with `UNIQUE(user_id, rumor_id)` and cast-time columns, **When** `place_bet(rumor_id, choice)` runs, **Then** it (in one transaction) verifies the rumor is Speculated + published, records choice + crowd split at cast + server timestamp, and increments the rumor counter.
**And** a second call for the same user+rumor is rejected by the constraint.
**And** RLS lets a user insert only their own bet and read only their own predictions.

### Story 2.2: Vote buttons + optimistic tap (FR5, UX-DR3)
As a user, I want tapping a vote to feel instant, so that the interaction is satisfying.
**Acceptance Criteria:**
**Given** a Speculated card, **When** I tap "É TEA 🍵" or "É CAP 🧢," **Then** in the same frame I get haptic feedback and the UI updates optimistically (buttons begin collapsing) while the write happens in the background.
**And** if the write fails, the UI reconciles quietly and lets me retry without losing context.

### Story 2.3: Vote-reveal animation + crowd split (FR8, UX-DR4)
As a user, I want a satisfying reveal of where the crowd stands, so that voting has a payoff.
**Acceptance Criteria:**
**Given** I cast a vote, **When** the reveal plays, **Then** the buttons collapse into a teal/coral bar that springs once to the crowd split with the % counting up, my own vote already reflected, framed as "A galera acha 62%" (not a live ticker).
**And** the bar animates only once; later views show settled data.

### Story 2.4: Lock & guards (FR6, FR7)
As a user, I want my prediction locked, so that the game stays fair.
**Acceptance Criteria:**
**Given** I have voted, **When** I view the rumor, **Then** I see my locked pick + "Palpite trancado 🔒" and cannot change it.
**Given** a resolved rumor, **When** I view it, **Then** no voting is possible.

### Story 2.5: Handle prompt at first bet (FR15)
As a user, I want to choose my anonymous handle when I first bet, so that I can appear on the leaderboard.
**Acceptance Criteria:**
**Given** my first-ever vote, **When** it is cast, **Then** I'm prompted to pick a unique handle (no real name).
**And** the handle is saved to my persona and shown on my future leaderboard/profile.

---

## Epic 3: Resolution & The Payoff

Score resolved bets and deliver the dopamine payoff; bring points, leaderboard, and My Bets to life.

### Story 3.1: `resolve_rumor` scorer — contrarian + early-bird, idempotent (FR10, FR11, FR12)
As a developer, I want a single idempotent scoring function, so that resolution awards correct points exactly once.
**Acceptance Criteria:**
**Given** a Speculated rumor with predictions, **When** `resolve_rumor(rumor_id, outcome)` runs, **Then** it sets the rumor resolved, and for each unscored prediction computes correct/incorrect and points = base × contrarian_mult × earlybird_mult (correct), 0 (incorrect, no negatives).
**And** re-running the function does not double-award (idempotent via `scored_at`).
**And** it is SECURITY DEFINER; users cannot invoke point writes directly.

### Story 3.2: Apply scores to users + ranking (FR13, FR16)
As a user, I want my points and accuracy updated when bets resolve, so that my track record is real.
**Acceptance Criteria:**
**Given** resolution runs, **When** scoring completes, **Then** each affected user's total_points, correct_count, resolved_count update and their bet is marked won/lost.
**And** the leaderboard order reflects new totals.

### Story 3.3: Win payoff overlay animation (FR14, UX-DR6)
As a user who was right, I want an exciting celebration, so that I'm hooked to come back.
**Acceptance Criteria:**
**Given** a resolved bet I won, **When** I open it, **Then** a full-screen pink→yellow takeover plays: confetti, heavy haptic, "VOCÊ ACERTOU!", points counting up in gold, rank ticking up, and a "BORA DE NOVO 🔥" CTA returning me to the feed.
**And** Reduce-Motion downgrades confetti to a fade while keeping the points count-up.

### Story 3.4: Loss state (UX-DR7)
As a user who was wrong, I want a kind, forward-looking result, so that I keep playing.
**Acceptance Criteria:**
**Given** a resolved bet I lost, **When** I view it, **Then** I see a gentle "Foi cap dessa vez 😅" with no points lost and a pointer to my other open bets. No punishing animation.

### Story 3.5: My Bets surface + in-app resolution indicator (FR18, FR19, UX-DR8)
As a user, I want to track my open and resolved bets, so that the open loops pull me back.
**Acceptance Criteria:**
**Given** I have bets, **When** I open "Palpites," **Then** I see Pending (with anticipation cues) and Resolved (won/lost) lists.
**Given** a bet of mine resolved while away, **When** I return, **Then** an in-app indicator surfaces the result (push deferred to v2).

### Story 3.6: Leaderboard screen (FR17, UX-DR9)
As a user, I want to see the O Profeta ranking, so that I can compete.
**Acceptance Criteria:**
**Given** the Ranking tab, **When** it loads, **Then** I see personas ranked by points; my own row is pinned/visible at any rank; top-3 get a flourish.

### Story 3.7: Profile + stats (FR16, FR18, UX-DR10)
As a user, I want a profile of my record, so that my anonymous reputation is visible.
**Acceptance Criteria:**
**Given** the Perfil tab, **When** it loads, **Then** I see my handle, points, accuracy %, open-bets count (stat chips), and my bet history; plus access to account/settings.

---

## Epic 4: Comments & Community Safety

Flat, text-only comments with the mandatory safety net.

### Story 4.1: Comments schema + post a comment (FR23)
As a user, I want to comment on a rumor, so that I can share my take.
**Acceptance Criteria:**
**Given** the `comments` table + RLS, **When** I post text on a rumor detail, **Then** it appears (optimistically) with my handle + timestamp; visible comments exclude blocked authors.
**And** comments are text-only and length-capped.

### Story 4.2: Like + sort comments (FR24)
As a user, I want to like and sort comments, so that the best takes rise.
**Acceptance Criteria:**
**Given** comments exist, **When** I like one, **Then** the like is recorded once (`UNIQUE(comment_id,user_id)`) and the count updates.
**When** I switch sort, **Then** comments order by Recent or Top (likes). Flat list only.

### Story 4.3: Community-guidelines gate (FR28)
As the platform, I want users to accept guidelines before their first comment, so that behavior and liability are set.
**Acceptance Criteria:**
**Given** a user's first comment attempt, **When** they try to post, **Then** a one-time guidelines sheet ("opiniões, não acusações") must be accepted before the comment sends; acceptance is recorded.

### Story 4.4: Report a comment → moderation queue (FR25)
As a user, I want to report bad comments, so that harmful content can be removed.
**Acceptance Criteria:**
**Given** a comment, **When** I report it with a reason, **Then** a `comment_reports` row is created and the comment is marked "em análise" for me.

### Story 4.5: Block a user (FR26)
As a user, I want to block a persona, so that I never see their comments.
**Acceptance Criteria:**
**Given** a comment author, **When** I block them, **Then** a `blocks` row is created and their comments are hidden from me everywhere thereafter.

### Story 4.6: Profanity filter on insert (FR27)
As the platform, I want egregious content auto-filtered, so that the worst never shows.
**Acceptance Criteria:**
**Given** a new comment, **When** it contains filtered keywords, **Then** it is auto-hidden/blocked at insert (server-side), independent of client.

---

## Epic 5: Curator Admin Tool (`gossip-admin` web app)

The founders' daily operations console.

### Story 5.1: Admin web app + curator auth gate (FR20)
As a curator, I want a gated admin site, so that only we can manage content.
**Acceptance Criteria:**
**Given** the `gossip-admin` web app, **When** a non-curator visits, **Then** access is denied; **When** a user with `is_curator` authenticates, **Then** the dashboard loads.

### Story 5.2: Build the daily 1+6 set — create, hero, schedule, seed (FR20)
As a curator, I want to compose the daily set, so that the feed is full and concentrated.
**Acceptance Criteria:**
**Given** the admin, **When** I create rumors for a date, **Then** I can set summary, status, optional source, flag exactly one hero (enforced), set `publish_at`, and set seed_true/false.
**And** scheduled rumors appear in the app only at `publish_at`.

### Story 5.3: Resolve a rumor (triggers scorer) (FR21)
As a curator, I want to resolve rumors, so that bets pay out.
**Acceptance Criteria:**
**Given** a Speculated rumor, **When** I mark it Confirmed/Debunked, **Then** `resolve_rumor` runs and users are scored; the action is recorded.

### Story 5.4: Edit/remove rumor + hide/delete comment (FR21, FR27)
As a curator, I want to correct or remove content, so that the app stays clean and lawful.
**Acceptance Criteria:**
**Given** any rumor/comment, **When** I edit or remove it, **Then** the change reflects in the app; removed comments show a "comentário removido" tombstone.

### Story 5.5: Moderation queue (FR25)
As a curator, I want a queue of reported comments, so that I can act fast.
**Acceptance Criteria:**
**Given** reports exist, **When** I open the queue, **Then** I see reported comments with reasons and can hide/remove or dismiss; resolved reports leave the queue.

### Story 5.6: Audit trail (FR22)
As the platform, I want curator actions logged, so that moderation is defensible.
**Acceptance Criteria:**
**Given** any create/resolve/edit/remove, **When** it occurs, **Then** an `audit_log` row records actor, action, target, and timestamp.

---

## Epic 6: Launch Readiness (Ship to Brazil)

Make it accessible, lawful, performant, and shippable.

### Story 6.1: Accessibility floor (UX-DR15)
As any user, I want the app to be accessible, so that everyone can play.
**Acceptance Criteria:**
**Given** the app, **When** audited, **Then** text meets AA contrast, outcomes are never color-only (icon+label), Reduce-Motion is honored, hit targets ≥44pt, and key elements have screen-reader labels.

### Story 6.2: pt-BR microcopy + legal-safety copy pass (UX-DR16, NFR1)
As the platform, I want all copy on-brand and legally safe, so that we sound right and avoid accusation framing.
**Acceptance Criteria:**
**Given** all surfaces, **When** reviewed, **Then** copy is pt-BR gossip-slang on-brand and never states rumors as fact (opinion framing throughout).

### Story 6.3: Delete-account / LGPD data path (NFR2)
As a user, I want to delete my account and data, so that my privacy rights are honored (and stores are satisfied).
**Acceptance Criteria:**
**Given** Profile settings, **When** I delete my account, **Then** my user row + predictions + comments are hard-deleted/cascaded and I'm signed out.

### Story 6.4: Content-safety trio + contact method (NFR3, store requirement)
As the platform, I want report/block/moderation + a published contact, so that iOS/Android approve a UGC app.
**Acceptance Criteria:**
**Given** UGC features, **When** store-reviewed, **Then** in-app report, block, a working moderation path, and a published contact email are all present and functional.

### Story 6.5: Performance pass (NFR4)
As a user, I want the app to feel fast, so that the loop stays addictive.
**Acceptance Criteria:**
**Given** a mid-range Android on mobile data, **When** I use the app, **Then** the feed renders < ~2s and a vote tap is acknowledged < ~500ms (optimistic).

### Story 6.6: Android release (+ iOS a beat behind) (NFR6)
As the team, I want to ship to the stores, so that real Brazilians can play.
**Acceptance Criteria:**
**Given** a release build via EAS, **When** submitted, **Then** the Android app passes Play review and is live.
**And** the iOS build is submitted only after the content-safety trio (6.4) is verified, per the Apple UGC requirement.

---

## v2 Backlog — Push Notifications (founder input, 2026-06-03)

Deferred to v2 per PRD (v1 uses in-app indicators). Founder-requested triggers:
- **Bet resolved** — "Seu palpite foi resolvido — você acertou! / quase!" → deep-link into the payoff.
- **New hero gossip** — "🔥 Saiu a Fofoca do Dia — dá teu palpite!" (daily re-engagement hook).
- **Retention nudges** — playful, curiosity-driven copy to pull users back (e.g. "A galera tá dividida nessa… qual teu palpite? 👀").
Implementation later: Expo Notifications + the deep-link-into-payoff (Sally's UX-DR). Build once we reach the notification phase.

## v2 Backlog — Bot rules + Auto-debunk (founder input, 2026-06-04)

**Source-credibility tagging (DONE in ingest bot):** reliable/established outlets (G1, Globo, Folha, UOL…) → Confirmed; social / anyone-editable / tabloid (Twitter/X, Reddit, anon blogs) → Speculated.

**Resolution model v2:** rumors remain **Speculated** until multiple credible sources confirm or disprove them. Time can resolve only explicit prediction-deadline questions (example: “Will X and Y be publicly confirmed by Friday?”). If the deadline passes without the defined event happening, CAP wins; otherwise evidence keeps the rumor open.
