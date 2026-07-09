import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius } from '../theme/tokens';

export type MarketStatus = 'ABERTO' | 'CONFIRMADO' | 'CAP' | 'VOID';

const STATUS_LABELS: Record<MarketStatus, string> = {
  ABERTO: 'ABERTO',
  CONFIRMADO: 'CONFIRMADO',
  CAP: 'DESMENTIDO',
  VOID: 'ANULADO',
};

/** Mono status pill — ABERTO (amber) / CONFIRMADO (green) / CAP (red). */
export default function StatusChip({ status }: { status: MarketStatus }) {
  const { colors } = useTheme();
  const tint =
    status === 'CONFIRMADO'
      ? { bg: colors.confirmedBg, fg: colors.confirmed }
      : status === 'CAP'
        ? { bg: colors.capRedBg, fg: colors.capRed }
        : status === 'VOID'
          ? { bg: colors.raised, fg: colors.muted }
        : { bg: colors.openBg, fg: colors.open };

  return (
    <View style={[styles.chip, { backgroundColor: tint.bg }]}>
      <Text style={[styles.label, { color: tint.fg }]}>{STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  label: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 0.6 },
});
