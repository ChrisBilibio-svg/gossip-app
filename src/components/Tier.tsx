import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';

/**
 * Status-tier ladder — derived purely from total points (no backend).
 * Gives players a visible progression (Aprendiz → … → Lenda),
 * on-brand with the "O Profeta" leaderboard.
 */
export interface Tier {
  name: string;
  emoji: string;
  min: number;
  color: string;
}

const TIERS: Tier[] = [
  { name: 'Aprendiz', emoji: '🌱', min: 0, color: colors.muted },
  { name: 'Fofoqueiro', emoji: '🗣️', min: 100, color: colors.tea },
  { name: 'Vidente', emoji: '🔮', min: 500, color: colors.primary },
  { name: 'Profeta', emoji: '👑', min: 1500, color: colors.gold },
  { name: 'Lenda', emoji: '🏆', min: 5000, color: colors.accent },
];

export function tierForPoints(points: number): Tier {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (points >= tier.min) current = tier;
  }
  return current;
}

export function nextTier(points: number): Tier | null {
  return TIERS.find((t) => t.min > points) ?? null;
}

export function TierBadge({ points, compact }: { points: number; compact?: boolean }) {
  const t = tierForPoints(points);
  return (
    <View style={[styles.badge, compact && styles.badgeCompact, { borderColor: t.color }]}>
      <Text style={[styles.emoji, compact && styles.emojiCompact]}>{t.emoji}</Text>
      <Text style={[styles.name, compact && styles.nameCompact, { color: t.color }]}>{t.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSunken,
  },
  badgeCompact: { paddingHorizontal: spacing.sm, paddingVertical: 2, gap: 3 },
  emoji: { fontSize: 16 },
  emojiCompact: { fontSize: 13 },
  name: { fontFamily: 'NunitoSans_700Bold', fontSize: 14 },
  nameCompact: { fontSize: 11 },
});
