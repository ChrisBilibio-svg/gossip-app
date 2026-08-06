import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import type { Choice } from '../lib/predictions';
import {
  getCoinEconomyState,
  noCashValueReminder,
  placeFixedPrediction,
  potentialReturns,
  reserveWarningCopy,
  reserveWarningForStake,
  requestFixedPredictionQuote,
  stakeLimits,
  validateStake,
  type EconomyState,
  type FixedMarketOutcomeQuote,
} from '../lib/economy';
import { formatDeadline } from '../lib/rumors';
import type { Rumor } from '../lib/rumors';

interface Props {
  rumor: Rumor;
  choice: Choice | null;
  visible: boolean;
  onClose: () => void;
  onPlaced: (choice: Choice) => void;
  onError: (message: string) => void;
}

export default function PredictionSlip({ rumor, choice, visible, onClose, onPlaced, onError }: Props) {
  const { colors } = useTheme();
  const [economy, setEconomy] = useState<EconomyState | null>(null);
  const [quote, setQuote] = useState<FixedMarketOutcomeQuote | null>(null);
  const [stakeText, setStakeText] = useState('100');
  const [placing, setPlacing] = useState(false);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshQuote = useCallback(async (notice?: string) => {
    if (!choice) return;
    try {
      const next = await requestFixedPredictionQuote(rumor.id, choice);
      if (!next) {
        setQuote(null);
        setLoadError('Não foi possível obter uma cotação agora. Feche e tente novamente em instantes.');
        return;
      }
      setQuote(next);
      setLoadError(null);
      if (notice) setQuoteNotice(notice);
    } catch {
      setQuote(null);
      setLoadError('Não foi possível atualizar a cotação. Feche e tente novamente.');
    }
  }, [choice, rumor.id]);

  useEffect(() => {
    if (!visible || !choice) return;
    let active = true;
    setEconomy(null);
    setQuote(null);
    setQuoteNotice(null);
    setLoadError(null);
    Promise.all([getCoinEconomyState(), requestFixedPredictionQuote(rumor.id, choice)])
      .then(([state, quoteRow]) => {
        if (!active) return;
        setEconomy(state);
        setStakeText(String(state.standardStakeCoins));
        if (!state.featureEnabled || state.predictionPlacementKilled) {
          setLoadError('Os palpites com moedas ainda não estão disponíveis.');
          return;
        }
        if (!quoteRow) {
          setLoadError('Não foi possível obter uma cotação agora. Feche e tente novamente em instantes.');
          return;
        }
        setQuote(quoteRow);
      })
      .catch(() => {
        if (active) setLoadError('Não foi possível carregar a carteira e a cotação. Feche e tente novamente.');
      });
    return () => {
      active = false;
    };
  }, [choice, rumor.id, visible]);

  const stake = /^\d+$/.test(stakeText.trim()) ? Number(stakeText.trim()) : Number.NaN;
  const limits = economy ? stakeLimits(economy.balance, economy.recommendedWalletFraction, economy.maxWalletFraction, economy.absoluteMaxStakeCoins) : null;
  const returns = quote && Number.isInteger(stake) && stake > 0 ? potentialReturns(stake, quote.decimalOdds) : { totalReturn: 0, netWin: 0 };
  const validation = economy && limits ? validateStake(stake, economy.balance, limits, economy.absoluteMaxStakeCoins) : null;
  const stakeForDisplay = Number.isInteger(stake) ? stake : 0;
  const remaining = economy ? economy.balance - stakeForDisplay : 0;
  const reserveWarning = economy ? reserveWarningForStake(stakeForDisplay, economy.balance) : null;
  const deadline = formatDeadline(rumor.predictionDeadline);
  const insufficient = validation?.toLowerCase().includes('saldo insuficiente');

  const submit = useCallback(async () => {
    if (!choice || !economy || !quote || validation || !quote.quoteId) return;
    setPlacing(true);
    const idempotencyKey = `fixed:${rumor.id}:${choice}:${quote.quoteId}:${stake}`;
    const result = await placeFixedPrediction({
      rumorId: rumor.id,
      choice,
      stakeCoins: stake,
      probabilityVersion: quote.probabilityVersion,
      quoteId: quote.quoteId,
      idempotencyKey,
    });
    setPlacing(false);
    if (!result.ok) {
      if (result.quoteChanged) {
        await refreshQuote('As odds mudaram ou a cotação expirou. Confira o novo retorno e confirme novamente.');
        return;
      }
      onError(result.error ?? 'Não foi possível registrar a previsão com moedas.');
      return;
    }
    onPlaced(choice);
    onClose();
  }, [choice, economy, onClose, onError, onPlaced, quote, refreshQuote, rumor.id, stake, validation]);

  if (!choice) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Confirmar palpite</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar palpite">
              <Feather name="x" size={18} color={colors.faint} />
            </Pressable>
          </View>

          {loadError ? (
            <>
              <Text style={[styles.copy, { color: colors.danger }]}>{loadError}</Text>
              <Pressable onPress={onClose} style={[styles.neutralBtn, { borderColor: colors.border }]} accessibilityRole="button">
                <Text style={[styles.neutralText, { color: colors.primary }]}>Voltar para A Coluna</Text>
              </Pressable>
            </>
          ) : !economy || !quote || !limits ? (
            <Text style={[styles.copy, { color: colors.muted }]}>Carregando cotação server-side, odds e carteira...</Text>
          ) : (
            <>
              <Text style={[styles.question, { color: colors.text }]}>{rumor.summary}</Text>
              {quoteNotice ? <Text style={[styles.notice, { color: colors.gold }]}>{quoteNotice}</Text> : null}
              <Info label="Resultado escolhido" value={choice === 'true' ? 'Verdade' : 'Mentira'} />
              <Info label="Probabilidade atual" value={`${Math.round(quote.probability * 100)}%`} />
              <Info label="Retorno fixado" value={`${quote.decimalOdds.toFixed(2)}x`} />
              <Info label="Saldo disponível" value={`${economy.balance.toLocaleString('pt-BR')} moedas`} />
              <Info label="Stake máximo" value={`${limits.hardMaxStake.toLocaleString('pt-BR')} moedas`} />
              <Info label="Retorno total potencial" value={`${returns.totalReturn.toLocaleString('pt-BR')} moedas`} />
              <Info label="Ganho líquido potencial" value={`${returns.netWin.toLocaleString('pt-BR')} moedas`} />
              <Info label="Saldo após stake" value={`${remaining.toLocaleString('pt-BR')} moedas`} />
              <Info label="Mercado fecha" value={deadline || 'em breve'} />

              <View style={styles.stakeInputWrap}>
                <Text style={[styles.inputLabel, { color: colors.faint }]}>Stake em moedas inteiras</Text>
                <TextInput
                  value={stakeText}
                  onChangeText={setStakeText}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor={colors.faint}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.raised }]}
                  accessibilityLabel="Stake em moedas"
                />
              </View>

              <View style={styles.stakes}>
                {economy.quickStakeCoins.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setStakeText(String(value))}
                    style={[styles.stakeBtn, { borderColor: stake === value ? colors.primary : colors.border, backgroundColor: stake === value ? colors.primaryBg : colors.raised }]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.stakeText, { color: stake === value ? colors.primary : colors.text }]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.copy, { color: colors.faint }]}>Padrão: {economy.standardStakeCoins} · recomendado: {limits.recommendedStake} · máximo seguro: {limits.hardMaxStake}</Text>
              {reserveWarning ? <Text style={[styles.warning, { color: colors.gold }]}>{reserveWarningCopy(reserveWarning)}</Text> : null}
              {validation ? <Text style={[styles.error, { color: colors.danger }]}>{validation}</Text> : null}
              {insufficient ? <Pressable onPress={onClose} style={[styles.neutralBtn, { borderColor: colors.border }]} accessibilityRole="button" accessibilityLabel="Ver opções de moedas"><Text style={[styles.neutralText, { color: colors.primary }]}>Ver opções de moedas</Text></Pressable> : null}
              <Text style={[styles.disclaimer, { color: colors.faint }]}>{noCashValueReminder()}</Text>

              <Pressable
                onPress={submit}
                disabled={placing || Boolean(validation)}
                style={[styles.submit, { backgroundColor: colors.primary }, (placing || Boolean(validation)) && styles.disabled]}
                accessibilityRole="button"
              >
                <Text style={[styles.submitText, { color: colors.onPrimary }]}>{placing ? 'Confirmando...' : `Confirmar ${Number.isFinite(stake) ? stake : 0} moedas`}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.faint }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 20 },
  question: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 15, lineHeight: 21 },
  copy: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  notice: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 17 },
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
  neutralBtn: { minHeight: 44, borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  neutralText: { fontFamily: fonts.sansBold, fontSize: 12 },
  disclaimer: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: spacing.sm },
  submit: { minHeight: 44, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  disabled: { opacity: 0.55 },
  submitText: { fontFamily: fonts.sansBold, fontSize: 14 },
});
