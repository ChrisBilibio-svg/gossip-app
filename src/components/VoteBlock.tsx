import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { splitPercent, type Rumor } from '../lib/rumors';
import { getMyChoice, type Choice } from '../lib/predictions';
import { getMyHandle } from '../lib/profile';
import Icon from './icons/Icon';
import HandlePrompt from './HandlePrompt';
import PredictionSlip from './PredictionSlip';
import { getCoinEconomyState, offeredDecimalOdds } from '../lib/economy';

interface Props {
  rumor: Rumor;
  onVoted?: (choice: Choice) => void;
  viewerIsPro?: boolean;
}

function haptic() {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* no-op on web */
  }
}

export default function VoteBlock({ rumor, onVoted }: Props) {
  const { colors } = useTheme();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandleState] = useState<string | null | undefined>(undefined);
  const [promptOpen, setPromptOpen] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [slipChoice, setSlipChoice] = useState<Choice | null>(null);

  const { tea: teaPct, cap: capPct } = splitPercent(rumor);
  const teaProbability = Math.max(10, Math.min(90, teaPct)) / 100;
  const capProbability = Math.max(10, Math.min(90, capPct)) / 100;
  const displayedTeaPct = Math.round(teaProbability * 100);
  const displayedCapPct = Math.round(capProbability * 100);
  const teaOdds = offeredDecimalOdds(teaProbability);
  const capOdds = offeredDecimalOdds(capProbability);

  useEffect(() => {
    let active = true;
    setChoice(null);
    setError(null);
    setPromptOpen(false);
    setPendingChoice(null);
    setTradingEnabled(false);
    setSlipChoice(null);
    getCoinEconomyState().then((state) => active && setTradingEnabled(state.featureEnabled && !state.predictionPlacementKilled));
    getMyHandle().then((h) => active && setHandleState(h));
    getMyChoice(rumor.id).then((c) => active && setChoice(c));
    return () => {
      active = false;
    };
  }, [rumor.id]);

  const trade = async (c: Choice) => {
    haptic();
    setError(null);
    if (!tradingEnabled) {
      setError('Trading com moedas está desativado pelo servidor. Nenhum palpite grátis será enviado.');
      return;
    }
    let h = handle;
    if (h === undefined) {
      h = await getMyHandle();
      setHandleState(h);
    }
    if (!h) {
      setPendingChoice(c);
      setPromptOpen(true);
      return;
    }
    setSlipChoice(c);
  };

  const onHandleSet = (newHandle: string) => {
    setHandleState(newHandle);
    setPromptOpen(false);
    const c = pendingChoice;
    setPendingChoice(null);
    if (c) setSlipChoice(c);
  };

  return (
    <View style={styles.wrap}>
      {choice === null ? (
        <>
          <View style={styles.marketInfo}>
            <OutcomeQuote label="Verdade" probability={displayedTeaPct} odds={teaOdds} tone="tea" />
            <OutcomeQuote label="Mentira" probability={displayedCapPct} odds={capOdds} tone="cap" />
          </View>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}
              onPress={() => trade('true')}
              accessibilityRole="button"
              accessibilityLabel="Escolher Verdade"
            >
              <View style={styles.sideRow}>
                <Icon name="verdade" color={colors.tea} size={18} />
                <Text style={[styles.btnSide, { color: colors.tea }]}>Verdade</Text>
              </View>
              <Text style={[styles.btnPct, { color: colors.tea }]}>Retorno atual {teaOdds.toFixed(2)}x</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}
              onPress={() => trade('false')}
              accessibilityRole="button"
              accessibilityLabel="Escolher Mentira"
            >
              <View style={styles.sideRow}>
                <Icon name="mentira" color={colors.cap} size={18} />
                <Text style={[styles.btnSide, { color: colors.cap }]}>Mentira</Text>
              </View>
              <Text style={[styles.btnPct, { color: colors.cap }]}>Retorno atual {capOdds.toFixed(2)}x</Text>
            </Pressable>
          </View>
          <Text style={[styles.noCash, { color: colors.faint }]}>Moedas não têm valor em dinheiro. Todo palpite exige stake de moedas.</Text>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        </>
      ) : (
        <View style={[styles.locked, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.lockedRow}>
            <View style={styles.sideRow}>
              <Icon name={choice === 'true' ? 'verdade' : 'mentira'} color={choice === 'true' ? colors.tea : colors.cap} size={15} />
              <Text style={[styles.lockedPick, { color: choice === 'true' ? colors.tea : colors.cap }]}>Sua posição: {choice === 'true' ? 'Verdade' : 'Mentira'}</Text>
            </View>
            <Text style={[styles.lockedNote, { color: colors.faint }]}>Odds fixadas</Text>
          </View>
        </View>
      )}

      <PredictionSlip
        rumor={rumor}
        choice={slipChoice}
        visible={slipChoice !== null}
        onClose={() => setSlipChoice(null)}
        onError={(message) => {
          setSlipChoice(null);
          setError(message);
        }}
        onPlaced={(placedChoice) => {
          setChoice(placedChoice);
          onVoted?.(placedChoice);
        }}
      />

      <HandlePrompt visible={promptOpen} onClose={() => { setPromptOpen(false); setPendingChoice(null); }} onSet={onHandleSet} />
    </View>
  );
}

function OutcomeQuote({ label, probability, odds, tone }: { label: string; probability: number; odds: number; tone: 'tea' | 'cap' }) {
  const { colors } = useTheme();
  const color = tone === 'tea' ? colors.tea : colors.cap;
  const bg = tone === 'tea' ? colors.teaBg : colors.capBg;
  const border = tone === 'tea' ? colors.teaBorder : colors.capBorder;
  return (
    <View style={[styles.quoteCard, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.quoteLabel, { color }]}>{label}</Text>
      <Text style={[styles.quoteText, { color: colors.text }]}>Probabilidade: {probability}%</Text>
      <Text style={[styles.quoteText, { color: colors.text }]}>Retorno atual: {odds.toFixed(2)}x</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  marketInfo: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  quoteCard: { flex: 1, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, gap: 2 },
  quoteLabel: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 0.4 },
  quoteText: { fontFamily: fonts.mono, fontSize: 10 },
  buttons: { flexDirection: 'row', gap: spacing.md },
  btn: { flex: 1, borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', gap: 2 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnSide: { fontFamily: fonts.sansBold, fontSize: 15 },
  btnPct: { fontFamily: fonts.mono, fontSize: 11 },
  noCash: { fontFamily: fonts.sans, fontSize: 10, lineHeight: 15, marginTop: spacing.sm, textAlign: 'center' },
  error: { fontFamily: fonts.sansSemi, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  locked: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  lockedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  lockedPick: { fontFamily: fonts.sansSemi, fontSize: 13, flex: 1 },
  lockedNote: { fontFamily: fonts.mono, fontSize: 11 },
});
