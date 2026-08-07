import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import {
  buildExchangeClientOrderId,
  executeAmmTradeV2,
  getMarketSnapshotV2,
  isDuplicateExchangeOrderResult,
  normalizeExchangeV2Error,
  placeOrderV2,
  quoteAmmV2,
  quoteOrderV2,
  type AmmQuoteV2,
  type ExchangeOutcome,
  type MarketSnapshotV2,
  type OrderQuoteV2,
} from '../lib/exchangeV2';

/**
 * Casual "buy VERDADE/MENTIRA shares, cash out later" trade sheet for an
 * exchange_v2 market. A share settles for 1 coin if its side wins, 0 if it
 * loses (0.5 both sides on VOID), so buying `quantity` shares at price `p`
 * costs `quantity × p` coins and returns up to `quantity` coins if it wins.
 *
 * Trading is server-gated: in production `placeOrderV2` returns
 * `exchange_unavailable` until the gate is enabled, and this sheet shows a
 * friendly "em breve" state rather than an error. A `previewSnapshot` prop
 * lets us render the design without a live exchange market.
 */
interface Props {
  visible: boolean;
  marketId: string;
  summary: string;
  initialOutcome?: ExchangeOutcome;
  environment?: 'development' | 'preview' | 'production';
  /**
   * When the market runs on the LMSR house AMM, quote/execute go through the
   * always-on curve (`quoteAmmV2` / `executeAmmTradeV2`) instead of the CLOB.
   */
  ammEnabled?: boolean;
  /** Bypass the network snapshot load (design preview / dev-gated demos). */
  previewSnapshot?: MarketSnapshotV2 | null;
  onClose: () => void;
  onFilled?: (outcome: ExchangeOutcome) => void;
}

const QUICK_LOTS = [100, 200, 500];

function roundToTick(value: number, tick: number): number {
  if (!tick || tick <= 0) return value;
  return Math.round(value / tick) * tick;
}

export default function ExchangeTradeSheet({
  visible,
  marketId,
  summary,
  initialOutcome = 'true',
  environment = 'production',
  ammEnabled = false,
  previewSnapshot,
  onClose,
  onFilled,
}: Props) {
  const { colors } = useTheme();
  const [snapshot, setSnapshot] = useState<MarketSnapshotV2 | null>(null);
  const [outcome, setOutcome] = useState<ExchangeOutcome>(initialOutcome);
  const [qtyText, setQtyText] = useState('100');
  const [quote, setQuote] = useState<OrderQuoteV2 | null>(null);
  const [ammQuote, setAmmQuote] = useState<AmmQuoteV2 | null>(null);
  const [placed, setPlaced] = useState<{ outcome: ExchangeOutcome; quantity: number; cost: number } | null>(null);
  const clearQuotes = useCallback(() => { setQuote(null); setAmmQuote(null); }, []);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Load the market snapshot when the sheet opens.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setOutcome(initialOutcome);
    setQuote(null);
    setAmmQuote(null);
    setPlaced(null);
    setNotice(null);
    setErrorMsg(null);
    setUnavailable(false);
    setLoading(true);
    if (previewSnapshot !== undefined) {
      setSnapshot(previewSnapshot);
      setUnavailable(!previewSnapshot);
      setLoading(false);
      return;
    }
    getMarketSnapshotV2(marketId)
      .then((snap) => {
        if (!active) return;
        setSnapshot(snap);
        setUnavailable(!snap || snap.state !== 'open');
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSnapshot(null);
        setUnavailable(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, marketId, initialOutcome, previewSnapshot]);

  // The casual "price" for a buy = current best ask, else the mark probability.
  const priceFor = useCallback(
    (side: ExchangeOutcome): number | null => {
      if (!snapshot) return null;
      const mark = side === 'true' ? snapshot.markProbability : 1 - snapshot.markProbability;
      const ask = snapshot.bestAsk;
      const raw = ask != null && side === 'true' ? ask : mark;
      const clamped = Math.min(Math.max(raw, snapshot.tickSize), 1 - snapshot.tickSize);
      return roundToTick(clamped, snapshot.tickSize);
    },
    [snapshot],
  );

  const price = priceFor(outcome);
  const quantity = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : Number.NaN;
  const validQty = Number.isInteger(quantity) && quantity > 0;
  const cost = validQty && price != null ? Math.round(quantity * price) : 0;
  const maxReturn = validQty ? quantity : 0;
  const netWin = maxReturn - cost;
  const probPct = price != null ? Math.round(price * 100) : null;

  // Unified view over the CLOB quote and the AMM quote so the body renders one
  // flow. `activeCost` becomes the exact curve cost once an AMM quote lands.
  const hasQuote = ammEnabled ? ammQuote != null : quote != null;
  const activeCost = ammEnabled && ammQuote ? Math.round(ammQuote.totalCoins) : cost;
  const activeNetWin = maxReturn - activeCost;
  const activeProbPct = ammEnabled && ammQuote ? Math.round(ammQuote.unitPrice * 100) : probPct;
  const activeExpiresAt = ammEnabled ? ammQuote?.expiresAt ?? null : quote?.expiresAt ?? null;
  const activeWarning = ammEnabled ? ammQuote?.warnings?.[0] ?? null : quote?.warnings?.[0] ?? null;

  const fetchQuote = useCallback(
    async (noticeText?: string) => {
      if (!snapshot || !validQty) return;
      setQuoting(true);
      setErrorMsg(null);

      if (ammEnabled) {
        const next = await quoteAmmV2(marketId, outcome, 'buy', String(quantity));
        setQuoting(false);
        if (!next) {
          setAmmQuote(null);
          setErrorMsg('Não foi possível cotar na AMM agora. Ajuste a quantidade e tente de novo.');
          return;
        }
        setAmmQuote(next);
        if (noticeText) setNotice(noticeText);
        return;
      }

      if (price == null) { setQuoting(false); return; }
      const next = await quoteOrderV2(marketId, outcome, 'buy', String(quantity), price.toFixed(8));
      setQuoting(false);
      if (!next) {
        setQuote(null);
        setErrorMsg('Não foi possível cotar agora. Ajuste a quantidade e tente de novo.');
        return;
      }
      setQuote(next);
      if (noticeText) setNotice(noticeText);
    },
    [snapshot, price, validQty, marketId, outcome, quantity, ammEnabled],
  );

  const submit = useCallback(async () => {
    if (ammEnabled) {
      if (!ammQuote || !validQty) return;
      setPlacing(true);
      setErrorMsg(null);
      const result = await executeAmmTradeV2({
        marketId,
        outcome,
        action: 'buy',
        quantity: String(quantity),
        quoteId: ammQuote.quoteId,
        environment,
      });
      setPlacing(false);
      if (result.ok) {
        setPlaced({ outcome, quantity, cost: Math.round(result.totalCoins ?? activeCost) });
        onFilled?.(outcome);
        return;
      }
      if (result.requiresRequote) {
        setAmmQuote(null);
        await fetchQuote('O preço da AMM mudou. Confira o novo custo e confirme de novo.');
        return;
      }
      if (result.errorCode === 'exchange_unavailable' || result.errorCode === 'market_closed') {
        setUnavailable(true);
        return;
      }
      setErrorMsg(normalizeExchangeV2Error(result.error ?? result.errorCode ?? '').message);
      return;
    }

    if (!quote || price == null || !validQty) return;
    setPlacing(true);
    setErrorMsg(null);
    const clientOrderId = buildExchangeClientOrderId({ marketId, outcome, action: 'buy', quoteId: quote.quoteId });
    const result = await placeOrderV2({
      marketId,
      outcome,
      action: 'buy',
      quantity: String(quantity),
      limitPrice: price.toFixed(8),
      timeInForce: 'GTC',
      clientOrderId,
      quoteId: quote.quoteId,
      environment,
    });
    setPlacing(false);

    if (result.ok || isDuplicateExchangeOrderResult(result)) {
      setPlaced({ outcome, quantity, cost: activeCost });
      onFilled?.(outcome);
      return;
    }
    if (result.requiresRequote) {
      setQuote(null);
      await fetchQuote('O preço ou o livro mudou. Confira o novo custo e confirme de novo.');
      return;
    }
    if (result.errorCode === 'exchange_unavailable' || result.errorCode === 'market_closed') {
      setUnavailable(true);
      return;
    }
    const friendly = normalizeExchangeV2Error(result.error ?? result.errorCode ?? '');
    setErrorMsg(friendly.message);
  }, [ammEnabled, ammQuote, quote, price, validQty, marketId, outcome, quantity, activeCost, environment, onFilled, onClose, fetchQuote]);

  // Live countdown for the active quote (CLOB or AMM); auto-invalidate when it
  // lapses so a stale price can never be submitted.
  useEffect(() => {
    if (!activeExpiresAt) {
      setSecondsLeft(null);
      return;
    }
    const compute = () => Math.max(0, Math.ceil((new Date(activeExpiresAt).getTime() - Date.now()) / 1000));
    setSecondsLeft(compute());
    const id = setInterval(() => {
      const s = compute();
      setSecondsLeft(s);
      if (s <= 0) {
        clearInterval(id);
        clearQuotes();
        setNotice('A cotação expirou. Cote o palpite novamente.');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [activeExpiresAt, clearQuotes]);

  const isTea = outcome === 'true';
  const sideColor = isTea ? colors.tea : colors.cap;

  const body = useMemo(() => {
    if (loading) {
      return <Text style={[styles.copy, { color: colors.muted }]}>Carregando mercado e livro de ofertas…</Text>;
    }
    if (placed) {
      const isTeaPlaced = placed.outcome === 'true';
      const ret = placed.quantity;
      const profit = ret - placed.cost;
      return (
        <View style={styles.placedWrap}>
          <View style={[styles.placedIcon, { backgroundColor: isTeaPlaced ? colors.teaBg : colors.capBg, borderColor: isTeaPlaced ? colors.tea : colors.cap }]}>
            <Feather name="check" size={26} color={isTeaPlaced ? colors.tea : colors.cap} />
          </View>
          <Text style={[styles.placedTitle, { color: colors.text }]}>Feito!</Text>
          <Text style={[styles.placedSub, { color: colors.muted }]}>
            Você comprou {placed.quantity.toLocaleString('pt-BR')} {isTeaPlaced ? 'Verdade' : 'Mentira'}.
          </Text>
          <View style={[styles.placedReturn, { backgroundColor: colors.goldBg, borderColor: colors.gold }]}>
            <Text style={[styles.placedReturnLabel, { color: colors.faint }]}>Se acertar, você recebe</Text>
            <Text style={[styles.placedReturnValue, { color: colors.gold }]}>{ret.toLocaleString('pt-BR')} moedas</Text>
            {profit > 0 ? <Text style={[styles.placedProfit, { color: colors.tea }]}>lucro de +{profit.toLocaleString('pt-BR')} moedas</Text> : null}
          </View>
          <Text style={[styles.placedNote, { color: colors.faint }]}>
            Custo {placed.cost.toLocaleString('pt-BR')} moedas · você pode vender quando quiser enquanto o mercado estiver aberto. O resultado sai quando o mercado fechar.
          </Text>
          <Pressable onPress={onClose} style={[styles.submit, { backgroundColor: colors.primary }]} accessibilityRole="button">
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>Concluir</Text>
          </Pressable>
        </View>
      );
    }
    if (unavailable || !snapshot) {
      return (
        <>
          <Text style={[styles.copy, { color: colors.muted }]}>
            A negociação deste mercado ainda não está disponível. Em breve você poderá comprar e vender palpites a qualquer momento.
          </Text>
          <Pressable onPress={onClose} style={[styles.neutralBtn, { borderColor: colors.border }]} accessibilityRole="button">
            <Text style={[styles.neutralText, { color: colors.primary }]}>Voltar</Text>
          </Pressable>
        </>
      );
    }
    return (
      <>
        <Text style={[styles.question, { color: colors.text }]}>{summary}</Text>

        <View style={styles.sideRow}>
          <SideButton label="Verdade" active={isTea} color={colors.tea} bg={colors.teaBg} border={colors.teaBorder} onPress={() => { setOutcome('true'); clearQuotes(); }} />
          <SideButton label="Mentira" active={!isTea} color={colors.cap} bg={colors.capBg} border={colors.capBorder} onPress={() => { setOutcome('false'); clearQuotes(); }} />
        </View>

        {notice ? <Text style={[styles.notice, { color: colors.gold }]}>{notice}</Text> : null}

        <Info label={hasQuote ? 'Preço' : 'Preço atual'} value={activeProbPct != null ? `${activeProbPct}¢ · ${activeProbPct}%` : '—'} />
        <Info label={hasQuote ? 'Custo' : 'Custo estimado'} value={`${activeCost.toLocaleString('pt-BR')} moedas`} />
        <Info label="Retorno se acertar" value={`${maxReturn.toLocaleString('pt-BR')} moedas`} />
        <Info label="Lucro líquido" value={`${activeNetWin.toLocaleString('pt-BR')} moedas`} highlight={activeNetWin > 0 ? colors.gold : undefined} />

        <View style={styles.stakeInputWrap}>
          <Text style={[styles.inputLabel, { color: colors.faint }]}>Quantidade de palpites (lotes inteiros)</Text>
          <TextInput
            value={qtyText}
            onChangeText={(t) => { setQtyText(t); clearQuotes(); }}
            keyboardType="number-pad"
            placeholder="100"
            placeholderTextColor={colors.faint}
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.raised }]}
            accessibilityLabel="Quantidade de palpites"
          />
        </View>
        <View style={styles.stakes}>
          {QUICK_LOTS.map((value) => (
            <Pressable
              key={value}
              onPress={() => { setQtyText(String(value)); clearQuotes(); }}
              style={[styles.stakeBtn, { borderColor: quantity === value ? colors.primary : colors.border, backgroundColor: quantity === value ? colors.primaryBg : colors.raised }]}
              accessibilityRole="button"
            >
              <Text style={[styles.stakeText, { color: quantity === value ? colors.primary : colors.text }]}>{value}</Text>
            </Pressable>
          ))}
        </View>

        {hasQuote ? (
          <View style={[styles.quotePanel, { borderColor: colors.border, backgroundColor: colors.raised }]}>
            {ammEnabled && ammQuote ? (
              <>
                <Info label="Preço médio" value={`${Math.round(ammQuote.unitPrice * 100)}¢`} />
                <Info label="Novo preço após a compra" value={`${Math.round(ammQuote.priceYesAfter * 100)}¢ Verdade`} />
              </>
            ) : quote ? (
              <>
                <Info
                  label="Preço médio estimado"
                  value={quote.estimatedAverageExecutionPrice != null ? `${Math.round(quote.estimatedAverageExecutionPrice * 100)}¢` : (probPct != null ? `${probPct}¢` : '—')}
                />
                {quote.estimatedFillableQuantity > 0 && quote.estimatedFillableQuantity < quantity ? (
                  <Text style={[styles.warning, { color: colors.gold }]}>
                    Preenchimento parcial: ~{quote.estimatedFillableQuantity.toLocaleString('pt-BR')} de {quantity.toLocaleString('pt-BR')} agora; o resto fica na fila.
                  </Text>
                ) : null}
                {quote.fees > 0 ? <Info label="Taxas" value={`${quote.fees.toLocaleString('pt-BR')} moedas`} /> : null}
              </>
            ) : null}
            {secondsLeft != null ? (
              <Text style={[styles.countdown, { color: secondsLeft <= 5 ? colors.danger : colors.faint }]}>
                Cotação válida por {secondsLeft}s
              </Text>
            ) : null}
          </View>
        ) : null}

        {activeWarning ? <Text style={[styles.warning, { color: colors.gold }]}>{activeWarning}</Text> : null}
        {errorMsg ? <Text style={[styles.error, { color: colors.danger }]}>{errorMsg}</Text> : null}
        <Text style={[styles.disclaimer, { color: colors.faint }]}>Moedas são entretenimento, sem valor em dinheiro. Venda sujeita à liquidez.</Text>

        {!hasQuote ? (
          <Pressable
            onPress={() => fetchQuote()}
            disabled={quoting || !validQty}
            style={[styles.submit, { backgroundColor: sideColor }, (quoting || !validQty) && styles.disabled]}
            accessibilityRole="button"
          >
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>{quoting ? 'Cotando…' : 'Cotar palpite'}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={placing}
            style={[styles.submit, { backgroundColor: sideColor }, placing && styles.disabled]}
            accessibilityRole="button"
          >
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>{placing ? 'Confirmando…' : `Comprar ${maxReturn.toLocaleString('pt-BR')} · ${activeCost.toLocaleString('pt-BR')} moedas`}</Text>
          </Pressable>
        )}
      </>
    );
  }, [loading, placed, unavailable, snapshot, summary, isTea, colors, notice, probPct, maxReturn, qtyText, quantity, quote, ammEnabled, ammQuote, hasQuote, activeCost, activeNetWin, activeProbPct, activeWarning, clearQuotes, secondsLeft, errorMsg, quoting, placing, validQty, sideColor, fetchQuote, submit, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Negociar palpite</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
              <Feather name="x" size={18} color={colors.faint} />
            </Pressable>
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
}

function SideButton({ label, active, color, bg, border, onPress }: { label: string; active: boolean; color: string; bg: string; border: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.sideBtn, { borderColor: active ? color : border, backgroundColor: active ? bg : 'transparent' }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.sideText, { color, opacity: active ? 1 : 0.7 }]}>{label}</Text>
    </Pressable>
  );
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.faint }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: highlight ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.sansBold, fontSize: 18 },
  question: { fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 21 },
  copy: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  notice: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 17 },
  sideRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  sideBtn: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  sideText: { fontFamily: fonts.sansBold, fontSize: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { fontFamily: fonts.sans, fontSize: 12 },
  infoValue: { fontFamily: fonts.monoSemi, fontSize: 12, textAlign: 'right', flex: 1 },
  stakeInputWrap: { gap: 4, marginTop: spacing.sm },
  inputLabel: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.monoBold, fontSize: 16 },
  stakes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stakeBtn: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  stakeText: { fontFamily: fonts.monoBold, fontSize: 13 },
  warning: { fontFamily: fonts.sansSemi, fontSize: 11, lineHeight: 16 },
  error: { fontFamily: fonts.sansSemi, fontSize: 11, lineHeight: 16 },
  quotePanel: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, marginTop: spacing.xs },
  countdown: { fontFamily: fonts.monoSemi, fontSize: 11, textAlign: 'right' },
  neutralBtn: { minHeight: 44, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  neutralText: { fontFamily: fonts.sansBold, fontSize: 12 },
  disclaimer: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: spacing.xs },
  submit: { minHeight: 48, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  disabled: { opacity: 0.55 },
  submitText: { fontFamily: fonts.sansBold, fontSize: 14 },
  placedWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  placedIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  placedTitle: { fontFamily: fonts.sansBold, fontSize: 22 },
  placedSub: { fontFamily: fonts.sans, fontSize: 13, textAlign: 'center' },
  placedReturn: { alignSelf: 'stretch', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: 'center', gap: 2, marginTop: spacing.sm },
  placedReturnLabel: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.6 },
  placedReturnValue: { fontFamily: fonts.monoBold, fontSize: 34, letterSpacing: -0.5 },
  placedProfit: { fontFamily: fonts.sansSemi, fontSize: 13, marginTop: 2 },
  placedNote: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: spacing.xs },
});
