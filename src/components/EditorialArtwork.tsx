import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EditorialImage } from '../lib/rumors';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, spacing } from '../theme/tokens';

function isPexelsPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'pexels.com' || url.hostname === 'www.pexels.com')
      && url.pathname.startsWith('/photo/');
  } catch {
    return false;
  }
}

export default function EditorialArtwork({
  image,
  featured = false,
  detail = false,
}: {
  image: EditorialImage;
  featured?: boolean;
  detail?: boolean;
}) {
  const { colors } = useTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (failedUrl === image.url) return null;

  const height = detail ? 220 : featured ? 168 : 128;
  const credit = `Imagem ilustrativa · Foto: ${image.photographer} / Pexels`;
  const openCredit = () => {
    if (!isPexelsPhotoUrl(image.pageUrl)) return;
    void Linking.openURL(image.pageUrl).catch(() => undefined);
  };

  return (
    <View style={[styles.frame, { borderColor: colors.border }]}>
      <Image
        source={{ uri: image.url }}
        resizeMode="cover"
        accessible
        accessibilityRole="image"
        accessibilityLabel={image.alt}
        onError={() => setFailedUrl(image.url)}
        style={[styles.image, { height, backgroundColor: colors.raised }]}
      />
      {detail && isPexelsPhotoUrl(image.pageUrl) ? (
        <Pressable
          onPress={openCredit}
          accessibilityRole="link"
          accessibilityLabel={`Abrir crédito da foto de ${image.photographer} no Pexels`}
          style={styles.creditPressable}
        >
          <Text style={[styles.credit, { color: colors.faint }]}>{credit}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.credit, styles.creditStatic, { color: colors.faint }]}>{credit}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: 1, borderRadius: radius.sm },
  image: { width: '100%' },
  creditPressable: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  creditStatic: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  credit: { fontFamily: fonts.sans, fontSize: 9, lineHeight: 13 },
});
