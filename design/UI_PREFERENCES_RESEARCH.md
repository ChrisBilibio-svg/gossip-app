# Viddi — UI / Design Preferences Research (Brazil)

_Design-preference research for the audience in `AUDIENCE_RESEARCH.md` (BR reality-TV/gossip Gen-Z + millennials, female-skewing, mobile-only). Three progressively deeper, token-controlled passes (no multi-agent fan-out). Confidence tagged; "verified" = adversarially checked. Everything here is **inferred from trends + known app aesthetics — not first-party Viddi user testing** (see the validation plan at the end). Last updated 2026-06-18._

---

## TL;DR
The audience's taste is **"dark + dopamine"**: they strongly prefer **dark mode**, but want it **colorful, playful, animated** — not austere. Viddi's current dark-fintech build nails "dark" and under-delivers "dopamine." Highest-impact, lowest-risk change: add a **pink→lilac gradient + a purple/silver secondary** to the hero + win moment, and make sharing **WhatsApp-native**. Then **validate on real users** before going further.

---

## Layer 1 — Foundations

**Dark mode = strongly preferred (validates Viddi's dark default).** ~73% of Gen Z (Adobe); Instagram dark 77.2% among 18–34; 76% of 18–24; 82% of Android users ([Digital Silk/Yahoo](https://finance.yahoo.com/news/dark-mode-design-becomes-gen-112900313.html), [forms.app](https://forms.app/en/blog/dark-mode-statistics)). _High._ Bonus: OLED battery savings on mid-range phones.

**But they want bold color + dopamine, not restraint.** Gen-Z 2025 = neon/hot-pink/purple, gradients, "dopamine" palettes; Figma saw +40% bold design on Gen-Z platforms (TikTok/Snapchat). Winning pattern = **"minimal maximalism"** (minimalist structure, maximalist accents); playful/authentic over sterile; micro-interactions expected; clarity non-negotiable ([Aufait UX](https://www.aufaitux.com/blog/tactile-maximalism-gen-z-ui/), [Hadia Tech](https://hadiatech.com/designing-for-gen-z-working-ui-trends/)). _High (global, not BR-specific)._

**Color for a young, female-skewing pop-culture audience.** Pink → playfulness/femininity/romance; purple → creativity/community (Twitch); red/purple/pink drive sharing; 70% of 18–24 engage more with bold colors; cohesive palettes +60% engagement ([Mention](https://mention.com/en/blog/social-media-psychology-color/), [Design Shack](https://designshack.net/articles/graphics/social-media-color-psychology/)). _Medium (soft science)._

**Device reality = mid-range Android.** Samsung 39% / Motorola 25%; sub-US$200 phones = 41% of shipments (doubled YoY); Moto G is the mid-range sweet spot ([Omdia](https://omdia.tech.informa.com/blogs/2025/april/brazil-smartphone-market-in-2025)). _High, BR-specific._ → must feel fast/smooth on mid-tier Android; lean bundle, no jank.

**Trust cues matter more than usual** (gossip + fake-news + post-betting-ban "not an aposta/golpe"). Clean consistent grid = +17% perceived professionalism; source transparency, ratings, no lag/crashes, no vague privacy ([MoldStud](https://moldstud.com/articles/p-the-influence-of-mobile-app-design-on-user-trust)). _Medium._

**Reference apps (directional):** TikTok (black + neon pink/cyan, full-bleed, dopamine motion); Instagram (dark option, pink→purple gradient identity, airy); Twitch (dark + vibrant purple + community); WhatsApp (green, utilitarian, trusted, light-default); Cartola FC (dark-ish, data-dense, leaderboard rigor).

---

## Layer 2 — Build-grade specifics

**Palette (concrete + accessibility catch):**
- **Gradients: pink→purple is the 2025 move**, and it's analogous (safe) vs harsh complementary pairs at small sizes ([enveos](https://enveos.com/top-creative-color-gradient-trends-for-2025-a-bold-shift-in-design/), [IconikAI](https://www.iconikai.com/blog/app-icon-design-trends-2026)). Suggest `#FF4D9D → ~#8B5CF6` on hero, win moment, wordmark.
- **Dopamine accents** = high saturation + brightness (pink/purple/gold triad).
- **⚠️ Accessibility catch:** fully-saturated neon **vibrates** on dark; **pure/near-pure black is too harsh** with light text (halation) — guidance is a softer black like `#121212`, not `#000` ([FiveJars](https://fivejars.com/insights/dark-mode-ui-9-design-considerations-you-cant-ignore/), [WebAIM](https://webaim.org/articles/contrast/)). **This flags Viddi's current `#07060A` base** (near-pure-black, shipped on request): bold/OLED-great but below recommended softness — with saturated neon it risks halation/vibration. Fix: lift base to ~`#0E0C14` **or** temper accent saturation; verify **≥4.5:1** text, **≥3:1** large/UI; never neon on small body text.

**Typography — the audience wants the personality the redesign removed.** Gen-Z 2025 type is moving **away from millennial sleek minimalism** toward personality (chunky/rounded/Y2K/"animated"/"thick rounded friendly") while staying accessibility-first ([Accio](https://www.accio.com/business/gen-z-font-trends), [Burntilldead](https://burntilldeadstudio.com/fonts-gen-z-love-trendy-typefaces-that-define-a-generation/)). Viddi swapped chunky Baloo → tight-grotesk Inter (reads millennial-sleek/fintech — the aesthetic they're drifting from). Ideal = **hybrid**: keep Inter (body/UI) + JetBrains Mono (numbers = trust), **add a characterful display face** for wordmark/hero/win (rounded like Baloo/Fredoka for warmth, or expressive grotesk like Clash Display for edge).

**Motion / haptics / gamification (concrete + ethics guardrail):**
- **Thumb-zone** placement for TEA/CAP + share; **embodied swipe** = micro-dopamine; micro-interactions on every tap ([Passionate](https://passionates.com/tiktok-revolution-smart-design-built-250b-empire/)).
- Gamification that works: progress tracking, daily tasks, streaks, badges (Viddi has streaks + tiers).
- **⚠️ Ethics guardrail:** literature flags "dark haptics," dark patterns, addiction-by-design ([arXiv: Dark Haptics](https://arxiv.org/pdf/2504.08471)). Given Viddi's trust/anti-fake-news/post-ban positioning: **celebratory dopamine, not manipulative dark patterns** — on-brand *and* store/regulator-safe.

**Concrete deltas:**
| Area | Now | Recommendation |
|---|---|---|
| Base dark | `#07060A` | Lift to ~`#0E0C14` **or** temper accents (avoid halation) |
| Accents | pink sparse, no purple | Add purple `#8B5CF6`; use pink more prominently |
| Gradient | none | pink→purple on hero + win + wordmark |
| Display type | Inter (grotesk) | Add rounded/expressive display for wordmark/hero/win |
| Motion | reaction spring, count-up | Extend micro-interactions; keep ethical |
| Numbers | JetBrains Mono | Keep (trust) ✅ |

---

## Layer 3 — Brazil-specific + validation

**"Y2K brasileiro" is the live BR Gen-Z aesthetic — confirms + extends the palette.** Metallic/shiny, funk/brega-funk-driven neon; palette = **rosa (pink), lilás (lilac/purple), prata (silver), azul bebê (baby blue)** + white/black ([Estado de Minas](https://www.em.com.br/emfoco/2025/04/13/tendencia-polemica-dos-anos-2000-conquistam-as-passarelas-em-2025/), [zzmall](https://www.zzmall.com.br/magazzine/comportamento/quais-as-tendencias-queridinhas-da-geracao-z)). Independently confirms pink→purple and adds **metallic silver** (premium + on-trend on dark, use sparingly) and optional **baby blue**. Refined accent set: **pink `#FF4D9D` + lilac `#8B5CF6` + metallic-silver highlight + optional baby-blue**. _Medium._

**BBB = a bold, re-skinned-every-season identity → seasonal theming.** Couldn't pull a concrete BBB palette (only Behance/Logopedia/@bbb 22M) — _low confidence_ — but the pattern is a neon/gradient logo refreshed each season. Idea: **season-themed accent skins** ("BBB mode"/"A Fazenda mode") during a live season — cheap, rides the beachhead's obsession.

**⭐ WhatsApp sharing = growth engine AND legal tripwire.** BR gossip travels via **prints (screenshots), figurinhas (stickers), and WhatsApp groups**. BUT the STJ ruled sharing screenshots of private conversations without consent can be a crime / trigger indemnização; mocking stickers carry liability ([CNN Brasil/STJ](https://www.cnnbrasil.com.br/nacional/stj-decide-que-divulgar-print-de-conversa-de-whatsapp-deve-gerar-indenizacao/), [Correio](https://www.correio24horas.com.br/em-alta/fofoca-ameacada-compartilhar-print-de-whatsapp-pode-gerar-indenizacao-0921)). _Medium-high._
- **Opportunity:** make shareables WhatsApp-native — one-tap share-to-WhatsApp, **print-ready win cards**, **figurinha (sticker) export** (extend the existing react-native-view-shot win card).
- **Guardrail:** never frame user-submitted private screenshots as "evidence/sources" — keep to public markets + crowd opinion. Position Viddi as **"the safe way to share the tea"** (public, sourced, opinião-não-acusação). Reinforces "fofoca com recibo."

**Screen-by-screen application:**
- **Feed hero:** pink→lilac gradient accent edge; optional seasonal skin.
- **Win moment:** full pink→lilac mesh + gold; export as WhatsApp sticker + print card.
- **Market cards:** stay dark/structured; gradient/metallic on *featured* only.
- **Tiers/badges:** Y2K metallic tier badges.
- **Share:** WhatsApp-first, then Stories.

**Validation plan (do this before more desk research):**
1. **Palette/icon A/B (48h):** post 2–3 wordmark/icon options (dark-minimal vs pink-gradient vs Y2K-metallic) to the founding Telegram + micro-creators; measure preference + "what app do you think this is?" (comprehension guards the *not-a-betting-app* framing).
2. **App-store icon A/B** once live.
3. **5-person hallway test on mid-range Android** — check halation/vibration on `#07060A` + neon.
4. Ship the **pink→lilac gradient token first** (lowest-risk), measure engagement before bigger moves.

---

## Confidence & gaps
- **High:** dark-mode preference; mid-range-Android reality; pink→purple gradient trend; neon-on-dark / pure-black accessibility caution; thumb-zone/micro-interaction patterns.
- **Medium:** color-for-female-audience (soft science); Y2K-brasileiro palette; WhatsApp print/sticker behavior + STJ legal risk; trust cues (general).
- **Low / unmeasured:** BBB concrete palette; seasonal-theming ROI; specific font names (Clash/Satoshi direction-confirmed, not BR-validated); **all hex values are proposals**; **no first-party Viddi user testing** — hence the validation plan.
