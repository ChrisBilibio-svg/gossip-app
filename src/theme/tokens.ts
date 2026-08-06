/**
 * Design tokens — PREDICTION-MARKET identity (dark-first, light variant).
 *
 * The app reads its live palette through `useTheme()` (see ThemeProvider). Two
 * schemes implement the same `ColorScheme` shape: `darkColors` (primary, the
 * pixel-exact mockup) and `lightColors` (AA-safe inverted variant). Color is a
 * PRECISE ACCENT on neutral ink — teal/coral are the two market sides, pink is
 * brand/action, gold is points/winning; those roles never blur.
 *
 * The legacy flat `colors` export below is kept temporarily so any not-yet-
 * migrated screen still compiles; it is removed once every screen uses useTheme.
 */

export interface ColorScheme {
  mode: 'dark' | 'light';
  // surfaces
  bg: string; // app canvas
  card: string; // elevated card
  raised: string; // inset wells / secondary surface
  navBar: string; // bottom nav / compose bar
  border: string; // hairline
  // text
  text: string; // primary
  muted: string; // secondary
  faint: string; // tertiary / mono metadata
  // accents (roles)
  primary: string; // brand pink — CTAs, active, you
  onPrimary: string; // text/icon on a pink fill
  tea: string; // TEA market side (true)
  cap: string; // CAP market side (false)
  confirmed: string; // resolved-true status
  open: string; // open/speculated status
  capRed: string; // resolved-false status
  gold: string; // points / track-record / win
  danger: string;
  // soft tints (chips, position buttons, accent panels)
  teaBg: string;
  teaBorder: string;
  teaBgDim: string;
  teaBorderDim: string;
  capBg: string;
  capBorder: string;
  capBgDim: string;
  capBorderDim: string;
  primaryBg: string;
  primaryBorder: string;
  openBg: string;
  confirmedBg: string;
  capRedBg: string;
  goldBg: string;
}

export const darkColors: ColorScheme = {
  mode: 'dark',
  // Twitter/X "Lights out" style: true black canvas, neutral blue-grey surfaces
  // (no purple tint), so the pink/teal/gold accents pop against pure black.
  bg: '#14110E',
  card: '#1E1A15',
  raised: '#29231C',
  navBar: '#14110E',
  border: '#3A3127',
  text: '#F6EFE6',
  muted: '#B9AA98',
  faint: '#AA9B89',
  primary: '#FF4D8F',
  onPrimary: '#261018',
  tea: '#35C7A0',
  cap: '#F0808A',
  confirmed: '#22C55E',
  open: '#F59E0B',
  capRed: '#F0556F',
  gold: '#E7B84C',
  danger: '#F0556F',
  teaBg: 'rgba(53,199,160,0.12)',
  teaBorder: 'rgba(53,199,160,0.32)',
  teaBgDim: 'rgba(53,199,160,0.08)',
  teaBorderDim: 'rgba(53,199,160,0.22)',
  capBg: 'rgba(240,128,138,0.12)',
  capBorder: 'rgba(240,128,138,0.32)',
  capBgDim: 'rgba(240,128,138,0.08)',
  capBorderDim: 'rgba(240,128,138,0.22)',
  primaryBg: 'rgba(255,77,143,0.10)',
  primaryBorder: 'rgba(255,77,143,0.35)',
  openBg: 'rgba(245,158,11,0.15)',
  confirmedBg: 'rgba(34,197,94,0.15)',
  capRedBg: 'rgba(240,85,111,0.15)',
  goldBg: 'rgba(231,184,76,0.10)',
};

export const lightColors: ColorScheme = {
  mode: 'light',
  bg: '#F6F0E5',
  card: '#FFFDF8',
  raised: '#EEE4D3',
  navBar: '#FFFDF8',
  border: '#D9CCB8',
  text: '#261E18',
  muted: '#6F6154',
  faint: '#74675B',
  primary: '#C92766',
  onPrimary: '#FFFFFF',
  tea: '#087D68',
  cap: '#C14752',
  confirmed: '#15803D',
  open: '#B45309',
  capRed: '#DC2655',
  gold: '#9A6A10',
  danger: '#DC2655',
  teaBg: 'rgba(13,148,136,0.10)',
  teaBorder: 'rgba(13,148,136,0.30)',
  teaBgDim: 'rgba(13,148,136,0.07)',
  teaBorderDim: 'rgba(13,148,136,0.18)',
  capBg: 'rgba(218,59,92,0.10)',
  capBorder: 'rgba(218,59,92,0.30)',
  capBgDim: 'rgba(218,59,92,0.06)',
  capBorderDim: 'rgba(218,59,92,0.16)',
  primaryBg: 'rgba(214,39,122,0.08)',
  primaryBorder: 'rgba(214,39,122,0.30)',
  openBg: 'rgba(180,83,9,0.12)',
  confirmedBg: 'rgba(21,128,61,0.12)',
  capRedBg: 'rgba(220,38,85,0.12)',
  goldBg: 'rgba(183,121,31,0.10)',
};

export const radius = {
  chip: 4,
  sm: 8, // buttons
  md: 12, // cards
  lg: 16,
  pill: 999,
} as const;

// 4px base scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Type families. Inter (grotesk) for UI/headlines; JetBrains Mono for ALL
 * numbers (odds, points, ranks, timers) so they align in columns, trading-UI
 * style. Legacy NunitoSans display/body keys remain until screens migrate.
 */
export const fonts = {
  // grotesk (Inter)
  sans: 'Inter_400Regular',
  sansMed: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  sansExtra: 'Inter_800ExtraBold',
  // monospace / tabular numerals (JetBrains Mono)
  mono: 'JetBrainsMono_400Regular',
  monoMed: 'JetBrainsMono_500Medium',
  monoSemi: 'JetBrainsMono_600SemiBold',
  monoBold: 'JetBrainsMono_700Bold',
  serif: 'serif',
  serifBold: 'serif',
  // legacy (NunitoSans) — kept until all screens migrate
  display: 'NunitoSans_700Bold',
  displaySemi: 'NunitoSans_700Bold',
  displayExtra: 'NunitoSans_700Bold',
  body: 'NunitoSans_400Regular',
  bodyBold: 'NunitoSans_700Bold',
} as const;

/**
 * @deprecated legacy flat palette — now pointed at the DARK scheme so any
 * not-yet-migrated component renders coherently dark during the redesign.
 * Removed once every surface uses useTheme().
 */
export const colors = {
  bg: darkColors.bg,
  surface: darkColors.card,
  surfaceSunken: darkColors.raised,
  primary: darkColors.primary,
  primaryPress: '#E23C88',
  accent: darkColors.gold,
  tea: darkColors.tea,
  cap: darkColors.cap,
  confirmed: darkColors.confirmed,
  speculated: darkColors.open,
  gold: darkColors.gold,
  text: darkColors.text,
  muted: darkColors.muted,
  border: darkColors.border,
  success: darkColors.confirmed,
  danger: darkColors.capRed,
} as const;

export const type = {
  display: { fontFamily: fonts.display, color: colors.text },
  body: { fontFamily: fonts.body, color: colors.text },
} as const;

export const theme = { colors, radius, spacing, fonts, type } as const;
export type Theme = typeof theme;
