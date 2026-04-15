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
  // /spike is a dev-only WebTorrent route (ADR-009); bypass auth so it's
  // reachable on fresh installs (Android emulator especially).
  // TODO(Phase 2 cleanup gate): remove this branch and the spike route
  // once real WebTorrent playback lands. See ADR-006 Phase 2 section.
  const isSpike = rootSegment === 'spike';
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
