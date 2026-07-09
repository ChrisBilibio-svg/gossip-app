import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme/tokens';

/**
 * Shared empty/zero-data state — a centered emoji + headline + optional nudge.
 * Keeps MyBets, Leaderboard, Social, etc. visually consistent.
 */
export default function EmptyState({ emoji, title, body }: { emoji: string; title: string; body?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.sm },
  emoji: { fontSize: 40 },
  title: { fontFamily: 'NunitoSans_700Bold', fontSize: 18, color: colors.text, textAlign: 'center' },
  body: { fontFamily: 'NunitoSans_400Regular', fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
