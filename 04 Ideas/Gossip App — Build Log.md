---
title: Gossip App — Build Log
date: 2026-06-04
tags: [gossip-app, build-log, fofoca]
---

# Gossip App ("Fofoca") — Build Log

> [!important] Written record of everything built so it survives chat compaction.
> **Code:** `C:\Users\Chris\Projects\gossip-app` + GitHub `pastorfred/gossip`
> **Resume here:** read `PROJECT_STATUS.md` in the repo root.
> Planning: [[Gossip App — Brazil]] · [[Gossip App — Brainstorm Session 2026-06-02]] · Gossip App Brief / PRD / Architecture / UX / Epics (in 04 Ideas).

## What we built (one session, idea → working product)

Went the full BMad pipeline: **brainstorm → brief → PRD → architecture → UX (+ HTML mockup) → 35-story backlog → BUILT Epics 1–6 → content automation → Android emulator → GitHub.**

### The app (Expo SDK 56 + Supabase) — v1 code-complete
- **Epic 1 — Foundation/Onboarding/Feed:** T&C liability gate, frictionless anonymous session, login/recover (email+pw), seeded daily feed, designed cards + "Fofoca do Dia" hero + Speculated/Confirmed tabs + detail view.
- **Epic 2 — Betting:** `place_bet` RPC (write-once via UNIQUE, captures crowd-split + timestamp at cast time), optimistic tap + spring reveal animation, lock, first-bet handle prompt ("grátis e 100% anônimo").
- **Epic 3 — Resolution/Payoff:** `resolve_rumor` scorer (skill-weighted: contrarian × early-bird, idempotent), full-screen win payoff (confetti + points count-up + rank tick), My Bets, O Profeta leaderboard, profile.
- **Epic 4 — Comments + safety:** flat comments, like, Recent/Top sort, report/block, profanity filter, first-post guidelines gate.
- **Epic 5 — Curator admin:** `gossip-admin/admin.html` — create/schedule/seed/resolve rumors, moderation queue, drafts review.
- **Epic 6 — Launch readiness:** accessibility floor, delete-account (LGPD), contact method, legal microcopy ("opinião, nunca acusação").

### Content automation (the bot)
- `scripts/ingest.mjs` + `.github/workflows/ingest.yml` → **GitHub Actions, daily 08:00 BRT + manual**.
- Pulls **free** sources (Google News RSS = all outlets, browser UA), Claude writes a **headline + article paragraph**, tags by **source credibility** (reliable outlet → Confirmed; social/anyone-editable → Speculated), suggests seed counts → inserts as **drafts** for one-click approval in the admin.
- Cost: a few cents/day (Claude Haiku). Max budget agreed: $50/mo.

### Infra milestones
- Pushed all code to **GitHub** (`pastorfred/gossip`), `.env` + `android/` gitignored.
- Set up **Android Studio + emulator** ("fofoca" AVD) and a working **dev build** (escapes the Expo Go SDK-56 wall).
- Persistent memory written so future chats recall the project.

## Key product decisions (chronological)
- Core = **prediction market** reframe (opinion data, not accusation) — legal posture by design.
- v1 **binary** (tea/cap); richer prediction → v2.
- **Money never touches the truth meter**; monetization = Pro speed/flex + Gossip Pulse data (v2/v3).
- **Native iOS + Android** via Expo; Android first.
- Cold-start = **density not traffic** → "1 + 6" daily format, hero "Fofoca do Dia", seeded counts.
- **Comments pulled into v1** (founder call) with mandatory safety net.
- **Hide crowd % until you bet**; show % on resolved rumors with correct side ✓.
- **Pinned SDK 56 → kept 56** (use emulator/dev build, not Expo Go).
- **Source-credibility tagging** (reliable→Confirmed, social→Speculated).
- **Article view** — tap a rumor → headline → article paragraph → comments.
- Bot: **draft → approve** now; full auto-publish = a v2 toggle.

## Pending / next
- **Branding:** real name + logo + app icon (palette/fonts already in DESIGN.md).
- **Marketing / cold-start:** density playbook + Chris's own ideas (he wants to start this).
- **Store release:** EAS build + Google Play ($25); iOS after content-safety trio.
- **Legal:** lawyer's real T&C wording (placeholder in `src/content/terms.ts`).
- **Resolution model v2:** evidence-first resolution (multiple credible sources confirm/disprove), plus optional explicit prediction deadlines for time-bounded questions; flip `AUTO_PUBLISH=true`; more sources; possible move to office PC if Google blocks GitHub's datacenter IP.
- **"Hermes"** — a bot being created on the office PC (details TBD — confirm with Chris).

## Gotchas / notes
- **Gradle pin:** `android/` is gitignored; on a fresh clone, after prebuild set `gradle-wrapper.properties` to **gradle-8.13** (RN 0.85 breaks on Gradle 9 — `IBM_SEMERU`).
- **Anonymous sign-ins** must be ON in Supabase; **email confirmation** is OFF (so login works).
- Supabase project ref: `viotounckcqwmxyotzrv`.
- Migrations 0000–0009 applied in Supabase SQL Editor.
