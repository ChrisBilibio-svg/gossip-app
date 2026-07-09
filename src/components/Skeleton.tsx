import { useEffect } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius as R, spacing } from '../theme/tokens';

/**
 * One shared pulse drives every skeleton on screen so they shimmer in sync
 * (and it costs a single Animated loop). Reduce Motion downgrades to a static
 * dim block — no pulsing.
 */
const pulse = new Animated.Value(0.5);
let started = false;
function ensurePulse() {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((reduced) => {
      if (reduced) {
        pulse.setValue(0.65);
        return;
      }
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        ]),
      ).start();
    })
    .catch(() => pulse.setValue(0.65));
}

/** A single pulsing placeholder bar/block. */
export function Skeleton({
  width = '100%',
  height = 12,
  radius = 4,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: object;
}) {
  const { colors } = useTheme();
  ensurePulse();
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.border, opacity: pulse }, style]} />;
}

/** A market-card-shaped skeleton for the feed and list loading states. */
export function SkeletonMarketCard() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}>
        <Skeleton width={56} height={14} radius={R.chip} />
        <Skeleton width={50} height={14} radius={R.chip} />
      </View>
      <Skeleton width="92%" height={12} style={{ marginTop: spacing.md }} />
      <Skeleton width="68%" height={12} style={{ marginTop: 6 }} />
      <Skeleton width="100%" height={6} radius={3} style={{ marginTop: spacing.md }} />
      <View style={[styles.row, { marginTop: spacing.sm }]}>
        <Skeleton width={70} height={10} />
        <Skeleton width={48} height={10} />
      </View>
      <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
        <Skeleton width="48%" height={34} radius={R.sm} />
        <Skeleton width="48%" height={34} radius={R.sm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: R.md, borderWidth: 1, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
