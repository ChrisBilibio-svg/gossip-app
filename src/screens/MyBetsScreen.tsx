import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { getMyBets, type MyBet } from '../lib/bets';
import { Skeleton } from '../components/Skeleton';
import Icon from '../components/icons/Icon';

interface Props {
  onWinPress?: (bet: MyBet) => void;
}

export default function MyBetsScreen({ onWinPress }: Props) {
  const { colors } = useTheme();
  const [bets, setBets] = useState<MyBet[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setBets(await getMyBets());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(() => bets.filter((b) => !b.resolved), [bets]);
  const resolved = useMemo(() => bets.filter((b) => b.resolved), [bets]);
  const correct = resolved.filter((b) => b.isCorrect === true).length;
  const points = resolved.reduce((sum, b) => sum + (b.isCorrect ? (b.pointsAwarded ?? 0) : 0), 0);
  const accuracy = resolved.length > 0 ? `${Math.round((correct / resolved.length) * 100)}%` : '—';

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
          <Skeleton width={70} height={10} style={{ marginBottom: spacing.sm }} />
          {[0, 1].map((i) => (
            <View
              key={i}
              style={[styles.posCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: spacing.sm }]}
            >
              <Skeleton width="90%" height={12} />
              <Skeleton width="40%" height={11} style={{ marginTop: spacing.md }} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        {/* Summary */}
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SummaryCell value={points.toLocaleString('pt-BR')} label="pontos" valueColor={colors.gold} divider />
          <SummaryCell value={accuracy} label="acertos" valueColor={colors.text} divider />
          <SummaryCell value={String(pending.length)} label="abertas" valueColor={colors.text} />
        </View>

        {/* Open */}
        <Text style={[styles.section, { color: colors.faint }]}>ABERTAS</Text>
        {pending.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyTitle, { color: colors.muted }]}>Nenhuma posição aberta.</Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>Faça seus primeiros palpites 👀</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {pending.map((b) => (
              <View key={b.rumorId} style={[styles.posCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.posHeadline, { color: colors.text }]} numberOfLines={2}>
                  {b.summary}
                </Text>
                <View style={styles.posRow}>
                  <View style={styles.choiceRow}>
                    <Icon name={b.choice === 'true' ? 'verdade' : 'mentira'} color={b.choice === 'true' ? colors.tea : colors.cap} size={14} />
                    <Text style={[styles.side, { color: b.choice === 'true' ? colors.tea : colors.cap }]}>
                      {b.choice === 'true' ? 'Verdade' : 'Mentira'}
                    </Text>
                  </View>
                  <Text style={[styles.posMeta, { color: colors.faint }]}>aguardando resolução</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Resolved */}
        {resolved.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.faint, marginTop: spacing.lg }]}>RESOLVIDAS</Text>
            <View style={{ gap: spacing.sm }}>
              {resolved.map((b) => {
                const voided = b.status === 'void';
                const won = b.isCorrect === true && !voided;
                return (
                  <Pressable
                    key={b.rumorId}
                    onPress={won && onWinPress ? () => onWinPress(b) : undefined}
                    accessibilityRole={won && onWinPress ? 'button' : undefined}
                    style={[
                      styles.posCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: won ? colors.teaBorderDim : colors.border,
                        opacity: won ? 1 : voided ? 0.9 : 0.75,
                      },
                    ]}
                  >
                    <View style={styles.settledTop}>
                      <Text
                        style={[styles.posHeadline, { color: won || voided ? colors.text : colors.muted, flex: 1 }]}
                        numberOfLines={2}
                      >
                        {b.summary}
                      </Text>
                      <Text style={[styles.points, { color: won ? colors.gold : voided ? colors.faint : colors.capRed }]}>
                        {won ? `+${b.pointsAwarded ?? 0} pts` : voided ? 'devolvido' : '0 pts'}
                      </Text>
                    </View>
                    <View style={styles.posRow}>
                      <View style={styles.choiceRow}>
                        <Icon name={b.choice === 'true' ? 'verdade' : 'mentira'} color={b.choice === 'true' ? colors.tea : colors.cap} size={14} />
                        <Text style={[styles.side, { color: b.choice === 'true' ? colors.tea : colors.cap }]}>
                          {b.choice === 'true' ? 'Verdade' : 'Mentira'}
                        </Text>
                      </View>
                      {voided ? (
                        <Text style={[styles.posMeta, { color: colors.faint }]}>Anulado — sem veredito · palpite devolvido</Text>
                      ) : !won ? (
                        <Text style={[styles.posMeta, { color: colors.faint }]}>Não foi dessa vez</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {bets.length === 0 ? (
          <View style={styles.zeroWrap}>
            <Icon name="target" color={colors.faint} size={34} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Você ainda não palpitou</Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>
              Vá para Mercados, escolha Verdade ou Mentira e comece seu histórico.
            </Text>
          </View>
        ) : null}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );

  function Header() {
    return (
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Meus Palpites</Text>
      </View>
    );
  }
}

function SummaryCell({
  value,
  label,
  valueColor,
  divider,
}: {
  value: string;
  label: string;
  valueColor: string;
  divider?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.cell, divider && { borderRightWidth: 1, borderRightColor: colors.border }]}>
      <Text style={[styles.cellValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.cellLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1 },
  title: { fontFamily: fonts.sansBold, fontSize: 17 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  summary: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  cell: { flex: 1, alignItems: 'center' },
  cellValue: { fontFamily: fonts.monoBold, fontSize: 18 },
  cellLabel: { fontFamily: fonts.sans, fontSize: 10, marginTop: 2 },
  section: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.sm },
  posCard: { borderWidth: 1, borderRadius: radius.sm + 2, padding: spacing.md },
  posHeadline: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  settledTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  posRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  side: { fontFamily: fonts.monoSemi, fontSize: 11 },
  posMeta: { fontFamily: fonts.mono, fontSize: 10 },
  points: { fontFamily: fonts.monoBold, fontSize: 13 },
  emptyCard: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 28, alignItems: 'center', gap: 4 },
  emptyTitle: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center' },
  emptySub: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
  zeroWrap: { alignItems: 'center', paddingTop: 40, gap: spacing.sm },
  zeroEmoji: { fontSize: 32 },
});
