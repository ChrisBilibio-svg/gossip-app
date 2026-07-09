import { useCallback, useEffect, useMemo, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import {
  applyOpenFeed,
  applyResolvedFeed,
  type FeedSort,
  type OpenQuickFilter,
  type ResolvedOutcome,
  type ResolvedSort,
} from '../lib/feedSearchCore';
import { fetchFeed, getRumorById, type Rumor, type RumorStatus } from '../lib/rumors';
import { type Choice } from '../lib/predictions';
import { setRumorReaction, type ReactionValue } from '../lib/reactions';
import MarketCard from '../components/MarketCard';
import RumorDetail from '../components/RumorDetail';
import Icon from '../components/icons/Icon';
import { SkeletonMarketCard } from '../components/Skeleton';

type Tab = 'open' | 'resolved';

const OPEN_SORTS: Array<{ key: FeedSort; label: string }> = [
  { key: 'hot', label: '🔥 Em alta' },
  { key: 'recent', label: '🆕 Recentes' },
  { key: 'closing-soon', label: '⏰ Encerrando logo' },
  { key: 'most-commented', label: '💬 Mais comentados' },
];

const OPEN_QUICK: Array<{ key: OpenQuickFilter; label: string }> = [
  { key: 'tied', label: '⚖️ Empatados' },
  { key: 'unbet', label: '🆕 Ainda não palpitei' },
  { key: 'discussion', label: '💬 Com discussão' },
];

const RESOLVED_SORTS: Array<{ key: ResolvedSort; label: string }> = [
  { key: 'recent', label: '🆕 Recentes' },
  { key: 'popular', label: '🔥 Populares' },
];

const RESOLVED_OUTCOMES: Array<{ key: ResolvedOutcome; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'tea', label: 'Confirmados' },
  { key: 'cap', label: 'Desmentidos' },
  { key: 'void', label: '⚪ Anulado' },
  { key: 'my-wins', label: '🏆 Meus acertos' },
];

function isResolved(status: RumorStatus) {
  return status === 'confirmed' || status === 'debunked' || status === 'void';
}

function applyLocalChoice(rumor: Rumor, choice: Choice): Rumor {
  if (rumor.myChoice != null) return rumor;
  return {
    ...rumor,
    myChoice: choice,
    trueTotal: rumor.trueTotal + (choice === 'true' ? 1 : 0),
    falseTotal: rumor.falseTotal + (choice === 'false' ? 1 : 0),
  };
}

export default function FeedScreen() {
  const { colors } = useTheme();
  const [rumors, setRumors] = useState<Rumor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // open-tab controls
  const [sort, setSort] = useState<FeedSort>('hot');
  const [quick, setQuick] = useState<OpenQuickFilter[]>([]);
  // resolved-tab controls
  const [resolvedSort, setResolvedSort] = useState<ResolvedSort>('recent');
  const [outcome, setOutcome] = useState<ResolvedOutcome>('all');
  const [selected, setSelected] = useState<Rumor | null>(null);
  const [localChoices, setLocalChoices] = useState<Record<string, Choice>>({});

  const load = useCallback(async () => {
    const r = await fetchFeed();
    setRumors(r.rumors.map((rumor) => {
      const choice = localChoices[rumor.id];
      return choice ? applyLocalChoice(rumor, choice) : rumor;
    }));
    setError(r.error);
    setLoading(false);
  }, [localChoices]);

  useEffect(() => {
    load();
  }, [load]);

  const resetControls = () => {
    setSort('hot');
    setQuick([]);
    setResolvedSort('recent');
    setOutcome('all');
  };

  const toggleQuick = (key: OpenQuickFilter) =>
    setQuick((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const tabRumors = useMemo(
    () => rumors.filter((r) => (tab === 'open' ? r.status === 'speculated' : isResolved(r.status))),
    [rumors, tab],
  );
  const filtered = useMemo(
    () =>
      tab === 'open'
        ? applyOpenFeed(tabRumors, query, sort, quick)
        : applyResolvedFeed(tabRumors, query, resolvedSort, outcome),
    [tabRumors, query, tab, sort, quick, resolvedSort, outcome],
  );
  const hasSearch = query.trim().length > 0;
  const hasActiveFilter =
    tab === 'open' ? sort !== 'hot' || quick.length > 0 : resolvedSort !== 'recent' || outcome !== 'all';

  const reactToRumor = async (rumor: Rumor, value: ReactionValue) => {
    const current = rumor.myReaction;
    const next = current === value ? null : value;
    const apply = (r: Rumor): Rumor => {
      if (r.id !== rumor.id) return r;
      let likeCount = r.likeCount;
      let dislikeCount = r.dislikeCount;
      if (current === 1) likeCount = Math.max(likeCount - 1, 0);
      if (current === -1) dislikeCount = Math.max(dislikeCount - 1, 0);
      if (next === 1) likeCount += 1;
      if (next === -1) dislikeCount += 1;
      return { ...r, likeCount, dislikeCount, myReaction: next };
    };
    setRumors((prev) => prev.map(apply));
    setSelected((prev) => (prev ? apply(prev) : prev));
    await setRumorReaction(rumor.id, current, value);
  };

  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.filterChip,
        { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryBg : colors.raised },
      ]}
    >
      <Text style={[styles.filterChipText, { color: active ? colors.primary : colors.muted }]}>{label}</Text>
    </Pressable>
  );

  const TopBar = (
    <View style={[styles.topBar, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      <Text style={[styles.logo, { color: colors.text }]}>
        Viddi<Text style={{ color: colors.primary }}>.</Text>
      </Text>
      <View style={styles.topIcons}>
        <Pressable onPress={() => setSearchOpen((s) => !s)} accessibilityRole="button" accessibilityLabel="Buscar" hitSlop={8}>
          <Feather name="search" size={18} color={searchOpen ? colors.primary : colors.muted} />
        </Pressable>
        <Pressable
          onPress={() => setFiltersOpen((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel="Ordenar e filtrar mercados"
          accessibilityState={{ expanded: filtersOpen }}
          hitSlop={8}
        >
          <Feather name="sliders" size={18} color={filtersOpen || hasActiveFilter ? colors.primary : colors.muted} />
        </Pressable>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {TopBar}
        <View style={styles.body}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ marginBottom: spacing.md }}>
              <SkeletonMarketCard />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {TopBar}
        <View style={styles.centered}>
          <Text style={[styles.errTitle, { color: colors.text }]}>Não consegui carregar o feed</Text>
          <Text style={[styles.errDetail, { color: colors.danger }]}>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {TopBar}
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View>
            {searchOpen ? (
              <View style={[styles.searchBox, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                <Feather name="search" size={14} color={colors.faint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar por artista, novela, time..."
                  placeholderTextColor={colors.faint}
                  style={[styles.searchInput, { color: colors.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
                {hasSearch ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Limpar busca">
                    <Feather name="x" size={14} color={colors.faint} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {(['open', 'resolved'] as const).map((t) => {
                const active = tab === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setTab(t);
                      resetControls();
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[styles.segBtn, active && { backgroundColor: colors.raised }]}
                  >
                    <Text
                      style={[
                        styles.segText,
                        { color: active ? colors.text : colors.faint, fontFamily: active ? fonts.sansSemi : fonts.sans },
                      ]}
                    >
                      {t === 'open' ? 'Em aberto' : 'Resolvidas'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {filtersOpen ? (
              <View style={[styles.filterPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.filterSection, { color: colors.faint }]}>ORDENAR</Text>
                <View style={styles.filterChips}>
                  {tab === 'open'
                    ? OPEN_SORTS.map((o) => <Chip key={o.key} label={o.label} active={sort === o.key} onPress={() => setSort(o.key)} />)
                    : RESOLVED_SORTS.map((o) => (
                        <Chip key={o.key} label={o.label} active={resolvedSort === o.key} onPress={() => setResolvedSort(o.key)} />
                      ))}
                </View>

                <Text style={[styles.filterSection, { color: colors.faint, marginTop: spacing.md }]}>
                  {tab === 'open' ? 'FILTROS RÁPIDOS' : 'RESULTADO'}
                </Text>
                <View style={styles.filterChips}>
                  {tab === 'open'
                    ? OPEN_QUICK.map((o) => (
                        <Chip key={o.key} label={o.label} active={quick.includes(o.key)} onPress={() => toggleQuick(o.key)} />
                      ))
                    : RESOLVED_OUTCOMES.map((o) => (
                        <Chip key={o.key} label={o.label} active={outcome === o.key} onPress={() => setOutcome(o.key)} />
                      ))}
                </View>

                <Text style={[styles.filterMeta, { color: colors.faint }]}>{filtered.length} resultado(s)</Text>
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="eyes" color={colors.faint} size={34} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {hasSearch
                ? `Nenhum resultado para “${query.trim()}”`
                : hasActiveFilter
                  ? 'Nenhum mercado com esse filtro'
                  : tab === 'open'
                    ? 'Nenhum mercado aberto agora'
                    : 'Nenhum mercado resolvido ainda'}
            </Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>
              {hasSearch || hasActiveFilter
                ? 'Tente limpar a busca ou trocar os filtros.'
                : tab === 'open'
                  ? 'Volte em breve — as fofocas não param.'
                  : 'Aguarda — os mercados vão resolver em breve.'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <MarketCard
            rumor={item}
            onPress={setSelected}
            onTakePosition={(r) => setSelected(r)}
            featured={index === 0 && tab === 'open' && !hasSearch && !hasActiveFilter}
          />
        )}
        ListFooterComponent={<View style={{ height: spacing.xxl }} />}
      />
      <RumorDetail
        rumor={selected}
        onClose={() => setSelected(null)}
        onVoted={(choice) => {
          if (!selected) return;
          const votedId = selected.id;
          const patchChoice = (rumor: Rumor) => (rumor.id === votedId ? applyLocalChoice(rumor, choice) : rumor);
          setLocalChoices((prev) => ({ ...prev, [votedId]: choice }));
          setRumors((prev) => prev.map(patchChoice));
          setSelected((prev) => (prev ? patchChoice(prev) : prev));
        }}
        onReact={reactToRumor}
        onOpenRumor={(id) => getRumorById(id).then((r) => r && setSelected(r))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  logo: { fontFamily: fonts.sansBold, fontSize: 20, letterSpacing: -0.4 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, minHeight: 40, fontFamily: fonts.sans, fontSize: 14 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, padding: 3, marginBottom: spacing.md },
  segBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
  segText: { fontSize: 12 },
  filterPanel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  filterSection: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.8, marginBottom: spacing.sm },
  filterMeta: { fontFamily: fonts.mono, fontSize: 10, marginTop: spacing.md },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 6 },
  filterChipText: { fontFamily: fonts.sansMed, fontSize: 11 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  errTitle: { fontFamily: fonts.sansSemi, fontSize: 15 },
  errDetail: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyEmoji: { fontSize: 32 },
  emptyTitle: { fontFamily: fonts.sansMed, fontSize: 14, textAlign: 'center' },
  emptySub: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center' },
});
