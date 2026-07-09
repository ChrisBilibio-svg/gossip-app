import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';

/**
 * Native-dependency-free probability chart. It uses rounded columns plus a
 * current/min/max readout so market movement is legible without adding svg or a
 * dev-build rebuild requirement.
 */
export default function Sparkline({
  data,
  width = 60,
  height = 20,
  color,
  showLabels = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showLabels?: boolean;
}) {
  const { colors } = useTheme();
  const stroke = color ?? colors.tea;
  if (data.length < 2) return null;

  const normalized = data.map((v) => Math.max(0, Math.min(100, Math.round(v))));
  const min = Math.min(...normalized);
  const max = Math.max(...normalized);
  const current = normalized[normalized.length - 1];
  const range = max - min || 1;
  const chartHeight = showLabels ? Math.max(28, height - 28) : height;
  const trendUp = current >= normalized[0];
  const accessibilityLabel = `Gráfico de probabilidade de ser verdade, atual ${current}%, mínimo ${min}%, máximo ${max}%`;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={[showLabels && styles.frame, showLabels && { borderColor: colors.border, backgroundColor: colors.raised }, { width }]}>
      <View style={[styles.chart, { height: chartHeight }]}>
        <View style={[styles.midline, { backgroundColor: colors.border }]} />
        {normalized.map((v, i) => {
          const barHeight = 4 + ((v - min) / range) * Math.max(1, chartHeight - 8);
          const isLast = i === normalized.length - 1;
          return (
            <View key={`${v}-${i}`} style={styles.col}>
              <View
                style={[
                  styles.bar,
                  {
                    height: barHeight,
                    backgroundColor: stroke,
                    opacity: isLast ? 1 : 0.45 + (i / Math.max(1, normalized.length - 1)) * 0.35,
                    borderRadius: isLast ? 3 : 2,
                  },
                ]}
              />
              {isLast ? <View style={[styles.dot, { borderColor: colors.card, backgroundColor: stroke }]} /> : null}
            </View>
          );
        })}
      </View>

      {showLabels ? (
        <View style={styles.labels}>
          <View>
            <Text style={[styles.label, { color: colors.faint }]}>Verdade agora</Text>
            <Text style={[styles.current, { color: stroke }]}>{current}%</Text>
          </View>
          <View style={styles.metaLabels}>
            <Text style={[styles.meta, { color: colors.faint }]}>{trendUp ? '↗ subiu' : '↘ caiu'}</Text>
            <Text style={[styles.meta, { color: colors.faint }]}>min {min}%</Text>
            <Text style={[styles.meta, { color: colors.faint }]}>max {max}%</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, position: 'relative', overflow: 'hidden' },
  midline: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, opacity: 0.7 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minWidth: 2 },
  bar: { width: '100%' },
  dot: { position: 'absolute', bottom: -2, width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  labels: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.xs, gap: spacing.sm },
  label: { fontFamily: fonts.mono, fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  current: { fontFamily: fonts.monoBold, fontSize: 15, marginTop: 1 },
  metaLabels: { alignItems: 'flex-end', gap: 1 },
  meta: { fontFamily: fonts.mono, fontSize: 8 },
});
