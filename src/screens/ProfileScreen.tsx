import { useEffect, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { deleteMyAccount, getMyProfile, setAvatar as setServerAvatar, type MyProfile } from '../lib/profile';
import { supabase } from '../lib/supabase';
import ProSheet from '../components/ProSheet';
import HelpSheet from '../components/HelpSheet';
import KeywordsSheet from '../components/KeywordsSheet';
import AvatarPicker from '../components/AvatarPicker';
import Avatar from '../components/icons/Avatar';
import { AVATARS, DEFAULT_AVATAR, getAvatar, setAvatar, type Avatar as AvatarValue } from '../components/avatar';
import { nextTier, tierForPoints } from '../components/Tier';
import { Skeleton } from '../components/Skeleton';
import { buildSupportMailto, SUPPORT_EMAIL } from '../lib/supportContact';

const LADDER = ['Aprendiz', 'Fofoqueiro', 'Vidente', 'Profeta', 'Lenda'];

interface Props {
  onOpenAccount: () => void;
  onDeleted?: () => void;
}

export default function ProfileScreen({ onOpenAccount, onDeleted }: Props) {
  const { colors, mode, toggle } = useTheme();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [proOpen, setProOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatar, setAvatarState] = useState<AvatarValue>(DEFAULT_AVATAR);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getMyProfile(), supabase.auth.getUser()]).then(([p, u]) => {
      if (!active) return;
      setProfile(p);
      setEmail(u.data.user?.email ?? null);
      setLoading(false);
      // Prefer the server-saved avatar; fall back to the on-device cache.
      const serverAvatar = p?.avatar && (AVATARS as readonly string[]).includes(p.avatar) ? (p.avatar as AvatarValue) : null;
      if (serverAvatar) {
        setAvatarState(serverAvatar);
        setAvatar(serverAvatar);
      } else {
        getAvatar().then((a) => active && a && setAvatarState(a));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header />
        <View style={styles.body}>
          <View style={styles.idRow}>
            <Skeleton width={52} height={52} radius={26} />
            <View style={{ gap: 6 }}>
              <Skeleton width={120} height={15} />
              <Skeleton width={90} height={10} />
            </View>
          </View>
          <View style={[styles.statRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.stat}>
                <Skeleton width={52} height={20} />
                <Skeleton width={34} height={9} style={{ marginTop: 6 }} />
              </View>
            ))}
          </View>
          {[0, 1].map((i) => (
            <View key={i} style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="100%" height={48} radius={6} style={{ marginTop: spacing.md }} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  const pts = profile?.totalPoints ?? 0;
  const correct = profile?.correctCount ?? 0;
  const resolved = profile?.resolvedCount ?? 0;
  const currentStreak = profile?.currentStreak ?? 0;
  const bestStreak = profile?.bestStreak ?? 0;
  const accPct = resolved > 0 ? Math.round((correct / resolved) * 100) : 0;
  const acc = resolved > 0 ? `${accPct}%` : '—';
  const tier = tierForPoints(pts);
  const next = nextTier(pts);
  const tierIdx = LADDER.findIndex((l) => tier.name.startsWith(l));
  const progress = next ? Math.min(1, Math.max(0, (pts - tier.min) / (next.min - tier.min))) : 1;

  const openSupport = async () => {
    const fallback = `Envie um email para ${SUPPORT_EMAIL}`;
    try {
      const url = buildSupportMailto();
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        setSupportMessage(null);
        await Linking.openURL(url);
      } else {
        setSupportMessage(fallback);
      }
    } catch {
      setSupportMessage(fallback);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header />
      <ScrollView contentContainerStyle={styles.body}>
        {/* Avatar + handle */}
        <View style={styles.idRow}>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Trocar avatar"
            style={[styles.avatar, { borderColor: colors.primary, backgroundColor: colors.raised }]}
          >
            <Avatar value={avatar} size={30} />
            <View style={[styles.avatarEdit, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
              <Feather name="edit-2" size={9} color={colors.onPrimary} />
            </View>
          </Pressable>
          <View>
            <Text style={[styles.handle, { color: colors.text }]}>@{profile?.handle ?? 'sem apelido'}</Text>
            <Text style={[styles.member, { color: colors.faint }]}>persona anônima</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={[styles.statRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Stat value={pts.toLocaleString('pt-BR')} label="pontos" color={colors.gold} divider />
          <Stat value={acc} label="acertos" color={colors.text} divider />
          <Stat value={String(currentStreak)} label="🔥 sequência" color={colors.text} />
        </View>

        {/* Tier progress */}
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.panelHead}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>{tier.name}</Text>
            <Text style={[styles.panelMeta, { color: colors.faint }]}>{next ? `→ ${next.name}` : 'nível máximo'}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.raised }]}>
            <View style={[styles.trackFill, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
          <View style={styles.ladder}>
            {LADDER.map((l, i) => (
              <Text
                key={l}
                style={[styles.ladderText, { color: i <= tierIdx ? colors.muted : colors.faint, fontFamily: i === tierIdx ? fonts.sansSemi : fonts.sans }]}
              >
                {l}
              </Text>
            ))}
          </View>
          {next ? (
            <Text style={[styles.panelNote, { color: colors.faint }]}>
              +{(next.min - pts).toLocaleString('pt-BR')} pts para {next.name}
            </Text>
          ) : null}
        </View>

        {/* Track record */}
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.panelHead}>
            <Text style={[styles.panelTitle, { color: colors.text }]}>Histórico</Text>
            <Text style={[styles.panelMeta, { color: colors.faint }]}>{resolved.toLocaleString('pt-BR')} resolvidos</Text>
          </View>
          <View style={styles.recordGrid}>
            <TrackRecordStat
              value={`${correct.toLocaleString('pt-BR')} / ${resolved.toLocaleString('pt-BR')}`}
              label="acertos resolvidos"
              color={colors.text}
            />
            <TrackRecordStat value={acc} label="precisão" color={colors.primary} />
            <TrackRecordStat value={String(currentStreak)} label="sequência atual" color={colors.tea} />
            <TrackRecordStat value={String(bestStreak)} label="melhor sequência" color={colors.gold} />
          </View>
          <View style={[styles.accuracyTrack, { backgroundColor: colors.raised }]}>
            <View style={[styles.accuracyFill, { width: `${accPct}%`, backgroundColor: colors.primary }]} />
          </View>
          <Text style={[styles.panelNote, { color: colors.faint }]}>VOID é push: não mexe na precisão nem na sequência.</Text>
        </View>

        {/* Viddi Pro */}
        <Pressable
          onPress={() => setProOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Conhecer o Viddi Pro"
          style={[styles.proRow, { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder }]}
        >
          <Feather name="star" size={16} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.proTitle, { color: colors.primary }]}>Viddi Pro</Text>
            <Text style={[styles.proSub, { color: colors.muted }]}>mercados exclusivos · analytics avançado</Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </Pressable>

        {/* Settings */}
        <View style={[styles.settings, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
            <View style={styles.settingLeft}>
              <Feather name="moon" size={14} color={colors.muted} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Tema escuro</Text>
                <Text style={[styles.settingSub, { color: colors.faint }]}>{mode === 'dark' ? 'Ativado' : 'Desativado'}</Text>
              </View>
            </View>
            <Switch
              value={mode === 'dark'}
              onValueChange={toggle}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor={colors.card}
            />
          </View>

          <Pressable
            onPress={() => setHelpOpen(true)}
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Como funciona o Viddi"
          >
            <View style={styles.settingLeft}>
              <Feather name="help-circle" size={14} color={colors.muted} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Como funciona</Text>
                <Text style={[styles.settingSub, { color: colors.faint }]}>Verdade vs Mentira, pontos, resolução, anulação</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={14} color={colors.faint} />
          </Pressable>

          <Pressable
            onPress={() => setKeywordsOpen(true)}
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Tópicos que sigo"
          >
            <View style={styles.settingLeft}>
              <Feather name="bell" size={14} color={colors.muted} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Tópicos que sigo</Text>
                <Text style={[styles.settingSub, { color: colors.faint }]}>Avisos sobre quem você acompanha</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={14} color={colors.faint} />
          </Pressable>

          {email ? (
            <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
              <View style={styles.settingLeft}>
                <Feather name="shield" size={14} color={colors.muted} />
                <View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>Conta salva</Text>
                  <Text style={[styles.settingSub, { color: colors.faint }]}>{email}</Text>
                </View>
              </View>
            </View>
          ) : (
            <Pressable onPress={onOpenAccount} style={[styles.settingRow, { borderBottomColor: colors.border }]} accessibilityRole="button">
              <View style={styles.settingLeft}>
                <Feather name="log-in" size={14} color={colors.muted} />
                <View>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>Salvar conta / Entrar</Text>
                  <Text style={[styles.settingSub, { color: colors.faint }]}>guarde seu histórico</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={14} color={colors.faint} />
            </Pressable>
          )}

          <Pressable
            onPress={openSupport}
            style={styles.settingRow}
            accessibilityRole="button"
            accessibilityLabel="Abrir email para contato e suporte"
          >
            <View style={styles.settingLeft}>
              <Feather name="mail" size={14} color={colors.muted} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.text }]}>Contato & Suporte</Text>
                <Text style={[styles.settingSub, { color: colors.faint }]}>{SUPPORT_EMAIL}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={14} color={colors.faint} />
          </Pressable>
        </View>

        {supportMessage ? <Text style={[styles.supportFallback, { color: colors.muted }]}>{supportMessage}</Text> : null}

        {/* Delete account (LGPD) */}
        {confirming ? (
          <View style={styles.confirmRow}>
            <Pressable
              style={[styles.deleteConfirm, { backgroundColor: colors.danger }]}
              disabled={deleting}
              onPress={async () => {
                setDeleting(true);
                setDeleteError(null);
                const result = await deleteMyAccount();
                if (!result.ok) {
                  setDeleteError(result.error ?? 'Não foi possível deletar a conta agora.');
                  setDeleting(false);
                  return;
                }
                onDeleted?.();
              }}
            >
              <Text style={styles.deleteConfirmText}>{deleting ? '...' : 'Confirmar exclusão'}</Text>
            </Pressable>
            <Pressable onPress={() => { setConfirming(false); setDeleteError(null); setDeleting(false); }}>
              <Text style={[styles.cancel, { color: colors.muted }]}>Cancelar</Text>
            </Pressable>
            {deleteError ? <Text style={[styles.deleteError, { color: colors.capRed }]}>{deleteError}</Text> : null}
          </View>
        ) : (
          <Pressable
            onPress={() => { setConfirming(true); setDeleteError(null); }}
            accessibilityRole="button"
            style={[styles.deleteBtn, { borderColor: colors.capRedBg }]}
          >
            <Text style={[styles.deleteText, { color: colors.capRed }]}>Deletar conta (LGPD Art. 18)</Text>
          </Pressable>
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <ProSheet visible={proOpen} onClose={() => setProOpen(false)} />
      <HelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />
      <KeywordsSheet visible={keywordsOpen} onClose={() => setKeywordsOpen(false)} />
      <AvatarPicker
        visible={pickerOpen}
        current={avatar}
        onClose={() => setPickerOpen(false)}
        onSelect={(a) => {
          setAvatarState(a);
          setAvatar(a); // instant on-device cache
          setServerAvatar(a); // persist so others see it
          setPickerOpen(false);
        }}
      />
    </View>
  );

  function Header() {
    return (
      <View style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Perfil</Text>
      </View>
    );
  }
}

function Stat({ value, label, color, divider }: { value: string; label: string; color: string; divider?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, divider && { borderRightWidth: 1, borderRightColor: colors.border }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

function TrackRecordStat({ value, label, color }: { value: string; label: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.recordStat, { backgroundColor: colors.raised, borderColor: colors.border }]}>
      <Text style={[styles.recordValue, { color }]}>{value}</Text>
      <Text style={[styles.recordLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1 },
  title: { fontFamily: fonts.sansBold, fontSize: 17 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  body: { padding: spacing.lg },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 26 },
  avatarEdit: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 18 },
  handle: { fontFamily: fonts.sansBold, fontSize: 15 },
  member: { fontFamily: fonts.sans, fontSize: 11, marginTop: 1 },
  statRow: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fonts.monoBold, fontSize: 20 },
  statLabel: { fontFamily: fonts.sans, fontSize: 9, marginTop: 2 },
  panel: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  panelTitle: { fontFamily: fonts.sansSemi, fontSize: 12 },
  panelMeta: { fontFamily: fonts.mono, fontSize: 10 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 6 },
  trackFill: { height: 4, borderRadius: 2 },
  ladder: { flexDirection: 'row', justifyContent: 'space-between' },
  ladderText: { fontSize: 8 },
  panelNote: { fontFamily: fonts.mono, fontSize: 10, marginTop: 8 },
  recordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  recordStat: { width: '48%', borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  recordValue: { fontFamily: fonts.monoBold, fontSize: 16 },
  recordLabel: { fontFamily: fonts.sans, fontSize: 9, marginTop: 2 },
  accuracyTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: spacing.md },
  accuracyFill: { height: 5, borderRadius: 3 },
  proRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  proTitle: { fontFamily: fonts.sansSemi, fontSize: 13 },
  proSub: { fontFamily: fonts.sans, fontSize: 10, marginTop: 1 },
  settings: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  settingLabel: { fontFamily: fonts.sansMed, fontSize: 12 },
  settingSub: { fontFamily: fonts.sans, fontSize: 10, marginTop: 1 },
  supportFallback: { fontFamily: fonts.sans, fontSize: 11, marginBottom: spacing.md, textAlign: 'center' },
  confirmRow: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  deleteConfirm: { borderRadius: radius.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignSelf: 'stretch', alignItems: 'center' },
  deleteConfirmText: { fontFamily: fonts.sansSemi, fontSize: 13, color: '#FFFFFF' },
  deleteError: { fontFamily: fonts.sansMed, fontSize: 11, textAlign: 'center', paddingHorizontal: spacing.md },
  cancel: { fontFamily: fonts.sansMed, fontSize: 13 },
  deleteBtn: { borderWidth: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center' },
  deleteText: { fontFamily: fonts.sansMed, fontSize: 12 },
});
