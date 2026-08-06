import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorScheme } from '../theme/tokens';
import { fonts, radius, spacing } from '../theme/tokens';

const SEEN_KEY = 'fofoca_first_run_seen_v1';

interface Row {
  icon: string;
  label: string;
  desc: string;
  tone: keyof Pick<ColorScheme, 'tea' | 'cap' | 'muted' | 'open' | 'gold' | 'primary'>;
}

const STEPS: { title: string; sub: string; rows: Row[] }[] = [
  {
    title: 'Bem-vindo ao Viddi.',
    sub: 'O mercado de previsões do mundo pop brasileiro.',
    rows: [
      { icon: 'V', label: 'Verdade', desc: 'Você acredita que a fofoca é verdade. Toma posição de que vai ser confirmada.', tone: 'tea' },
      { icon: 'M', label: 'Mentira', desc: 'Você acha que é mentira. Toma posição de que vai ser desmentida.', tone: 'cap' },
    ],
  },
  {
    title: 'Como os mercados resolvem',
    sub: 'Sem achismo — regras claras.',
    rows: [
      { icon: '📰', label: 'Fonte confiável', desc: 'Uma fonte de imprensa reconhecida confirma ou desmente. O mercado fecha na hora.', tone: 'muted' },
      { icon: '⏱', label: 'Prazo de 7 dias', desc: 'Sem confirmação no prazo, o mercado resolve com base na maioria.', tone: 'open' },
    ],
  },
  {
    title: 'Pontos e histórico',
    sub: 'Acertar tem valor.',
    rows: [
      { icon: '🏆', label: 'Pontos', desc: 'Cada acerto soma pontos. Quanto mais improvável seu palpite correto, mais você ganha.', tone: 'gold' },
      { icon: '📈', label: 'Histórico', desc: 'Seu histórico é público. Suba no ranking "O Profeta" e ganhe status.', tone: 'primary' },
      { icon: '👤', label: 'Anônimo por padrão', desc: 'Você escolhe um handle. Seus dados pessoais nunca aparecem.', tone: 'muted' },
    ],
  },
];

export default function FirstRunOverlay() {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEEN_KEY).then((v) => {
      if (active && !v) setShow(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = () => {
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
    setShow(false);
  };

  if (!show) return null;
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={dismiss}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.primary : colors.border }]} />
          ))}
        </View>

        <Text style={[styles.brand, { color: colors.primary }]}>VIDDI</Text>
        <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{current.sub}</Text>

        <View style={styles.rows}>
          {current.rows.map((r) => (
            <View key={r.label} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.rowIcon, { color: colors[r.tone] }]}>{r.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors[r.tone] }]}>{r.label}</Text>
                <Text style={[styles.rowDesc, { color: colors.muted }]}>{r.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          {step > 0 ? (
            <Pressable
              onPress={() => setStep(step - 1)}
              accessibilityRole="button"
              style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.backText, { color: colors.muted }]}>Voltar</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => (last ? dismiss() : setStep(step + 1))}
            accessibilityRole="button"
            style={[styles.nextBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.nextText, { color: colors.onPrimary }]}>{last ? 'Começar' : 'Continuar'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 56, paddingBottom: spacing.xl },
  dots: { flexDirection: 'row', gap: 6, marginBottom: spacing.xxl },
  dot: { height: 3, flex: 1, borderRadius: 2 },
  brand: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 16, letterSpacing: 0.5, marginBottom: spacing.lg },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 24, letterSpacing: -0.4, lineHeight: 31, marginBottom: 6 },
  sub: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginBottom: spacing.xl },
  rows: { flex: 1, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderWidth: 1, borderRadius: radius.sm + 2 },
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowLabel: { fontFamily: fonts.sansBold, fontSize: 12, marginBottom: 3 },
  rowDesc: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  backBtn: { flex: 1, borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: 13, alignItems: 'center' },
  backText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  nextBtn: { flex: 2, borderRadius: radius.sm + 2, paddingVertical: 13, alignItems: 'center' },
  nextText: { fontFamily: fonts.sansBold, fontSize: 13 },
});
