---
title: "Product Brief — Gossip Prediction App (Brazil)"
status: ready-for-handoff
created: 2026-06-02
updated: 2026-06-02
source: "[[Gossip App — Brainstorm Session 2026-06-02]], [[Gossip App — Brazil]]"
---

# Product Brief: Gossip Prediction App (working title) `[ASSUMPTION]`

> **Working title only.** No product name chosen yet — naming is an open decision (see Open Questions). Placeholder concepts floated in brainstorm: "O Profeta," "Fofoca Market." `[ASSUMPTION]`

## Executive Summary

Brazil has a massive, fragmented gossip culture — celebrity news, scandals, and rumors spread across TV, X, Reddit, 4chan, Instagram, and dozens of fofoca blogs, with no single place to follow it and no way to know what's actually true. This product consolidates that chaos into one clean feed **and turns it into a game**: every unverified rumor becomes a prediction the crowd can bet on — *true 🍵 or cap 🧢* — and when a credible source confirms or debunks it, the bet resolves and the people who called it right earn status.

The core insight from discovery: the "is it true?" question and the "is it fun?" question are answered by the **same loop**. A rumor arrives tagged **Speculated**; the crowd predicts whether it will be upgraded to **Confirmed**; a real source resolves it. This flips the legal posture of a gossip app (the platform displays *opinion data and probabilities*, never factual accusations) while creating a genuinely addictive daily habit built on open, unresolved bets.

Why now: gossip-source aggregation is technically cheap, Brazil's betting/palpite culture primes users for prediction mechanics, and no competitor combines aggregation + a truth filter + a prediction game. The opening bet is small and testable — a manually-curated v1 that answers one question: *will Brazilians come back every day to predict gossip?*

## The Problem

- **Gossip is everywhere and nowhere.** Brazilian fans chase rumors across X, Reddit, 4chan, Instagram, fofoca blogs, and TV. No single feed consolidates it. `[ASSUMPTION: based on brainstorm + original idea note; not yet validated with real users]`
- **You can't tell what's real.** Rumor and confirmed fact blur together. The "fake news" problem erodes trust and there's no signal for credibility.
- **Following is passive and forgettable.** Reading gossip is a low-engagement, one-and-done act. Nothing pulls you back or rewards you for being early or right.
- **Sharing an opinion carries social risk.** Posting hot takes under your real identity invites judgment, which suppresses participation.

**Cost of the status quo:** attention is scattered, no platform owns the Brazilian gossip audience, and the engagement (and ad/data value) that audience represents goes uncaptured.

## The Solution

A mobile-first `[ASSUMPTION: mobile-first; not yet decided]` app with one core loop:

1. **Curated feed** of the day's juiciest rumors, each tagged **Speculated** or **Confirmed** (tag driven by source credibility — official statement / live TV / the person themselves = Confirmed; lower-credibility chatter = Speculated).
2. **The bet** — tap *true 🍵 / cap 🧢* on any Speculated rumor. Free for everyone, always.
3. **Resolution + payoff** — when a credible source confirms or debunks it, the bet resolves in real time and correct callers score points.
4. **Status** — an anonymous persona builds a track record; a leaderboard ("O Profeta") turns accuracy into fame without revealing identity.

The retention engine is **always-open loops**: you always have live bets pending (unfinished business your brain can't drop), and resolving them surfaces fresh rumors to bet on — you never reach zero.

**The social layer (two tiers):**
- **Community Feed** — a Twitter-style space where users post their own opinions/reactions on a piece of gossip and **rate it out of 5** (a separate signal from the bet: rating = how juicy/credible it is; betting = will it be confirmed). The "hangout" that serves the talkers, not just the scorekeepers.
- **"For You" page** — a personalized feed that surfaces gossip and posts tuned to the people, topics, and fandoms each user cares about, driving discovery and daily return.
- **Evidence/Tea threads** — per-rumor discussion reframed as "evidence" backing a true/cap call (deeper layer; can follow the basic feed).

## What Makes This Different

- **The truth filter IS the game.** Competitors have either aggregation *or* a comment section. Here, the Speculated→Confirmed pipeline doubles as the prediction market — one mechanic, not two features. This is the defensible core.
- **Legal posture by design.** Framing everything as crowd opinion / probabilities (never "X did Y") sidesteps the defamation trap that kills naive anonymous-gossip apps. **Iron rule: money never touches the truth meter.**
- **Anonymous fame.** Two status tracks — **O Profeta** (best predictor) and **A Fonte** (best intel-dropper) — let people become legends while faceless. The persona becomes the celebrity.
- **A data asset no one else has.** Running the prediction layer generates a real-time map of national belief — sellable later as anonymized trend data.

**Honest read on the moat:** at v1 the advantage is *concept + execution speed*, not technology. The aggregation is cheap to copy; the defensibility comes from owning the audience, the status/reputation graph, and the resolved-bet data — all of which compound only *after* traction. `[ASSUMPTION]`

## Who This Serves

- **Primary: Brazilian gossip/pop-culture fans `[ASSUMPTION: age skew ~16–34, mobile-native — not yet validated]`** who already follow celebrity drama across multiple apps and enjoy being "in the know" and right before others.
- **Secondary — the talkers:** users who love posting opinions and "evidence" more than they care about scorekeeping. Served by the social layer (deferred past v1).
- **Future B2B: media outlets, journalists, talk shows** who'd pay for aggregate sentiment/trend data ("what Brazil believes right now").

## Success Criteria

**v1 is a single-assumption test:** *Will people come back daily to predict gossip?*

- **Primary metric:** D1 / D7 retention on the prediction action. `[ASSUMPTION: specific targets TBD — e.g. D7 ≥ 20%?]`
- **Engagement:** average bets placed per active user per day; % of users with ≥1 open bet at any time.
- **Habit signal:** repeat sessions per day (the "open loops" pull working).
- **Not yet about money.** Revenue is explicitly *not* a v1 success metric.

## Scope

**In (v1 — manually operated):**
- Human-curated feed of 5–10 rumors/day, pulled manually from X, Reddit, 4chan, fofoca blogs, news (manual curation = those sources are free, no APIs).
- Speculated / Confirmed tagging.
- Binary bet (true/cap) on Speculated items.
- Real-time resolution + points payoff.
- Anonymous persona + simple O Profeta leaderboard.

**Explicitly out (deferred to v2 — fast-follow once daily prediction is proven):**
- **Social layer:** Community Feed (post opinions + rate gossip out of 5), the **"For You" personalized page**, and "A Fonte" evidence/tea threads. *(High priority for v2 — Chris's strong intent; held back only to keep v1 a clean test.)*
- Automated aggregation / scraping.
- Pro subscription (speed + status flex) and Gossip Pulse data sales.
- Personalized push alerts, richer (non-binary) predictions, geographic teams, user-submitted rumors.

## Open Questions

- **🧊 Cold-start / go-to-market (biggest unknown):** an empty prediction market isn't fun. How does the first crowd arrive — a single celebrity/fandom beachhead? a niche community (one football club, one reality show)? seeding tactics? **Unresolved — recommend a dedicated session or PM-led GTM plan.**
- **Product name & brand.** None chosen.
- **Form factor.** Mobile app vs. web-first vs. PWA — undecided; affects build path.
- **Build path.** Given limited coding resources: no-code MVP vs. Claude Code build vs. hired dev (→ Architect's call).
- **Moderation & legal review.** Even as "opinion data," anonymous content in Brazil needs a moderation model and a real legal gut-check before public launch.

## Vision

If it works: the default home for Brazilian gossip — not a place you *read* gossip, but a place you *play* it. The country's real-time verdict engine on what's true about the famous, with anonymous oracles whose calls the whole app watches. From there: expand the prediction-market engine beyond gossip (sports rumors, politics, viral news), monetize through status/speed subscriptions and anonymized trend data, and become the layer that turns *any* unverified claim into a crowd-resolved verdict — starting with the one topic Brazil can't stop talking about.
