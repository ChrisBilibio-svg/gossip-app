# Viddi (gossip-app) — Project Status

_Single source of truth for picking this project back up. Last updated: 2026-06-30._

## What it is
Brazil-first **gossip prediction game** named **Viddi** (name decided 2026-06-11; Latin *vidi* / PT *eu vi* = "I saw it"). Curated rumors → the crowd predicts **tea 🍵 (true) / cap 🧢 (false)** → resolved by credible sources under the default **evidence** policy, or by CAP-on-timeout only for explicit **deadline** questions. Evidence markets use a resolve-by window and **VOID** (push: no points/accuracy hit) if no verdict lands. Correct resolved callers score (skill-weighted: contrarian + early-bird) and climb the **O Profeta** leaderboard. Anonymous-first.

## Stack & locations
- **App:** Expo SDK 56 (React Native 0.85, TypeScript). Web + Android dev build.
- **Backend:** Supabase (Postgres). Project ref `viotounckcqwmxyotzrv`.
- **Admin:** `gossip-admin/admin.html` — self-contained Viddi curator console (curator login e.g. `admin@fofoca.com`; infra email unchanged until Chris says otherwise).
- **Bots:** `scripts/ingest.mjs` (Google News RSS → Claude evidence-policy drafts with resolve-by windows) + `scripts/resolve-deadlines.mjs` (policy-aware CAP/VOID resolver, dry-run default), via `.github/workflows/`.
- **Repo:** https://github.com/pastorfred/gossip (branch `main`).
- **Planning docs:** Obsidian `Brainstorm Abs/04 Ideas/Gossip App *` (brainstorm, brief, PRD, architecture, UX, epics, build log, **Graphics & Visuals TODO**).
- **Business docs:** Obsidian `Brainstorm Abs/05 Business/` + repo `05 Business/` (investor deck, financial plan, T&C + NDA drafts — all DRAFT, need counsel).

## ⭐ How we work — TWO COORDINATED AGENTS (read this)
The build runs as two autonomous loops driven by **`BACKLOG.md`** (repo root = the live task list, file-scoped lanes):
- 🟣 **Claude = UI lane:** `src/screens/`, `src/components/`, `src/theme/`, `App.tsx` wiring.
- 🔵 **Hermes = backend lane:** `supabase/migrations/`, `src/lib/`, `scripts/`, `gossip-admin/`, backend tests.
- Never edit the other lane's files — use a `[handoff]` item in `BACKLOG.md` instead.
- **Per task:** `git pull --rebase` → pick top unchecked item in your lane (skip `[handoff: human]` / `[blocked]`) → implement small → `node ./node_modules/typescript/bin/tsc --noEmit` + `node --test tests/*.test.mjs` (**never commit red**) → commit + push (Co-Authored-By trailer) → check off in `BACKLOG.md`.
- **STOP and ask Chris before:** applying a Supabase migration (he runs them by hand), destructive actions, or product/pricing/legal/brand decisions.

## Built (v1 complete + lots of polish)
- **Core loop:** T&C gate, anon session, daily feed (hero market + tabs **Em aberto / Resolvidas**), card→detail, `place_bet` (write-once, cast-time capture), optimistic vote + spring reveal, `resolve_rumor` scorer, win **payoff** (confetti + count-up) with **share-the-win** text/link, My Bets, leaderboard, profile.
- **Resolution model:** hybrid per-rumor policy (`0028` applied). Default `evidence` rumors resolve TEA/CAP only with credible sources; the 7-day default `prediction_deadline` is a resolve-by window and lapses to **VOID** (push, no score/accuracy impact). Curator-selected `deadline` rumors are true "by date X" questions and still CAP on timeout. Admin + ingest now default new items to evidence policy.
- **Comments + safety:** flat comments, like/sort/report/block, profanity filter, guidelines gate.
- **Social (Viddi Social tab 💬):** repost a rumor with a take + 1–5 spice rating; gossip-level 🍵 like/dislike reactions; **Twitter-style repost replies** (tap a repost → reply thread + composer) and **tap the quoted gossip → original detail** (`getRumorById`).
- **Curator admin:** create/schedule/seed/resolve, moderation queue, drafts, evidence sources.
- **Content automation:** Google News RSS → Claude frames each item as evidence-resolved gossip with a 7-day resolve-by window, writes headline + article + seed counts → inserts as **drafts** for one-click approval.
- **UI polish (recent, all on main):** Social skeletons/empty/error · reaction haptics + spring pop · first-run explainer · shared EmptyState · leaderboard **podium + rank ▲/▼ arrows + você pill** · profile **🍵 avatar + accuracy bar** · accessibility pass · article typography · **Pro paywall scaffold** (ProSheet, non-functional) · **breaking-news 🚨 hero** · **status-tier ladder** (Aprendiz→…→Lenda do Babado) · keyword search.
- **Scale/security hardening (Hermes):** single feed RPC, atomic bet counter, denormalized reaction counts, DB write rate-limits, server search RPC, leaderboard rank snapshots, **client RPC fallbacks** (UI works even before migrations apply), admin audit log, moderation queue RPC + audit triggers, config preflight/env-file leak guard with fail-closed CLI parsing, dependency-audit gate with fail-closed CLI argument parsing, dedicated Gitleaks secret-scan CI, config-threaded migration-drift checker, anonymous-cleanup dry-run, import-safe/config-threaded ops scripts (including redaction-safe deadline resolver and ingest validation), stricter ingest AI output validation, scheduled workflow concurrency guards, clean ESM Node test runtime, push/PR Quality Gate workflow, **auth attempt throttling**, centralized user-input validation, admin runtime config, and DB payload/rate-limit hardening for remaining user-writable surfaces.
- **Monetization scaffold:** ad strategy documented in `docs/monetization-ads.md`; `src/lib/monetization.ts` defines consent-aware AdMob placement policy, frequency caps, Pro ad-free behavior, Pro pre-bet insight access, and the hard guardrail that ads/Pro never affect TEA/CAP/VOID, score, rank, or truth.

## 🎨 Brand
- **App icon (shipped):** flat-vector **crystal-ball with a teal tea-cup inside + gold sparkles** on hot-pink `#F62770` ("reading the tea leaves = predicting the gossip"). Master at `assets/icon-source.svg`; full-bleed `icon.png` + adaptive foreground + monochrome installed.
- **Palette:** pink `#F62770`/`#FF4D9D`, teal TEA `#0DBEB7`/`#14B8A6`, gold sparkle `#FDB936`/`#FFD43B`, white. Font: NunitoSans. Identity converging on a **mystic / "O Profeta" seer** theme.
- **Name: DECIDED → "Viddi"** (2026-06-11; Latin *vidi* / PT *eu vi* = "I saw it"). Register `viddi.app.br` + `viddiapp.com` (`.com`/`.com.br` exact are taken). Backend/admin/support user-facing strings have been rebranded; keep repo/Supabase/legacy infra names unchanged unless Chris explicitly asks for infra renames.

## Migrations (apply IN ORDER in Supabase SQL Editor — Chris applies by hand)
`0000`–`0012` (foundation → evidence sources) · `0013` social feed + reactions · `0014` place_bet draft guard · `0015` denormalized reaction counts · `0016` single feed RPC · `0017` atomic bet counter · `0018` write rate limits · `0019` server search RPC · `0020` leaderboard rank delta · `0021` admin audit log · `0022` content reports · `0023` notification preferences · `0024` analytics events · `0025` moderation queue RPC · `0026` moderation audit triggers · `0027` social repost replies · `0028` hybrid resolution/VOID · `0029` comment guideline RLS · `0030` handle validation · `0031` categories · `0032` comment counts · `0033` profile avatars · `0034` odds history · `0035` delete-account cleanup · `0036` security input/rate-limits · `0037` source clustering · `0038` keyword notifications · `0039` update markets · `0040` profile streaks · `0041` private Grupos leagues.
- ✅ **`0000`–`0031` and `0040` APPLIED**. Repost replies, hybrid resolution (incl. `void` status + `void_rumor()`), comment-guideline RLS, handle validation, rumor categories, and profile streak counters are live. Chris ran `0040_profile_streaks.sql`; `recompute_profile_streaks()` returned `14`, meaning 14 existing profiles were backfilled.
- ⏳ **`0032`–`0039` and `0041` code-ready / pending manual apply:** comment counts, profile avatars, odds history, delete-account social cleanup, security input/rate-limit hardening, source clustering, keyword notifications, update markets, and private Grupos leagues still need Chris to apply them in Supabase SQL Editor.
- ✅ **Hybrid activation follow-up:** BACKLOG #45 is code-ready: admin + ingest default new gossip to `evidence` + resolve-by window; shared feed/client status contracts are `void`-aware. The deadline resolver (`scripts/resolve-deadlines.mjs`) stays dry-run until you enable it.

## Secrets / config
- App `.env` (gitignored): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable — safe in client).
- GitHub Actions secrets: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service key NEVER in client).

## How to run
- **Web:** `npm run web` (localhost:8081).
- **Android emulator:** AVD named `fofoca`. `npx expo run:android`.
  - ⚠️ `android/` is gitignored; on a fresh clone pin `gradle-wrapper.properties` to **gradle-8.13** (RN 0.85 breaks on Gradle 9).
  - ⚠️ **Icon / native-dep changes need a full `expo run:android` rebuild** — not a Metro reload.
- **Admin:** open `gossip-admin/admin.html` in a browser, log in as curator.

## Pending / next (Chris's decisions + deferred work)
- ✅ **Migrations `0000`–`0031` plus `0040` applied** in Supabase, including hybrid resolution / VOID, rumor categories, and profile streak counters. ⏳ `0032_rumor_comment_counts.sql`, `0033_profile_avatar.sql`, `0034_rumor_odds_history.sql`, `0035_delete_account_social_cleanup.sql`, `0036_security_input_rate_limits.sql`, `0037_source_clustering.sql`, `0038_keyword_notifications.sql`, `0039_update_markets.sql`, and `0041_groups_leagues.sql` are code-ready but still need Chris to apply them live.
- ⏳ **`expo run:android` rebuild** to see the new icon + repost feature on the phone.
- **#15 Story-image win card** — APPROVED but human-gated: needs `react-native-view-shot` (native dep) + rebuild; Chris triggers via a prompt. (Viral win-share image.)
- **Pro pricing sign-off** — ProSheet shows placeholder R$ 19,90 + copy.
- **AdMob IDs / privacy sign-off** — ads are planned/scaffolded but native SDK integration waits on real AdMob app IDs/ad unit IDs and updated Terms/Privacy consent copy.
- ✅ **Name decision** — Viddi is locked; backend/admin/support user-facing strings are rebranded while infra names remain stable. UI rebrand remains tracked in BACKLOG UI #24.
- **Splash screen** — still default; match the new crystal-ball icon.
- **Graphics/visuals** — see Obsidian "Graphics & Visuals TODO" (mascot, illustrated states, rumor-card art → last needs a Hermes `image_url`/`category` field).
- ✅ **Rumor categories are live** — migration `0031_rumor_categories.sql` is applied; bounded `rumors.category`, feed/search RPC output, client mapping/search, ingest inference, and curator admin entry are implemented.
- ✅ **"Mais comentados" backend is code-ready** — migration `0032_rumor_comment_counts.sql` adds denormalized visible `comment_count`, trigger maintenance, feed/search RPC output, and `commentCount` mapping/sort support. Pending: Chris applies the Supabase migration before live RPC/direct reads return the new count.
- ✅ **Server avatars backend is code-ready** — migration `0033_profile_avatar.sql` adds `profiles.avatar`, validates the curated emoji set, exposes avatars through leaderboard/comments/social/repost replies, and adds `set_avatar(p_avatar)`. Pending: Chris applies the Supabase migration before live avatars appear to others.
- ✅ **Odds history backend is code-ready** — migration `0034_rumor_odds_history.sql` adds periodic `rumor_odds_snapshots`, `snapshot_rumor_odds()`, `get_rumor_odds_history(...)`, and `Rumor.oddsHistory`; GitHub Actions snapshots every 3 hours. Pending: Chris applies the Supabase migration before live sparkline data appears.
- ✅ **Delete-account fix is code-ready** — migration `0035_delete_account_social_cleanup.sql` repairs `delete_my_account()` for newer social/report/notification/analytics/rate-limit tables that could block `auth.users` deletion; the Profile screen now surfaces deletion failures instead of navigating as if deletion succeeded. Pending: Chris applies the Supabase migration before live account deletion is fixed.
- ✅ **Cybersecurity hardening pass is code-ready** — migration `0036_security_input_rate_limits.sql` adds remaining DB rate-limit triggers, safe text/JSON/token size constraints, and rate-limited profile mutation RPCs; client auth routes enforce 5 failed attempts / 15 minutes; app user-input validation is centralized; admin Supabase config is runtime-only; `SECURITY_REVIEW.md` lists remaining risks. Pending: Chris applies the Supabase migration before DB-side enforcement is live.
- ✅ **Source clustering backend is code-ready** — migration `0037_source_clustering.sql` adds `rumors.source_count`/`event_key`, source-count triggers, feed/search RPC output, conservative ingest clustering onto `rumor_evidence_sources`, and admin split/merge controls; `Rumor.sourceCount` falls back to `evidenceSources.length` pre-migration. Pending: Chris applies the Supabase migration before live source counts/event keys are authoritative.
- ✅ **Keyword notifications backend is code-ready** — migration `0038_keyword_notifications.sql` adds `keyword_subscriptions`, service-role `notification_queue`, publish-time keyword matching, notification preference/frequency caps, and service-role queue RPCs; `src/lib/notifications.ts` exposes keyword subscription helpers; `.github/workflows/send-keyword-notifications.yml` runs the Expo push sender every 15 minutes. Pending: Chris applies the Supabase migration and configures GitHub secrets; client push-token registration remains native-dep/dev-build gated.
- ✅ **Update markets backend is code-ready** — migration `0039_update_markets.sql` adds nullable `rumors.updates_rumor_id` self-reference, feed/search RPC parent summaries, conservative ingest follow-up linking, and admin set/clear controls; `Rumor.updatesRumor` is `{ id, summary } | null` with pre-migration fallback. Pending: Chris applies the Supabase migration before live update references appear.
- ✅ **Profile streak stats are live** — migration `0040_profile_streaks.sql` adds `profiles.current_streak`/`best_streak`, updates `resolve_rumor()` to increment/reset streaks in scoring order, keeps VOID as a push with no accuracy/streak change, backfills existing scored history chronologically, and exposes `MyProfile.currentStreak`/`bestStreak` plus `LeaderRow.currentStreak` with zero fallbacks. Chris applied it; `recompute_profile_streaks()` returned `14` backfilled profiles. UI #27 is now unblocked to render current/best streaks.
- ✅ **Private Grupos backend is code-ready** — migration `0041_groups_leagues.sql` adds time-limited private leagues (`groups`, `group_members`), member-only RLS, SECURITY DEFINER RPCs with explicit auth/handle/cap/rate-limit checks, owner transfer/delete semantics, invite-code collision retry/regeneration, and frozen windowed group leaderboards using `predictions.awarded_at`. `src/lib/groups.ts` exposes typed missing-RPC-safe wrappers. Pending: Chris applies the Supabase migration before live Grupos work; UI #28 is filed for the O Profeta groups view/duration picker/join-code/invite/owner management.
- **Legal** — T&C + NDA drafts in `05 Business/` need a Brazilian lawyer; `src/content/terms.ts` is placeholder.
- **GTM / cold-start** — dense-beachhead launch; **Store release** — EAS + Google Play ($25).

## Token discipline (multi-session)
Project is split across sessions to save tokens. New sessions: **trust this file + `BACKLOG.md`** instead of re-exploring the codebase or re-reading large files. Keep summaries short.

## Co-dev setup
`git clone` → `npm install` → `.env` with the two Supabase public values → `npm run web`.
