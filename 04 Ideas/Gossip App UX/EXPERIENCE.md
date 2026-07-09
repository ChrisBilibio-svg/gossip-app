---
title: "EXPERIENCE — Gossip Prediction App (Brazil)"
status: final
created: 2026-06-02
updated: 2026-06-02
sources:
  - "Brainstorm Abs/04 Ideas/Gossip App PRD/prd.md"
  - "Brainstorm Abs/04 Ideas/Gossip App Architecture/architecture.md"
---

# EXPERIENCE — Gossip Prediction App (Brazil)

> Behavior, IA, states, interaction, motion, flows. **This file owns how it works.** Visual tokens live in DESIGN.md, referenced as `{colors.x}` etc. On conflict, the spines win over any mock.

## Foundation

- **Form factor:** native mobile phone app (Expo / React Native). **Android-first** release; iOS a beat behind. Portrait, one-hand / thumb use.
- **UI system:** React Native + Reanimated for 60fps motion on the UI thread; Expo Haptics for tactile feedback. DESIGN.md is the visual identity.
- **Language:** Portuguese (pt-BR) first. Microcopy is casual Brazilian gossip slang.
- **Core principle:** the product is a *loop*, not a set of screens — every surface either feeds a bet, resolves one, or shows where you stand.

## Information Architecture

Four primary surfaces via **bottom-nav** (DESIGN `{components.bottom-nav}`):

1. **Feed** (home) — today's set: the **Fofoca do Dia** hero card on top, then ~6 supporting rumor cards. Speculated (open to bet) and Confirmed visible; a Speculated/Confirmed filter toggle.
2. **My Bets** — the open-loops home. **Pending** bets (anticipation: "resolving soon") + **Resolved** history (won/lost). This is the retention surface.
3. **Leaderboard** — global O Profeta ranking; the user's own rank pinned.
4. **Profile** — anonymous persona: handle, points, accuracy %, open-bets count; settings; account-delete (LGPD); report/contact.

**Rumor detail** opens from any card: full summary, the vote interaction, source link (Confirmed), and the result once resolved.

**IA closure:** every PRD need maps to a surface — feed→FR1-4, bet→FR5-9 (card + detail), resolution/payoff→FR10-14 (My Bets + overlay), identity/leaderboard→FR15-18 (Leaderboard + Profile). ✅

## Voice and Tone (microcopy)

Casual, warm, cheeky Brazilian gossip-friend. Never clinical, never accusatory (legal posture: opinion, not fact).

- Vote buttons: **"É TEA 🍵"** / **"É CAP 🧢"**
- Crowd split label: **"A galera acha..."** ("the crowd thinks...") → "62% acha que é tea"
- Empty pending: **"Nenhum palpite rolando. Bora dar uns? 👀"**
- Win: **"VOCÊ ACERTOU! 🔥"** Lose: **"Foi cap dessa vez 😅"** (kind, never mocking — keep them playing)
- Hero label: **"FOFOCA DO DIA"**
- Locked vote: **"Palpite trancado 🔒"** (reinforces write-once without scolding)
- Never state the rumor as fact in app copy — it's always "a fofoca diz..." / framed as claim + crowd opinion.

## Component Patterns (behavioral)

- **Rumor card:** tap anywhere → detail. Speculated cards show live-ish split + vote buttons; Confirmed cards show outcome + source. Hero card is visually dominant and pinned top.
- **Vote buttons:** single tap commits (write-once). On commit they **collapse** into the result row (your pick highlighted, split revealed). No undo — communicated as "trancado 🔒," framed as part of the game's integrity, not a limitation.
- **Vote-bar:** shows the crowd split as **settled data** ("A galera acha 62%"), not a twitching live counter. Your own vote is injected immediately so the bar visibly moves *because of you*.
- **My Bets pending row:** conveys anticipation — "resolvendo em breve," subtle pulse on items close to resolution.
- **Leaderboard:** your row is always pinned/visible even when you're #4,000, so progress feels reachable.

## State Patterns

For every data surface, define: **loading · seeded · empty · committed · resolved · error · offline.**

- **Loading:** skeleton cards (never a blank screen) — feed must feel instant.
- **Seeded (launch tactic):** early on, cards carry seed vote counts so the split is *never* 0/0. The user never sees a dead feed. (Architecture: seed_true/seed_false.)
- **Pre-vote vs Committed:** pre-vote shows buttons + a teaser split; committed shows your locked pick + the full split + "🔒".
- **Resolved — WIN:** triggers the payoff overlay (see Motion). **Resolved — LOSS:** gentle, kind, immediately points at the next open bet ("mas você tem 3 palpites rolando 👀").
- **Empty (My Bets):** nudge into the feed.
- **Offline / error:** optimistic UI already showed the vote; if the write fails, reconcile *quietly* and re-surface the vote button with a soft "tenta de novo" — never lose the user's intent loudly.

## Interaction Primitives

- **Optimistic vote (THE critical one):** on tap → *in the same frame* fire haptic (medium impact) + collapse buttons + reveal split with the user's vote already counted. The network write happens silently in the background. Success = nothing further; failure = quiet reconcile. **Never** put a spinner between the tap and the feedback.
- **Haptics:** medium impact on vote commit; light tick on tab change; heavy + success pattern on a WIN.
- **Pull-to-refresh** on feed (bouncy). **Scroll** is the primary motion — keep it buttery; use framework defaults, don't over-customize physics.
- **Deep-link** (v2 push): a resolved-bet notification opens straight into the payoff overlay.

## Motion & Animation (the dopamine spine) ⭐

> This is the retention thesis made physical. Built with Reanimated on the UI thread (60fps). Two moments get *deliberate over-investment*: the **vote reveal** and the **win payoff**.

### 1. The Vote Reveal (every single bet — must feel great thousands of times)
On tap (total ~400ms, but feedback is instant):
1. **0ms:** haptic medium + buttons spring/squish (scale 0.96→1) — instant acknowledgement.
2. **0–150ms:** the two vote buttons collapse/cross-fade into the **vote-bar**.
3. **150–400ms:** the bar fills *once* with a spring easing from 0 → the crowd split, your side briefly pulsing/glowing in `{colors.tea}` or `{colors.cap}`. The % numbers count up as the bar fills.
4. Settle: "Palpite trancado 🔒" fades in. Done. Satisfying, quick, repeatable.
- **Rule:** the bar animates ONCE, on reveal. It does NOT keep twitching afterward (no fake-live). On later views it's just settled data.

### 2. The Win Payoff (the signature moment — overspend here)
When a pending bet resolves in the user's favor (entered via My Bets, or v2 deep-link from push):
1. **Takeover:** full-screen **payoff-overlay** slides/scales up over the app — a saturated pink→yellow wash (the one loud moment in a calm app).
2. **Confetti burst:** pink + yellow particles rain (Reanimated/Skia or Lottie). Heavy haptic punch on impact.
3. **"VOCÊ ACERTOU! 🔥"** lands with a spring (overshoot bounce).
4. **Points count UP** — never snap. The number rolls from old→new total (e.g. +65) with the gold `{colors.gold}` flashing.
5. **Rank ticks** — "#9 → #7" animates the climb.
6. **Exit:** a single tappable **"BORA DE NOVO 🔥"** CTA → drops them back into the feed with fresh bets (closes one loop, opens the next).
- Respect silent mode for any optional sound; never block — always dismissible.

### 3. The Loss (kind, fast, forward)
- No takeover, no punishment. A soft card-flip to "Foi cap dessa vez 😅," no points lost, and an immediate pointer to open bets. Keep them in the loop, never shame them.

### 4. Ambient delight (cheap, high-return)
- Hero card a gentle idle shimmer/pulse to pull the eye. New-bet entrance: cards spring in on feed refresh. Tab switches: quick cross-fade. Keep everything bouncy, never sluggish.

## Accessibility Floor

- All text AA contrast (verify amber/teal/coral on white — darken if needed; see DESIGN).
- Vote outcome never conveyed by **color alone** — always pair with the 🍵/🧢 icon + label + your-pick highlight (color-blind safe).
- Honor **Reduce Motion**: confetti/most motion downgrades to a tasteful fade + the points still count up (keep the reward legible without vestibular load).
- Hit targets ≥ 44pt; vote buttons large and thumb-reachable.
- Screen-reader labels for vote state, split ("crowd: 62% tea, 38% cap"), result, rank.
- Respects system font scaling (Baloo/Nunito hold up when enlarged).

## Key Flows

### Flow 1 — Beatriz makes her call (the core loop) ⭐ climax
Beatriz, 24, on the bus, opens the app. *Skeleton cards flash, then today's set lands.* The **Fofoca do Dia** glows at the top: *"[Celeb] secretly signed with the rival label."* She reads it, grins, taps **É TEA 🍵**. **— CLIMAX —** *Haptic thump; the buttons squish and melt into a bar that springs to "A galera acha 62% tea," her side glowing teal, the number rolling up; "trancado 🔒" fades in.* It felt good. She scrolls, calls three more, sees **"4 palpites rolando"** in My Bets, and pockets the phone — with four open loops tugging at her.

### Flow 2 — The payoff pulls her back ⭐ climax
That evening Beatriz reopens out of habit and taps **My Bets**. One pending row is pulsing — *resolved.* She taps it. **— CLIMAX —** *The screen erupts: pink-yellow wash, confetti raining, heavy haptic, "VOCÊ ACERTOU! 🔥" bouncing in, **+65** rolling up in gold, her rank ticking **#9 → #7**.* She taps **"BORA DE NOVO 🔥"** and lands back in the feed, already eyeing the next call. The loop closes and reopens in one breath.

### Flow 3 — First-run (anonymous, frictionless)
New user opens the app → **no signup wall** (anonymous session created silently). They land straight in a *seeded, alive* feed and can browse and even tap a vote. At the moment of their first vote, a light prompt: **"Escolhe teu @ pra entrar no ranking"** (pick a handle) — the only step, framed as joining the game, not signing up. Track record begins.

### Flow 4 — Curator posts the day (web admin, not in-app)
Out of scope for the mobile UX spine — handled by the `gossip-admin` web tool (architecture). Noted so the IA stays honest: rumors *appear* in the feed via scheduled publish; the app never authors them.

## Open Questions / Assumptions
- `[ASSUMPTION]` Fonts: Baloo 2 (display) + Nunito Sans (body). Both free, good pt-BR coverage; swap freely.
- `[ASSUMPTION]` Exact win-payoff length (~2–2.5s) and whether sound ships in v1 (lean: optional, off by default).
- `[NOTE FOR UX]` Dark mode deferred (light-first); revisit post-v1.
- `[ASSUMPTION]` "É TEA / É CAP" slang as button labels — validate it lands with Brazilian users; alt: "VERDADE / MENTIRA".
- Open: exact loss-state copy tone; confirm it never feels punishing.

## Comments (in v1 — founder decision 2026-06-02)

> Scope change: a **simple, text-only, flat comment section** ships in v1. Founder accepted the moderation + defamation trade-offs. Safety features below are NON-NEGOTIABLE (legal + app-store required). The richer Evidence/Tea threads, ratings, and For You remain v2.

**Component — comment section (per rumor detail):**
- Flat list (no nested replies in v1), sorted **Recent** / **Top** (by likes). Text-only — no images.
- Each comment: anonymous handle, text, timestamp, like count + like button, and an **overflow menu → Report / Block user**.
- Compose bar pinned at bottom of rumor detail; tap to post (optimistic insert).
- A small **like** (❤️/🔥) is the only reaction in v1 (keeps it light).

**Mandatory safety (v1):**
- **Report comment** → sends to moderation queue (admin web tool), with reason picker.
- **Block user** → the blocker never sees that persona's comments again (client + server filter).
- **Keyword/profanity filter** on post (auto-hide or soft-block obvious violations).
- **Hide/delete** any comment from the admin tool; deleted comments leave a "comentário removido" tombstone.
- **First-post guideline gate:** before a user's first comment, a one-time sheet: community rules + "opiniões, não acusações" — must accept.

**Voice/microcopy guardrail:** placeholder "Solta teu palpite, sem acusação 👀"; framing keeps comments as opinion, never stated fact. Loss/empty states friendly.

**State patterns:** loading (skeleton lines) · empty ("Seja o primeiro a comentar 👀") · posted (optimistic, reconcile quietly on failure) · reported (comment dims for reporter, "em análise") · removed (tombstone) · blocked-author (hidden).

**Accessibility:** report/block reachable by screen reader; like state not color-only.

**[NOTE FOR JOHN/WINSTON]** This reopens PRD scope (new FRs: comments, like, report, block, moderation queue, guideline gate) and architecture (new `comments` + `comment_reports` tables, RLS, admin moderation UI, profanity filter; **moderation ops cost moves into v1**). Folded into those docs 2026-06-02; please sanity-check.

## Deferred to v2 (logged, not in v1)
- **Evidence–Tea threads** (evidence backing a true/cap call, upvotes, nested), the **Community Feed** (rate gossip out of 5), the **"For You"** personalized page. (Basic flat comments now exist in v1; these are the richer evolution.)
- Push notifications (deep-link into payoff). Dark mode.
