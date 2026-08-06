import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorScheme } from '../theme/tokens';
import { fonts, radius, spacing } from '../theme/tokens';

interface Row {
  icon: string;
  label: string;
  desc: string;
  tone: keyof Pick<ColorScheme, 'tea' | 'cap' | 'muted' | 'open' | 'gold' | 'primary' | 'faint'>;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'O palpite',
    rows: [
      { icon: 'V', label: 'Verdade', desc: 'Você acha que a fofoca é verdade — toma posição de que vai ser confirmada.', tone: 'tea' },
      { icon: 'M', label: 'Mentira', desc: 'Você acha que é mentira — toma posição de que vai ser desmentida.', tone: 'cap' },
      { icon: '🔒', label: 'Posição trancada', desc: 'Cada palpite é único e definitivo. Depois de tomar posição, não dá pra trocar.', tone: 'muted' },
    ],
  },
  {
    title: 'Como o mercado resolve',
    rows: [
      { icon: '📰', label: 'Por fonte', desc: 'Uma fonte de imprensa confiável confirma ou desmente — o mercado fecha na hora.', tone: 'muted' },
      { icon: '⏱', label: 'Por prazo', desc: 'Mercados de "até a data X": sem confirmação no prazo, resolvem como combinado.', tone: 'open' },
      { icon: '↔', label: 'VOID (anulado)', desc: 'Sem veredito até o prazo? O mercado é anulado — seu palpite é devolvido, sem ganho nem perda.', tone: 'faint' },
    ],
  },
  {
    title: 'Pontos & ranking',
    rows: [
      { icon: '🏆', label: 'Pontos', desc: 'Cada acerto soma pontos. Quanto mais improvável seu palpite correto, mais você ganha.', tone: 'gold' },
      { icon: '📈', label: 'Histórico', desc: 'Seu histórico de acertos é público. Suba no ranking "O Profeta" e ganhe status.', tone: 'primary' },
    ],
  },
  {
    title: 'Regras da casa',
    rows: [
      { icon: '👀', label: 'Opinião, não acusação', desc: 'Aqui é diversão. Os palpites refletem a opinião da comunidade — nunca afirmação de fato sobre ninguém.', tone: 'muted' },
    ],
  },
];

/** In-app "Como funciona" — a persistent FAQ for predictions, resolution, VOID, points. */
export default function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Como funciona</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {SECTIONS.map((section) => (
              <View key={section.title} style={{ marginBottom: spacing.lg }}>
                <Text style={[styles.sectionTitle, { color: colors.faint }]}>{section.title.toUpperCase()}</Text>
                {section.rows.map((r) => (
                  <View key={r.label} style={[styles.row, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                    <Text style={[styles.icon, { color: colors[r.tone] }]}>{r.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors[r.tone] }]}>{r.label}</Text>
                      <Text style={[styles.rowDesc, { color: colors.muted }]}>{r.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
            <View style={{ height: spacing.lg }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 21 },
  body: { paddingHorizontal: spacing.xl },
  sectionTitle: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 1, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderWidth: 1, borderRadius: radius.sm + 2, marginBottom: spacing.sm },
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  rowLabel: { fontFamily: fonts.sansBold, fontSize: 12, marginBottom: 3 },
  rowDesc: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
});
