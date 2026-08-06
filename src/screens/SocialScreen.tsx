import { useCallback, useEffect, useMemo, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { formatDateTime, getRumorById, type Rumor } from '../lib/rumors';
import { type ReactionValue } from '../lib/reactions';
import { getSocialFeed, setRepostReaction, socialScore, type SocialRepost, type SocialSort } from '../lib/social';
import ReactionButtons from '../components/ReactionButtons';
import RepostDetail from '../components/RepostDetail';
import RumorDetail from '../components/RumorDetail';
import { Skeleton } from '../components/Skeleton';
import Avatar from '../components/icons/Avatar';
import Icon from '../components/icons/Icon';

export default function SocialScreen() {
  const { colors } = useTheme();
  const [posts, setPosts] = useState<SocialRepost[]>([]);
  const [tab, setTab] = useState<SocialSort>('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepost, setSelectedRepost] = useState<SocialRepost | null>(null);
  const [selectedRumor, setSelectedRumor] = useState<Rumor | null>(null);

  const load = useCallback(async () => {
    const result = await getSocialFeed(tab);
    setPosts(result.posts);
    setError(result.error);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const rankedPosts = useMemo(() => {
    if (tab === 'recent') return posts;
    return [...posts].sort((a, b) => socialScore(b.likeCount, b.dislikeCount) - socialScore(a.likeCount, a.dislikeCount));
  }, [posts, tab]);

  const reactToPost = async (post: SocialRepost, value: ReactionValue) => {
    const current = post.myReaction;
    const next = current === value ? null : value;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        let likeCount = p.likeCount;
        let dislikeCount = p.dislikeCount;
        if (current === 1) likeCount = Math.max(likeCount - 1, 0);
        if (current === -1) dislikeCount = Math.max(dislikeCount - 1, 0);
        if (next === 1) likeCount += 1;
        if (next === -1) dislikeCount += 1;
        return { ...p, likeCount, dislikeCount, myReaction: next };
      }),
    );
    await setRepostReaction(post.id, current, value);
  };

  const openRumor = async (rumorId: string) => {
    const r = await getRumorById(rumorId);
    if (r) setSelectedRumor(r);
  };

  const Header = (
    <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Social</Text>
      <Text style={[styles.subtitle, { color: colors.faint }]}>Opiniões da comunidade</Text>
      <View style={[styles.segment, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['recent', 'top'] as SocialSort[]).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segBtn, active && { backgroundColor: colors.raised }]}
            >
              <Text style={[styles.segText, { color: active ? colors.text : colors.faint, fontFamily: active ? fonts.sansSemi : fonts.sans }]}>
                {t === 'recent' ? 'Recentes' : 'Populares'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {Header}
        <View style={styles.body}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: spacing.md }]}>
              <View style={styles.authorRow}>
                <Skeleton width={32} height={32} radius={16} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="50%" height={12} />
                  <Skeleton width={80} height={8} />
                </View>
              </View>
              <Skeleton width="95%" height={12} />
              <Skeleton width="80%" height={12} style={{ marginTop: 6, marginBottom: spacing.md }} />
              <Skeleton width="100%" height={44} radius={8} />
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
        data={rankedPosts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.zeroWrap}>
            <Icon name="chat" color={colors.faint} size={34} />
            <Text style={[styles.zeroTitle, { color: colors.text }]}>
              {error ? 'Social ainda não está ativo' : 'Ainda não há opiniões'}
            </Text>
            <Text style={[styles.zeroSub, { color: colors.faint }]}>
              {error
                ? 'Rode a migração 0013_social_feed_reactions.sql no Supabase.'
                : 'Abra um mercado e seja o primeiro a publicar sua opinião anônima.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onReact={reactToPost}
            onOpenReplies={setSelectedRepost}
            onOpenRumor={openRumor}
          />
        )}
        ListFooterComponent={<View style={{ height: spacing.xxl }} />}
      />
      <RepostDetail repost={selectedRepost} onClose={() => setSelectedRepost(null)} onOpenRumor={openRumor} />
      <RumorDetail rumor={selectedRumor} onClose={() => setSelectedRumor(null)} onOpenRumor={openRumor} />
    </View>
  );
}

function PostCard({
  post,
  onReact,
  onOpenReplies,
  onOpenRumor,
}: {
  post: SocialRepost;
  onReact: (post: SocialRepost, value: ReactionValue) => void;
  onOpenReplies: (post: SocialRepost) => void;
  onOpenRumor: (rumorId: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={() => onOpenReplies(post)} accessibilityRole="button" accessibilityLabel="Ver respostas da opinião">
        <View style={styles.authorRow}>
          <View style={[styles.avatar, { backgroundColor: colors.raised }]}>
            {post.avatar ? (
              <Avatar value={post.avatar} size={20} />
            ) : (
              <Text style={[styles.avatarText, { color: colors.muted }]}>{(post.handle ?? 'a').slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.authorTop}>
              <Text style={[styles.handle, { color: colors.text }]} numberOfLines={1}>
                @{post.handle ?? 'anônimo'}
              </Text>
              <Text style={[styles.when, { color: colors.faint }]}>{formatDateTime(post.createdAt)}</Text>
            </View>
            <View style={styles.convRow}>
              <Text style={[styles.convLabel, { color: colors.faint }]}>convicção</Text>
              <ConvictionBar level={post.rating} />
            </View>
          </View>
        </View>
        <Text style={[styles.caption, { color: colors.text }]}>{post.caption}</Text>
      </Pressable>

      <Pressable
        onPress={() => onOpenRumor(post.rumorId)}
        accessibilityRole="button"
        accessibilityLabel="Abrir o mercado citado"
        style={[styles.quoted, { backgroundColor: colors.raised, borderColor: colors.border }]}
      >
        <Text style={[styles.quotedText, { color: colors.muted }]} numberOfLines={3}>
          {post.rumorSummary}
        </Text>
        <View style={styles.quotedFoot}>
          <Text style={[styles.quotedLink, { color: colors.primary }]}>ver mercado</Text>
          <Feather name="arrow-up-right" size={11} color={colors.primary} />
        </View>
      </Pressable>

      <View style={styles.actions}>
        <ReactionButtons
          compact
          likeCount={post.likeCount}
          dislikeCount={post.dislikeCount}
          myReaction={post.myReaction}
          onReact={(value) => onReact(post, value)}
        />
        <Pressable onPress={() => onOpenReplies(post)} accessibilityRole="button" accessibilityLabel="Ver respostas" style={styles.replyBtn}>
          <Feather name="message-circle" size={13} color={colors.faint} />
          <Text style={[styles.replyCount, { color: colors.faint }]}>{post.replyCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConvictionBar({ level }: { level: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.convBar}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[styles.convSeg, { backgroundColor: i <= level ? colors.primary : colors.border }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1 },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 20 },
  subtitle: { fontFamily: fonts.sans, fontSize: 11, marginTop: 2, marginBottom: spacing.md },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
  segText: { fontSize: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  authorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  authorTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handle: { fontFamily: fonts.sansSemi, fontSize: 12, flex: 1 },
  when: { fontFamily: fonts.mono, fontSize: 10 },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 3 },
  convLabel: { fontFamily: fonts.sans, fontSize: 10 },
  convBar: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  convSeg: { width: 8, height: 3, borderRadius: 1.5 },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  quoted: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md },
  quotedText: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16 },
  quotedFoot: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.sm },
  quotedLink: { fontFamily: fonts.monoSemi, fontSize: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  replyCount: { fontFamily: fonts.mono, fontSize: 11 },
  zeroWrap: { alignItems: 'center', paddingTop: 60, gap: spacing.sm },
  zeroEmoji: { fontSize: 32 },
  zeroTitle: { fontFamily: fonts.sansMed, fontSize: 14, textAlign: 'center' },
  zeroSub: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', paddingHorizontal: spacing.xl },
});
