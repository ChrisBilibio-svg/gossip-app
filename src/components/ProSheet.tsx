import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';

/**
 * Viddi Pro paywall — SCAFFOLD ONLY, no billing wired. Pricing/copy are
 * placeholders pending sign-off; the CTA is intentionally inert ("Em breve").
 */
const PERKS = [
  { icon: '⏱️', title: 'Alertas antecipados', body: 'Receba os mercados quentes antes de todo mundo.' },
  { icon: '📊', title: 'Analytics avançado', body: 'Sua precisão, tendências e desempenho por tema.' },
  { icon: '✨', title: 'Flair de perfil', body: 'Cosméticos e destaque de status no ranking.' },
  { icon: '🔮', title: 'Persona de Profeta', body: 'Avatar e visual exclusivos para quem se destaca nos palpites.' },
];

export default function ProSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.kicker, { color: colors.primary }]}>VIDDI PRO</Text>
            <Text style={[styles.title, { color: colors.text }]}>Vire um Profeta Pro</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Velocidade e status — não altera resultados.</Text>

            {PERKS.map((p) => (
              <View key={p.title} style={styles.perk}>
                <Text style={styles.perkIcon}>{p.icon}</Text>
                <View style={styles.perkText}>
                  <Text style={[styles.perkTitle, { color: colors.text }]}>{p.title}</Text>
                  <Text style={[styles.perkBody, { color: colors.muted }]}>{p.body}</Text>
                </View>
              </View>
            ))}

            <View style={[styles.priceBox, { backgroundColor: colors.raised, borderColor: colors.border }]}>
              <Text style={[styles.price, { color: colors.text }]}>
                R$ 19,90<Text style={[styles.priceUnit, { color: colors.muted }]}>/mês</Text>
              </Text>
              <Text style={[styles.priceNote, { color: colors.faint }]}>Cancele quando quiser.</Text>
            </View>

            <Text style={[styles.fairplay, { color: colors.faint }]}>
              🔒 O Pro nunca muda a verdade nem o placar. Dinheiro não pesa no palpite.
            </Text>

            <Pressable style={[styles.cta, { backgroundColor: colors.primary }]} disabled accessibilityRole="button" accessibilityLabel="Viddi Pro em breve">
              <Text style={[styles.ctaText, { color: colors.onPrimary }]}>Em breve</Text>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar">
              <Text style={[styles.close, { color: colors.muted }]}>Agora não</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', paddingTop: spacing.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, marginBottom: spacing.sm },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xs },
  kicker: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: fonts.sansBold, fontSize: 22, marginTop: 4 },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, marginBottom: spacing.md },
  perk: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.sm },
  perkIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  perkText: { flex: 1 },
  perkTitle: { fontFamily: fonts.sansSemi, fontSize: 14 },
  perkBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 1 },
  priceBox: { alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.lg },
  price: { fontFamily: fonts.monoBold, fontSize: 28 },
  priceUnit: { fontFamily: fonts.monoMed, fontSize: 14 },
  priceNote: { fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  fairplay: { fontFamily: fonts.sans, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: spacing.md },
  cta: { borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md, opacity: 0.7 },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 15 },
  close: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
});
