import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { NunitoSans_400Regular, NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { spacing } from './src/theme/tokens';
import { hasAcceptedCurrent } from './src/lib/consent';
import { ensureAnonymousSession } from './src/lib/auth';
import { TERMS } from './src/content/terms';
import TermsGate from './src/components/TermsGate';
import AccountSheet from './src/components/AccountSheet';
import PayoffOverlay from './src/components/PayoffOverlay';
import BottomNav, { type Tab } from './src/components/BottomNav';
import FirstRunOverlay from './src/components/FirstRunOverlay';
import FeedScreen from './src/screens/FeedScreen';
import SocialScreen from './src/screens/SocialScreen';
import MyBetsScreen from './src/screens/MyBetsScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import ProfileScreen from './src/screens/ProfileScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Root() {
  const { colors, mode } = useTheme();
  const [accepted, setAccepted] = useState<boolean | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('feed');
  const [accountOpen, setAccountOpen] = useState(false);
  const [payoffPoints, setPayoffPoints] = useState<number | null>(null);

  useEffect(() => {
    hasAcceptedCurrent(TERMS.version).then(setAccepted);
  }, []);

  useEffect(() => {
    if (accepted) ensureAnonymousSession();
  }, [accepted]);

  const barStyle = mode === 'dark' ? 'light' : 'dark';

  if (accepted === undefined) {
    return <View style={[styles.fill, { backgroundColor: colors.bg }]} />;
  }

  if (!accepted) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        <StatusBar style={barStyle} />
        <TermsGate onAccepted={() => setAccepted(true)} />
      </View>
    );
  }

  return (
    <View style={[styles.app, { backgroundColor: colors.bg }]}>
      <StatusBar style={barStyle} />

      <View style={styles.screenArea}>
        {tab === 'feed' ? (
          <FeedScreen />
        ) : tab === 'social' ? (
          <SocialScreen />
        ) : tab === 'bets' ? (
          <MyBetsScreen />
        ) : tab === 'rank' ? (
          <LeaderboardScreen />
        ) : (
          <ProfileScreen
            onOpenAccount={() => setAccountOpen(true)}
            onDeleted={() => {
              ensureAnonymousSession();
              setTab('feed');
            }}
          />
        )}
      </View>

      <BottomNav tab={tab} onChange={setTab} />

      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} onSuccess={() => {}} />

      <PayoffOverlay
        visible={payoffPoints !== null}
        points={payoffPoints ?? 0}
        onClose={() => {
          setPayoffPoints(null);
          setTab('feed');
        }}
      />

      <FirstRunOverlay />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  const onLayout = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider>
      <View style={styles.fill} onLayout={onLayout}>
        <Root />
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  app: { flex: 1, paddingTop: spacing.xxl },
  screenArea: { flex: 1 },
});
