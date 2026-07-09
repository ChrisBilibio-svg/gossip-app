import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { setHandle } from '../lib/profile';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSet: (handle: string) => void;
}

/** First-position handle prompt — framed as "free + 100% anonymous", not a signup wall. */
export default function HandlePrompt({ visible, onClose, onSet }: Props) {
  const { colors } = useTheme();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const handle = value.trim().replace(/^@/, '');
    if (handle.length < 3) {
      setError('Mínimo 3 letras');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setHandle(handle);
    setBusy(false);
    if (res.ok) {
      onSet(handle);
    } else {
      setError(res.error ?? 'Não foi possível. Tente outro nome.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Quer palpitar?</Text>
          <Text style={[styles.blurb, { color: colors.muted }]}>
            Escolha seu @ para entrar no jogo. É de graça e você continua{' '}
            <Text style={[styles.bold, { color: colors.text }]}>100% anônimo</Text> — sem nome real, sem e-mail.
          </Text>

          <View style={[styles.inputRow, { backgroundColor: colors.raised, borderColor: colors.border }]}>
            <Text style={[styles.at, { color: colors.faint }]}>@</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="seu_apelido"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              value={value}
              onChangeText={setValue}
              onSubmitEditing={submit}
            />
          </View>

          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

          <Pressable
            style={[styles.cta, { backgroundColor: colors.primary }]}
            onPress={submit}
            disabled={busy || value.trim().length < 3}
          >
            <Text style={[styles.ctaText, { color: colors.onPrimary }]}>{busy ? '...' : 'Continuar'}</Text>
          </Pressable>

          <Pressable onPress={onClose}>
            <Text style={[styles.cancel, { color: colors.muted }]}>Agora não</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxl, alignItems: 'center', gap: spacing.md },
  title: { fontFamily: fonts.sansBold, fontSize: 22 },
  blurb: { fontFamily: fonts.sans, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  bold: { fontFamily: fonts.sansSemi },
  inputRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.lg },
  at: { fontFamily: fonts.sansSemi, fontSize: 16 },
  input: { flex: 1, paddingVertical: spacing.md, marginLeft: spacing.xs, fontFamily: fonts.sansSemi, fontSize: 15 },
  error: { fontFamily: fonts.sansSemi, fontSize: 13 },
  cta: { alignSelf: 'stretch', borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  ctaText: { fontFamily: fonts.sansBold, fontSize: 15 },
  cancel: { fontFamily: fonts.sansMed, fontSize: 13, marginTop: spacing.xs },
});
