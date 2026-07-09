import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { listKeywords, subscribeKeyword, unsubscribeKeyword, type KeywordSubscription } from '../lib/notifications';

/**
 * Manage keyword follows ("🔔 me avise sobre…"). Subscriptions live server-side
 * (notifications.ts); a new market mentioning a followed topic notifies the
 * user. The on-device push token registration is a separate native step.
 */
export default function KeywordsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [keywords, setKeywords] = useState<KeywordSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listKeywords();
    setKeywords(r.keywords);
    setError(r.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setInput('');
      setError(null);
      load();
    }
  }, [visible, load]);

  const add = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    const res = await subscribeKeyword(input);
    setBusy(false);
    if (res.ok) {
      setInput('');
      setError(null);
      load();
    } else {
      setError(res.error ?? 'Não consegui adicionar agora.');
    }
  };

  const remove = async (keyword: string) => {
    await unsubscribeKeyword(keyword);
    load();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Tópicos que sigo</Text>
              <Text style={[styles.sub, { color: colors.faint }]}>
                Receba um aviso quando uma nova fofoca mencionar um tópico — ex.: "vinicius junior".
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <View style={[styles.addRow, { backgroundColor: colors.raised, borderColor: colors.border }]}>
            <Feather name="bell" size={14} color={colors.faint} />
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Adicionar um tópico…"
              placeholderTextColor={colors.faint}
              style={[styles.input, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={add}
              maxLength={48}
            />
            <Pressable
              onPress={add}
              disabled={!input.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel="Seguir tópico"
              style={[styles.addBtn, { backgroundColor: colors.primary }, (!input.trim() || busy) && styles.off]}
            >
              <Text style={[styles.addBtnText, { color: colors.onPrimary }]}>Seguir</Text>
            </Pressable>
          </View>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : keywords.length === 0 ? (
              <Text style={[styles.empty, { color: colors.faint }]}>
                Você ainda não segue nenhum tópico. Adicione um acima 👀
              </Text>
            ) : (
              keywords.map((k) => (
                <View key={k.id} style={[styles.kwRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.kw, { color: colors.text }]}>🔔 {k.keyword}</Text>
                  <Pressable
                    onPress={() => remove(k.keyword)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Deixar de seguir ${k.keyword}`}
                  >
                    <Feather name="x" size={16} color={colors.faint} />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  title: { fontFamily: fonts.sansBold, fontSize: 18 },
  sub: { fontFamily: fonts.sans, fontSize: 12, marginTop: 2, lineHeight: 17 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44 },
  input: { flex: 1, minHeight: 44, fontFamily: fonts.sans, fontSize: 14 },
  addBtn: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  addBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  off: { opacity: 0.45 },
  error: { fontFamily: fonts.sans, fontSize: 12, marginTop: spacing.sm },
  list: { marginTop: spacing.md },
  empty: { fontFamily: fonts.sans, fontSize: 13, textAlign: 'center', marginTop: spacing.lg },
  kwRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1 },
  kw: { fontFamily: fonts.sansMed, fontSize: 14 },
});
