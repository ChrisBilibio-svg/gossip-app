import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import type { Rumor } from '../lib/rumors';
import type { Choice } from '../lib/predictions';
import OddsBar from './OddsBar';
import StatusChip from './StatusChip';
import Sparkline from './Sparkline';
import Icon from './icons/Icon';
import { canSeeMarketStats, deadlineLabel, marketOdds, marketVolume, placeholderSparkline, toMarketStatus } from './marketView';

interface Props {
  rumor: Rumor;
  onPress: (r: Rumor) => void;
  onTakePosition?: (r: Rumor, side: Choice) => void;
  featured?: boolean;
  viewerIsPro?: boolean;
}

/** A rumor rendered as a prediction MARKET: status, odds bar, volume, position. */
export default function MarketCard({ rumor, onPress, onTakePosition, featured, viewerIsPro = false }: Props) {
  const { colors } = useTheme();
  const status = toMarketStatus(rumor.status);
  const { teaPct, capPct } = marketOdds(rumor);
  const volume = marketVolume(rumor);
  const dl = deadlineLabel(rumor.predictionDeadline);
  const spark = rumor.oddsHistory.length >= 2 ? rumor.oddsHistory : placeholderSparkline(teaPct);
  const position = rumor.myChoice;
  const isOpen = status === 'ABERTO';
  const showStats = canSeeMarketStats({ status: rumor.status, myChoice: position, viewerIsPro });

  return (
    <Pressable
      onPress={() => onPress(rumor)}
      accessibilityRole="button"
      accessibilityLabel={rumor.summary}
      style={[styles.card, { backgroundColor: colors.card, borderColor: featured ? colors.primary : colors.border }]}
    >
      {featured ? <View style={[styles.edge, { backgroundColor: colors.primary }]} /> : null}

      <View style={styles.topRow}>
        <View style={styles.metaLeft}>
          {featured ? <Text style={[styles.dayLabel, { color: colors.primary }]}>VIDDI DO DIA</Text> : null}
          {rumor.updatesRumor ? (
            <View style={[styles.updateChip, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}>
              <Text style={[styles.updateChipText, { color: colors.primary }]}>🆕 ATUALIZAÇÃO</Text>
            </View>
          ) : null}
          <StatusChip status={status} />
          {isOpen && dl ? (
            <View style={styles.deadline}>
              <Feather name="clock" size={10} color={colors.faint} />
              <Text style={[styles.deadlineText, { color: colors.faint }]}>fecha em {dl}</Text>
            </View>
          ) : null}
        </View>
        {showStats ? <Sparkline data={spark} color={teaPct > 50 ? colors.tea : colors.cap} /> : null}
      </View>

      <Text style={[styles.headline, { color: colors.text }]}>{rumor.summary}</Text>

      {showStats ? <OddsBar teaPct={teaPct} capPct={capPct} compact /> : <View style={[styles.statsLock, { backgroundColor: colors.raised, borderColor: colors.border }]}>
        <Feather name="lock" size={12} color={colors.faint} />
        <Text style={[styles.statsLockText, { color: colors.faint }]}>Palpite para ver odds e gráficos</Text>
      </View>}

      <View style={styles.bottomRow}>
        <Text style={[styles.volume, { color: colors.faint }]}>
          {showStats ? `${volume.toLocaleString('pt-BR')} palpites${rumor.sourceCount > 1 ? ` · ${rumor.sourceCount} fontes` : ''}` : 'estatísticas liberadas após o palpite'}
        </Text>
      </View>

      {isOpen ? (
        <View style={styles.actions}>
          {!position ? (
            <>
              <Pressable
                onPress={() => onTakePosition?.(rumor, 'true')}
                accessibilityRole="button"
                accessibilityLabel="Palpitar Verdade"
                style={[styles.posBtn, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}
              >
                <View style={styles.posRow}>
                  <Icon name="verdade" color={colors.tea} size={15} />
                  <Text style={[styles.posBtnText, { color: colors.tea }]}>Verdade{showStats ? ` ${teaPct}%` : ''}</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onTakePosition?.(rumor, 'false')}
                accessibilityRole="button"
                accessibilityLabel="Palpitar Mentira"
                style={[styles.posBtn, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}
              >
                <View style={styles.posRow}>
                  <Icon name="mentira" color={colors.cap} size={15} />
                  <Text style={[styles.posBtnText, { color: colors.cap }]}>Mentira{showStats ? ` ${capPct}%` : ''}</Text>
                </View>
              </Pressable>
            </>
          ) : (
            <View
              style={[
                styles.locked,
                {
                  backgroundColor: position === 'true' ? colors.teaBgDim : colors.capBgDim,
                  borderColor: position === 'true' ? colors.teaBorderDim : colors.capBorderDim,
                },
              ]}
            >
              <View style={styles.posRow}>
                <Icon name={position === 'true' ? 'verdade' : 'mentira'} color={position === 'true' ? colors.tea : colors.cap} size={14} />
                <Text style={[styles.lockedSide, { color: position === 'true' ? colors.tea : colors.cap }]}>
                  {position === 'true' ? 'Verdade' : 'Mentira'}
                </Text>
              </View>
              <Text style={[styles.lockedNote, { color: colors.faint }]}>Posição trancada 🔒</Text>
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, paddingBottom: spacing.md, overflow: 'hidden' },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 },
  dayLabel: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.9 },
  updateChip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 2 },
  updateChipText: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.4 },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  deadlineText: { fontFamily: fonts.mono, fontSize: 10 },
  headline: { fontFamily: fonts.sansMed, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  statsLock: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  statsLockText: { fontFamily: fonts.sansSemi, fontSize: 11 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  volume: { fontFamily: fonts.mono, fontSize: 10 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  posBtn: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  locked: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockedSide: { fontFamily: fonts.sansSemi, fontSize: 11 },
  lockedNote: { fontFamily: fonts.mono, fontSize: 10 },
});
