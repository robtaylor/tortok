import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Redirect, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <RootLayoutNav />
    </QueryClientProvider>
  );
}

function RootLayoutNav() {
  const { token, isLoading } = useAuthStore();
  const rootSegment = useSegments()[0];

  // Expo Router resolves <Redirect> before the Stack mounts, avoiding the
  // flicker / re-entry from imperative router.replace() in an effect.
  if (isLoading) return null;
  const inAuth = rootSegment === '(auth)';
  // /spike and /spike-bridge are dev-only WebTorrent routes (ADR-009 + Phase
  // 2 Unit 1); bypass auth so they're reachable on fresh installs.
  // TODO(Phase 2 cleanup gate): remove these branches and the spike routes
  // once real WebTorrent playback lands. See ADR-006 Phase 2 section.
  const isSpike =
    rootSegment === 'spike' ||
    (rootSegment as string) === 'spike-bridge'; // not in generated route types yet
  if (!token && !inAuth && !isSpike) return <Redirect href="/(auth)/login" />;
  if (token && inAuth) return <Redirect href="/(tabs)" />;

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
