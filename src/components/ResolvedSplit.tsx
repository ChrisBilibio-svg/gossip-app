import { Linking, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, spacing } from '../theme/tokens';
import { splitPercent, type Rumor } from '../lib/rumors';
import Icon from './icons/Icon';

/**
 * Read-only crowd split for a RESOLVED market. Betting is over, so the
 * percentages are shown with the correct side marked ✓ and the loser dimmed.
 */
export default function ResolvedSplit({ rumor, large }: { rumor: Rumor; large?: boolean }) {
  const { colors } = useTheme();
  const { tea, cap } = splitPercent(rumor);
  const total = rumor.trueTotal + rumor.falseTotal;
  const teaCorrect = rumor.status === 'confirmed';
  const capCorrect = rumor.status === 'debunked';
  const voided = rumor.status === 'void';

  return (
    <View style={styles.wrap}>
      <Text style={[styles.caption, { color: colors.faint }]}>RESULTADO</Text>
      <View style={[styles.bar, { backgroundColor: colors.raised, height: large ? 12 : 8 }]}>
        <View style={{ flex: Math.max(tea, 0.0001), backgroundColor: colors.tea, opacity: teaCorrect || voided ? 1 : 0.45 }} />
        <View style={{ flex: Math.max(cap, 0.0001), backgroundColor: colors.cap, opacity: capCorrect || voided ? 1 : 0.45 }} />
      </View>
      <View style={styles.row}>
        <View style={styles.lbl}>
          <Icon name="verdade" color={colors.tea} size={13} />
          <Text style={[styles.label, { color: colors.tea }]}>Verdade {tea}%{teaCorrect ? ' ✓' : ''}</Text>
        </View>
        <View style={styles.lbl}>
          <Text style={[styles.label, { color: colors.cap }]}>{capCorrect ? '✓ ' : ''}{cap}% Mentira</Text>
          <Icon name="mentira" color={colors.cap} size={13} />
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={[styles.outcome, { color: colors.text }]}>
          {voided ? 'Anulado' : teaCorrect ? 'Era verdade' : 'Era mentira'} · {total.toLocaleString('pt-BR')} palpites
        </Text>
        {rumor.sourceUrl ? (
          <Text style={[styles.source, { color: colors.primary }]} onPress={() => Linking.openURL(rumor.sourceUrl!)}>
            ver fonte ↗
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: 4 },
  caption: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 0.6 },
  bar: { flexDirection: 'row', borderRadius: 4, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  lbl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontFamily: fonts.monoMed, fontSize: 11 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
  outcome: { fontFamily: fonts.sansMed, fontSize: 12 },
  source: { fontFamily: fonts.monoSemi, fontSize: 11 },
});
