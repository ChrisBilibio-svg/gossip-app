---
title: 'A Coluna native interface'
type: 'feature'
created: '2026-07-22'
status: 'done'
baseline_commit: '1de839c'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/coin-economy-fixed-odds.md'
  - '{project-root}/design/DESIGN_BRIEF_FOR_MOCKUPS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The working native app uses the prior prediction-terminal presentation, while the selected A Coluna concept exists only as static HTML. The user needs A Coluna running against the existing Supabase-backed product so the real feed, wallet, odds, position placement, social, leaderboard, profile, and overlays remain testable.

**Approach:** Reskin the existing component tree as A Coluna rather than creating a second app: introduce its warm editorial tokens, masthead, serif story hierarchy, image-ready story slots, and newspaper-like market treatment while reusing all current API and economy code. Remove user-visible TEA/CAP language in favor of Verdade/Mentira, and show fixed-odds returns with the less-likely outcome paying the higher multiplier.

## Boundaries & Constraints

**Always:** Preserve current Supabase sessions, queries, reactions, comments, wallet ledger, 45-second server quotes, stake limits, settlement, and five-tab navigation. Keep internal `true`/`false` and legacy `tea`/`cap` identifiers where changing them would affect schemas or contracts, but expose only Verdade/Mentira or Yes/No to users. Keep odds visible before placement, display server-quote values in the confirmation sheet, retain the closed-loop coin disclaimer, meet 44-point touch targets, support dark/light themes, and provide a branded category fallback whenever editorial artwork is unavailable.

**Ask First:** Any live Supabase migration or storage bucket; activating economy/purchase kill switches; implementing Apple/Google checkout; adding licensed third-party photography; changing legal, consent, or age-rating behavior.

**Never:** Duplicate Supabase/business logic, create separate A Coluna screen trees, alter fixed-odds mathematics, invent source-credibility ratings, scrape remote images in the client, fake successful purchases, or touch the unrelated dirty ingestion/research/assets/admin/video changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Live feed | Configured Supabase with published rumors | A Coluna feed renders real stories, categories, odds, volume, sources, and coin balance | Existing refresh/error/empty states use the new visual language |
| Missing artwork | Rumor has no media field | Branded category artwork preserves the image slot and readable headline | No broken image icon or fabricated photo |
| Position quote | User selects Verdade or Mentira with coins available | Existing PredictionSlip loads canonical server odds, stake limits, and potential return | Changed/expired quote requires reconfirmation; disabled economy remains explicit |
| Probability split | Verdade 63%, Mentira 37%, 5% edge | Approx. 1.51x for Verdade and 2.57x for Mentira | Never reuse stale decorative multipliers |
| Existing position | User already placed a coin position | Locked side and odds remain visible with no second free vote path | Existing API state remains authoritative |

</frozen-after-approval>

## Code Map

- `App.tsx` — font loading and native application shell.
- `src/theme/tokens.ts` — shared A Coluna color, typography, radius, and spacing roles.
- `src/screens/FeedScreen.tsx` — masthead, edition framing, filters, live feed, store entry, detail/slip orchestration.
- `src/components/MarketCard.tsx` — editorial story card, artwork fallback, public probabilities, odds, and position actions.
- `src/components/RumorDetail.tsx` — full article/market/source/comment presentation.
- `src/components/PredictionSlip.tsx` — real server quote, stake, wallet, and return confirmation.
- `src/components/{BottomNav,CoinStoreButton,OddsBar,StatusChip,VoteBlock}.tsx` — shared navigation and market primitives.
- `src/screens/{SocialScreen,MyBetsScreen,LeaderboardScreen,ProfileScreen}.tsx` — existing functional tabs inheriting and refining the editorial system.
- `src/components/{FirstRunOverlay,HelpSheet,PayoffOverlay,WalletPanel}.tsx` — remove visible TEA/CAP metaphors and align supporting surfaces.
- `tests-ui/**` — interaction, visible-copy, odds-direction, and navigation regression coverage.

## Tasks & Acceptance

**Execution:**
- [x] `App.tsx`, `src/theme/*` — install the A Coluna dark/light visual foundation and cross-platform editorial type role without replacing API providers.
- [x] `src/screens/FeedScreen.tsx`, `src/components/MarketCard.tsx` — build the masthead, edition/category framing, image-ready story layout, live market data, wallet entry, and correct public odds.
- [x] `src/components/RumorDetail.tsx`, `src/components/PredictionSlip.tsx`, shared market primitives — carry the same editorial hierarchy through reading and coin-position placement while preserving canonical quote behavior.
- [x] Remaining screens and overlays — apply the shared visual language and remove user-visible TEA/CAP wording without changing feature behavior.
- [x] `tests-ui/**` — update copy assertions and add regression checks for odds direction, image fallback, store access, and trade-sheet entry.

**Acceptance Criteria:**
- Given a configured Supabase environment, when the app opens, then A Coluna is the active native interface and the real feed loads through the existing API path.
- Given any existing tab or overlay, when opened, then its previous controls and data remain available in the new shared theme.
- Given no story image, when a card/detail renders, then an accessible category fallback occupies the editorial image slot.
- Given a minority outcome, when odds are shown, then its multiplier is higher than the majority outcome and confirmation uses the server quote.
- Given a user searches visible copy, when onboarding, help, cards, details, and position flows render, then TEA/CAP terminology is absent.

## Design Notes

A Coluna uses a restrained warm-paper/ink palette, a serif role for masthead and story headlines, sans-serif controls, and monospaced probabilities, balances, timers, and returns. Pink remains the Viddi signature; Verdade and Mentira keep distinct semantic colors but are always labeled. Image slots are editorial hierarchy, not decoration: until a licensed media pipeline is approved, deterministic category artwork is the honest fallback.

## Verification

**Commands:**
- `npm run typecheck` — application TypeScript succeeds.
- `npm run typecheck:ui` — UI test TypeScript succeeds.
- `npm test` — contract and fixed-odds regressions pass.
- `npm run test:ui -- --runInBand` — component and screen tests pass.
- `npm run web -- --port 8123` — connected A Coluna build renders for visual/API smoke testing.

## Suggested Review Order

**Editorial entry and feed**

- Starts with the live API-backed screen and A Coluna masthead orchestration.
  [`FeedScreen.tsx:67`](../src/screens/FeedScreen.tsx#L67)

- Defines the story card, visible odds, sources, and coin-position actions.
  [`MarketCard.tsx:25`](../src/components/MarketCard.tsx#L25)

- Supplies honest category artwork whenever licensed story media is unavailable.
  [`EditorialArtwork.tsx:21`](../src/components/EditorialArtwork.tsx#L21)

**Trading and supporting surfaces**

- Preserves server-quoted odds, stake limits, failures, and closed-loop disclosures.
  [`PredictionSlip.tsx:31`](../src/components/PredictionSlip.tsx#L31)

- Carries editorial hierarchy through evidence, reactions, comments, and trading.
  [`RumorDetail.tsx:31`](../src/components/RumorDetail.tsx#L31)

- Keeps the coin store visible while respecting purchase kill switches.
  [`CoinStoreButton.tsx:13`](../src/components/CoinStoreButton.tsx#L13)

**Design system and regressions**

- Centralizes warm dark/light colors, accessible contrast, and editorial type roles.
  [`tokens.ts:53`](../src/theme/tokens.ts#L53)

- Locks visible odds, artwork fallback, and terminology into component tests.
  [`MarketCard.test.tsx:34`](../tests-ui/components/MarketCard.test.tsx#L34)

- Verifies the feed opens coin trading without restoring a free-vote path.
  [`FeedScreen.statsUnlock.test.tsx:121`](../tests-ui/screens/FeedScreen.statsUnlock.test.tsx#L121)
