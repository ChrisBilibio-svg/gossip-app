---
title: "DESIGN — Gossip Prediction App (Brazil)"
status: final
created: 2026-06-02
updated: 2026-06-02
sources:
  - "Brainstorm Abs/04 Ideas/Gossip App PRD/prd.md"
  - "Brainstorm Abs/04 Ideas/Gossip App Architecture/architecture.md"
colors:
  bg: "#FFFBF5"          # warm off-white / cream
  surface: "#FFFFFF"     # cards
  surface-sunken: "#FFF3F8" # subtle pink-tinted wells
  primary: "#FF4D9D"     # hot pink — brand, primary CTAs
  primary-press: "#E23C88"
  accent: "#FFD43B"      # sunny yellow — highlights, points, winning
  tea: "#14B8A6"         # 🍵 "true" vote side (teal)
  cap: "#FB7185"         # 🧢 "cap"/false vote side (coral)
  confirmed: "#16A34A"   # Confirmed tag (green)
  speculated: "#F59E0B"  # Speculated tag (amber)
  gold: "#FFC83D"        # win coins / O Profeta
  text: "#1A1626"        # near-black plum
  muted: "#7A7290"       # secondary text
  border: "#F0E6EE"
  success: "#16A34A"
  danger: "#EF4444"
typography:
  display: "Baloo 2"     # [ASSUMPTION] rounded, chunky, playful; great PT-BR glyph support
  body: "Nunito Sans"    # [ASSUMPTION] friendly humanist sans for readability
  scale: "1.25 (major third)"
rounded:
  sm: "8px"
  md: "14px"
  lg: "20px"
  pill: "999px"          # buttons, tags, vote bar
spacing:
  base: "4px"            # 4 / 8 / 12 / 16 / 24 / 32
components: [card, vote-bar, vote-button, tag-pill, payoff-overlay, leaderboard-row, bottom-nav, stat-chip]
---

# DESIGN — Gossip Prediction App (Brazil)

> Visual identity spine. **This file owns how it looks.** EXPERIENCE.md owns how it works and references these tokens by name. On any conflict with a mock, this spine wins.

## Brand & Style

**Personality:** the funniest, most plugged-in friend in the group chat. Playful, warm, a little cheeky — *fofoca* (gossip) as joyful social sport, never mean or tabloid-trashy. Brazilian warmth: bright, generous, expressive.

**Voice in pixels:** rounded everything, chunky friendly type, lots of warm white space so the punchy pink/yellow pops. Motion is bouncy and alive. The everyday feed is calm and readable; the *winning* moment is loud, saturated, and celebratory.

**Three words:** Playful · Warm · Alive.

## Colors

Light, warm base so the brand colors sing. **Pink `{colors.primary}` = brand + action.** **Yellow `{colors.accent}`/`{colors.gold}` = points, winning, delight.** The two vote sides are always **teal `{colors.tea}` (🍵 true)** vs **coral `{colors.cap}` (🧢 cap)** — never pink/yellow, so voting reads instantly distinct from branding.

- **Background** `{colors.bg}` cream; **cards** `{colors.surface}` white with a soft shadow.
- **Tags:** Confirmed `{colors.confirmed}` green, Speculated `{colors.speculated}` amber — the trust signal, always visible.
- **Contrast:** all text meets WCAG AA on its background (`{colors.text}` on cream/white; white on pink CTAs). Verify the amber/teal/coral on white at small sizes — darken if AA fails.

## Typography

- **Display `{typography.display}` (Baloo 2):** headlines, rumor summaries, the hero card, points numbers. Chunky and rounded — carries the playful energy.
- **Body `{typography.body}` (Nunito Sans):** metadata, counts, UI labels, longer text. Friendly but clean.
- Big, confident sizes. The rumor text is the star of each card — generous size, tight rounded display face.

## Layout & Spacing

- Single-column, vertically scrolling **card feed** (Twitter/Tea DNA). `{spacing.base}` 4px grid.
- Comfortable card padding (16–20px), generous gaps between cards (12–16px) so scrolling feels light, not cramped.
- Thumb-reachable: primary actions (the vote buttons) sit low on the card and screen.

## Elevation & Depth

- Soft, diffuse shadows (warm-tinted, low opacity) — friendly, not harsh. Cards float gently on the cream.
- The **hero "Fofoca do Dia"** card sits one elevation higher + slightly larger + a pink accent edge — visibly the main event.
- The **payoff overlay** is the top layer — a full-screen takeover above everything.

## Shapes

- Rounded-everything: cards `{rounded.lg}`, buttons & tags & vote bar `{rounded.pill}`, inner wells `{rounded.md}`.
- No hard right angles in the brand surfaces. Roundness = friendliness.

## Components

- **card** — white, `{rounded.lg}`, soft shadow. Holds: tag-pill, rumor summary (display face), vote-bar, vote-buttons, palpite count. The hero variant is larger with a pink edge + ⭐/🔥 marker.
- **vote-bar** — horizontal pill split teal/coral showing the crowd %. Animates *once* on reveal (see EXPERIENCE Motion). Labeled "🍵 62% · 38% 🧢".
- **vote-button** — two big pill buttons: **🍵 É TEA** (teal) / **🧢 É CAP** (coral). Press = haptic + spring. After voting they collapse into the result state.
- **tag-pill** — small pill: green CONFIRMADO / amber ESPECULADO.
- **payoff-overlay** — full-screen celebratory takeover for a win: saturated pink→yellow wash, confetti, points counting up, rank tick. The signature moment.
- **leaderboard-row** — rank, anonymous handle, points (gold), accuracy %. Top 3 get a crown/medal flourish.
- **stat-chip** — compact pill for profile stats (points, accuracy, open bets).
- **bottom-nav** — Feed · My Bets · Leaderboard · Profile.

## Do's and Don'ts

- ✅ Keep the everyday feed calm and readable; spend the visual loudness on the **win** moment.
- ✅ Keep teal/coral exclusively for voting; pink/yellow exclusively for brand/reward. Never blur these.
- ✅ Always show the Confirmed/Speculated tag — it's the trust spine.
- ❌ Don't make it look like a casino or a tabloid — playful, not seedy; we're "opinion data," never accusations.
- ❌ Don't animate a fake-live ticker. The split animates once, on reveal (see EXPERIENCE).
- ❌ Don't bury the vote buttons — they're the whole point; keep them thumb-reachable and unmissable.
