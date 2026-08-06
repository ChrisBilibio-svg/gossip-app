import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { getMyFixedPositions, noCashValueReminder, type FixedPosition } from '../lib/economy';
import { Skeleton } from '../components/Skeleton';
import Icon from '../components/icons/Icon';
import CoinStoreButton from '../components/CoinStoreButton';

interface Props {
  onWinPress?: (position: FixedPosition) => void;
}

export default function MyBetsScreen({ onWinPress: _onWinPress }: Props) {
  const { colors } = useTheme();
  const [positions, setPositions] = useState<FixedPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setPositions(await getMyFixedPositions());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useMemo(() => positions.filter((p) => p.status === 'OPEN'), [positions]);
  const settled = useMemo(() => positions.filter((p) => p.status !== 'OPEN'), [positions]);
  const won = settled.filter((p) => p.status === 'WON').length;
  const returned = settled.reduce((sum, p) => sum + (p.actualReturnCoins ?? 0), 0);
  const accuracy = settled.length > 0 ? `${Math.round((won / settled.length) * 100)}%` : '—';

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header />
        <View style={styles.body}>
          <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.cell}>
                <Skeleton width={48} height={18} />
                <Skeleton width={34} height={9} style={{ marginTop: 6 }} />
              </View>
            ))}
          </View>
          <Skeleton width={110} height={10} style={{ marginBottom: spacing.sm }} />
          {[0, 1].map((i) => (
            <View key={i} style={[styles.posCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: spacing.sm }]}>
              <Skeleton width="90%" height={12} />
              <Skeleton width="60%" height={11} style={{ marginTop: spacing.md }} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}>
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SummaryCell value={returned.toLocaleString('pt-BR')} label="retornos em moedas" valueColor={colors.gold} divider />
          <SummaryCell value={accuracy} label="acertos" valueColor={colors.text} divider />
          <SummaryCell value={String(open.length)} label="abertas" valueColor={colors.text} />
        </View>

        <Text style={[styles.section, { color: colors.faint }]}>MINHAS POSIÇÕES · ABERTAS</Text>
        {open.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.muted }]}>Nenhuma posição aberta.</Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>Abra um mercado, escolha Verdade/Mentira e defina um stake de moedas.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {open.map((p) => <PositionCard key={p.id} position={p} />)}
          </View>
        )}

        {settled.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.faint, marginTop: spacing.lg }]}>PREDICTION RESULTS · SETTLED</Text>
            <View style={{ gap: spacing.sm }}>
              {settled.map((p) => <PositionCard key={p.id} position={p} />)}
            </View>
          </>
        ) : null}

        {positions.length === 0 ? (
          <View style={styles.zeroWrap}>
            <Icon name="target" color={colors.faint} size={34} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Você ainda não tem posições</Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>Todo palpite agora exige stake de moedas virtuais. {noCashValueReminder()}</Text>
          </View>
        ) : null}
        <Text style={[styles.disclaimer, { color: colors.faint }]}>{noCashValueReminder()}</Text>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );

  function Header() {
    return (
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>My Predictions</Text>
        <CoinStoreButton compact />
      </View>
    );
  }
}

function PositionCard({ position }: { position: FixedPosition }) {
  const { colors } = useTheme();
  const open = position.status === 'OPEN';
  const won = position.status === 'WON';
  const voided = position.status === 'VOID';
  const sideColor = position.outcomeKey === 'true' ? colors.tea : colors.cap;
  const actual = position.actualReturnCoins == null ? '—' : `${position.actualReturnCoins.toLocaleString('pt-BR')} moedas`;
  const statusLabel = position.status === 'OPEN' ? 'ABERTO' : position.status === 'WON' ? 'GANHOU' : position.status === 'LOST' ? 'PERDEU' : 'ANULADO';
  return (
    <View style={[styles.posCard, { backgroundColor: colors.card, borderColor: won ? colors.teaBorderDim : colors.border, opacity: position.status === 'LOST' ? 0.78 : 1 }]}>
      <Text style={[styles.posHeadline, { color: colors.text }]} numberOfLines={2}>{position.question}</Text>
      <View style={styles.posRow}>
        <View style={styles.choiceRow}>
          <Icon name={position.outcomeKey === 'true' ? 'verdade' : 'mentira'} color={sideColor} size={14} />
          <Text style={[styles.side, { color: sideColor }]}>{position.stakeCoins} moedas em {position.outcomeKey === 'true' ? 'Verdade' : 'Mentira'}</Text>
        </View>
        <Text style={[styles.status, { color: won ? colors.tea : voided ? colors.faint : open ? colors.gold : colors.capRed }]}>{statusLabel}</Text>
      </View>
      <View style={styles.details}>
        <Text style={[styles.posMeta, { color: colors.faint }]}>Odds fixadas: {position.lockedDecimalOdds.toFixed(2)}x</Text>
        <Text style={[styles.posMeta, { color: colors.faint }]}>Retorno potencial: {position.potentialTotalReturnCoins.toLocaleString('pt-BR')} moedas</Text>
        <Text style={[styles.posMeta, { color: colors.faint }]}>Ganho líquido potencial: {position.potentialNetWinCoins.toLocaleString('pt-BR')} moedas</Text>
        <Text style={[styles.posMeta, { color: colors.faint }]}>Retorno real à carteira: {actual}</Text>
        <Text style={[styles.posMeta, { color: colors.faint }]}>Status do mercado: {position.marketStatus}</Text>
        {position.settledAt ? <Text style={[styles.posMeta, { color: colors.faint }]}>Data de resolução: {new Date(position.settledAt).toLocaleDateString('pt-BR')}</Text> : null}
      </View>
    </View>
  );
}

function SummaryCell({ value, label, valueColor, divider }: { value: string; label: string; valueColor: string; divider?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.cell, divider && { borderRightWidth: 1, borderRightColor: colors.border }]}>
      <Text style={[styles.cellValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.cellLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 20 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  summary: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  cell: { flex: 1, alignItems: 'center' },
  cellValue: { fontFamily: fonts.monoBold, fontSize: 18 },
  cellLabel: { fontFamily: fonts.sans, fontSize: 10, marginTop: 2 },
  section: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.sm },
  posCard: { borderWidth: 1, borderRadius: radius.sm + 2, padding: spacing.md },
  posHeadline: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 17 },
  posRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.sm },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  side: { fontFamily: fonts.monoSemi, fontSize: 11 },
  status: { fontFamily: fonts.monoBold, fontSize: 10 },
  details: { gap: 3, marginTop: spacing.sm },
  posMeta: { fontFamily: fonts.mono, fontSize: 10 },
  emptyCard: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 28, alignItems: 'center', gap: 4, paddingHorizontal: spacing.md },
  emptyTitle: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center' },
  emptySub: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  zeroWrap: { alignItems: 'center', paddingTop: 40, gap: spacing.sm },
  disclaimer: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: spacing.lg },
});
