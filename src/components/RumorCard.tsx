import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';
import { formatDate, formatDateTime, formatDeadline, splitPercent, type Rumor } from '../lib/rumors';
import { type ReactionValue } from '../lib/reactions';
import ResolvedSplit from './ResolvedSplit';
import ReactionButtons from './ReactionButtons';

const TAG: Record<Rumor['status'], { text: string; fg: string }> = {
  speculated: { text: 'Em aberto', fg: colors.speculated },
  confirmed: { text: 'Confirmado', fg: colors.confirmed },
  debunked: { text: 'Furada', fg: colors.cap },
  void: { text: 'Anulado', fg: colors.muted },
};

interface Props {
  rumor: Rumor;
  onPress?: (r: Rumor) => void;
  onReact?: (rumor: Rumor, value: ReactionValue) => void;
}

/** Designed rumor card (Story 1.6 / UX-DR2, UX-DR5). Hero variant is larger with a pink edge. */
export default function RumorCard({ rumor, onPress, onReact }: Props) {
  const tag = TAG[rumor.status];
  const { tea, cap } = splitPercent(rumor);
  const total = rumor.trueTotal + rumor.falseTotal;
  const deadline = formatDeadline(rumor.predictionDeadline);
  const posted = formatDate(rumor.createdAt);
  const confirmedAt = rumor.status !== 'speculated' ? formatDateTime(rumor.resolvedAt) : null;

  return (
    <Pressable
      onPress={onPress ? () => onPress(rumor) : undefined}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `Abrir fofoca: ${rumor.summary}` : undefined}
      style={({ pressed }) => [styles.card, rumor.isHero && styles.hero, pressed && onPress && styles.pressed]}
    >
      <View style={styles.metaRow}>
        {rumor.isHero ? (
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>🚨 VIDDI DO DIA</Text>
          </View>
        ) : (
          <Text style={styles.sourceDot}>Viddi</Text>
        )}
        <Text style={styles.dot}>·</Text>
        <Text style={[styles.tagText, { color: tag.fg }]}>{tag.text}</Text>
      </View>

      <Text style={[styles.summary, rumor.isHero && styles.heroSummary]}>{rumor.summary}</Text>

      {rumor.article ? (
        <Text style={styles.excerpt} numberOfLines={2}>{rumor.article}</Text>
      ) : null}

      <Text style={styles.resolutionMeta}>
        {rumor.resolutionPolicy === 'deadline' && deadline
          ? `Fecha ${deadline} se não confirmar`
          : `Resolve com ${rumor.requiredSourceCount}+ fontes confiáveis`}
      </Text>

      <View style={styles.dateRow}>
        {posted ? <Text style={styles.posted}>🕒 Postado em {posted}</Text> : null}
        {confirmedAt ? (
          <Text style={[styles.confirmedDate, rumor.status === 'debunked' && styles.debunkedDate]}>
            {rumor.status === 'confirmed' ? '✓ Confirmado' : '✕ Furada'} em {confirmedAt}
          </Text>
        ) : null}
      </View>

      {rumor.status === 'speculated' ? (
        rumor.myChoice ? (
          <View style={styles.splitWrap}>
            <View style={styles.bar}>
              <View style={[styles.barTea, { flex: Math.max(tea, 1) }, rumor.myChoice === 'true' && styles.picked]}>
                <Text style={styles.barText} numberOfLines={1}>Verdade {tea}%</Text>
              </View>
              <View style={[styles.barCap, { flex: Math.max(cap, 1) }, rumor.myChoice === 'false' && styles.picked]}>
                <Text style={[styles.barText, styles.barTextRight]} numberOfLines={1}>{cap}% Mentira</Text>
              </View>
            </View>
            <Text style={styles.count}>
              Seu palpite: {rumor.myChoice === 'true' ? 'Verdade' : 'Mentira'} · {total.toLocaleString('pt-BR')} palpites
            </Text>
          </View>
        ) : (
          <View style={styles.teaseRow}>
            <Text style={styles.teaseText}>Toque para palpitar</Text>
            <Text style={styles.teaseCount}>{total.toLocaleString('pt-BR')} palpites</Text>
          </View>
        )
      ) : (
        <ResolvedSplit rumor={rumor} />
      )}

      {onReact ? (
        <View style={styles.socialRow}>
          <Text style={styles.socialLabel}>Popularidade</Text>
          <ReactionButtons
            compact
            likeCount={rumor.likeCount}
            dislikeCount={rumor.dislikeCount}
            myReaction={rumor.myReaction}
            onReact={(value) => onReact(rumor, value)}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hero: { borderLeftWidth: 4, borderLeftColor: colors.primary, backgroundColor: colors.surfaceSunken },
  heroBadge: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  heroBadgeText: { fontFamily: 'NunitoSans_700Bold', fontSize: 11, color: '#FFFFFF', letterSpacing: 0.3 },
  pressed: { backgroundColor: colors.surfaceSunken },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  sourceDot: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.text },
  dot: { fontFamily: 'NunitoSans_400Regular', fontSize: 13, color: colors.muted },
  tagText: { fontFamily: 'NunitoSans_700Bold', fontSize: 13 },
  summary: { fontFamily: 'NunitoSans_700Bold', fontSize: 17, color: colors.text, lineHeight: 23 },
  heroSummary: { fontSize: 19, lineHeight: 25 },
  excerpt: { fontFamily: 'NunitoSans_400Regular', fontSize: 14, color: colors.muted, lineHeight: 20, marginTop: spacing.xs },
  resolutionMeta: { fontFamily: 'NunitoSans_400Regular', fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  dateRow: { marginTop: spacing.xs, gap: 2 },
  posted: { fontFamily: 'NunitoSans_400Regular', fontSize: 12, color: colors.muted },
  confirmedDate: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.confirmed },
  debunkedDate: { color: colors.cap },
  splitWrap: { marginTop: spacing.md },
  crowdCaption: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.muted, marginBottom: spacing.xs },
  bar: { flexDirection: 'row', height: 30, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  barTea: { backgroundColor: colors.tea, justifyContent: 'center', paddingHorizontal: spacing.md },
  barCap: { backgroundColor: colors.cap, justifyContent: 'center', paddingHorizontal: spacing.md, alignItems: 'flex-end' },
  barText: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: '#FFFFFF' },
  barTextRight: { textAlign: 'right' },
  count: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.muted, marginTop: spacing.sm, textAlign: 'right' },
  picked: { borderColor: '#FFFFFF', borderWidth: 2 },
  teaseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  teaseText: { fontFamily: 'NunitoSans_700Bold', fontSize: 14, color: colors.accent },
  teaseCount: { fontFamily: 'NunitoSans_400Regular', fontSize: 12, color: colors.muted },
  socialRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  socialLabel: { fontFamily: 'NunitoSans_700Bold', fontSize: 12, color: colors.muted },
  resolvedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  resolvedText: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.confirmed },
  source: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.primary },
  furada: { fontFamily: 'NunitoSans_700Bold', fontSize: 13, color: colors.cap, marginTop: spacing.md },
});
