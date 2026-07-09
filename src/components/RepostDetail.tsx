import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import Avatar from './icons/Avatar';
import { fonts, radius, spacing } from '../theme/tokens';
import { formatDateTime } from '../lib/rumors';
import { createRepostReply, getRepostReplies, type SocialRepost, type SocialRepostReply } from '../lib/social';

interface Props {
  repost: SocialRepost | null;
  onClose: () => void;
  onOpenRumor: (rumorId: string) => void;
}

/** Twitter-style repost detail: the take on top + a reply thread + composer. */
export default function RepostDetail({ repost, onClose, onOpenRumor }: Props) {
  const { colors } = useTheme();
  const [replies, setReplies] = useState<SocialRepostReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!repost) return;
    setLoading(true);
    setReplies(await getRepostReplies(repost.id));
    setLoading(false);
  }, [repost]);

  useEffect(() => {
    if (repost) {
      setBody('');
      setErr(null);
      load();
    }
  }, [repost, load]);

  const send = async () => {
    if (!repost || !body.trim()) return;
    setPosting(true);
    const res = await createRepostReply(repost.id, body);
    setPosting(false);
    if (res.ok) {
      setBody('');
      setErr(null);
      load();
    } else {
      setErr(res.error ?? 'Não consegui responder agora.');
    }
  };

  return (
    <Modal visible={repost !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Voltar">
            <Feather name="arrow-left" size={20} color={colors.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Opinião</Text>
        </View>

        {repost ? (
          <>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.metaRow}>
                <View style={styles.handleRow}>
                  {repost.avatar ? <Avatar value={repost.avatar} size={15} /> : null}
                  <Text style={[styles.handle, { color: colors.text }]}>@{repost.handle ?? 'anônimo'}</Text>
                </View>
                <Text style={[styles.when, { color: colors.faint }]}>{formatDateTime(repost.createdAt)}</Text>
              </View>
              <View style={styles.convRow}>
                <Text style={[styles.convLabel, { color: colors.faint }]}>convicção</Text>
                <View style={styles.convBar}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <View key={i} style={[styles.convSeg, { backgroundColor: i <= repost.rating ? colors.primary : colors.border }]} />
                  ))}
                </View>
              </View>
              <Text style={[styles.caption, { color: colors.text }]}>{repost.caption}</Text>

              <Pressable
                onPress={() => onOpenRumor(repost.rumorId)}
                accessibilityRole="button"
                accessibilityLabel="Abrir o mercado citado"
                style={[styles.rumorBox, { backgroundColor: colors.raised, borderColor: colors.border }]}
              >
                <Text style={[styles.rumorSummary, { color: colors.muted }]}>{repost.rumorSummary}</Text>
                <View style={styles.rumorFoot}>
                  <Text style={[styles.rumorLink, { color: colors.primary }]}>ver mercado</Text>
                  <Feather name="arrow-up-right" size={11} color={colors.primary} />
                </View>
              </Pressable>

              <Text style={[styles.repliesTitle, { color: colors.text, borderTopColor: colors.border }]}>
                Respostas{replies.length ? ` (${replies.length})` : ''}
              </Text>

              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
              ) : replies.length === 0 ? (
                <Text style={[styles.empty, { color: colors.faint }]}>Seja o primeiro a responder.</Text>
              ) : (
                replies.map((r) => (
                  <View key={r.id} style={[styles.reply, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.rHandle, { color: colors.text }]}>@{r.handle ?? 'anônimo'}</Text>
                    <Text style={[r.status === 'removed' ? styles.rRemoved : styles.rBody, { color: r.status === 'removed' ? colors.faint : colors.text }]}>
                      {r.status === 'removed' ? 'resposta removida' : r.body}
                    </Text>
                    <Text style={[styles.rWhen, { color: colors.faint }]}>{formatDateTime(r.createdAt)}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={[styles.composer, { backgroundColor: colors.navBar, borderTopColor: colors.border }]}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
                placeholder="Responder sem acusar como fato"
                placeholderTextColor={colors.faint}
                value={body}
                onChangeText={setBody}
                maxLength={280}
                multiline
              />
              <Pressable
                style={[styles.sendBtn, { backgroundColor: colors.primary }, (!body.trim() || posting) && styles.sendOff]}
                onPress={send}
                disabled={posting || !body.trim()}
                accessibilityRole="button"
                accessibilityLabel="Enviar resposta"
              >
                <Text style={[styles.sendText, { color: colors.onPrimary }]}>{posting ? '...' : 'Responder'}</Text>
              </Pressable>
            </View>
            {err ? <Text style={[styles.err, { color: colors.danger }]}>{err}</Text> : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  headerTitle: { fontFamily: fonts.sansSemi, fontSize: 14 },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  handle: { fontFamily: fonts.sansSemi, fontSize: 13 },
  when: { fontFamily: fonts.mono, fontSize: 10 },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  convLabel: { fontFamily: fonts.sans, fontSize: 10 },
  convBar: { flexDirection: 'row', gap: 2 },
  convSeg: { width: 8, height: 3, borderRadius: 1.5 },
  caption: { fontFamily: fonts.sansMed, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  rumorBox: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  rumorSummary: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  rumorFoot: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.sm },
  rumorLink: { fontFamily: fonts.monoSemi, fontSize: 10 },
  repliesTitle: { fontFamily: fonts.sansSemi, fontSize: 13, marginTop: spacing.xl, marginBottom: spacing.sm, borderTopWidth: 1, paddingTop: spacing.lg },
  empty: { fontFamily: fonts.sans, fontSize: 13, marginTop: spacing.sm },
  reply: { paddingVertical: spacing.md, borderBottomWidth: 1 },
  rHandle: { fontFamily: fonts.sansSemi, fontSize: 12 },
  rBody: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginTop: 2 },
  rRemoved: { fontFamily: fonts.sans, fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  rWhen: { fontFamily: fonts.mono, fontSize: 10, marginTop: 4 },
  composer: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.sans, fontSize: 13, maxHeight: 100 },
  sendBtn: { borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  sendOff: { opacity: 0.4 },
  sendText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  err: { fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
