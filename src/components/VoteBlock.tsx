import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { splitPercent, type Rumor } from '../lib/rumors';
import { getMyChoice, placeBet, type Choice } from '../lib/predictions';
import { getMyHandle } from '../lib/profile';
import OddsBar from './OddsBar';
import HandlePrompt from './HandlePrompt';
import Icon from './icons/Icon';
import { canSeeMarketStats } from './marketView';

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

/**
 * Take a position (Verdade / Mentira) on an open market. Write-once via place_bet,
 * gated by a handle prompt on the first position. Once taken, it collapses to a
 * locked row showing the settled split.
 */
export default function VoteBlock({ rumor, onVoted, viewerIsPro = false }: Props) {
  const { colors } = useTheme();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [freshVote, setFreshVote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandleState] = useState<string | null | undefined>(undefined);
  const [promptOpen, setPromptOpen] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);

  const trueTotal = rumor.trueTotal + (freshVote && choice === 'true' ? 1 : 0);
  const falseTotal = rumor.falseTotal + (freshVote && choice === 'false' ? 1 : 0);
  const { tea: teaPct, cap: capPct } = splitPercent({ trueTotal, falseTotal });
  const baseOdds = splitPercent(rumor);
  const showPreBetStats = canSeeMarketStats({ status: rumor.status, myChoice: choice, viewerIsPro });

  useEffect(() => {
    let active = true;
    setChoice(null);
    setFreshVote(false);
    setError(null);
    setPromptOpen(false);
    setPendingChoice(null);
    getMyHandle().then((h) => active && setHandleState(h));
    getMyChoice(rumor.id).then((c) => active && setChoice(c));
    return () => {
      active = false;
    };
  }, [rumor.id]);

  const doVote = async (c: Choice) => {
    haptic();
    setChoice(c);
    setFreshVote(true);
    setError(null);
    const res = await placeBet(rumor.id, c);
    if (!res.ok && !res.alreadyBet) {
      setChoice(null);
      setFreshVote(false);
      setError(res.error ?? 'Não foi possível. Tente novamente.');
    } else {
      onVoted?.(c);
    }
  };

  const vote = async (c: Choice) => {
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
    doVote(c);
  };

  const onHandleSet = (newHandle: string) => {
    setHandleState(newHandle);
    setPromptOpen(false);
    const c = pendingChoice;
    setPendingChoice(null);
    if (c) doVote(c);
  };

  return (
    <View style={styles.wrap}>
      {choice === null ? (
        <>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.teaBg, borderColor: colors.teaBorder }]}
              onPress={() => vote('true')}
              accessibilityRole="button"
              accessibilityLabel="Palpitar que é verdade, tea"
            >
              <View style={styles.sideRow}>
                <Icon name="verdade" color={colors.tea} size={18} />
                <Text style={[styles.btnSide, { color: colors.tea }]}>Verdade</Text>
              </View>
              <Text style={[styles.btnPct, { color: colors.tea }]}>{showPreBetStats ? `${baseOdds.tea}% chance` : 'palpite para ver odds'}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.capBg, borderColor: colors.capBorder }]}
              onPress={() => vote('false')}
              accessibilityRole="button"
              accessibilityLabel="Palpitar que é mentira, cap"
            >
              <View style={styles.sideRow}>
                <Icon name="mentira" color={colors.cap} size={18} />
                <Text style={[styles.btnSide, { color: colors.cap }]}>Mentira</Text>
              </View>
              <Text style={[styles.btnPct, { color: colors.cap }]}>{showPreBetStats ? `${baseOdds.cap}% chance` : 'palpite para ver odds'}</Text>
            </Pressable>
          </View>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        </>
      ) : (
        <View style={[styles.locked, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <OddsBar teaPct={teaPct} capPct={capPct} />
          <View style={styles.lockedRow}>
            <View style={styles.sideRow}>
              <Icon name={choice === 'true' ? 'verdade' : 'mentira'} color={choice === 'true' ? colors.tea : colors.cap} size={15} />
              <Text style={[styles.lockedPick, { color: choice === 'true' ? colors.tea : colors.cap }]}>
                Seu palpite: {choice === 'true' ? 'Verdade' : 'Mentira'}
              </Text>
            </View>
            <Text style={[styles.lockedNote, { color: colors.faint }]}>Posição trancada 🔒</Text>
          </View>
        </View>
      )}

      <HandlePrompt
        visible={promptOpen}
        onClose={() => {
          setPromptOpen(false);
          setPendingChoice(null);
        }}
        onSet={onHandleSet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  buttons: { flexDirection: 'row', gap: spacing.md },
  btn: { flex: 1, borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', gap: 2 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnSide: { fontFamily: fonts.sansBold, fontSize: 15 },
  btnPct: { fontFamily: fonts.mono, fontSize: 11 },
  error: { fontFamily: fonts.sansSemi, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  locked: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  lockedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockedPick: { fontFamily: fonts.sansSemi, fontSize: 13 },
  lockedNote: { fontFamily: fonts.mono, fontSize: 11 },
});
