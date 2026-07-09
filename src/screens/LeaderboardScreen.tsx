import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { getLeaderboard, type LeaderRow } from '../lib/leaderboard';
import { supabase } from '../lib/supabase';
import { tierForPoints } from '../components/Tier';
import { Skeleton } from '../components/Skeleton';
import GroupsTab from '../components/GroupsTab';
import Avatar from '../components/icons/Avatar';
import Icon from '../components/icons/Icon';

type View2 = 'global' | 'groups';

function accuracy(r: LeaderRow): string {
  if (r.resolvedCount === 0) return '—';
  return `${Math.round((r.correctCount / r.resolvedCount) * 100)}%`;
}

export default function LeaderboardScreen() {
  const { colors } = useTheme();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View2>('global');

  const load = useCallback(async () => {
    const [{ data: u }, lb] = await Promise.all([supabase.auth.getUser(), getLeaderboard()]);
    setMeId(u.user?.id ?? null);
    setRows(lb);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>O Profeta</Text>
      <Text style={[styles.subtitle, { color: colors.faint }]}>
        {view === 'groups' ? 'Ligas privadas com seus amigos' : 'Ranking · histórico ponderado por acertos'}
      </Text>
      <View style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['global', 'groups'] as View2[]).map((v) => {
          const active = view === v;
          return (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segBtn, active && { backgroundColor: colors.raised }]}
            >
              <Text style={[styles.segText, { color: active ? colors.text : colors.faint, fontFamily: active ? fonts.sansSemi : fonts.sans }]}>
                {v === 'global' ? '🌎 Geral' : '👯 Grupos'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (view === 'groups') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {Header}
        <GroupsTab />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {Header}
        <View style={{ paddingTop: spacing.sm }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Skeleton width={16} height={12} />
              <View style={styles.handleCell}>
                <Skeleton width="55%" height={12} />
                <Skeleton width="35%" height={9} style={{ marginTop: 4 }} />
              </View>
              <Skeleton width={48} height={12} />
              <View style={{ width: 56, alignItems: 'flex-end' }}>
                <Skeleton width={32} height={11} />
              </View>
              <View style={styles.deltaCell}>
                <Skeleton width={12} height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {Header}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={[styles.colHead, { borderBottomColor: colors.border }]}>
            <Text style={[styles.chRank, { color: colors.faint }]}>#</Text>
            <Text style={[styles.chHandle, { color: colors.faint }]}>Handle</Text>
            <Text style={[styles.chPts, { color: colors.faint }]}>Pts</Text>
            <Text style={[styles.chAcc, { color: colors.faint }]}>Acerto</Text>
            <View style={styles.chDelta} />
          </View>
        }
        ListEmptyComponent={
          <View style={styles.zeroWrap}>
            <Icon name="trophy" color={colors.gold} size={34} />
            <Text style={[styles.zeroTitle, { color: colors.text }]}>Ninguém no ranking ainda</Text>
            <Text style={[styles.zeroSub, { color: colors.faint }]}>Acerte uma fofoca e seja o primeiro a virar O Profeta.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const rank = item.rank || index + 1;
          const me = item.id === meId;
          const top3 = rank <= 3;
          const accent = top3 ? colors.gold : me ? colors.primary : colors.text;
          return (
            <View
              style={[
                styles.row,
                { borderBottomColor: colors.border },
                top3 && { backgroundColor: colors.goldBg },
                me && { backgroundColor: colors.primaryBg, borderWidth: 1, borderColor: colors.primaryBorder, borderRadius: radius.sm + 2, marginHorizontal: spacing.md },
              ]}
            >
              <Text style={[styles.rank, { color: top3 ? colors.gold : me ? colors.primary : colors.faint }]}>{rank}</Text>
              <View style={styles.handleCell}>
                <View style={styles.handleLine}>
                  {item.avatar ? <Avatar value={item.avatar} size={16} /> : null}
                  <Text style={[styles.handle, { color: colors.text }]} numberOfLines={1}>
                    @{item.handle ?? 'anônimo'}
                  </Text>
                  {me ? (
                    <View style={[styles.youPill, { backgroundColor: colors.primaryBg }]}>
                      <Text style={[styles.youPillText, { color: colors.primary }]}>você</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.tier, { color: top3 ? colors.gold : colors.muted }]}>
                  {tierForPoints(item.totalPoints).name}
                </Text>
              </View>
              <Text style={[styles.pts, { color: top3 ? colors.gold : colors.text }]}>
                {item.totalPoints.toLocaleString('pt-BR')}
              </Text>
              <Text style={[styles.acc, { color: colors.muted }]}>{accuracy(item)}</Text>
              <View style={styles.deltaCell}>
                <Delta delta={item.rankDelta} />
              </View>
            </View>
          );
        }}
        ListFooterComponent={<View style={{ height: spacing.xxl }} />}
      />
    </View>
  );
}

function Delta({ delta }: { delta: number | null }) {
  const { colors } = useTheme();
  if (delta === null || delta === 0) return <Feather name="minus" size={12} color={colors.faint} />;
  return delta > 0 ? (
    <Feather name="trending-up" size={12} color={colors.confirmed} />
  ) : (
    <Feather name="trending-down" size={12} color={colors.capRed} />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1 },
  title: { fontFamily: fonts.sansBold, fontSize: 17 },
  subtitle: { fontFamily: fonts.sans, fontSize: 11, marginTop: 2 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, padding: 3, marginTop: spacing.md },
  segBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
  segText: { fontSize: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  colHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  chRank: { width: 28, fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.6 },
  chHandle: { flex: 1, fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.6 },
  chPts: { width: 72, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.6 },
  chAcc: { width: 56, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.6 },
  chDelta: { width: 24 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 11, borderBottomWidth: 1 },
  rank: { width: 28, fontFamily: fonts.monoBold, fontSize: 12 },
  handleCell: { flex: 1, paddingRight: spacing.sm },
  handleLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAvatar: { fontSize: 14 },
  handle: { fontFamily: fonts.sansMed, fontSize: 12, flexShrink: 1 },
  youPill: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  youPillText: { fontFamily: fonts.monoSemi, fontSize: 9 },
  tier: { fontFamily: fonts.sans, fontSize: 9, marginTop: 1 },
  pts: { width: 72, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 12 },
  acc: { width: 56, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11 },
  deltaCell: { width: 24, alignItems: 'flex-end' },
  zeroWrap: { alignItems: 'center', paddingTop: 60, gap: spacing.sm },
  zeroEmoji: { fontSize: 32 },
  zeroTitle: { fontFamily: fonts.sansMed, fontSize: 14 },
  zeroSub: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xl },
});
