import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { secureAccount, signInWithEmail } from '../lib/auth';

type Mode = 'save' | 'login';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AccountSheet({ visible, onClose, onSuccess }: Props) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>('save');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (visible) {
      setDone(false);
      setMessage('');
    }
  }, [visible]);

  const submit = async () => {
    setBusy(true);
    setMessage('');
    const r = mode === 'save' ? await secureAccount(email.trim(), password) : await signInWithEmail(email.trim(), password);
    setBusy(false);
    setMessage(r.message);
    if (r.ok) {
      setDone(true);
      onSuccess();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          {done ? (
            <>
              <Text style={[styles.successTitle, { color: colors.confirmed }]}>
                {mode === 'login' ? 'Bem-vindo de volta!' : 'Conta salva!'}
              </Text>
              {message ? <Text style={[styles.blurb, { color: colors.muted }]}>{message}</Text> : null}
              <Pressable style={[styles.cta, { backgroundColor: colors.primary }]} onPress={onClose}>
                <Text style={[styles.ctaText, { color: colors.onPrimary }]}>Fechar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.tabs}>
                <Tab label="Salvar conta" active={mode === 'save'} onPress={() => setMode('save')} />
                <Tab label="Entrar" active={mode === 'login'} onPress={() => setMode('login')} />
              </View>

              <Text style={[styles.blurb, { color: colors.muted }]}>
                {mode === 'save'
                  ? 'Guarde seu @ e seu histórico. Adicione e-mail e senha para não perder a conta.'
                  : 'Já tem conta? Entre para recuperar seu @, pontos e histórico.'}
              </Text>

              <TextInput
                style={[styles.input, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
                placeholder="E-mail"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={[styles.input, { backgroundColor: colors.raised, borderColor: colors.border, color: colors.text }]}
                placeholder="Senha"
                placeholderTextColor={colors.faint}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              {message ? <Text style={[styles.message, { color: colors.text }]}>{message}</Text> : null}

              <Pressable
                style={[styles.cta, { backgroundColor: colors.primary }]}
                onPress={submit}
                disabled={busy || !email || !password}
              >
                <Text style={[styles.ctaText, { color: colors.onPrimary }]}>
                  {busy ? '...' : mode === 'save' ? 'Salvar minha conta' : 'Entrar'}
                </Text>
              </Pressable>

              <Pressable onPress={onClose} accessibilityRole="button">
                <Text style={[styles.close, { color: colors.muted }]}>Agora não</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={[styles.tab, { backgroundColor: active ? colors.primary : colors.raised }]}
      >
        <Text style={[styles.tabText, { color: active ? colors.onPrimary : colors.muted }]}>{label}</Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  tabText: { fontFamily: fonts.sansSemi, fontSize: 13 },
  blurb: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  successTitle: { fontFamily: fonts.sansBold, fontSize: 22, textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.sans, fontSize: 14 },
  message: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center' },
  cta: { borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center' },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 15 },
  close: { fontFamily: fonts.sansMed, fontSize: 13, textAlign: 'center', marginTop: spacing.xs },
});
