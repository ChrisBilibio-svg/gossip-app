import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { CLOSED_LOOP_COIN_COPY, COIN_STORE_PRODUCTS, getCoinEconomyState, type EconomyState } from '../lib/economy';

interface Props {
  compact?: boolean;
}

export default function CoinStoreButton({ compact = false }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EconomyState | null>(null);

  useEffect(() => {
    let active = true;
    getCoinEconomyState().then((next) => active && setState(next));
    return () => { active = false; };
  }, [open]);

  const balance = state?.balance ?? 0;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Loja de moedas"
        hitSlop={8}
        style={[styles.button, { backgroundColor: colors.raised, borderColor: colors.border }, compact && styles.compact]}
      >
        <Feather name="shopping-bag" size={15} color={colors.gold} />
        <Text style={[styles.balance, { color: colors.text }]}>{balance.toLocaleString('pt-BR')}</Text>
      </Pressable>
      <CoinStoreSheet visible={open} onClose={() => setOpen(false)} state={state} />
    </>
  );
}

function CoinStoreSheet({ visible, onClose, state }: { visible: boolean; onClose: () => void; state: EconomyState | null }) {
  const { colors } = useTheme();
  const purchasesDisabled = !state?.featureEnabled || state.purchasesKilled;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.kicker, { color: colors.gold }]}>A COLUNA · LOJA</Text>
              <Text style={[styles.title, { color: colors.text }]}>Moedas virtuais</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar loja de moedas" hitSlop={8}>
              <Feather name="x" size={18} color={colors.faint} />
            </Pressable>
          </View>
          <Text style={[styles.copy, { color: colors.muted }]}>Pacotes únicos estão disponíveis para usuários grátis e Pro. O app deve exibir o preço localizado retornado pela loja antes do checkout.</Text>
          <ScrollView contentContainerStyle={styles.products} showsVerticalScrollIndicator={false}>
            {COIN_STORE_PRODUCTS.map((product) => (
              <View key={product.id} style={[styles.product, { backgroundColor: colors.raised, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.productTitle, { color: colors.text }]}>{product.title}</Text>
                  <Text style={[styles.productDesc, { color: colors.muted }]}>{product.description}</Text>
                  <Text style={[styles.benchmark, { color: colors.faint }]}>Benchmark: {product.benchmarkUsd} · preço localizado: {product.localizedPrice ?? 'fornecido pela loja'}</Text>
                </View>
                <Pressable
                  disabled={purchasesDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver opção ${product.title}`}
                  style={[styles.optionBtn, { backgroundColor: colors.primary }, purchasesDisabled && styles.disabled]}
                >
                  <Text style={[styles.optionText, { color: colors.onPrimary }]}>{product.subscription ? 'Ver Pro' : 'Ver opção'}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          {purchasesDisabled ? <Text style={[styles.warning, { color: colors.gold }]}>Compras estão desativadas por feature flag até revisão legal, classificação etária e verificação server-side da loja.</Text> : null}
          <Text style={[styles.disclaimer, { color: colors.faint }]}>{CLOSED_LOOP_COIN_COPY}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  compact: { minHeight: 44, paddingHorizontal: 8 },
  balance: { fontFamily: fonts.monoBold, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '86%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  kicker: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1 },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 22, marginTop: 2 },
  copy: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  products: { gap: spacing.sm, paddingBottom: spacing.md },
  product: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  productTitle: { fontFamily: fonts.sansBold, fontSize: 15 },
  productDesc: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, marginTop: 2 },
  benchmark: { fontFamily: fonts.mono, fontSize: 10, marginTop: 4 },
  optionBtn: { minHeight: 44, alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' },
  optionText: { fontFamily: fonts.sansBold, fontSize: 12 },
  disabled: { opacity: 0.55 },
  warning: { fontFamily: fonts.sansSemi, fontSize: 11, lineHeight: 16 },
  disclaimer: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center' },
});
