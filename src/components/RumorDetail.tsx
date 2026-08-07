import { useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { formatDate, formatDateTime, formatDeadline, type Rumor } from '../lib/rumors';
import { type Choice } from '../lib/predictions';
import { type ReactionValue } from '../lib/reactions';
import { createRepost } from '../lib/social';
import VoteBlock from './VoteBlock';
import ResolvedSplit from './ResolvedSplit';
import CommentSection from './CommentSection';
import ReactionButtons from './ReactionButtons';
import OddsBar from './OddsBar';
import ExchangeMarketEntry from './ExchangeMarketEntry';
import { exchangeV2UiEnabled } from '../lib/exchangeUiFlags';
import { getMarketSnapshotV2 } from '../lib/exchangeV2';
import StatusChip from './StatusChip';
import Sparkline from './Sparkline';
import Icon from './icons/Icon';
import EditorialArtwork from './EditorialArtwork';
import { deadlineLabel, marketOdds, marketVolume, placeholderSparkline, toMarketStatus } from './marketView';

interface Props {
  rumor: Rumor | null;
  onClose: () => void;
  onVoted?: (choice: Choice) => void;
  onReact?: (rumor: Rumor, value: ReactionValue) => void;
  onOpenRumor?: (id: string) => void;
  viewerIsPro?: boolean;
}

export default function RumorDetail({ rumor, onClose, onVoted, onReact, onOpenRumor, viewerIsPro = false }: Props) {
  const { colors } = useTheme();
  const visible = rumor !== null;

  const longArticle = (rumor?.article?.length ?? 0) > 220;
  const [expanded, setExpanded] = useState(false);
  const [repostText, setRepostText] = useState('');
  const [rating, setRating] = useState(4);
  const [repostMsg, setRepostMsg] = useState<string | null>(null);
  const [postingRepost, setPostingRepost] = useState(false);
  // A market that runs on the exchange/AMM shows ONLY the trading card — the
  // legacy fixed-odds vote block is hidden so there's one model per market.
  const [exchangeActive, setExchangeActive] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setRepostText('');
    setRating(4);
    setRepostMsg(null);
  }, [rumor?.id]);

  useEffect(() => {
    if (!exchangeV2UiEnabled || !rumor?.id) {
      setExchangeActive(false);
      return;
    }
    let active = true;
    getMarketSnapshotV2(rumor.id)
      .then((snap) => { if (active) setExchangeActive(Boolean(snap) && snap!.state === 'open'); })
      .catch(() => { if (active) setExchangeActive(false); });
    return () => { active = false; };
  }, [rumor?.id]);

  const submitRepost = async () => {
    if (!rumor || !repostText.trim()) return;
    setPostingRepost(true);
    const result = await createRepost(rumor.id, repostText, rating);
    setPostingRepost(false);
    if (result.ok) {
      setRepostText('');
      setRepostMsg('Repostado no Viddi Social.');
    } else {
      setRepostMsg(result.error ?? 'Não consegui repostar agora.');
    }
  };

  if (!rumor) return <Modal visible={visible} animationType="slide" onRequestClose={onClose} />;

  const status = toMarketStatus(rumor.status);
  const { teaPct, capPct } = marketOdds(rumor);
  const volume = marketVolume(rumor);
  const dl = deadlineLabel(rumor.predictionDeadline);
  const resolveBy = formatDeadline(rumor.predictionDeadline);
  const posted = formatDate(rumor.createdAt);
  const confirmedAt = rumor.status !== 'speculated' ? formatDateTime(rumor.resolvedAt) : null;
  const spark = rumor.oddsHistory.length >= 2 ? rumor.oddsHistory : placeholderSparkline(teaPct);
  const displayedSourceCount = Math.max(rumor.sourceCount, rumor.sourceUrl ? 1 : 0);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Voltar">
            <Feather name="arrow-left" size={20} color={colors.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>A Coluna</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {rumor.editorialImage ? <EditorialArtwork image={rumor.editorialImage} detail /> : null}
          {/* Status + deadline */}
          <View style={[styles.metaRow, rumor.editorialImage ? styles.afterArtwork : null]}>
            <Text style={[styles.categoryKicker, { color: colors.primary }]}>{rumor.category?.trim() || 'Cultura pop'}</Text>
            <StatusChip status={status} />
            {status === 'ABERTO' && dl ? (
              <View style={styles.deadline}>
                <Feather name="clock" size={10} color={colors.faint} />
                <Text style={[styles.deadlineText, { color: colors.faint }]}>fecha em {dl}</Text>
              </View>
            ) : null}
            {posted ? <Text style={[styles.posted, { color: colors.faint }]}>{posted}</Text> : null}
          </View>

          {/* Headline */}
          <Text style={[styles.headline, { color: colors.text }]}>{rumor.summary}</Text>

          {/* Article */}
          {rumor.article ? (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={[styles.article, { color: colors.muted }]} numberOfLines={longArticle && !expanded ? 4 : undefined}>
                {rumor.article}
              </Text>
              {longArticle ? (
                <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.readMore, { color: colors.primary }]}>{expanded ? 'Ler menos' : 'Ler mais'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Update-of (quote-tweet style link to the prior market) */}
          {rumor.updatesRumor ? (
            <Pressable
              onPress={() => onOpenRumor?.(rumor.updatesRumor!.id)}
              accessibilityRole="button"
              accessibilityLabel="Abrir a notícia original"
              style={[styles.updateBox, { backgroundColor: colors.raised, borderColor: colors.border }]}
            >
              <Text style={[styles.updateBoxLabel, { color: colors.primary }]}>🆕 Atualização de</Text>
              <Text style={[styles.updateBoxSummary, { color: colors.muted }]} numberOfLines={2}>
                {rumor.updatesRumor.summary}
              </Text>
              <View style={styles.updateBoxFoot}>
                <Text style={[styles.updateBoxLink, { color: colors.primary }]}>ver original</Text>
                <Feather name="arrow-up-right" size={11} color={colors.primary} />
              </View>
            </Pressable>
          ) : null}

          {/* Resolved banner */}
          {confirmedAt ? (
            <View
              style={[
                styles.resolvedBox,
                {
                  backgroundColor: rumor.status === 'debunked' ? colors.capRedBg : rumor.status === 'void' ? colors.raised : colors.confirmedBg,
                  borderColor: rumor.status === 'debunked' ? colors.capRed : rumor.status === 'void' ? colors.border : colors.confirmed,
                },
              ]}
            >
              <View style={styles.resolvedRow}>
                {rumor.status === 'confirmed' ? (
                  <Icon name="check" color={colors.confirmed} size={15} />
                ) : rumor.status === 'debunked' ? (
                  <Icon name="cross" color={colors.capRed} size={15} />
                ) : null}
                <Text style={[styles.resolvedLabel, { color: rumor.status === 'debunked' ? colors.capRed : rumor.status === 'void' ? colors.muted : colors.confirmed }]}>
                  {rumor.status === 'confirmed' ? 'Confirmado' : rumor.status === 'void' ? 'Anulado' : 'Desmentido'}
                </Text>
              </View>
              <Text style={[styles.resolvedWhen, { color: colors.muted }]}>{confirmedAt}</Text>
            </View>
          ) : null}

          {/* Odds panel */}
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <>
              <View style={styles.panelHead}>
                <Text style={[styles.panelTitle, { color: colors.text }]}>O que a comunidade acha</Text>
                <Text style={[styles.panelMeta, { color: colors.faint }]}>
                    {volume.toLocaleString('pt-BR')} moedas virtuais em atividade{displayedSourceCount > 0 ? ` · ${displayedSourceCount} ${displayedSourceCount === 1 ? 'fonte' : 'fontes'}` : ''}
                  </Text>
                </View>
                <OddsBar teaPct={teaPct} capPct={capPct} />
                <View style={styles.chartWrap}>
                  <Sparkline data={spark} width={300} height={82} color={teaPct > 50 ? colors.tea : colors.cap} showLabels />
                </View>
                <Text style={[styles.chartCaption, { color: colors.faint }]}>probabilidade de ser verdade ao longo do tempo · moedas não têm valor em dinheiro</Text>
            </>
          </View>

          {/* Resolution rule */}
          <View style={[styles.ruleBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.ruleTitle, { color: colors.text }]}>Como resolve</Text>
            <Text style={[styles.ruleText, { color: colors.muted }]}>
              {rumor.resolutionPolicy === 'deadline' && resolveBy
                ? `Sem confirmação confiável até ${resolveBy}, o rumor é considerado falso.`
                : `Em aberto até ${rumor.requiredSourceCount}+ fontes confiáveis confirmarem ou desmentirem. Sem veredito no resolve-by, vira VOID.`}
            </Text>
            {rumor.evidenceSources.length > 0 ? (
              <View style={styles.evidence}>
                {rumor.evidenceSources.map((s) => (
                  <Pressable key={s.id} onPress={() => Linking.openURL(s.sourceUrl)} accessibilityRole="link">
                    <Text style={[styles.evidenceLink, { color: colors.muted }]}>
                      {s.supportsOutcome ? 'Verdade' : 'Mentira'} · {s.sourceLabel || 'fonte'} ↗
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : rumor.sourceUrl ? (
              <View style={styles.evidence}>
                <Pressable onPress={() => Linking.openURL(rumor.sourceUrl!)} accessibilityRole="link">
                  <Text style={[styles.evidenceLink, { color: colors.muted }]}>Fonte da matéria ↗</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Position / resolved split */}
          {rumor.status === 'speculated' ? (
            exchangeActive ? (
              // Exchange/AMM market → trading only, no legacy vote block.
              <ExchangeMarketEntry rumorId={rumor.id} summary={rumor.summary} />
            ) : (
              <VoteBlock
                rumor={rumor}
                onVoted={(choice) => onVoted?.(choice)}
                viewerIsPro={viewerIsPro}
              />
            )
          ) : <ResolvedSplit rumor={rumor} large />}

          {/* Reactions + repost */}
          <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, marginTop: spacing.lg }]}>
            <View style={styles.socialHead}>
              <Text style={[styles.panelTitle, { color: colors.text }]}>Reações da comunidade</Text>
              {onReact ? (
                <ReactionButtons
                  compact
                  likeCount={rumor.likeCount}
                  dislikeCount={rumor.dislikeCount}
                  myReaction={rumor.myReaction}
                  onReact={(value) => onReact(rumor, value)}
                />
              ) : null}
            </View>

            <Text style={[styles.repostTitle, { color: colors.text }]}>Publicar opinião</Text>
            <View style={styles.ratingRow}>
              <Text style={[styles.convLabel, { color: colors.faint }]}>convicção</Text>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="button" accessibilityLabel={`Convicção ${n}`}>
                  <View style={[styles.convSeg, { backgroundColor: n <= rating ? colors.primary : colors.border }]} />
                </Pressable>
              ))}
            </View>
            <TextInput
              value={repostText}
              onChangeText={setRepostText}
              placeholder="Sua opinião anônima sobre este mercado..."
              placeholderTextColor={colors.faint}
              style={[styles.repostInput, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
              multiline
              maxLength={280}
            />
            <View style={styles.repostFooter}>
              <Text style={[styles.repostCount, { color: colors.faint }]}>{repostText.length}/280</Text>
              <Pressable
                style={[styles.repostBtn, { backgroundColor: colors.primary }, (!repostText.trim() || postingRepost) && styles.off]}
                onPress={submitRepost}
                disabled={!repostText.trim() || postingRepost}
              >
                <Text style={[styles.repostBtnText, { color: colors.onPrimary }]}>{postingRepost ? 'Postando...' : 'Postar'}</Text>
              </Pressable>
            </View>
            {repostMsg ? <Text style={[styles.repostMsg, { color: colors.confirmed }]}>{repostMsg}</Text> : null}
          </View>

          <CommentSection rumorId={rumor.id} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  headerTitle: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 18 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  afterArtwork: { marginTop: spacing.md },
  categoryKicker: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  deadlineText: { fontFamily: fonts.mono, fontSize: 10 },
  posted: { fontFamily: fonts.mono, fontSize: 10 },
  headline: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 23, lineHeight: 30 },
  article: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 24 },
  readMore: { fontFamily: fonts.sansSemi, fontSize: 12, marginTop: spacing.sm },
  updateBox: { borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md },
  updateBoxLabel: { fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 0.4, marginBottom: 4 },
  updateBoxSummary: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  updateBoxFoot: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.sm },
  updateBoxLink: { fontFamily: fonts.monoSemi, fontSize: 10 },
  resolvedBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  resolvedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resolvedLabel: { fontFamily: fonts.sansSemi, fontSize: 13 },
  resolvedWhen: { fontFamily: fonts.mono, fontSize: 11 },
  panel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  panelTitle: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 15 },
  panelMeta: { fontFamily: fonts.mono, fontSize: 11 },
  lockedStatsPanel: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  lockIcon: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  lockedStatsCopy: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  chartWrap: { marginTop: spacing.md, alignItems: 'stretch' },
  chartCaption: { fontFamily: fonts.mono, fontSize: 9, textAlign: 'center', marginTop: 4 },
  ruleBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  ruleTitle: { fontFamily: fonts.serifBold, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  ruleText: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  evidence: { marginTop: spacing.sm, gap: 4 },
  evidenceLink: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 18 },
  socialHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  repostTitle: { fontFamily: fonts.sansSemi, fontSize: 12, marginBottom: spacing.sm },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  convLabel: { fontFamily: fonts.sans, fontSize: 10, marginRight: 4 },
  convSeg: { width: 18, height: 4, borderRadius: 2 },
  repostInput: { minHeight: 70, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.sans, fontSize: 13, marginTop: spacing.sm, textAlignVertical: 'top' },
  repostFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  repostCount: { fontFamily: fonts.mono, fontSize: 11 },
  repostBtn: { borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  off: { opacity: 0.45 },
  repostBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  repostMsg: { fontFamily: fonts.sansMed, fontSize: 11, marginTop: spacing.sm },
});
