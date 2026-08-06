import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { exchangeV2UiEnabled, resolveExchangeEnvironment } from '../lib/exchangeUiFlags';
import { getMarketSnapshotV2, type ExchangeOutcome, type MarketSnapshotV2 } from '../lib/exchangeV2';
import ExchangeTradeSheet from './ExchangeTradeSheet';

/**
 * Real-market entry point for exchange v2 (Claude/UI lane). Mounted under a
 * market's detail; it self-detects whether that rumor is actually an
 * exchange_v2 market by loading its snapshot (`exchange_markets.market_id` IS
 * the rumor id, so `marketId === rumorId`). It renders NOTHING when:
 *   - the UI flag is off (production default — see {@link exchangeV2UiEnabled}),
 *   - no exchange market backs this rumor (legacy fixed-odds only), or
 *   - the market is not open for trading.
 *
 * When it does render, it shows a casual mark-price + best bid/ask readout and
 * a "Negociar" button that opens {@link ExchangeTradeSheet} against the real
 * market. Production trading stays server-gated regardless; the sheet degrades
 * to a friendly "em breve" state until the gate is enabled.
 */
interface Props {
  rumorId: string;
  summary: string;
  /**
   * Bypass the network snapshot load with fixed data (dev preview / design
   * demos), mirroring {@link ExchangeTradeSheet}'s `previewSnapshot`. `null`
   * forces the hidden state; `undefined` (default) uses the live snapshot.
   */
  previewSnapshot?: MarketSnapshotV2 | null;
}

/** 0–1 price → whole-cent label, e.g. 0.43 → "43¢". */
function cents(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return '—';
  return `${Math.round(price * 100)}¢`;
}

export default function ExchangeMarketEntry({ rumorId, summary, previewSnapshot }: Props) {
  const { colors } = useTheme();
  const [snapshot, setSnapshot] = useState<MarketSnapshotV2 | null>(previewSnapshot ?? null);
  const [buyOutcome, setBuyOutcome] = useState<ExchangeOutcome | null>(null);

  useEffect(() => {
    if (!exchangeV2UiEnabled) return;
    if (previewSnapshot !== undefined) {
      setSnapshot(previewSnapshot);
      return;
    }
    let active = true;
    setSnapshot(null);
    getMarketSnapshotV2(rumorId)
      .then((snap) => {
        if (active) setSnapshot(snap);
      })
      .catch(() => {
        if (active) setSnapshot(null);
      });
    return () => {
      active = false;
    };
  }, [rumorId, previewSnapshot]);

  // Ship nothing to prod, and stay invisible unless a real, open market backs
  // this rumor.
  if (!exchangeV2UiEnabled) return null;
  if (!snapshot || snapshot.state !== 'open') return null;

  const yes = snapshot.markProbability;
  const no = 1 - snapshot.markProbability;
  const hasBid = snapshot.bestBid != null;
  const hasAsk = snapshot.bestAsk != null;
  const hasBook = hasBid || hasAsk;
  const spreadCents = hasBid && hasAsk ? Math.round((snapshot.bestAsk! - snapshot.bestBid!) * 100) : null;
  const midPrice = hasBid && hasAsk ? (snapshot.bestBid! + snapshot.bestAsk!) / 2 : null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.text }]}>Negociar palpite</Text>
        <View style={[styles.betaTag, { backgroundColor: colors.goldBg, borderColor: colors.gold }]}>
          <Text style={[styles.betaText, { color: colors.gold }]}>NOVO</Text>
        </View>
      </View>

      <Text style={[styles.copy, { color: colors.muted }]}>
        Compre Verdade ou Mentira ao preço de mercado e venda quando quiser, enquanto o mercado estiver aberto.
      </Text>

      <View style={styles.priceRow}>
        <View style={[styles.priceCell, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}>
          <Text style={[styles.priceLabel, { color: colors.tea }]}>Verdade</Text>
          <Text style={[styles.priceValue, { color: colors.tea }]}>{cents(yes)}</Text>
        </View>
        <View style={[styles.priceCell, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}>
          <Text style={[styles.priceLabel, { color: colors.cap }]}>Mentira</Text>
          <Text style={[styles.priceValue, { color: colors.cap }]}>{cents(no)}</Text>
        </View>
      </View>

      {hasBook ? (
        <>
          <View style={styles.bookRow}>
            <BookStat label="Melhor compra" value={cents(snapshot.bestBid)} color={colors.faint} valueColor={colors.tea} />
            <BookStat label="Preço médio" value={cents(snapshot.markProbability)} color={colors.faint} valueColor={colors.text} />
            <BookStat label="Melhor venda" value={cents(snapshot.bestAsk)} color={colors.faint} valueColor={colors.cap} />
          </View>
          <Text style={[styles.spreadLine, { color: colors.faint }]}>
            {spreadCents != null
              ? `Spread ${spreadCents}¢ · meio ${cents(midPrice)}`
              : 'Só um lado do livro tem oferta no momento.'}
          </Text>
        </>
      ) : (
        <View style={[styles.emptyBook, { borderColor: colors.border, backgroundColor: colors.raised }]}>
          <Text style={[styles.emptyBookText, { color: colors.muted }]}>
            Livro ainda sem ofertas — o preço de referência parte de {cents(snapshot.markProbability)}.
          </Text>
        </View>
      )}

      {snapshot.lastTradePrice != null ? (
        <Text style={[styles.lastTrade, { color: colors.faint }]}>
          Último negócio: {cents(snapshot.lastTradePrice)} · Verdade
        </Text>
      ) : null}

      <View style={styles.buyRow}>
        <Pressable onPress={() => setBuyOutcome('true')} style={[styles.buyBtn, { backgroundColor: colors.tea }]} accessibilityRole="button" accessibilityLabel="Comprar Verdade">
          <Text style={[styles.buyText, { color: colors.onPrimary }]}>Comprar Verdade</Text>
        </Pressable>
        <Pressable onPress={() => setBuyOutcome('false')} style={[styles.buyBtn, { backgroundColor: colors.cap }]} accessibilityRole="button" accessibilityLabel="Comprar Mentira">
          <Text style={[styles.buyText, { color: colors.onPrimary }]}>Comprar Mentira</Text>
        </Pressable>
      </View>

      <View style={styles.footRow}>
        <Feather name="info" size={11} color={colors.faint} />
        <Text style={[styles.footText, { color: colors.faint }]}>
          Moedas são entretenimento, sem valor em dinheiro. Venda sujeita à liquidez.
        </Text>
      </View>

      <ExchangeTradeSheet
        visible={buyOutcome !== null}
        marketId={rumorId}
        summary={summary}
        initialOutcome={buyOutcome ?? 'true'}
        environment={resolveExchangeEnvironment()}
        previewSnapshot={previewSnapshot}
        onClose={() => setBuyOutcome(null)}
      />
    </View>
  );
}

function BookStat({ label, value, color, valueColor }: { label: string; value: string; color: string; valueColor: string }) {
  return (
    <View style={styles.bookStat}>
      <Text style={[styles.bookLabel, { color }]}>{label}</Text>
      <Text style={[styles.bookValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 15 },
  betaTag: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  betaText: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.6 },
  copy: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  priceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  priceCell: { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', gap: 2 },
  priceLabel: { fontFamily: fonts.sansSemi, fontSize: 11 },
  priceValue: { fontFamily: fonts.monoBold, fontSize: 20 },
  bookRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs },
  bookStat: { flex: 1, alignItems: 'center', gap: 2 },
  bookLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.3 },
  bookValue: { fontFamily: fonts.monoSemi, fontSize: 13 },
  spreadLine: { fontFamily: fonts.mono, fontSize: 10, textAlign: 'center' },
  emptyBook: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  emptyBookText: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  lastTrade: { fontFamily: fonts.mono, fontSize: 10, textAlign: 'center' },
  buyRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  buyBtn: { flex: 1, minHeight: 46, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  buyText: { fontFamily: fonts.sansBold, fontSize: 13 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.xs },
  footText: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, flex: 1 },
});
