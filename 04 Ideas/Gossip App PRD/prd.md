---
title: "PRD — Gossip Prediction App (Brazil)"
status: final
created: 2026-06-02
updated: 2026-06-02
source: "[[Gossip App Brief/brief]], [[Gossip App — Brainstorm Session 2026-06-02]]"
---

# PRD: Gossip Prediction App (working title)

> **Scope of this PRD: v1 only** — the lean, manually-operated validation build. v2 features (social feed, ratings, For You, automation, monetization) are listed under Out of Scope for context but are **not** specified here.

## 1. Overview & Goal

A **native mobile** app (iOS + Android) that consolidates Brazilian celebrity gossip into one curated feed and turns each unverified rumor into a crowd prediction: *true 🍵 / cap 🧢*. When a credible source confirms or debunks a rumor, every bet resolves and correct callers earn points and climb an anonymous leaderboard.

**The single goal of v1:** validate one assumption — *will users come back daily to predict gossip?* Every requirement below exists to make that test real and measurable. Anything not serving it is deferred.

**Primary success metric:** D1 / D7 retention on the prediction action. (Full metrics in §7.)

## 2. Target User & Primary Journey

**Primary user:** Brazilian gossip/pop-culture fan `[ASSUMPTION: ~16–34, mobile-native]` who already follows celebrity drama across X, Instagram, and fofoca blogs and enjoys being right before everyone else.

**UJ-1 — "Beatriz checks the tea" (core daily loop)**
Beatriz, 24, opens the app on her commute. The feed shows ~8 fresh rumors, each tagged **Speculated** or **Confirmed**. She reads a Speculated one — *"[Celebridade] secretly signed with [rival label]"* — taps **🍵 true**. A small confirmation shows she's locked her call; the live split shows 61% of the crowd agrees. She places calls on three more, sees she has **5 open bets pending**, and closes the app. Later she reopens the app out of habit (open-loops pull) and sees an in-app indicator: *"🔥 You were RIGHT — +65 pts, you're now #7."* `[v1 uses an in-app indicator; push notifications deferred — see FR19]` Loop repeats.

**UJ-2 — "The curator feeds the machine" (operator journey)**
Each morning, Chris (or a curator) scans X, Reddit, 4chan, fofoca blogs, and news; picks 5–10 rumors; posts each into the app via an admin tool, tagging it Speculated or Confirmed and writing a one-line summary. Through the day, when a credible source resolves a Speculated item, the curator marks it Confirmed or Debunked, which triggers payout to all bettors.

## 3. Scope

**In (v1):** curated feed, binary bet, bet resolution + skill-weighted points payout, anonymous identity + leaderboard, in-app resolution indicators, **flat text comments + moderation (report/block/filter/guidelines)**, a minimal curator/admin tool. Native iOS + Android.
**Out (v2+):** see §8.

## 4. Functional Requirements

### Feature A — Rumor Feed

- **FR1.** The system shall display a reverse-chronological feed of rumor cards, each showing: summary text, a **Speculated** or **Confirmed** tag, post time, and (for Speculated) the current crowd vote split and count.
- **FR2.** The system shall provide two filtered views of the feed: **Speculated** (open bets) and **Confirmed** (resolved/verified), switchable via tabs.
- **FR3.** Each rumor card shall open a detail view showing the full summary and, where provided, the source attribution/link for Confirmed items. `[ASSUMPTION: source link shown for Confirmed to reinforce trust; Speculated items show "unverified" without naming a source]`
- **FR4.** The feed shall load the most recent N rumors and page/scroll older ones. `[ASSUMPTION: N≈30]`

**Acceptance:** Given active rumors exist, when a user opens the app, the feed renders within performance budget (§6) with correct tags, and switching tabs shows only items of that status.

### Feature B — The Bet (Prediction)

- **FR5.** For any **Speculated** rumor, the system shall let an authenticated user cast exactly one binary prediction: **true (🍵)** or **cap (🧢)**.
- **FR6.** The system shall lock a user's prediction once cast — it cannot be changed or withdrawn. `[ASSUMPTION: no edits keeps the leaderboard honest; revisit if users complain]`
- **FR7.** The system shall prevent predictions on any rumor already **Confirmed** or **Debunked** (resolved items are closed).
- **FR8.** After casting, the system shall show the user the live crowd split (% true vs % cap) and total prediction count for that rumor.
- **FR9.** The system shall record each prediction with user ID, rumor ID, choice, and timestamp for later scoring.

**Acceptance:** Given a Speculated rumor, when a user taps true or cap, the choice is recorded once, locked, and the crowd split updates; a second attempt on the same rumor is rejected; any attempt on a resolved rumor is rejected.

### Feature C — Resolution & Payoff

- **FR10.** The system shall let an authorized curator resolve a Speculated rumor to one of two terminal states: **Confirmed (true)** or **Debunked (false)**. **[DECIDED: v1 resolution is a manual curator action — no automated source detection. Automated/source-assisted resolution is explicitly a v2 goal, not v1.]**
- **FR11.** On resolution, the system shall score every prediction on that rumor: a prediction matching the outcome is **correct**, otherwise **incorrect**, and award points per the scoring rule (FR12).
- **FR12.** The system shall award points for each correct prediction using a **skill-weighted (odds-based) model**, so that being right when the crowd was wrong, and being right early, pays more than following the obvious majority:
  - **FR12a — Contrarian weighting:** points scale inversely with how popular the user's pick was *at the moment they cast it*. Calling **true** when only 20% agreed and being right pays more than calling true when 80% already agreed. `[ASSUMPTION: e.g. points = base × (1 − crowd_share_of_your_pick_at_cast_time); exact curve TBD]`
  - **FR12b — Early-bird bonus:** an additional multiplier for casting earlier in a rumor's life (more uncertainty = more skill). `[ASSUMPTION: small bonus, capped, to avoid pure first-mover farming]`
  - **FR12c — Incorrect predictions** score zero (no negative points in v1). `[ASSUMPTION: penalties deferred — avoid discouraging participation during the validation test]`
  - The exact formula and constants are tunable post-launch; the requirement is that scoring rewards *accuracy-under-uncertainty*, not volume.
- **FR13.** On resolution, the system shall update each affected user's total score and leaderboard position, and mark their bet as won/lost in their history.
- **FR14.** The system shall display a clear payoff result to the user (won/lost, points delta, new rank) the next time they view the resolved rumor or their profile. `[ASSUMPTION: a real-time in-app "you were right" moment is desired; minimum bar is that the result is visible on next view — see FR15 for push]`

**Acceptance:** Given a Speculated rumor with predictions, when the curator marks it Confirmed or Debunked, all matching predictions are scored correct, scores and ranks update, and each user can see their won/lost result and point change.

### Feature D — Anonymous Identity & Leaderboard

- **FR15.** The system shall let a user create an account with an **anonymous persona** (chosen display name/handle, no real name required) and authenticate on return so their track record persists. `[ASSUMPTION: lightweight auth — email or phone for recovery, but no real-name or social-graph linkage. Auth mechanism is Architect's call.]`
- **FR16.** The system shall maintain per-user stats: total points, number of correct vs total resolved predictions (accuracy %), and current open bets count.
- **FR17.** The system shall display a global leaderboard ("O Profeta") ranking personas by total points. `[ASSUMPTION: global ranking for v1; leagues/friends deferred]`
- **FR18.** The system shall show each user their own rank and stats on a profile/home surface, including their list of open and resolved bets.
- **FR19.** The system shall surface bet resolutions to the user via an **in-app indicator** (badge/notification center inside the app) — points delta, won/lost, new rank — visible on next open. **[DECIDED: push notifications are NOT in v1. They are launch-essential and scheduled for v2/v3. v1 relies on the open-loops habit + in-app indicators to drive return visits, which is also a cleaner test of intrinsic pull.]**

**Acceptance:** Given a returning user, when they log in, their persona, points, accuracy, rank, and bet history load correctly; the leaderboard reflects current standings; a resolved bet surfaces an in-app indicator showing the result.

### Feature E — Curator / Admin Tool

- **FR20.** The system shall provide an authenticated admin interface (separate from the user app) for the curator to **create a rumor**: summary text, initial status (Speculated/Confirmed), and optional source link. `[ASSUMPTION: a simple gated admin screen or even a lightweight CMS/back-office is acceptable for v1]`
- **FR21.** The admin interface shall let the curator **resolve** a Speculated rumor to Confirmed or Debunked (triggering FR10–FR14) and **edit/remove** a rumor (e.g. for moderation or correction).
- **FR22.** The system shall timestamp and attribute curator actions (created/resolved/edited) for an audit trail. `[ASSUMPTION: lightweight — supports moderation defensibility]`

**Acceptance:** Given curator credentials, when the curator posts a rumor it appears in the user feed with the chosen tag; when they resolve it, scoring runs; non-curators cannot access the admin interface.

### Feature F — Comments (added v1 — founder decision 2026-06-02)

> Scope change: a simple, **text-only, flat** comment section ships in v1. The mandatory safety FRs are not optional — they are legal + app-store requirements for UGC.

- **FR23.** The system shall let an authenticated user post a **text-only comment** on a rumor; comments display the anonymous handle, text, and timestamp.
- **FR24.** The system shall let users **like** a comment (single toggle) and sort comments by **Recent** or **Top** (like count). Flat list only — no nested replies in v1.
- **FR25.** The system shall let any user **report** a comment (with a reason), adding it to a moderation queue.
- **FR26.** The system shall let a user **block** another persona; blocked personas' comments are hidden from the blocker.
- **FR27.** The system shall run a **keyword/profanity filter** on new comments (auto-hide or block egregious content) and let curators **hide/delete** any comment from the admin tool (deleted → "removido" tombstone).
- **FR28.** The system shall show a one-time **community-guidelines gate** before a user's first comment ("opinions, not accusations"), requiring acceptance.

**Acceptance:** a user can post/like/sort comments; reporting queues a comment for moderation; blocking hides an author; curators can remove comments; first-time commenters must accept guidelines; profanity is filtered.

## 5. Non-Functional Requirements

- **NFR1 — Legal posture.** All user-facing copy shall frame rumors as crowd opinion / unverified speculation and predictions as opinion data — never as factual accusations by the platform. The product shall not state "X did Y"; it presents what the crowd predicts. `[NOTE FOR PM: requires a real legal review before public launch — Brazilian defamation/Marco Civil. Flagged as launch-gating, not v1-build-gating.]`
- **NFR2 — Anonymity & privacy.** Personas shall not expose real identity to other users. Personal data collection shall be minimal and LGPD-compliant `[ASSUMPTION: LGPD applies — Brazil's data protection law]`.
- **NFR3 — Moderation.** The curator-only content model (no user-generated rumors in v1) shall be the primary abuse control; the audit trail (FR22) supports takedowns.
- **NFR4 — Performance.** Feed and bet actions shall feel instant on a mid-range Android phone on mobile data `[ASSUMPTION: feed render < ~2s, bet tap acknowledged < ~500ms]`.
- **NFR5 — Scale (modest).** v1 shall support an early-adopter user base `[ASSUMPTION: low thousands of users / low tens of thousands of predictions]` without architectural rework being a precondition to launch.
- **NFR6 — Platform.** **[DECIDED: v1 ships as native mobile apps for iOS + Android.]** `[NOTE FOR PM/Architect: native is the user's explicit choice. Given a solo founder with limited coding, the realistic path to "native iOS + Android from one codebase" is a cross-platform framework (e.g. React Native / Flutter) and/or a developer. This materially raises build effort vs. a web app — Winston (Architect) to define the concrete stack and whether outside dev help is needed.]`
- **NFR7 — Operability.** The daily curation workflow (post 5–10 rumors, resolve as sources land) shall be doable by one non-technical person in under ~30 min/day `[ASSUMPTION]`.

## 6. Success Metrics

**Primary:** D1 and D7 retention on the prediction action. `[ASSUMPTION: target D7 ≥ 20% to consider the loop validated]`
**Engagement:** avg predictions placed per active user per day; % of users holding ≥1 open bet at any time; repeat sessions/day.
**Funnel:** % of new users who place ≥1 bet in their first session (activation).
**Counter-metrics (watch for harm):** prediction-resolution latency (rumors sitting unresolved too long kills the payoff); curator load (minutes/day — if it balloons, the manual model fails); report/complaint rate on rumors (legal/abuse signal).

## 7. Open Questions

- **🧊 Cold-start / GTM (biggest, unresolved):** how does the first crowd arrive so the feed/market isn't empty? Candidate beachheads (one fandom? one reality show? one football transfer window?) not yet chosen. **Recommend resolving before/with build.**
- **Resolution authority & latency (FR10):** is one curator enough? What's the target time-to-resolve? How are ambiguous rumors that never clearly resolve handled (expire as "unresolved/void"?).
- **Scoring constants (FR12):** the skill-weighted model is decided; the exact curve, early-bird multiplier, and base value need tuning (can be set at build time and adjusted post-launch).
- **Native build path (NFR6):** which cross-platform framework, and does v1 need a hired developer given limited in-house coding? → Architect.
- **Product name & brand.**

## 8. Out of Scope (v2+)

**Push notifications** (launch-essential — scheduled v2/v3). **Automated / source-assisted bet resolution** (replaces manual curator resolution — v2 goal). Richer social layer — **Community Feed (rate gossip out of 5), the "For You" personalized page**, and "A Fonte" evidence/tea threads with nesting/upvotes (the evolution of v1's flat comments). Automated rumor aggregation/scraping. Pro subscription (speed + status flex). "Gossip Pulse" anonymized trend-data sales. Richer (non-binary) predictions, geographic teams, user-submitted rumors, friend/league leaderboards, negative-point penalties.

> **Note (2026-06-02):** Basic flat comments + moderation moved INTO v1 (Feature F) by founder decision. This pulls **moderation ops cost into v1** and adds defamation/abuse exposure — accepted trade-off. v2 social items above are the richer evolution.
