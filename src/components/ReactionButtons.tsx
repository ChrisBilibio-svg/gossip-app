import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeProvider';
import type { ColorScheme } from '../theme/tokens';
import { fonts, radius, spacing } from '../theme/tokens';
import { formatReactionCount, type ReactionValue } from '../lib/reactions';
import Icon, { type IconName } from './icons/Icon';

interface Props {
  likeCount: number;
  dislikeCount: number;
  myReaction: ReactionValue | null;
  onReact: (value: ReactionValue) => void;
  compact?: boolean;
}

export default function ReactionButtons({ likeCount, dislikeCount, myReaction, onReact, compact }: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <ReactBtn
        label="Curtir fofoca"
        icon="like"
        count={likeCount}
        active={myReaction === 1}
        accent={colors.tea}
        colors={colors}
        compact={compact}
        onPress={() => onReact(1)}
      />
      <ReactBtn
        label="Não curtir fofoca"
        icon="dislike"
        count={dislikeCount}
        active={myReaction === -1}
        accent={colors.cap}
        colors={colors}
        compact={compact}
        onPress={() => onReact(-1)}
      />
    </View>
  );
}

function ReactBtn({
  label,
  icon,
  count,
  active,
  accent,
  colors,
  compact,
  onPress,
}: {
  label: string;
  icon: IconName;
  count: number;
  active: boolean;
  accent: string;
  colors: ColorScheme;
  compact?: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    scale.stopAnimation();
    scale.setValue(0.8);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 140 }).start();
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { borderColor: active ? accent : colors.border, backgroundColor: colors.card },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Animated.View style={[styles.inner, { transform: [{ scale }] }]}>
        <Icon name={icon} color={active ? accent : colors.faint} size={13} />
        <Text style={[styles.text, { color: active ? accent : colors.faint }]}>{formatReactionCount(count)}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  rowCompact: { gap: spacing.xs },
  btn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  btnCompact: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontFamily: fonts.monoMed, fontSize: 12 },
});
