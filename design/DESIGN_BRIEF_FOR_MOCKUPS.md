# Viddi — Design Brief for Mockup Generation

_A copy-paste prompt for a design/mockup generator (e.g. Claude Design) to produce a full
visual redesign of the app. Built from `AUDIENCE_RESEARCH.md` + `UI_PREFERENCES_RESEARCH.md`,
and from a screen-by-screen read of the current `src/screens` + `src/components`. It is a
re-skin brief: keep every screen's information and controls, change the visual language._

---

You are a senior product designer. Design a full visual redesign of "Viddi," a
Brazilian mobile app, as high-fidelity mobile mockups (portrait, ~390×844,
iPhone/Android safe areas). Produce ONE mockup per screen listed in the
INTERFACES section, in BOTH dark mode (primary) and light mode. Annotate each
with the color/type/spacing decisions you made. This is a re-skin of an EXISTING
app — keep every screen's information and controls; change the visual language,
not the feature set.

═══════════════════════════════════════════════════════════════════
PRODUCT
═══════════════════════════════════════════════════════════════════
Viddi is a FREE, play-money "jogo de palpites" (guessing game) about Brazilian
pop culture, reality TV (BBB, A Fazenda), celebrity gossip, and football
transfer rumors. Users call each rumor 🍵 TEA (it's true) or 🧢 CAP (it's cap/
false), markets resolve by trusted sources or a deadline, and correct calls earn
points, streaks, tiers, and leaderboard rank. Anonymous-first, pt-BR only.

HARD POSITIONING CONSTRAINTS (do not violate):
- It is a GAME, never a "mercado de previsões / aposta / betting" product. Brazil
  banned prediction markets in 2026, so the vocabulary and vibe must read as
  playful pop-culture game, NOT a fintech trading/betting terminal. Keep clean
  structure and trustworthy data, drop the cold "trading desk" feeling.
- "Opinião, nunca acusação" — it's fun crowd opinion with sourced resolution
  ("fofoca com recibo"), never accusation. No mugshot/tabloid cruelty.
- Celebratory, not manipulative — dopamine through delight, no dark patterns.

AUDIENCE: BR Gen-Z + millennials, female-skewing, reality-TV/gossip superfans,
second-screen + WhatsApp-group native, mostly on MID-RANGE ANDROID (Moto G /
Samsung A). Must feel fast, legible, and premium on cheap OLED phones.

═══════════════════════════════════════════════════════════════════
DESIGN DIRECTION (from audience UI research — apply throughout)
═══════════════════════════════════════════════════════════════════
Overall aesthetic: "DARK + DOPAMINE" — dark-mode-first but colorful, playful,
alive. Minimal structure, maximalist accents. Think TikTok/Instagram energy
crossed with the trust of a scoreboard — with a Brazilian "Y2K brasileiro"
flavor (glossy, vibrant, a little nostalgic), NOT austere fintech.

COLOR:
- Signature move: a PINK → LILAC/PURPLE gradient (approx #FF4D9D → #8B5CF6) used
  on the hero/featured card, the win moment, the wordmark, and primary CTAs.
- Accent roles (keep these semantic roles distinct, never blur them):
  • Pink #FF4D9D = brand / primary action / "you"
  • Lilac-purple #8B5CF6 = NEW secondary accent (community, social, flair)
  • Teal #2DD4BF = 🍵 TEA side (true)  •  Coral #FB7185 = 🧢 CAP side (false)
  • Gold #FFC83D = points / winning / track record
  • Green = confirmed, amber = open, red = debunked
- Optional Y2K accents used sparingly: metallic/silver highlight (premium tier
  badges), soft baby-blue as a tertiary.
- ACCESSIBILITY CATCH: the current app uses a near-black base (#07060A) which,
  with saturated neon, risks halation/vibration on cheap screens. Use a slightly
  lifted dark base (~#0E0C14 / #121016) OR temper accent saturation. Keep text
  ≥4.5:1 contrast, large/UI ≥3:1, and never put neon on small body text.
- Light mode: warm off-white canvas, same accent roles at AA-safe darker tints.

TYPOGRAPHY:
- Body/UI: Inter (clean grotesk). Numbers (odds, points, ranks, timers):
  JetBrains Mono / tabular figures — column-aligned, this is the "trust" signal.
- ADD PERSONALITY: a rounded/expressive DISPLAY typeface for the wordmark,
  hero headlines, and the win screen (e.g. a friendly rounded face like
  Baloo/Fredoka, or an expressive grotesk like Clash Display). The current build
  reads too "millennial-sleek fintech"; the audience wants more character.

MOTION / FEEL: thumb-zone primary actions; springy micro-interactions on
tap/vote/react; count-up on points; tasteful confetti/glow on wins (celebratory,
restrained). Rounded cards (12–16px), hairline borders, generous spacing.

SHARING: design share artifacts to be WhatsApp-native (share-to-WhatsApp first,
then Stories) and figurinha/sticker-friendly — public market/win cards only,
never private-screenshot styling.

Keep the existing pt-BR copy and the 🍵 TEA / 🧢 CAP emoji language.

═══════════════════════════════════════════════════════════════════
CURRENT DESIGN TOKENS (what exists today — evolve these, don't ignore them)
═══════════════════════════════════════════════════════════════════
Dark: bg #07060A, card #100D16, raised #18141F, navBar #0A0810, border #221E2B,
text #F5F3F7, muted #9B93A8, faint #6E6680. Accents as listed above.
Radius: chips 4, buttons 8, cards 12, lg 16, pill 999. Spacing on a 4px scale.
Bottom tab bar with 5 tabs. Fonts: Inter + JetBrains Mono (add a display face).

═══════════════════════════════════════════════════════════════════
INTERFACES TO REDESIGN (one mockup each, dark + light)
═══════════════════════════════════════════════════════════════════
Bottom nav (persistent): 5 tabs — Mercados (home), Palpites (trending-up),
Social (users), O Profeta (award), Perfil (user). Active tab = pink; redesign
this bar too.

1. FEED / "Mercados" (home)
   - Top bar: "Viddi." wordmark (pink dot) + search icon + filter/sliders icon.
   - Expandable search field ("Buscar por artista, novela, time...").
   - Segmented control: "Em aberto" | "Resolvidas".
   - Collapsible filter panel: ORDENAR chips (🔥 Em alta, 🆕 Recentes,
     ⏰ Encerrando logo, 💬 Mais comentados) + FILTROS RÁPIDOS chips
     (⚖️ Tá empatado, 🆕 Ainda não palpitei, 💬 Com discussão); resolved tab
     shows RESULTADO chips (Todos, 🍵 Deu TEA, 🧢 Deu CAP, ⚪ Anulado,
     🏆 Meus acertos) + "N resultado(s)".
   - Scrolling list of MARKET CARDS; first open card is the featured
     "VIDDI DO DIA" hero. Empty state (👀) and 3-card skeleton loading state.

2. MARKET CARD (the core repeating unit — show all states)
   - Status chip (ABERTO/CONFIRMADO/FURADA/ANULADO), optional "🆕 ATUALIZAÇÃO"
     chip, "fecha em Xh" deadline, mini sparkline of TEA probability.
   - Headline (rumor summary).
   - Odds bar (TEA teal vs CAP coral split) + volume "N palpites · N fontes".
   - Two vote buttons: 🍵 TEA / 🧢 CAP (with % when unlocked).
   - Variants to show: (a) featured hero, (b) normal open, (c) STATS-LOCKED for
     free users pre-vote ("🔒 Palpite para ver odds e gráficos"), (d) voted/
     locked position ("Posição trancada 🔒"), (e) resolved.

3. MARKET DETAIL (full-screen modal, opens from a card)
   - Back header "Mercado"; status + deadline + posted date; big headline;
     article body with "Ler mais"; optional "🆕 Atualização de …" quote box to a
     prior market; resolved banner (✓ Confirmado / ✕ Furada / ↔ Anulado).
   - "A galera acha" odds panel: odds bar + full sparkline "probabilidade TEA ao
     longo do tempo" — OR a locked-stats state for free users pre-vote.
   - "Como resolve" rule box + evidence source links (🍵/🧢 fonte ↗).
   - Vote block (TEA/CAP big buttons → collapses to locked pick + odds bar), or a
     resolved split for settled markets.
   - "Reação da galera" (like/dislike) + "Postar um take" composer: conviction
     bar (1–5 segments) + 280-char anonymous text + Postar button.
   - Comment section below.

4. PALPITES / "Meus Palpites" (My Bets)
   - Header; summary row: pontos (gold), acertos %, abertas (count).
   - "ABERTAS" list (headline + 🍵/🧢 side + "aguardando resolução").
   - "RESOLVIDAS" list: won (gold "+N pts", tappable → win overlay), lost
     (dimmed, "Foi cap dessa vez", "0 pts"), void ("devolvido"). Empty state 🎯.

5. SOCIAL ("Takes dos analistas")
   - Header + segmented "Recentes" | "Populares".
   - Post cards: avatar (emoji), @handle, timestamp, "convicção" 1–5 bar, take
     caption, a quoted market box ("ver mercado ↗"), like/dislike + reply count.
   - Empty state 💬.

6. O PROFETA (Leaderboard)
   - Header "O Profeta · Ranking · skill-weighted track record".
   - Column header (#, Handle, Pts, Acerto, ▲▼). Rows: rank, avatar + @handle +
     tier name, points (mono), accuracy %, rank-change arrow. Top-3 gold-tinted;
     the current user's row highlighted pink with a "você" pill. Empty state 🏆.

7. PERFIL (Profile)
   - Header; avatar (emoji, tap-to-edit pencil) + @handle + "persona anônima".
   - Stats row: pontos (gold) / acertos % / 🔥 sequência (streak).
   - Tier progress panel: current tier name → next, progress track, ladder
     (Aprendiz · Fofoqueiro · Vidente · Profeta · Lenda), "+N pts para X".
   - Track-record panel (accuracy, streaks). Dark/light theme toggle. "Viddi Pro"
     CTA. Rows to open Help, Keywords, Account. Skeleton loading state.

8. WIN MOMENT — PayoffOverlay (full-screen celebration)
   - "CONFIRMADO" → "VOCÊ ACERTOU", count-up "+N pontos" (gold), rank line
     ("agora #N no ranking ↑"), restrained particles + glow. Primary "PRÓXIMA"
     button, "compartilhar nos Stories", "compartilhar como texto".
   - ALSO design the exported 9:16 SHARE CARD: currently a solid pink card with
     🍵, "EU ACERTEI", big points, "@handle", "viddi.app.br · 🍵 TEA ou 🧢 CAP?".
     Redesign it with the pink→lilac gradient; make a WhatsApp-sticker variant.

9. ONBOARDING (FirstRunOverlay, 3 steps, dots progress)
   - Step 1 "Bem-vindo ao Viddi" — 🍵 TEA / 🧢 CAP explainer.
   - Step 2 "Como os mercados resolvem" — 📰 fonte confiável / ⏱ prazo 7 dias.
   - Step 3 "Pontos & track record" — 🏆 pontos / 📈 track record / 👤 anônimo.
   - Voltar / Continuar → "Bora dar palpites".

10. TERMS GATE (first launch) — title, intro, scrollable terms card, accept CTA.

11. MODALS / SHEETS (bottom sheets):
   - Viddi PRO paywall: "VIRE UM PROFETA PRO", 4 perks (alertas antecipados,
     analytics, flair, persona), R$19,90/mês price box, fair-play note
     ("dinheiro não pesa no palpite"), CTA.
   - Handle prompt (pick an @apelido on first vote).
   - Keywords sheet (follow keywords / notifications).
   - Help sheet, Account sheet, Avatar picker (emoji grid).

12. SHARED COMPONENTS (show a small spec sheet): odds bar, sparkline, status
    chips, like/dislike reaction buttons, tier badges (make these Y2K-metallic),
    skeleton loaders, and the bottom nav — in the new visual language.

═══════════════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════════════
- A cohesive mockup for each interface above, dark + light.
- A one-page style tile: final palette (hex), gradient, type scale + the chosen
  display font, spacing/radius, iconography, and the component spec sheet.
- Short annotations per screen explaining how it applies the research (why these
  colors/type/motion) and how it respects the "game not betting" + accessibility
  constraints.
- Start with the style tile + the Feed and Market Detail, since those set the
  system; then the rest.
