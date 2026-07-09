import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { supabase } from '../lib/supabase';
import { tierForPoints } from './Tier';
import { Skeleton } from './Skeleton';
import Avatar from './icons/Avatar';
import { accuracyLabel, groupTimeLabel } from './groupView';
import {
  deleteGroup,
  getGroup,
  getGroupLeaderboard,
  leaveGroup,
  regenerateGroupInvite,
  removeGroupMember,
  renameGroup,
  type GroupLeaderboardRow,
  type GroupMeta,
} from '../lib/groups';

interface Props {
  groupId: string | null;
  onClose: () => void;
  /** Called after the group is left/deleted so the list can refresh. */
  onChanged?: () => void;
}

export default function GroupDetail({ groupId, onClose, onChanged }: Props) {
  const { colors } = useTheme();
  const visible = groupId !== null;
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [rows, setRows] = useState<GroupLeaderboardRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const [g, lb, u] = await Promise.all([getGroup(groupId), getGroupLeaderboard(groupId), supabase.auth.getUser()]);
      setMeta(g.group);
      setRows(lb.rows);
      setMeId(u.data.user?.id ?? null);
      setError(g.error ?? lb.error ?? null);
    } catch {
      setMeta(null);
      setError('Não foi possível carregar o grupo.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    setMeta(null);
    setRows([]);
    setError(null);
    load();
  }, [groupId, load]);

  const share = async () => {
    if (!meta) return;
    try {
      await Share.share({
        message: `Entrei num grupo no Viddi: "${meta.name}".\nCódigo: ${meta.inviteCode}\n\nEntre e veja quem acerta mais fofoca!`,
      });
    } catch {
      /* dismissed */
    }
  };

  const doRename = async () => {
    if (!meta) return;
    const name = renameValue.trim();
    if (name.length < 1) return;
    setBusy(true);
    const res = await renameGroup(meta.id, name, meta.emoji);
    setBusy(false);
    if (res.ok) {
      setRenaming(false);
      setMeta({ ...meta, name });
      onChanged?.();
    } else {
      Alert.alert('Ops', res.error ?? 'Não consegui renomear.');
    }
  };

  const doRegenerate = () => {
    if (!meta) return;
    Alert.alert('Gerar novo código?', 'O código antigo para de funcionar na hora.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Gerar',
        onPress: async () => {
          setBusy(true);
          const res = await regenerateGroupInvite(meta.id);
          setBusy(false);
          if (res.ok && res.inviteCode) setMeta({ ...meta, inviteCode: res.inviteCode });
          else Alert.alert('Ops', res.error ?? 'Não consegui gerar um novo código.');
        },
      },
    ]);
  };

  const doRemoveMember = (row: GroupLeaderboardRow) => {
    if (!meta) return;
    Alert.alert('Remover do grupo?', `Tirar @${row.handle ?? 'anônimo'} deste grupo?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          const res = await removeGroupMember(meta.id, row.id);
          if (res.ok) {
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            setMeta({ ...meta, memberCount: Math.max(0, meta.memberCount - 1) });
          } else {
            Alert.alert('Ops', res.error ?? 'Não consegui remover.');
          }
        },
      },
    ]);
  };

  const doLeave = () => {
    if (!meta) return;
    const owner = meta.isOwner;
    Alert.alert(
      owner ? 'Sair do grupo?' : 'Sair do grupo?',
      owner
        ? 'Você é o dono. Ao sair, o comando passa para o membro mais antigo (ou o grupo é encerrado se você for o último).'
        : 'Você deixa de disputar este grupo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const res = await leaveGroup(meta.id);
            setBusy(false);
            if (res.ok) {
              onChanged?.();
              onClose();
            } else {
              Alert.alert('Ops', res.error ?? 'Não consegui sair.');
            }
          },
        },
      ],
    );
  };

  const doDelete = () => {
    if (!meta) return;
    Alert.alert('Excluir grupo?', 'Isso apaga o grupo para todos. Não é possível desfazer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const res = await deleteGroup(meta.id);
          setBusy(false);
          if (res.ok) {
            onChanged?.();
            onClose();
          } else {
            Alert.alert('Ops', res.error ?? 'Não consegui excluir.');
          }
        },
      },
    ]);
  };

  const winner = meta && !meta.isActive ? rows.find((r) => r.rank === 1) ?? rows[0] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Voltar">
            <Feather name="arrow-left" size={20} color={colors.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {meta ? `${meta.emoji ? `${meta.emoji} ` : ''}${meta.name}` : 'Grupo'}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        >
          {loading ? (
            <>
              <Skeleton width="60%" height={16} />
              <Skeleton width="100%" height={64} radius={radius.md} style={{ marginTop: spacing.md }} />
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={44} radius={radius.sm} style={{ marginTop: spacing.sm }} />
              ))}
            </>
          ) : !meta ? (
            <View style={styles.centered}>
              <Text style={styles.emoji}>🔒</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Grupo indisponível</Text>
              <Text style={[styles.emptySub, { color: colors.faint }]}>{error ?? 'Você não faz parte deste grupo.'}</Text>
            </View>
          ) : (
            <>
              {/* Meta strip */}
              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Feather name="users" size={11} color={colors.faint} />
                  <Text style={[styles.metaText, { color: colors.faint }]}>{meta.memberCount} membros</Text>
                </View>
                <View style={styles.metaChip}>
                  <Feather name={meta.isActive ? 'clock' : 'flag'} size={11} color={meta.isActive ? colors.faint : colors.gold} />
                  <Text style={[styles.metaText, { color: meta.isActive ? colors.faint : colors.gold }]}>
                    {groupTimeLabel(meta.endsAt, meta.isActive)}
                  </Text>
                </View>
              </View>

              {/* Winner banner (ended) */}
              {winner ? (
                <View style={[styles.winner, { backgroundColor: colors.goldBg, borderColor: colors.gold }]}>
                  <Text style={styles.winnerEmoji}>🏆</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.winnerLabel, { color: colors.gold }]}>Campeão do grupo</Text>
                    <View style={styles.winnerRow}>
                      {winner.avatar ? <Avatar value={winner.avatar} size={14} /> : null}
                      <Text style={[styles.winnerHandle, { color: colors.text }]}>
                        @{winner.handle ?? 'anônimo'} · {winner.points.toLocaleString('pt-BR')} pts
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Invite */}
              <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.panelLabel, { color: colors.faint }]}>CÓDIGO DE CONVITE</Text>
                <View style={styles.inviteRow}>
                  <Text style={[styles.inviteCode, { color: colors.text }]}>{meta.inviteCode}</Text>
                  <Pressable
                    onPress={share}
                    accessibilityRole="button"
                    accessibilityLabel="Convidar amigos"
                    style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
                  >
                    <Feather name="share-2" size={13} color={colors.onPrimary} />
                    <Text style={[styles.inviteBtnText, { color: colors.onPrimary }]}>Convidar</Text>
                  </Pressable>
                </View>
                {meta.isOwner ? (
                  <Pressable onPress={doRegenerate} hitSlop={6} accessibilityRole="button">
                    <Text style={[styles.regen, { color: colors.faint }]}>gerar novo código</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* Leaderboard */}
              <Text style={[styles.section, { color: colors.faint }]}>CLASSIFICAÇÃO</Text>
              {rows.length === 0 ? (
                <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center' }]}>
                  <Text style={[styles.emptySub, { color: colors.faint, textAlign: 'center' }]}>
                    Ninguém pontuou ainda. Dê palpites e volte para ver quem lidera. 👀
                  </Text>
                </View>
              ) : (
                <View style={[styles.table, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {rows.map((r) => {
                    const me = r.id === meId;
                    const top = r.rank === 1;
                    const canRemove = meta.isOwner && r.id !== meId;
                    return (
                      <View
                        key={r.id}
                        style={[
                          styles.row,
                          { borderBottomColor: colors.border },
                          me && { backgroundColor: colors.primaryBg },
                        ]}
                      >
                        <Text style={[styles.rank, { color: top ? colors.gold : me ? colors.primary : colors.faint }]}>{r.rank}</Text>
                        <View style={styles.handleCell}>
                          <View style={styles.handleLine}>
                            {r.avatar ? <Avatar value={r.avatar} size={16} /> : null}
                            <Text style={[styles.handle, { color: colors.text }]} numberOfLines={1}>
                              @{r.handle ?? 'anônimo'}
                            </Text>
                            {me ? (
                              <View style={[styles.youPill, { backgroundColor: colors.primaryBg }]}>
                                <Text style={[styles.youPillText, { color: colors.primary }]}>você</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={[styles.tier, { color: top ? colors.gold : colors.muted }]}>{tierForPoints(r.points).name}</Text>
                        </View>
                        <Text style={[styles.pts, { color: top ? colors.gold : colors.text }]}>{r.points.toLocaleString('pt-BR')}</Text>
                        <Text style={[styles.acc, { color: colors.muted }]}>{accuracyLabel(r.correctCount, r.resolvedCount)}</Text>
                        {canRemove ? (
                          <Pressable onPress={() => doRemoveMember(r)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remover @${r.handle ?? 'membro'}`}>
                            <Feather name="user-x" size={15} color={colors.faint} />
                          </Pressable>
                        ) : (
                          <View style={{ width: 15 }} />
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Owner / member actions */}
              <View style={styles.actions}>
                {meta.isOwner ? (
                  <>
                    <Pressable
                      onPress={() => {
                        setRenameValue(meta.name);
                        setRenaming(true);
                      }}
                      style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                      accessibilityRole="button"
                    >
                      <Feather name="edit-2" size={13} color={colors.muted} />
                      <Text style={[styles.actionText, { color: colors.muted }]}>Renomear</Text>
                    </Pressable>
                    <Pressable
                      onPress={doDelete}
                      disabled={busy}
                      style={[styles.actionBtn, { borderColor: colors.capRedBg, backgroundColor: colors.card }]}
                      accessibilityRole="button"
                    >
                      <Feather name="trash-2" size={13} color={colors.danger} />
                      <Text style={[styles.actionText, { color: colors.danger }]}>Excluir</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onPress={doLeave}
                    disabled={busy}
                    style={[styles.actionBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    accessibilityRole="button"
                  >
                    <Feather name="log-out" size={13} color={colors.danger} />
                    <Text style={[styles.actionText, { color: colors.danger }]}>Sair do grupo</Text>
                  </Pressable>
                )}
              </View>
              {meta.isOwner ? (
                <Pressable onPress={doLeave} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: spacing.sm }}>
                  <Text style={[styles.leaveOwner, { color: colors.faint }]}>sair do grupo</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* Rename sheet */}
        <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
          <View style={styles.backdrop}>
            <View style={[styles.renameSheet, { backgroundColor: colors.card }]}>
              <Text style={[styles.renameTitle, { color: colors.text }]}>Renomear grupo</Text>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                maxLength={30}
                autoFocus
                placeholder="Nome do grupo"
                placeholderTextColor={colors.faint}
                style={[styles.renameInput, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
              />
              <View style={styles.renameActions}>
                <Pressable onPress={() => setRenaming(false)} style={styles.renameCancel}>
                  <Text style={[styles.actionText, { color: colors.muted }]}>Cancelar</Text>
                </Pressable>
                <Pressable
                  onPress={doRename}
                  disabled={busy || renameValue.trim().length < 1}
                  style={[styles.renameSave, { backgroundColor: colors.primary }, (busy || renameValue.trim().length < 1) && { opacity: 0.5 }]}
                >
                  <Text style={[styles.renameSaveText, { color: colors.onPrimary }]}>Salvar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1 },
  headerTitle: { fontFamily: fonts.sansSemi, fontSize: 15, flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  centered: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emoji: { fontSize: 32 },
  emptyTitle: { fontFamily: fonts.sansMed, fontSize: 15 },
  emptySub: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18 },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: fonts.mono, fontSize: 11 },
  winner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  winnerEmoji: { fontSize: 26 },
  winnerLabel: { fontFamily: fonts.monoBold, fontSize: 9, letterSpacing: 0.8 },
  winnerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  winnerHandle: { fontFamily: fonts.sansSemi, fontSize: 14 },
  panel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  panelLabel: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.8, marginBottom: spacing.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  inviteCode: { fontFamily: fonts.monoBold, fontSize: 24, letterSpacing: 3 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inviteBtnText: { fontFamily: fonts.sansSemi, fontSize: 12 },
  regen: { fontFamily: fonts.mono, fontSize: 10, marginTop: spacing.sm },
  section: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.sm },
  table: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 11, borderBottomWidth: 1 },
  rank: { width: 22, fontFamily: fonts.monoBold, fontSize: 12 },
  handleCell: { flex: 1 },
  handleLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowAvatar: { fontSize: 14 },
  handle: { fontFamily: fonts.sansMed, fontSize: 12, flexShrink: 1 },
  youPill: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  youPillText: { fontFamily: fonts.monoSemi, fontSize: 9 },
  tier: { fontFamily: fonts.sans, fontSize: 9, marginTop: 1 },
  pts: { width: 60, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 12 },
  acc: { width: 44, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: spacing.md },
  actionText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  leaveOwner: { fontFamily: fonts.mono, fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.xl },
  renameSheet: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  renameTitle: { fontFamily: fonts.sansBold, fontSize: 17 },
  renameInput: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.sansSemi, fontSize: 15 },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md },
  renameCancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  renameSave: { borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  renameSaveText: { fontFamily: fonts.sansBold, fontSize: 13 },
});
