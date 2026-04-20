import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Redirect, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';

export { ErrorBoundary } from 'expo-router';

// Suppress noisy rn-webrtc debug spew (dozens of lines per peer connection).
// Timestamp prefix aids log correlation across webtorrent/bridge/player layers.
if (__DEV__ && !(globalThis as unknown as { __consolePatched?: boolean }).__consolePatched) {
  (globalThis as unknown as { __consolePatched: boolean }).__consolePatched = true;
  const t0 = Date.now();
  const SUPPRESSED = /^rn-webrtc:/;
  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    const orig = console[level].bind(console);
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && SUPPRESSED.test(args[0])) return;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(3);
      orig(`[+${elapsed}s]`, ...args);
    };
  }
}

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
  if (!token && !inAuth) return <Redirect href="/(auth)/login" />;
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
