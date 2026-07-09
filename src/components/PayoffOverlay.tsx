import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { useTheme } from '../theme/ThemeProvider';
import { colors as legacy, darkColors, fonts, radius, spacing } from '../theme/tokens';
import { getMyProfile } from '../lib/profile';
import { getMyRank } from '../lib/leaderboard';

const { height: SCREEN_H } = Dimensions.get('window');
const PARTICLE_COLORS = [darkColors.gold, darkColors.confirmed, darkColors.primary];

// Off-screen Story card base size (9:16). Captured and upscaled to 1080×1920.
const CARD_W = 320;
const CARD_H = 569;

interface Props {
  visible: boolean;
  points: number;
  onClose: () => void;
}

function Particle({ delay }: { delay: number }) {
  const y = useRef(new Animated.Value(-40)).current;
  const left = useRef(Math.random() * 100).current;
  const color = useRef(PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(y, {
        toValue: SCREEN_H + 40,
        duration: 2600 + Math.random() * 1600,
        delay,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [y, delay]);

  return <Animated.View style={[styles.particle, { left: `${left}%`, backgroundColor: color, transform: [{ translateY: y }] }]} />;
}

/** The exported Instagram-Stories image. Rendered off-screen, captured via ref. */
function StoryCard({ points, rank, handle }: { points: number; rank: number | null; handle: string | null }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.cup}>🍵</Text>
      <Text style={cardStyles.headline}>EU ACERTEI</Text>
      <Text style={cardStyles.points}>+{points.toLocaleString('pt-BR')}</Text>
      <Text style={cardStyles.ptsLabel}>pontos</Text>
      {rank ? <Text style={cardStyles.rank}>#{rank} no ranking</Text> : null}
      <View style={cardStyles.spacer} />
      <Text style={cardStyles.handle}>{handle ? `@${handle}` : 'Viddi'}</Text>
      <Text style={cardStyles.watermark}>viddi.app.br · Verdade ou Mentira?</Text>
    </View>
  );
}

export default function PayoffOverlay({ visible, points, onClose }: Props) {
  const { colors } = useTheme();
  const [displayPts, setDisplayPts] = useState(0);
  const [rank, setRank] = useState<number | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sharing, setSharing] = useState(false);
  const countAnim = useRef(new Animated.Value(0)).current;
  const cardRef = useRef<View>(null);

  useEffect(() => {
    if (!visible) return;
    setRank(null);

    getMyProfile().then((p) => {
      if (!p) return;
      setHandle(p.handle);
      getMyRank(p.totalPoints).then(setRank);
    });

    let cleanup = () => {};
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      setReduceMotion(reduced);
      if (reduced) {
        setDisplayPts(points);
        return;
      }
      setDisplayPts(0);
      countAnim.setValue(0);
      const id = countAnim.addListener(({ value }) => setDisplayPts(Math.round(value * points)));
      Animated.timing(countAnim, { toValue: 1, duration: 1000, delay: 250, useNativeDriver: false }).start(() => {
        setDisplayPts(points);
      });
      cleanup = () => countAnim.removeListener(id);
    });

    return () => cleanup();
  }, [visible, points, countAnim]);

  const shareText = async () => {
    const rankLine = rank ? ` e subi para #${rank} no ranking` : '';
    try {
      await Share.share({
        message: `Eu acertei no Viddi! +${points.toLocaleString('pt-BR')} pts${rankLine}. Você acha que é verdade ou mentira? 🤔`,
      });
    } catch {
      // dismissed — no-op
    }
  };

  const shareImage = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile', width: 1080, height: 1920 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Compartilhar a vitória' });
      } else {
        await Share.share({ url: uri });
      }
    } catch {
      await shareText();
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        {/* Off-screen render target for the Story image export. */}
        <View ref={cardRef} collapsable={false} style={styles.cardHost} pointerEvents="none">
          <StoryCard points={points} rank={rank} handle={handle} />
        </View>

        {/* Premium glow + a few tasteful particles (not a confetti party). */}
        <View style={[styles.glow, { backgroundColor: colors.goldBg }]} pointerEvents="none" />
        {reduceMotion ? null : (
          <View style={styles.particleLayer} pointerEvents="none">
            {Array.from({ length: 10 }).map((_, i) => (
              <Particle key={i} delay={i * 120} />
            ))}
          </View>
        )}

        <Text style={[styles.statusLabel, { color: colors.confirmed }]}>CONFIRMADO</Text>
        <Text style={[styles.title, { color: colors.text }]}>VOCÊ ACERTOU</Text>
        <Text style={[styles.points, { color: colors.gold }]}>+{displayPts.toLocaleString('pt-BR')}</Text>
        <Text style={[styles.ptsLabel, { color: colors.muted }]}>pontos</Text>

        <Text style={[styles.rank, { color: colors.confirmed }]}>
          {rank ? `agora #${rank} no ranking ↑` : 'pontos somados ao seu histórico'}
        </Text>

        <Pressable
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Próxima"
        >
          <Text style={[styles.ctaText, { color: colors.onPrimary }]}>PRÓXIMA</Text>
        </Pressable>

        <Pressable
          onPress={shareImage}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel="Compartilhar imagem da vitória nos Stories"
        >
          <Text style={[styles.secondary, { color: colors.muted }]}>
            {sharing ? 'gerando imagem…' : 'compartilhar nos Stories'}
          </Text>
        </Pressable>
        <Pressable onPress={shareText} accessibilityRole="button" accessibilityLabel="Compartilhar como texto">
          <Text style={[styles.tertiary, { color: colors.faint }]}>compartilhar como texto</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  cardHost: { position: 'absolute', left: -2000, top: 0, width: CARD_W, height: CARD_H },
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 160, top: '24%' },
  particleLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  particle: { position: 'absolute', top: 0, width: 5, height: 5, borderRadius: 3 },
  statusLabel: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1.5, marginBottom: spacing.md },
  title: { fontFamily: fonts.sansExtra, fontSize: 28, letterSpacing: -0.4, textAlign: 'center', marginBottom: spacing.sm },
  points: { fontFamily: fonts.monoBold, fontSize: 56, lineHeight: 60 },
  ptsLabel: { fontFamily: fonts.mono, fontSize: 13, marginTop: 2 },
  rank: { fontFamily: fonts.monoSemi, fontSize: 13, marginTop: spacing.xl },
  cta: { marginTop: spacing.xxl, borderRadius: radius.sm + 2, paddingVertical: spacing.md, paddingHorizontal: 56 },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 14, letterSpacing: 0.5 },
  secondary: { fontFamily: fonts.sansSemi, fontSize: 13, marginTop: spacing.lg },
  tertiary: { fontFamily: fonts.sans, fontSize: 12, marginTop: spacing.md },
});

const cardStyles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: legacy.primary,
    alignItems: 'center',
    paddingTop: 72,
    paddingBottom: 40,
    paddingHorizontal: spacing.xl,
  },
  cup: { fontSize: 104, textAlign: 'center' },
  headline: { fontFamily: fonts.sansExtra, fontSize: 40, lineHeight: 44, color: '#FFFFFF', letterSpacing: 1, marginTop: spacing.lg },
  points: { fontFamily: fonts.monoBold, fontSize: 76, lineHeight: 84, color: legacy.gold, marginTop: spacing.lg },
  ptsLabel: { fontFamily: fonts.sansSemi, fontSize: 20, color: '#FFFFFF', opacity: 0.95, letterSpacing: 2 },
  rank: { fontFamily: fonts.monoSemi, fontSize: 20, color: '#FFFFFF', marginTop: spacing.lg },
  spacer: { flex: 1 },
  handle: { fontFamily: fonts.sansBold, fontSize: 22, color: '#FFFFFF' },
  watermark: { fontFamily: fonts.sansSemi, fontSize: 13, color: '#FFFFFF', opacity: 0.85, marginTop: spacing.sm },
});
