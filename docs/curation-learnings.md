# Curation Learnings Journal

Hermes's cumulative memory for the self-improving curation loop. Newest cycle on
top. Keep entries tight and factual: funnel counts, scorecard + trend, specific
misses, exact changes, open hypotheses.

---

## Cycle 1 — screen tightening from dry-run + live outcome read (2026-07-27)

**Funnel / dry-run**
- `node scripts/auto-curate.mjs` remained dry-run/no-write with `AUTO_PUBLISH_KILLED=true`.
- Feed fetch was healthy: outlet RSS + Google discovery pulls returned 1,519 raw feed items before dedupe/existing-link filtering.
- Initial full AI drafting did **not** complete because Anthropic returned billing/credit errors; no secrets were printed and no DB writes happened. The deterministic pre-screen probe still fetched 131 post-dedupe candidates with 51 recent DB links excluded.
- After Chris funded the API, full dry-run completed successfully with no writes: 30 drafts considered → 0 `auto_publish`, 30 `queue_draft`, 0 `skip`; reason histogram: `auto_publish_killed` 16, `screen_reject` 14. The kill switch remained ON, so no market was published.
- Before this cycle's screen changes: 130 deterministic candidates → 2 `approve_candidate`, 109 `needs_review`, 19 `reject`. Reason histogram: `no_future_event_signal` 100, `discovery_only_needs_real_source` 80, `not_market_suitable` 13, `sensitive_claim_insufficient_sourcing` 4, `age_unknown_possible_minor` 4, `event_already_known` 3, `minor_subject` 1, `not_objectively_resolvable` 1.
- After changes: 131 deterministic candidates → 0 `approve_candidate`, 108 `needs_review`, 23 `reject`. `not_market_suitable` rose to 18, and the false `minor_subject` hit disappeared.

**Outcome measurements (read-only SQL/REST, last 7d unless noted)**
- Published markets: 1 (`Novelas | Extra`, Thalita Carauta / Avenida Brasil). Trades: 2 positions, 20 total coins staked, time-to-first-trade ≈ 2 minutes.
- Past-deadline markets: 6 total, 0 TEA/CAP resolved, 0 VOID, 6 still `speculated` after deadline. This is a resolver/ops signal rather than a content-quality win.
- Approval audit: 1 `publish`, 0 rejects/request-changes in the 7d audit window. No recent reject examples exist to spot-check yet.
- Spot-check approve: Thalita Carauta market looks suitable (future casting/announcement, reliable Extra source, approved probability 0.55). No false-approve found in the audit sample, but sample size is only 1.
- Probability calibration: not computable yet; no audited recent market has resolved TEA/CAP/VOID.

**Scorecard**
- engagement_norm = 1.00 (1/1 published market has ≥1 trade; note both trades look like test traffic, not reliable organic signal).
- one_minus_void_rate = 1.00 if counting only explicit VOID, but this hides 6/6 past-deadline markets still unresolved/speculated. Operationally treat this as unhealthy until the resolver runs.
- approval_rate = 1.00 (1 publish, no reject/request-change actions).
- Formula score = 1.00 vs Cycle 0 `n/a`; trend is directionally positive but **statistically meaningless** because n=1 and trades are test-sized.

**Misses found + fixed**
- False approve: `Ronnie Wood, dos Rolling Stones, vai fazer show único no Brasil; saiba tudo` — confirmed concert listing/service copy, not a prediction market. Added `not_market_suitable` screen pattern + reject regression; keep-case `Cantora vai anunciar show extra no Brasil?` remains approved.
- False approve: `Hollywood já prepara seu próximo filme... acho que eles ainda não entenderam como funcionam os sucessos virais` — media meta-opinion, not a public-figure outcome market. Added meta/opinion screen pattern + reject regression; keep-case `Atriz vai estrear em filme de terror viral?` remains approved.
- False reject: `Social Distortion retorna ao Brasil após 16 anos...` was tagged `minor_subject` because `16 anos` matched age. Tightened age matching so duration phrases like `após 16 anos` do not imply minors; added keep-case plus explicit `filha de 16 anos` reject-case.

**Open hypotheses / next cycle**
1. Full Anthropic drafting path is funded again; keep tracking whether `auto_publish_killed` vs `screen_reject` stays in a healthy range as real candidates change.
2. Treat the 6 expired/still-speculated markets as a resolver visibility issue: separate content quality from deadline-processing health.
3. Once there are ≥10 published markets and real trades, compare `Novelas`/casting markets against generic `Celebridades` for trade rate and VOID rate.

## Cycle 0 — baseline (2026-07-27, seeded by setup)

**State of the board**
- Live markets: 1 open/bettable (Thalita Carauta casting, deadline 2026-07-31);
  14 published-but-EXPIRED (still shown as "ABERTO"), 5 resolved (confirmed).
- Trades so far: 2 test positions (test1, test6) on Thalita, 10 coins each. No
  organic trading volume yet — too early for engagement signal.

**Funnel (from auto-curate dry-run this session)**
- One live feed pull produced ~18 drafted candidates; before tightening, 15/18
  were (wrongly) auto_publish-eligible.

**Misses found + fixed this session**
- False-approves: AI reframed PAST/trivial/sensitive headlines into future-sounding
  questions that slipped the screen. Examples now rejected: "…terminaram o namoro
  em 2024", "…visitaram a mansão", "…sobre a morte inesperada", "…perdeu 6 kg",
  "…compartilhará fotos de férias".
- Changes made: screen.mjs now rejects extra past-tense verbs, any year earlier
  than "now", death/grief + body/weight (as sensitive), and trivial paparazzi
  non-events. +6 regression tests. All 6 leaked examples reject; genuine future
  markets (Anitta 2026, Thalita casting) still approve.

**Known systemic issues (not curation, but they distort signal)**
- Feed (get_feed / "Em aberto" tab) shows expired + resolved markets as open →
  users mostly see un-bettable markets. This suppresses trade engagement and will
  bias any engagement metric until fixed. Track separately; not Hermes's to fix.
- Scheduled ingest runs from `main`, which lacks the tightened screen.mjs → raw
  stale drafts. Resolves when the feature branch merges to main.
- Auto-publish DISABLED (kill switch ON). Correct for now.

**Baseline scorecard**
- Not computable yet (only 1 real market, no organic trades, resolvability window
  not elapsed). First real score expected after ~1 week of published markets +
  trades. Placeholder: score = n/a.

**Open hypotheses for next cycle**
1. Which categories/sources produce markets that actually get traded? (need >1
   live market to tell — depends on more markets being published.)
2. Are "casting/announcement" markets (será anunciado) more resolvable within 7
   days than "relationship" markets? Compare TEA/CAP vs VOID once data exists.
3. Is the default Verdade probability (0.50) biased vs actual resolution?
