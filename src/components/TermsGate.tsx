import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { TERMS } from '../content/terms';
import { recordConsent } from '../lib/consent';

interface Props {
  onAccepted: () => void;
}

/** First-launch Terms & Privacy gate; acceptance persisted with version + timestamp. */
export default function TermsGate({ onAccepted }: Props) {
  const { colors } = useTheme();
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    await recordConsent(TERMS.version);
    onAccepted();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.text }]}>{TERMS.title}</Text>
      <Text style={[styles.intro, { color: colors.text }]}>{TERMS.intro}</Text>

      <ScrollView style={[styles.scroll, { backgroundColor: colors.card, borderColor: colors.border }]} contentContainerStyle={styles.scrollBody}>
        {TERMS.sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={[styles.heading, { color: colors.text }]}>{s.heading}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>{s.body}</Text>
          </View>
        ))}
        <Text style={[styles.footnote, { color: colors.faint }]}>{TERMS.footnote}</Text>
      </ScrollView>

      <Pressable
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={accept}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel={TERMS.acceptLabel}
      >
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{TERMS.acceptLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.xl, paddingTop: spacing.xxl * 2 },
  title: { fontFamily: fonts.sansBold, fontSize: 26, letterSpacing: -0.4 },
  intro: { fontFamily: fonts.sansMed, fontSize: 14, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20 },
  scroll: { flex: 1, borderRadius: radius.md, borderWidth: 1 },
  scrollBody: { padding: spacing.lg },
  section: { marginBottom: spacing.lg },
  heading: { fontFamily: fonts.sansSemi, fontSize: 14, marginBottom: spacing.xs },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20 },
  footnote: { fontFamily: fonts.sans, fontSize: 12, fontStyle: 'italic', marginTop: spacing.sm },
  button: { borderRadius: radius.sm + 2, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonText: { fontFamily: fonts.sansBold, fontSize: 15 },
});
