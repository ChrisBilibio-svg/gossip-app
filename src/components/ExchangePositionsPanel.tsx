import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import {
  buildExchangeClientOrderId,
  executeAmmTradeV2,
  getPortfolioV2,
  isDuplicateExchangeOrderResult,
  normalizeExchangeV2Error,
  quoteAmmV2,
  quoteCashOutV1,
  sellPositionV1,
  type ExchangePositionV2,
} from '../lib/exchangeV2';

/**
 * "Suas posições" — the holdings the exchange produces, with live cost basis /
 * P&L and a casual "Vender" (cash-out) action. Cash-out quotes against the
 * current book then sells; production trading is gated off, so a real tap gets
 * a friendly "em breve" state. A `previewPositions` prop renders the design
 * without a live exchange market.
 */
interface Props {
  environment?: 'development' | 'preview' | 'production';
  previewPositions?: ExchangePositionV2[];
  /** Map of marketId -> current mark price (0..1) for the winning side, for value display. */
  markByMarket?: Record<string, number>;
  /** Only show holdings for this market (used inline on a market's detail). */
  marketFilter?: string;
  /** Cash out through the LMSR house AMM instead of the CLOB. */
  ammEnabled?: boolean;
  onCashedOut?: (position: ExchangePositionV2) => void;
}

type RowState = { quoting: boolean; selling: boolean; estimate: number | null; error: string | null; done: boolean; received: number | null };

const EMPTY_ROW: RowState = { quoting: false, selling: false, estimate: null, error: null, done: false, received: null };

export default function ExchangePositionsPanel({ environment = 'production', previewPositions, markByMarket, marketFilter, ammEnabled = false, onCashedOut }: Props) {
  const { colors } = useTheme();
  const [positions, setPositions] = useState<ExchangePositionV2[] | null>(previewPositions ?? null);
  const [loading, setLoading] = useState(previewPositions === undefined);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (previewPositions !== undefined) {
      setPositions(previewPositions);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getPortfolioV2()
      .then((p) => { if (active) { setPositions(p.positions); setLoading(false); } })
      .catch(() => { if (active) { setPositions([]); setLoading(false); } });
    return () => { active = false; };
  }, [previewPositions]);

  const patchRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), ...patch } }));
  }, []);

  const quoteCashOut = useCallback(async (pos: ExchangePositionV2) => {
    patchRow(pos.id, { quoting: true, error: null });
    if (ammEnabled) {
      const q = await quoteAmmV2(pos.marketId, pos.outcome, 'sell', String(pos.quantity));
      patchRow(pos.id, { quoting: false });
      if (!q) { patchRow(pos.id, { error: 'A negociação deste mercado ainda não está disponível.' }); return; }
      patchRow(pos.id, { estimate: Math.round(q.totalCoins) });
      return;
    }
    const quote = await quoteCashOutV1(pos.marketId, pos.outcome, String(pos.quantity));
    patchRow(pos.id, { quoting: false });
    if (!quote) {
      patchRow(pos.id, { error: 'A negociação deste mercado ainda não está disponível.' });
      return;
    }
    const price = quote.estimatedAverageExecutionPrice ?? quote.requestedLimitPrice;
    patchRow(pos.id, { estimate: Math.round(pos.quantity * price) });
  }, [ammEnabled, patchRow]);

  const confirmSell = useCallback(async (pos: ExchangePositionV2) => {
    patchRow(pos.id, { selling: true, error: null });
    if (ammEnabled) {
      const q = await quoteAmmV2(pos.marketId, pos.outcome, 'sell', String(pos.quantity));
      if (!q) { patchRow(pos.id, { selling: false, error: 'A negociação ainda não está disponível.' }); return; }
      const result = await executeAmmTradeV2({
        marketId: pos.marketId,
        outcome: pos.outcome,
        action: 'sell',
        quantity: String(pos.quantity),
        quoteId: q.quoteId,
        environment,
      });
      patchRow(pos.id, { selling: false });
      if (result.ok) {
        patchRow(pos.id, { done: true, estimate: null, received: Math.round(result.totalCoins ?? q.totalCoins) });
        onCashedOut?.(pos);
        return;
      }
      patchRow(pos.id, { error: normalizeExchangeV2Error(result.error ?? result.errorCode ?? '').message });
      return;
    }
    const quote = await quoteCashOutV1(pos.marketId, pos.outcome, String(pos.quantity));
    if (!quote) { patchRow(pos.id, { selling: false, error: 'A negociação ainda não está disponível.' }); return; }
    const clientOrderId = buildExchangeClientOrderId({ marketId: pos.marketId, outcome: pos.outcome, action: 'sell', quoteId: quote.quoteId });
    const result = await sellPositionV1({
      marketId: pos.marketId,
      outcome: pos.outcome,
      quantity: String(pos.quantity),
      limitPrice: quote.requestedLimitPrice.toFixed(8),
      timeInForce: 'GTC',
      clientOrderId,
      quoteId: quote.quoteId,
      environment,
    });
    patchRow(pos.id, { selling: false });
    if (result.ok || isDuplicateExchangeOrderResult(result)) {
      patchRow(pos.id, { done: true, estimate: null });
      onCashedOut?.(pos);
      return;
    }
    patchRow(pos.id, { error: normalizeExchangeV2Error(result.error ?? result.errorCode ?? '').message });
  }, [ammEnabled, environment, onCashedOut, patchRow]);

  const shown = (positions ?? []).filter(
    (p) => (marketFilter ? p.marketId === marketFilter : true) && p.quantity > 0,
  );

  // Scoped to one market (inline on a detail): render nothing until there's a
  // holding, so it only appears once the user actually owns shares here.
  if (marketFilter) {
    if (loading || shown.length === 0) return null;
  } else {
    if (loading) return <Text style={[styles.copy, { color: colors.muted }]}>Carregando suas posições…</Text>;
    if (shown.length === 0) {
      return <Text style={[styles.copy, { color: colors.muted }]}>Você ainda não tem posições. Compre um palpite para começar.</Text>;
    }
  }

  return (
    <View style={styles.list}>
      {shown.map((pos) => {
        const row = rows[pos.id] ?? EMPTY_ROW;
        const isTea = pos.outcome === 'true';
        const sideColor = isTea ? colors.tea : colors.cap;
        const mark = markByMarket?.[pos.marketId];
        const value = mark != null ? Math.round(pos.quantity * (isTea ? mark : 1 - mark)) : null;
        const pnl = value != null ? value - Math.round(pos.costBasis) : null;
        return (
          <View key={pos.id} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.raised }]}>
            <View style={styles.rowTop}>
              <View style={[styles.chip, { backgroundColor: isTea ? colors.teaBg : colors.capBg, borderColor: sideColor }]}>
                <Text style={[styles.chipText, { color: sideColor }]}>{isTea ? 'Verdade' : 'Mentira'}</Text>
              </View>
              <Text style={[styles.qty, { color: colors.text }]}>{pos.quantity.toLocaleString('pt-BR')} palpites</Text>
            </View>

            <Meta label="Preço médio" value={`${Math.round(pos.averageEntryPrice * 100)}¢`} colors={colors} />
            <Meta label="Investido" value={`${Math.round(pos.costBasis).toLocaleString('pt-BR')} moedas`} colors={colors} />
            {value != null ? <Meta label="Valor atual" value={`${value.toLocaleString('pt-BR')} moedas`} colors={colors} /> : null}
            {pnl != null ? <Meta label="Lucro/prejuízo" value={`${pnl >= 0 ? '+' : ''}${pnl.toLocaleString('pt-BR')}`} colors={colors} highlight={pnl >= 0 ? colors.gold : colors.danger} /> : null}

            {row.error ? <Text style={[styles.error, { color: colors.danger }]}>{row.error}</Text> : null}

            {row.done ? (
              <Text style={[styles.doneText, { color: colors.tea }]}>
                {row.received != null ? `Vendido · recebeu ${row.received.toLocaleString('pt-BR')} moedas ✓` : 'Posição vendida ✓'}
              </Text>
            ) : row.estimate != null ? (
              <View style={styles.actions}>
                <Pressable onPress={() => patchRow(pos.id, { estimate: null })} style={[styles.ghostBtn, { borderColor: colors.border }]} accessibilityRole="button">
                  <Text style={[styles.ghostText, { color: colors.muted }]}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={() => confirmSell(pos)} disabled={row.selling} style={[styles.sellBtn, { backgroundColor: sideColor }, row.selling && styles.disabled]} accessibilityRole="button">
                  <Text style={[styles.sellText, { color: colors.onPrimary }]}>{row.selling ? 'Vendendo…' : `Vender · receber ~${row.estimate.toLocaleString('pt-BR')}`}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => quoteCashOut(pos)} disabled={row.quoting} style={[styles.venderBtn, { borderColor: sideColor }, row.quoting && styles.disabled]} accessibilityRole="button">
                <Text style={[styles.venderText, { color: sideColor }]}>{row.quoting ? 'Cotando…' : 'Vender posição'}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Meta({ label, value, colors, highlight }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors']; highlight?: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: colors.faint }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: highlight ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  copy: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  row: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  chip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: fonts.sansBold, fontSize: 11 },
  qty: { fontFamily: fonts.monoSemi, fontSize: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontFamily: fonts.sans, fontSize: 11 },
  metaValue: { fontFamily: fonts.monoSemi, fontSize: 12 },
  error: { fontFamily: fonts.sansSemi, fontSize: 11, marginTop: 4 },
  doneText: { fontFamily: fonts.sansBold, fontSize: 12, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  ghostBtn: { minHeight: 40, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  sellBtn: { flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  sellText: { fontFamily: fonts.sansBold, fontSize: 12 },
  venderBtn: { minHeight: 40, borderWidth: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  venderText: { fontFamily: fonts.sansBold, fontSize: 12 },
  disabled: { opacity: 0.55 },
});
