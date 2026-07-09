import { useCallback, useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { getMyHandle } from '../lib/profile';
import { createGroup, getMyGroups, joinGroup, type GroupSummary } from '../lib/groups';
import { DURATION_PRESETS, GROUP_EMOJIS, MAX_DURATION_DAYS, MIN_DURATION_DAYS, endsAtFromDays, groupTimeLabel } from './groupView';
import GroupDetail from './GroupDetail';
import HandlePrompt from './HandlePrompt';
import Icon from './icons/Icon';
import { Skeleton } from './Skeleton';

type Sheet = 'create' | 'join' | null;
type Gate = 'create' | 'join' | null;

export default function GroupsTab() {
  const { colors } = useTheme();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [handlePrompt, setHandlePrompt] = useState(false);
  const [gate, setGate] = useState<Gate>(null);

  const load = useCallback(async () => {
    try {
      const res = await getMyGroups();
      setGroups(res.groups);
      setUnavailable(Boolean(res.unavailable));
    } catch {
      setGroups([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Gate create/join behind having a handle (reuse the existing HandlePrompt).
  const openWithHandle = async (which: 'create' | 'join') => {
    const handle = await getMyHandle();
    if (!handle) {
      setGate(which);
      setHandlePrompt(true);
      return;
    }
    setSheet(which);
  };

  const onHandleSet = () => {
    setHandlePrompt(false);
    const g = gate;
    setGate(null);
    if (g) setSheet(g);
  };

  const Header = (
    <View>
      <View style={styles.ctaRow}>
        <Pressable
          onPress={() => openWithHandle('create')}
          accessibilityRole="button"
          style={[styles.cta, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={15} color={colors.onPrimary} />
          <Text style={[styles.ctaText, { color: colors.onPrimary }]}>Criar grupo</Text>
        </Pressable>
        <Pressable
          onPress={() => openWithHandle('join')}
          accessibilityRole="button"
          style={[styles.ctaGhost, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Feather name="log-in" size={15} color={colors.text} />
          <Text style={[styles.ctaGhostText, { color: colors.text }]}>Entrar com código</Text>
        </Pressable>
      </View>
      {groups.length > 0 ? <Text style={[styles.section, { color: colors.faint }]}>MEUS GRUPOS</Text> : null}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.body}>
        {Header}
        {[0, 1].map((i) => (
          <View key={i} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: spacing.sm }]}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="35%" height={10} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ListHeaderComponent={Header}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="groups" color={colors.faint} size={34} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {unavailable ? 'Grupos chegando em breve' : 'Você ainda não tem grupos'}
            </Text>
            <Text style={[styles.emptySub, { color: colors.faint }]}>
              {unavailable
                ? 'A atualização do servidor ainda vai ser aplicada. Volte em breve. 🔧'
                : 'Crie uma liga com amigos e vejam quem acerta mais fofoca no prazo. 🏆'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setSelected(item.id)}
            accessibilityRole="button"
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardTitleRow}>
                {item.emoji ? <Text style={styles.cardEmoji}>{item.emoji}</Text> : null}
                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.isOwner ? <Feather name="star" size={12} color={colors.gold} /> : null}
              </View>
              {item.myRank ? (
                <View style={[styles.rankPill, { backgroundColor: colors.primaryBg }]}>
                  <Text style={[styles.rankPillText, { color: colors.primary }]}>#{item.myRank}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.cardMeta}>
              <Text style={[styles.metaText, { color: colors.faint }]}>{item.memberCount} membros</Text>
              <Text style={[styles.metaDot, { color: colors.faint }]}>·</Text>
              <Text style={[styles.metaText, { color: item.isActive ? colors.faint : colors.gold }]}>
                {groupTimeLabel(item.endsAt, item.isActive)}
              </Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={<View style={{ height: spacing.xxl }} />}
      />

      <CreateGroupSheet visible={sheet === 'create'} onClose={() => setSheet(null)} onCreated={(id) => { setSheet(null); load(); setSelected(id); }} />
      <JoinGroupSheet visible={sheet === 'join'} onClose={() => setSheet(null)} onJoined={(id) => { setSheet(null); load(); if (id) setSelected(id); }} />
      <GroupDetail groupId={selected} onClose={() => setSelected(null)} onChanged={load} />
      <HandlePrompt visible={handlePrompt} onClose={() => { setHandlePrompt(false); setGate(null); }} onSet={onHandleSet} />
    </View>
  );
}

/* ---------------- Create sheet ---------------- */

function CreateGroupSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (id: string | null) => void }) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<string>(DURATION_PRESETS[1].key); // default 1 mês
  const [customDays, setCustomDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setEmoji(null);
    setPresetKey(DURATION_PRESETS[1].key);
    setCustomDays('30');
    setError(null);
  };

  const isCustom = presetKey === 'custom';
  const days = isCustom ? parseInt(customDays, 10) : DURATION_PRESETS.find((p) => p.key === presetKey)?.days ?? 30;
  const validDays = Number.isFinite(days) && days >= MIN_DURATION_DAYS && days <= MAX_DURATION_DAYS;

  const submit = async () => {
    if (!validDays) {
      setError(`Duração de ${MIN_DURATION_DAYS} a ${MAX_DURATION_DAYS} dias.`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await createGroup(name, endsAtFromDays(days), emoji);
    setBusy(false);
    if (res.ok) {
      const id = res.group?.id ?? null;
      reset();
      onCreated(id);
    } else {
      setError(res.error ?? 'Não consegui criar o grupo.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Criar grupo</Text>
          <Text style={[styles.sheetSub, { color: colors.muted }]}>Uma liga privada com prazo — quem fizer mais pontos até o fim vence.</Text>

          <Text style={[styles.fieldLabel, { color: colors.faint }]}>NOME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={30}
            placeholder="Ex: Panelinha do BBB"
            placeholderTextColor={colors.faint}
            style={[styles.input, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
          />

          <Text style={[styles.fieldLabel, { color: colors.faint }]}>ÍCONE (opcional)</Text>
          <View style={styles.emojiRow}>
            {GROUP_EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => setEmoji(emoji === e ? null : e)}
                style={[styles.emojiBtn, { borderColor: emoji === e ? colors.primary : colors.border, backgroundColor: emoji === e ? colors.primaryBg : colors.raised }]}
              >
                <Text style={styles.emojiBtnText}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.faint }]}>DURAÇÃO</Text>
          <View style={styles.durationRow}>
            {DURATION_PRESETS.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => setPresetKey(p.key)}
                style={[styles.durChip, { borderColor: presetKey === p.key ? colors.primary : colors.border, backgroundColor: presetKey === p.key ? colors.primaryBg : colors.raised }]}
              >
                <Text style={[styles.durChipText, { color: presetKey === p.key ? colors.primary : colors.muted }]}>{p.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setPresetKey('custom')}
              style={[styles.durChip, { borderColor: isCustom ? colors.primary : colors.border, backgroundColor: isCustom ? colors.primaryBg : colors.raised }]}
            >
              <Text style={[styles.durChipText, { color: isCustom ? colors.primary : colors.muted }]}>Personalizado</Text>
            </Pressable>
          </View>
          {isCustom ? (
            <View style={styles.customRow}>
              <TextInput
                value={customDays}
                onChangeText={(t) => setCustomDays(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={3}
                style={[styles.customInput, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
              />
              <Text style={[styles.customUnit, { color: colors.muted }]}>dias (1–365)</Text>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={busy || name.trim().length < 1 || !validDays}
            style={[styles.submit, { backgroundColor: colors.primary }, (busy || name.trim().length < 1 || !validDays) && { opacity: 0.5 }]}
          >
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>{busy ? 'Criando…' : 'Criar grupo'}</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancel, { color: colors.muted }]}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Join sheet ---------------- */

function JoinGroupSheet({ visible, onClose, onJoined }: { visible: boolean; onClose: () => void; onJoined: (id: string | null) => void }) {
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await joinGroup(code);
    setBusy(false);
    if (res.ok) {
      setCode('');
      onJoined(res.group?.id ?? null);
    } else {
      setError(res.error ?? 'Não consegui entrar no grupo.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Entrar com código</Text>
          <Text style={[styles.sheetSub, { color: colors.muted }]}>Peça o código de 6 letras para quem criou o grupo.</Text>

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, ''))}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABC123"
            placeholderTextColor={colors.faint}
            style={[styles.codeInput, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
          />

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={busy || code.length !== 6}
            style={[styles.submit, { backgroundColor: colors.primary }, (busy || code.length !== 6) && { opacity: 0.5 }]}
          >
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>{busy ? 'Entrando…' : 'Entrar'}</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={[styles.cancel, { color: colors.muted }]}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  ctaRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  cta: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm + 2, paddingVertical: spacing.md },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 13 },
  ctaGhost: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: radius.sm + 2, paddingVertical: spacing.md },
  ctaGhostText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  section: { fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1, marginBottom: spacing.sm, marginTop: spacing.xs },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  cardEmoji: { fontSize: 18 },
  cardName: { fontFamily: fonts.sansSemi, fontSize: 14, flexShrink: 1 },
  rankPill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  rankPillText: { fontFamily: fonts.monoBold, fontSize: 11 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  metaText: { fontFamily: fonts.mono, fontSize: 11 },
  metaDot: { fontFamily: fonts.mono, fontSize: 11 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: spacing.sm },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontFamily: fonts.sansMed, fontSize: 15, textAlign: 'center' },
  emptySub: { fontFamily: fonts.sans, fontSize: 12.5, textAlign: 'center', lineHeight: 18, paddingHorizontal: spacing.lg },
  // sheets
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.sm },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, marginBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.sansBold, fontSize: 20 },
  sheetSub: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  fieldLabel: { fontFamily: fonts.monoSemi, fontSize: 9, letterSpacing: 0.8, marginTop: spacing.sm },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.sansSemi, fontSize: 15, marginTop: spacing.xs },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  emojiBtn: { width: 42, height: 42, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiBtnText: { fontSize: 20 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  durChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  durChipText: { fontFamily: fonts.sansMed, fontSize: 12 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  customInput: { width: 70, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: fonts.monoSemi, fontSize: 15, textAlign: 'center' },
  customUnit: { fontFamily: fonts.sans, fontSize: 13 },
  codeInput: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.monoBold, fontSize: 24, letterSpacing: 6, textAlign: 'center', marginTop: spacing.sm },
  error: { fontFamily: fonts.sansSemi, fontSize: 12.5, marginTop: spacing.sm },
  submit: { borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  submitText: { fontFamily: fonts.sansBold, fontSize: 15 },
  cancel: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
});
