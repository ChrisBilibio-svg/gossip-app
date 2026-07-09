# Fofoca — UI Redesign Brief & aura.build Prompt

_Source of truth for a professional visual redesign. Synthesized from the design spine (`04 Ideas/Gossip App UX/DESIGN.md` + `EXPERIENCE.md`), the implemented tokens (`src/theme/tokens.ts`), and the live screens. **Direction: sleek prediction-market / fintech** (chosen 2026-06-10). Last updated 2026-06-10._

## Direction & why
The current build is the *playful* identity — rounded everything, hot-pink-everywhere, chunky type, emoji-forward. It reads like a toy and isn't the look we want. **The redesign reframes Fofoca as a premium prediction-market product**: gossip is the *content*, but the chrome is a serious, data-forward betting/markets app. Think **Polymarket · Kalshi · Robinhood · Linear · Manifold Markets**.

The mental model shifts: a rumor is a **market**, voting TEA/CAP is **taking a position**, the crowd split is **implied probability**, points are a **track record / P&L**, and the leaderboard is a **traders' ranking**. Keep the Brazilian gossip *soul* in the copy and content; put the polish in the chrome.

**Feel:** data-driven, confident, dense-but-breathable, "real-money" premium. Dark-first. Precise typography, tabular numbers, restrained accent color, crisp cards.

---

## ⬇️ COPY-PASTE PROMPT FOR aura.build

> Paste everything in the block below into aura.build.

```
Design a high-fidelity, PREMIUM mobile app UI mockup (iOS/Android phone, portrait) for "Fofoca" — a Brazil-first gossip PREDICTION MARKET. Curated celebrity/pop-culture rumors are framed as markets; users take a position that each rumor is TEA 🍵 (true) or CAP 🧢 (false); each market resolves by a credible source or a 7-day deadline; correct callers build a track record and climb the "O Profeta" leaderboard. Anonymous-first, copy in Brazilian Portuguese (pt-BR).

CRITICAL — DO NOT make this look playful, candy, cartoonish, rounded-everything, or emoji-decorated. This is the OPPOSITE of a toy app. Model the visual language on serious prediction-market & fintech products: Polymarket, Kalshi, Robinhood, Manifold Markets, Linear, Coinbase. Data-forward, precise, confident, premium. A rumor = a market; voting = taking a position; the crowd split = implied probability; points = a track record.

CANVAS & MOOD: DARK-FIRST. Deep plum-ink near-black background, slightly lighter elevated card surfaces, hairline borders. High density but breathable. Sharp, intentional, "real-money" polish. (Also provide a clean LIGHT variant as secondary: near-white #FAFAFB, ink text — same system inverted.)

COLOR TOKENS (dark theme — use exactly; color is a PRECISE ACCENT, never a fill-everything):
- Background (base): #0D0B12 (plum-tinted near-black)
- Elevated card surface: #16131C ; raised/secondary: #1B1722
- Hairline borders / dividers: #2A2533
- Primary text: #F5F3F7 ; secondary/muted text: #9B93A8 ; faint: #6E6680
- Brand / primary accent (CTAs, active, key highlights): hot pink #FF4D9D (use sparingly, as a sharp neon-on-dark accent)
- TEA side (true / "yes"): teal #2DD4BF
- CAP side (false / "no"): coral #FB7185
- Confirmed/resolved-true: green #22C55E ; Open/Speculated: amber #F59E0B ; resolved-false: a desaturated red #F0556F
- Points / win / track-record gold: #FFC83D
RULE: teal/coral are EXCLUSIVELY the two market sides; pink is the brand/action accent; gold is points/winning. Never blur these roles. On dark, accents glow precisely — keep large surfaces neutral ink.

TYPOGRAPHY:
- UI + headlines: a precise modern grotesk — "Inter" (or Geist/Söhne/Aeonik style). Tight, confident hierarchy. NO rounded/chunky display faces.
- ALL NUMBERS use TABULAR / MONOSPACE numerals (odds %, points, ranks, counts, timers, prices) — "Geist Mono" / "JetBrains Mono" / Inter tabular figures. Numbers must align in columns like a trading UI.
- Rumor headlines: medium-weight grotesk, generous size, but the layout (not the typeface) carries the drama.

SHAPE & SPACING: tight, intentional radii — cards 12px, buttons 8–10px, pills ONLY for tags and the odds bar. 1px hairline borders (#2A2533). 4px grid; comfortable but data-dense. Low-key elevation (subtle shadow + border on dark), not floaty candy cards. Crisp line icons (no decorative emoji; 🍵/🧢 appear only as small functional side markers).

GENERATE THESE SCREENS (one mockup each, cohesive dark set):

1) FEED / MARKETS (home) — top bar: "Fofoca" wordmark (tight grotesk), search + filter icons. A featured "FOFOCA DO DIA" market at top (subtly elevated, a thin pink accent edge, an "AO VIVO"/open status chip, a deadline timer "fecha em 3d 14h" in mono). Below, a Em aberto / Resolvidas segmented control, then a dense list of MARKET CARDS. Each card: a status chip (ABERTO amber / CONFIRMADO green / CAP red), the rumor headline (grotesk), a slim teal|coral ODDS BAR with mono percentages "TEA 62% · 38% CAP", a volume line "1.247 palpites" (mono), and a tiny sparkline showing how the split moved. Looks like a markets list, not a social feed.

2) MARKET CARD — UNPOSITIONED vs POSITIONED (show both states). Unpositioned: two order-ticket-style buttons "TEA 🍵 62%" (teal) and "CAP 🧢 38%" (coral), styled like buy/long-short buttons with the implied % on each. Positioned: collapses to a compact row — your side highlighted, entry % shown, "Posição trancada 🔒" in muted text, and the live split. Treat it like an executed trade.

3) MARKET DETAIL — the rumor headline, a clean article body (grotesk body, "Ler mais"), a source link for resolved markets, a larger ODDS panel with the teal/coral split + a probability-over-time line chart + volume + the deadline countdown, the position buttons, and below a flat COMMENTS section (Recente/Top toggle, rows: @handle · text · timestamp · ❤️ count · overflow→Report/Block; pinned bottom compose bar, placeholder "Solta teu palpite, sem acusação 👀"). Comments are understated, secondary to the market data.

4) MY POSITIONS ("Palpites") — a portfolio view. Two sections: ABERTAS (open positions — rumor, your side, entry %, current %, deadline countdown, a subtle status) and RESOLVIDAS (settled — won rows in gold/green with "+65 pts" in mono, lost rows muted/red, never punishing). A small summary header: total points, accuracy %, open count — all mono, like a portfolio balance. Empty: "Nenhuma posição aberta. Bora dar uns palpites? 👀".

5) LEADERBOARD ("O Profeta") — a traders' ranking TABLE. Columns (mono, right-aligned): rank #, @handle, points, accuracy %, ▲/▼ rank delta in green/red. Top 3 get a restrained highlight (no crowns/medals — a subtle gold accent + tier label). Each row shows a status-tier label. The user's OWN row is pinned and accent-bordered with a "(você)" tag even when ranked low.

6) PROFILE — a trader dashboard. Big mono points balance + accuracy %, a current STREAK, open-positions count, a STATUS TIER with a thin progress bar to the next tier (ladder: Aprendiz → Fofoqueiro → Vidente → Profeta → Lenda do Babado — as clean text labels, not cartoon badges), an accuracy/track-record line chart (equity-curve style), a "Fofoca Pro" upgrade row, and settings (LGPD account delete, report/contact). Restrained, data-dense.

7) SOCIAL — reposts presented like analyst takes: a user reposts a market with their call + a 1–5 conviction rating (slim bar, not chili emojis), the quoted market embedded in a bordered box (tap → Market Detail), reaction counts and reply count in mono. Clean, threaded, sober.

8) RESOLVED / WIN MOMENT (premium, NOT confetti-candy) — when a position settles in the user's favor: a dark settlement screen with a precise gold+green glow (not raining confetti), "VOCÊ ACERTOU" in confident grotesk, "+65" points ticking up in tabular gold, a rank climb "#9 → #7", an accuracy bump, and a single CTA "PRÓXIMA". Satisfying and celebratory but sharp and premium — like a winning trade settling, with a tasteful glow/particle accent and haptic. Keep it the one bright moment in a calm dark app.

9) FIRST-RUN / HOW IT WORKS — a sober, well-typed explainer: TEA 🍵 = é verdade, CAP 🧢 = é mentira; how markets resolve (source or 7-day deadline); how points/track-record work. Clean diagrammatic, not illustrated-cartoon.

10) EMPTY & LOADING STATES — skeleton market cards (shimmer on dark, never blank), and minimal, typographic empty states.

MICROCOPY (pt-BR, confident but warm — keep it on the mockups): position buttons "TEA 🍵" / "CAP 🧢"; crowd split "A galera acha 62% tea"; featured label "FOFOCA DO DIA"; locked "Posição trancada 🔒"; deadline "fecha em 3d 14h"; win "VOCÊ ACERTOU"; loss "Foi cap dessa vez" (kind, never mocking); status "ABERTO / CONFIRMADO / CAP". Never state a rumor as fact — always framed as a claim + crowd probability ("a fofoca diz...").

ACCESSIBILITY: all text meets WCAG AA on the dark surfaces; never convey a market side by color alone — pair teal/coral with the 🍵/🧢 marker + label; hit targets ≥44pt; position buttons large and thumb-reachable.

DON'Ts: NOT playful/candy/cartoon; NOT rounded-everything; NOT emoji-as-decoration; don't blur the teal/coral (market sides) vs pink (brand) vs gold (points) color roles; don't bury the position buttons or the status chip; don't make the win a childish confetti party — keep it premium.

Deliver a cohesive, modern, premium, DATA-FORWARD dark UI set that feels like a serious prediction-market product wearing Brazilian-gossip content.
```

---

## Reference appendix (the detail behind the prompt)

### Product in one line
Curated rumors → crowd takes a position **TEA 🍵 (true) / CAP 🧢 (false)** → default evidence markets resolve by credible sources and VOID/push if the resolve-by window lapses with no verdict; explicit deadline markets still CAP on timeout → correct callers build a track record and climb the **O Profeta** leaderboard. Anonymous-first, pt-BR.

### The reframe (gossip app → prediction market)
| Gameplay concept | Old (playful) framing | New (market) framing |
|---|---|---|
| A rumor | a card to vote on | a **market** (with volume, odds, a close time) |
| Voting TEA/CAP | tap a candy button | **taking a position** (order-ticket buttons w/ implied %) |
| Crowd split | "A galera acha 62%" pill | **implied probability** + probability-over-time sparkline |
| My Bets | list of bets | a **portfolio** of open/settled positions |
| Points | win coins | a **track record / P&L** in tabular gold |
| Leaderboard | podium + crowns | a **traders' ranking table** w/ rank deltas |
| Win | confetti party | a **settlement** moment — premium glow, numbers tick up |

### Screen inventory (in scope)
- **Tabs:** Feed/Markets · Social · Palpites (My Positions) · O Profeta (Leaderboard) · Perfil.
- **Overlays/sheets:** Market Detail, Comments, Repost/take thread, Win/Settlement, First-Run, Terms gate, Handle prompt (pick @ on first position), Account sheet, Pro sheet.

### New design-language tokens (dark-first)
- **Surfaces:** base `#0D0B12` · card `#16131C` · raised `#1B1722` · border `#2A2533`.
- **Text:** primary `#F5F3F7` · muted `#9B93A8` · faint `#6E6680`.
- **Accents (precise, not fills):** brand pink `#FF4D9D` · TEA teal `#2DD4BF` · CAP coral `#FB7185` · confirmed green `#22C55E` · open amber `#F59E0B` · resolved-false red `#F0556F` · points gold `#FFC83D`.
- **Type:** grotesk (Inter/Geist/Söhne) for everything + **tabular/mono numerals** (Geist Mono / JetBrains Mono) for all numbers.
- **Shape:** cards 12px · buttons 8–10px · pills only for tags + odds bar · 1px hairlines · 4px grid · low-key elevation.

### What this deliberately abandons from the current build
Baloo-style chunky display, pill-everything radii, pure-flat-white candy cards, emoji-as-decoration, the podium/crowns leaderboard, and the confetti win. The brand pink/teal/coral/gold are retained but used as **disciplined data accents on dark**, not as fills.

### Note
This direction departs from the original `DESIGN.md`/`EXPERIENCE.md` spine (which specified the *playful* identity). If you adopt it, those spine docs should be updated so the repo stays internally consistent — flag and I'll prepare that change.
