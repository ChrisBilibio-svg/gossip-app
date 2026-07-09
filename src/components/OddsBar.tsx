import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/tokens';
import Icon from './icons/Icon';

/** Teal|coral implied-probability bar with mono percentage labels. */
export default function OddsBar({ teaPct, capPct, compact }: { teaPct: number; capPct: number; compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.track, { height: compact ? 4 : 8, backgroundColor: colors.raised }]}>
        <View style={{ flex: Math.max(teaPct, 0.0001), backgroundColor: colors.tea }} />
        <View style={{ flex: Math.max(capPct, 0.0001), backgroundColor: colors.cap }} />
      </View>
      <View style={styles.row}>
        <View style={styles.lbl}>
          <Icon name="verdade" color={colors.tea} size={13} />
          <Text style={[styles.label, { color: colors.tea }]}>Verdade {teaPct}%</Text>
        </View>
        <View style={styles.lbl}>
          <Text style={[styles.label, { color: colors.cap }]}>{capPct}% Mentira</Text>
          <Icon name="mentira" color={colors.cap} size={13} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  lbl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontFamily: fonts.monoMed, fontSize: 11 },
});
