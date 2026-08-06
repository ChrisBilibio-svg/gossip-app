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
import EditorialArtwork from './EditorialArtwork';
import { deadlineLabel, marketOdds, marketVolume, placeholderSparkline, toMarketStatus } from './marketView';
import { offeredDecimalOdds } from '../lib/economy';

interface Props {
  rumor: Rumor;
  onPress: (r: Rumor) => void;
  onTakePosition?: (r: Rumor, side: Choice) => void;
  featured?: boolean;
  viewerIsPro?: boolean;
}

/** A rumor rendered as a prediction MARKET: status, odds bar, volume, position. */
export default function MarketCard({ rumor, onPress, onTakePosition, featured }: Props) {
  const { colors } = useTheme();
  const status = toMarketStatus(rumor.status);
  const { teaPct, capPct } = marketOdds(rumor);
  const volume = marketVolume(rumor);
  const dl = deadlineLabel(rumor.predictionDeadline);
  const spark = rumor.oddsHistory.length >= 2 ? rumor.oddsHistory : placeholderSparkline(teaPct);
  const position = rumor.myChoice;
  const isOpen = status === 'ABERTO';
  const yesProbability = Math.max(10, Math.min(90, teaPct)) / 100;
  const noProbability = Math.max(10, Math.min(90, capPct)) / 100;
  const displayedTeaPct = Math.round(yesProbability * 100);
  const displayedCapPct = Math.round(noProbability * 100);
  const yesOdds = offeredDecimalOdds(yesProbability);
  const noOdds = offeredDecimalOdds(noProbability);
  const displayedSourceCount = Math.max(rumor.sourceCount, rumor.sourceUrl ? 1 : 0);
  const editorialImage = rumor.editorialImage ?? null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: featured ? colors.primary : colors.border }]}>
      {featured ? <View style={[styles.edge, { backgroundColor: colors.primary }]} /> : null}
      <Pressable onPress={() => onPress(rumor)} accessibilityRole="button" accessibilityLabel={rumor.summary}>
        {editorialImage ? <EditorialArtwork image={editorialImage} featured={featured} /> : null}

        <View style={[styles.topRow, editorialImage ? styles.afterArtwork : styles.textFirstTop]}>
          <View style={styles.metaLeft}>
            <Text style={[styles.categoryKicker, { color: colors.primary }]}>{rumor.category?.trim() || 'Cultura pop'}</Text>
            {featured ? <Text style={[styles.dayLabel, { color: colors.primary }]}>BABADO DO DIA</Text> : null}
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
          <Sparkline data={spark} color={displayedTeaPct > 50 ? colors.tea : colors.cap} />
        </View>

        <Text style={[styles.headline, featured && styles.featuredHeadline, { color: colors.text }]}>{rumor.summary}</Text>

        <OddsBar teaPct={displayedTeaPct} capPct={displayedCapPct} compact />

        {isOpen ? (
          <View style={styles.marketGrid}>
            <View style={[styles.marketSide, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}>
              <Text style={[styles.marketLabel, { color: colors.tea }]}>VERDADE</Text>
              <Text style={[styles.marketMetric, { color: colors.text }]}>Probabilidade: {displayedTeaPct}%</Text>
              <Text style={[styles.marketMetric, { color: colors.text }]}>Retorno atual: {yesOdds.toFixed(2)}x</Text>
            </View>
            <View style={[styles.marketSide, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}>
              <Text style={[styles.marketLabel, { color: colors.cap }]}>MENTIRA</Text>
              <Text style={[styles.marketMetric, { color: colors.text }]}>Probabilidade: {displayedCapPct}%</Text>
              <Text style={[styles.marketMetric, { color: colors.text }]}>Retorno atual: {noOdds.toFixed(2)}x</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.bottomRow}>
          <Text style={[styles.volume, { color: colors.faint }]}>
            {`${volume.toLocaleString('pt-BR')} volume negociado${displayedSourceCount > 0 ? ` · ${displayedSourceCount} ${displayedSourceCount === 1 ? 'fonte' : 'fontes'}` : ''}`}
          </Text>
        </View>
        <Text style={[styles.noCash, { color: colors.faint }]}>Moedas não têm valor em dinheiro.</Text>
      </Pressable>

      {isOpen ? (
        <View style={styles.actions}>
          {!position ? (
            <>
              <Pressable
                onPress={() => onTakePosition?.(rumor, 'true')}
                accessibilityRole="button"
                accessibilityLabel="Escolher Verdade"
                style={[styles.posBtn, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}
              >
                <View style={styles.posRow}>
                  <Icon name="verdade" color={colors.tea} size={15} />
                  <Text style={[styles.posBtnText, { color: colors.tea }]}>Verdade</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onTakePosition?.(rumor, 'false')}
                accessibilityRole="button"
                accessibilityLabel="Escolher Mentira"
                style={[styles.posBtn, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}
              >
                <View style={styles.posRow}>
                  <Icon name="mentira" color={colors.cap} size={15} />
                  <Text style={[styles.posBtnText, { color: colors.cap }]}>Mentira</Text>
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
              <Text style={[styles.lockedNote, { color: colors.faint }]}>Odds fixadas</Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, paddingBottom: spacing.md, overflow: 'hidden' },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  afterArtwork: { marginTop: spacing.md },
  textFirstTop: { marginTop: 0 },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', flex: 1 },
  categoryKicker: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  dayLabel: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.9 },
  updateChip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 2 },
  updateChipText: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.4 },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  deadlineText: { fontFamily: fonts.mono, fontSize: 10 },
  headline: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 16, lineHeight: 22, marginBottom: spacing.sm },
  featuredHeadline: { fontSize: 19, lineHeight: 25 },
  statsLock: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  statsLockText: { fontFamily: fonts.sansSemi, fontSize: 11 },
  marketGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  marketSide: { flex: 1, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  marketLabel: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.4 },
  marketMetric: { fontFamily: fonts.mono, fontSize: 10 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  volume: { fontFamily: fonts.mono, fontSize: 10 },
  noCash: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 14, marginTop: 3 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  posBtn: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  locked: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockedSide: { fontFamily: fonts.sansSemi, fontSize: 11 },
  lockedNote: { fontFamily: fonts.mono, fontSize: 10 },
});
