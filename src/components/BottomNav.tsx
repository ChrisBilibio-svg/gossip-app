import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, spacing } from '../theme/tokens';

export type Tab = 'feed' | 'bets' | 'social' | 'rank' | 'profile';

const ITEMS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'feed', label: 'Mercados', icon: 'home' },
  { key: 'bets', label: 'Palpites', icon: 'trending-up' },
  { key: 'social', label: 'Social', icon: 'users' },
  { key: 'rank', label: 'O Profeta', icon: 'award' },
  { key: 'profile', label: 'Perfil', icon: 'user' },
];

export default function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.nav, { backgroundColor: colors.navBar, borderTopColor: colors.border }]}>
      {ITEMS.map((it) => {
        const active = it.key === tab;
        const color = active ? colors.primary : colors.faint;
        return (
          <Pressable
            key={it.key}
            style={styles.item}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={it.label}
          >
            <Feather name={it.icon} size={20} color={color} />
            <Text style={[styles.label, { color, fontFamily: active ? fonts.sansSemi : fonts.sans }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', borderTopWidth: 1, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  item: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: spacing.xs, minWidth: 44 },
  label: { fontSize: 10 },
});
