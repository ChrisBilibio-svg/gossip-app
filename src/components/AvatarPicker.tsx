import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';
import { AVATARS, type Avatar as AvatarValue } from './avatar';
import Avatar from './icons/Avatar';

interface Props {
  visible: boolean;
  current: AvatarValue;
  onClose: () => void;
  onSelect: (avatar: AvatarValue) => void;
}

/** Pick an avatar from the curated set. Selection is applied immediately. */
export default function AvatarPicker({ visible, current, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: colors.text }]}>Escolha seu avatar</Text>
              <Text style={[styles.sub, { color: colors.faint }]}>Grátis para todos — não altera resultados.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {AVATARS.map((a) => {
              const active = a === current;
              return (
                <Pressable
                  key={a}
                  onPress={() => onSelect(a)}
                  accessibilityRole="button"
                  accessibilityLabel={`Avatar ${a}`}
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.cell,
                    { backgroundColor: colors.raised, borderColor: active ? colors.primary : colors.border },
                  ]}
                >
                  <Avatar value={a} size={28} />
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: spacing.lg }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { fontFamily: fonts.sansBold, fontSize: 18 },
  sub: { fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start' },
  cell: { width: '22%', height: 58, borderWidth: 1.5, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28, lineHeight: 34, textAlign: 'center' },
});
