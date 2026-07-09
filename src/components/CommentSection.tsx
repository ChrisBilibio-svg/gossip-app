import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import Avatar from './icons/Avatar';
import { fonts, radius, spacing } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import {
  acceptGuidelines,
  blockUser,
  getComments,
  hasAcceptedGuidelines,
  postComment,
  reportComment,
  toggleLike,
  type Comment,
  type CommentSort,
} from '../lib/comments';

export default function CommentSection({ rumorId }: { rumorId: string }) {
  const { colors } = useTheme();
  const [comments, setComments] = useState<Comment[]>([]);
  const [sort, setSort] = useState<CommentSort>('recent');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);

  const load = useCallback(async () => {
    const [c, { data: u }] = await Promise.all([getComments(rumorId, sort), supabase.auth.getUser()]);
    setComments(c);
    setMeId(u.user?.id ?? null);
  }, [rumorId, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const doPost = async () => {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    await postComment(rumorId, text);
    setBody('');
    setPosting(false);
    load();
  };

  const onSend = async () => {
    if (!body.trim()) return;
    if (!(await hasAcceptedGuidelines())) {
      setGuidelinesOpen(true);
      return;
    }
    doPost();
  };

  const onAcceptGuidelines = async () => {
    await acceptGuidelines();
    setGuidelinesOpen(false);
    doPost();
  };

  const like = async (c: Comment) => {
    setComments((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, likedByMe: !x.likedByMe, likeCount: x.likeCount + (x.likedByMe ? -1 : 1) } : x)),
    );
    await toggleLike(c.id, c.likedByMe);
  };

  const report = async (c: Comment) => {
    await reportComment(c.id, 'inadequado');
    setMenuFor(null);
    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, body: 'Denunciado — em análise' } : x)));
  };

  const block = async (c: Comment) => {
    await blockUser(c.userId);
    setMenuFor(null);
    load();
  };

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Comentários</Text>
        <View style={[styles.sortRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SortBtn label="Recente" active={sort === 'recent'} onPress={() => setSort('recent')} />
          <SortBtn label="Top" active={sort === 'top'} onPress={() => setSort('top')} />
        </View>
      </View>

      {comments.length === 0 ? <Text style={[styles.empty, { color: colors.faint }]}>Seja o primeiro a comentar 👀</Text> : null}

      {comments.map((c) => (
        <View key={c.id} style={[styles.comment, { borderBottomColor: colors.border }]}>
          <View style={styles.cTop}>
            <View style={styles.handleRow}>
              {c.avatar ? <Avatar value={c.avatar} size={14} /> : null}
              <Text style={[styles.handle, { color: colors.muted }]}>@{c.handle ?? 'anônimo'}</Text>
            </View>
            {c.userId !== meId ? (
              <Pressable onPress={() => setMenuFor(menuFor === c.id ? null : c.id)} hitSlop={6}>
                <Text style={[styles.dots, { color: colors.faint }]}>⋯</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[c.status === 'removed' ? styles.removed : styles.body, { color: c.status === 'removed' ? colors.faint : colors.text }]}>
            {c.status === 'removed' ? 'comentário removido' : c.body}
          </Text>
          <View style={styles.cActions}>
            <Pressable onPress={() => like(c)}>
              <Text style={[styles.like, { color: c.likedByMe ? colors.cap : colors.faint }]}>
                {c.likedByMe ? '♥' : '♡'} {c.likeCount}
              </Text>
            </Pressable>
          </View>
          {menuFor === c.id ? (
            <View style={[styles.menu, { borderTopColor: colors.border }]}>
              <Pressable onPress={() => report(c)}>
                <Text style={[styles.menuItem, { color: colors.danger }]}>Denunciar</Text>
              </Pressable>
              <Pressable onPress={() => block(c)}>
                <Text style={[styles.menuItem, { color: colors.danger }]}>Bloquear</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}

      <View style={styles.composer}>
        <TextInput
          style={[styles.input, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
          placeholder="Escreva seu palpite, sem acusação"
          placeholderTextColor={colors.faint}
          value={body}
          onChangeText={setBody}
          maxLength={500}
          multiline
        />
        <Pressable
          style={[styles.send, { backgroundColor: colors.primary }, !body.trim() && styles.sendOff]}
          onPress={onSend}
          disabled={posting || !body.trim()}
        >
          <Text style={[styles.sendText, { color: colors.onPrimary }]}>{posting ? '...' : 'Enviar'}</Text>
        </Pressable>
      </View>

      <Modal visible={guidelinesOpen} transparent animationType="slide" onRequestClose={() => setGuidelinesOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.gTitle, { color: colors.text }]}>Regras da casa</Text>
            <Text style={[styles.gBody, { color: colors.muted }]}>
              Aqui é opinião e diversão — <Text style={[styles.bold, { color: colors.text }]}>nunca acusação como fato</Text>. Sem ataques,
              ódio ou conteúdo ilegal. Você pode denunciar e bloquear quem passar do ponto.
            </Text>
            <Pressable style={[styles.gCta, { backgroundColor: colors.primary }]} onPress={onAcceptGuidelines}>
              <Text style={[styles.gCtaText, { color: colors.onPrimary }]}>Concordo</Text>
            </Pressable>
            <Pressable onPress={() => setGuidelinesOpen(false)}>
              <Text style={[styles.gCancel, { color: colors.muted }]}>Agora não</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );

  function SortBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
      <Pressable onPress={onPress} style={[styles.sortBtn, active && { backgroundColor: colors.raised }]}>
        <Text style={[styles.sortText, { color: active ? colors.text : colors.faint, fontFamily: active ? fonts.sansSemi : fonts.sans }]}>{label}</Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, borderTopWidth: 1, paddingTop: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontFamily: fonts.sansSemi, fontSize: 13 },
  sortRow: { flexDirection: 'row', gap: 1, borderWidth: 1, borderRadius: 6, padding: 2 },
  sortBtn: { paddingVertical: 3, paddingHorizontal: spacing.sm, borderRadius: 4 },
  sortText: { fontSize: 10 },
  empty: { fontFamily: fonts.sans, fontSize: 13, marginBottom: spacing.md },
  comment: { borderBottomWidth: 1, paddingVertical: spacing.md },
  cTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handle: { fontFamily: fonts.sansSemi, fontSize: 11 },
  dots: { fontFamily: fonts.sansBold, fontSize: 16, paddingHorizontal: spacing.sm },
  body: { fontFamily: fonts.sans, fontSize: 12, marginTop: 2, lineHeight: 18 },
  removed: { fontFamily: fonts.sans, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  cActions: { flexDirection: 'row', marginTop: spacing.sm },
  like: { fontFamily: fonts.mono, fontSize: 11 },
  menu: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, borderTopWidth: 1, paddingTop: spacing.sm },
  menuItem: { fontFamily: fonts.sansSemi, fontSize: 12 },
  composer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.sans, fontSize: 13, maxHeight: 100 },
  send: { borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  sendOff: { opacity: 0.4 },
  sendText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxl, alignItems: 'center', gap: spacing.md },
  gTitle: { fontFamily: fonts.sansBold, fontSize: 20 },
  gBody: { fontFamily: fonts.sans, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  bold: { fontFamily: fonts.sansSemi },
  gCta: { alignSelf: 'stretch', borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center' },
  gCtaText: { fontFamily: fonts.sansBold, fontSize: 15 },
  gCancel: { fontFamily: fonts.sansMed, fontSize: 13 },
});
