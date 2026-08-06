import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Curated, on-theme avatar set (prediction-market + gossip flavor). Emoji-based
 * so there's no asset pipeline. The choice is persisted on-device; surfacing it
 * to OTHER users (leaderboard/comments) needs a backend `profiles.avatar`
 * column — see backlog handoff.
 */
export const AVATARS = ['🔮', '👀', '🔥', '👑', '⭐', '🎭', '✨', '👻', '🛸', '🃏', '📰', '💬'] as const;

export type Avatar = (typeof AVATARS)[number];

export const DEFAULT_AVATAR: Avatar = '🔮';

const KEY = 'viddi.avatar';

export async function getAvatar(): Promise<Avatar | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === '🍵') return '📰';
    if (v === '🧢') return '💬';
    return v && (AVATARS as readonly string[]).includes(v) ? (v as Avatar) : null;
  } catch {
    return null;
  }
}

export async function setAvatar(avatar: Avatar): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, avatar);
  } catch {
    /* non-fatal — falls back to default next launch */
  }
}
