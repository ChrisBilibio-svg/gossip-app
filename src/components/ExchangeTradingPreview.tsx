import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import ExchangeTradeSheet from './ExchangeTradeSheet';
import ExchangePositionsPanel from './ExchangePositionsPanel';
import ExchangeMarketEntry from './ExchangeMarketEntry';
import type { ExchangeOutcome, ExchangePositionV2, MarketSnapshotV2 } from '../lib/exchangeV2';

/**
 * Dev-only preview of the casual exchange trading UX (buy sheet + positions +
 * cash-out), driven by demo data so it can be explored without a live
 * exchange_v2 market or the production trading gate. Mounted behind __DEV__.
 */
const DEMO_MARKET_ID = 'demo-market';
const DEMO_SUMMARY = 'Ana Castela confirmará publicamente um romance nos próximos 7 dias?';

const DEMO_SNAPSHOT: MarketSnapshotV2 = {
  marketId: DEMO_MARKET_ID,
  engineVersion: 'exchange_v2',
  state: 'open',
  bookVersion: 7,
  markProbability: 0.43,
  lastTradePrice: 0.42,
  bestBid: 0.41,
  bestAsk: 0.44,
  tickSize: 0.01,
  quantityStep: 0.000001,
  updatedAt: new Date().toISOString(),
};

const DEMO_POSITIONS: ExchangePositionV2[] = [
  {
    id: 'demo-pos-1', userId: 'demo', marketId: DEMO_MARKET_ID, outcome: 'true',
    quantity: 200, reservedSellQuantity: 0, costBasis: 82, averageEntryPrice: 0.41,
    realizedPnl: 0, feesPaid: 0, settlementId: null, settledAt: null, settledQuantity: 0,
    settlementPayout: 0, version: 3, updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo-pos-2', userId: 'demo', marketId: DEMO_MARKET_ID, outcome: 'false',
    quantity: 100, reservedSellQuantity: 0, costBasis: 60, averageEntryPrice: 0.60,
    realizedPnl: 0, feesPaid: 0, settlementId: null, settledAt: null, settledQuantity: 0,
    settlementPayout: 0, version: 2, updatedAt: new Date().toISOString(),
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ExchangeTradingPreview({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const [buyOutcome, setBuyOutcome] = useState<ExchangeOutcome | null>(null);

  const yesPct = Math.round(DEMO_SNAPSHOT.markProbability * 100);
  const noPct = 100 - yesPct;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
          <Text style={[styles.topTitle, { color: colors.text }]}>Negociação · preview</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar preview">
            <Feather name="x" size={20} color={colors.faint} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.badge, { color: colors.gold }]}>DADOS DE DEMONSTRAÇÃO</Text>

          <View style={[styles.marketCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.question, { color: colors.text }]}>{DEMO_SUMMARY}</Text>
            <View style={styles.priceRow}>
              <View style={[styles.priceCell, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}>
                <Text style={[styles.priceLabel, { color: colors.tea }]}>Verdade</Text>
                <Text style={[styles.priceValue, { color: colors.tea }]}>{yesPct}¢</Text>
              </View>
              <View style={[styles.priceCell, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}>
                <Text style={[styles.priceLabel, { color: colors.cap }]}>Mentira</Text>
                <Text style={[styles.priceValue, { color: colors.cap }]}>{noPct}¢</Text>
              </View>
            </View>
            <View style={styles.buyRow}>
              <Pressable onPress={() => setBuyOutcome('true')} style={[styles.buyBtn, { backgroundColor: colors.tea }]} accessibilityRole="button">
                <Text style={[styles.buyText, { color: colors.onPrimary }]}>Comprar Verdade</Text>
              </Pressable>
              <Pressable onPress={() => setBuyOutcome('false')} style={[styles.buyBtn, { backgroundColor: colors.cap }]} accessibilityRole="button">
                <Text style={[styles.buyText, { color: colors.onPrimary }]}>Comprar Mentira</Text>
              </Pressable>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Entrada no detalhe do mercado</Text>
          <ExchangeMarketEntry rumorId={DEMO_MARKET_ID} summary={DEMO_SUMMARY} previewSnapshot={DEMO_SNAPSHOT} />

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Suas posições</Text>
          <ExchangePositionsPanel
            environment="production"
            previewPositions={DEMO_POSITIONS}
            markByMarket={{ [DEMO_MARKET_ID]: DEMO_SNAPSHOT.markProbability }}
          />

          <Text style={[styles.footNote, { color: colors.faint }]}>
            Preview de UI. A negociação real fica desligada até aprovação. Compras e vendas aqui usam o contrato real, mas o gate de produção responde “em breve”.
          </Text>
        </ScrollView>

        <ExchangeTradeSheet
          visible={buyOutcome !== null}
          marketId={DEMO_MARKET_ID}
          summary={DEMO_SUMMARY}
          initialOutcome={buyOutcome ?? 'true'}
          previewSnapshot={DEMO_SNAPSHOT}
          onClose={() => setBuyOutcome(null)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.md, borderBottomWidth: 1 },
  topTitle: { fontFamily: fonts.sansBold, fontSize: 16 },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  badge: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1 },
  marketCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  question: { fontFamily: fonts.sansBold, fontSize: 16, lineHeight: 22 },
  priceRow: { flexDirection: 'row', gap: spacing.sm },
  priceCell: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', gap: 2 },
  priceLabel: { fontFamily: fonts.sansSemi, fontSize: 11 },
  priceValue: { fontFamily: fonts.monoBold, fontSize: 20 },
  buyRow: { flexDirection: 'row', gap: spacing.sm },
  buyBtn: { flex: 1, minHeight: 46, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  buyText: { fontFamily: fonts.sansBold, fontSize: 13 },
  sectionTitle: { fontFamily: fonts.sansBold, fontSize: 15, marginTop: spacing.sm },
  footNote: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, marginTop: spacing.md },
});
