import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { CLOSED_LOOP_COIN_COPY } from '../lib/economy';

/**
 * Viddi Pro paywall — feature-flagged scaffold. Checkout remains inert until
 * platform store products, age-rating/legal review, and server-side receipt
 * verification/webhooks are live. Prices shown here are placeholders; production
 * UI must render the localized price returned by Apple/Google/billing provider.
 */
const PERKS = [
  { icon: '🪙', title: '300 moedas agora', body: 'Crédito imediato só depois da compra ser verificada no servidor.' },
  { icon: '📆', title: '40 moedas por dia', body: '30 dias de serviço com acúmulo automático, mesmo sem abrir o app.' },
  { icon: '🛟', title: 'Piso diário Pro', body: 'No limite diário, se o saldo estiver abaixo de 1.000, o servidor completa antes das 40 moedas.' },
  { icon: '📊', title: 'Insights Pro', body: 'Acesso antecipado a odds, gráficos e estatísticas antes do palpite.' },
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
            <Text style={[styles.title, { color: colors.text }]}>Assinatura mensal Pro</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Moedas de entretenimento + insights. Nunca altera verdade, placar de habilidade ou resolução.</Text>

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
              <Text style={[styles.priceLabel, { color: colors.faint }]}>preço localizado da loja</Text>
              <Text style={[styles.price, { color: colors.text }]}>—</Text>
              <Text style={[styles.priceNote, { color: colors.faint }]}>Benchmark EUA: US$ 4,99/mês. Produção deve exibir o preço localizado retornado pela loja.</Text>
            </View>

            <View style={[styles.scheduleBox, { borderColor: colors.border }]}>
              <Text style={[styles.scheduleTitle, { color: colors.text }]}>Agenda de moedas verificada</Text>
              <Text style={[styles.scheduleLine, { color: colors.muted }]}>300 agora + 40 × 30 dias = 1.500 moedas programadas.</Text>
              <Text style={[styles.scheduleLine, { color: colors.muted }]}>Cancelamento não remove moedas já concedidas; apenas interrompe grants futuros quando o direito expirar.</Text>
            </View>

            <Text style={[styles.fairplay, { color: colors.faint }]}>{CLOSED_LOOP_COIN_COPY}</Text>
            <Text style={[styles.fairplay, { color: colors.faint }]}>Renovação, restauração, grace period, retry, cancelamento, expiração, reembolso e revogação são processados por recibos/webhooks verificados no servidor. Não registramos dados sensíveis de pagamento em analytics.</Text>

            <Pressable style={[styles.cta, { backgroundColor: colors.primary }]} disabled accessibilityRole="button" accessibilityLabel="Assinatura Pro indisponível até revisão legal e pagamentos verificados">
              <Text style={[styles.ctaText, { color: colors.onPrimary }]}>Checkout bloqueado por feature flag</Text>
            </Pressable>
            <Pressable style={[styles.restore, { borderColor: colors.border }]} disabled accessibilityRole="button" accessibilityLabel="Restaurar compra indisponível até integração da loja">
              <Text style={[styles.restoreText, { color: colors.muted }]}>Restaurar compra — em breve</Text>
            </Pressable>
            <Text style={[styles.cancel, { color: colors.faint }]}>Para cancelar, use as assinaturas da App Store/Google Play quando a compra estiver ativa.</Text>
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
  subtitle: { fontFamily: fonts.sans, fontSize: 13, marginBottom: spacing.md, lineHeight: 19 },
  perk: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.sm },
  perkIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  perkText: { flex: 1 },
  perkTitle: { fontFamily: fonts.sansSemi, fontSize: 14 },
  perkBody: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, marginTop: 1 },
  priceBox: { alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.lg },
  priceLabel: { fontFamily: fonts.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  price: { fontFamily: fonts.monoBold, fontSize: 28 },
  priceNote: { fontFamily: fonts.sans, fontSize: 11, marginTop: 2, textAlign: 'center', paddingHorizontal: spacing.md, lineHeight: 16 },
  scheduleBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  scheduleTitle: { fontFamily: fonts.sansSemi, fontSize: 13, marginBottom: 4 },
  scheduleLine: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  fairplay: { fontFamily: fonts.sans, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: spacing.md },
  cta: { borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md, opacity: 0.7 },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 15 },
  restore: { borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: spacing.sm, alignItems: 'center', marginTop: spacing.sm, opacity: 0.7 },
  restoreText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  cancel: { fontFamily: fonts.sans, fontSize: 10, textAlign: 'center', lineHeight: 15, marginTop: spacing.sm },
  close: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
});
