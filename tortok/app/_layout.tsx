import '@/lib/polyfills'; // must run before anything that uses AbortSignal.timeout
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Redirect, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { clearVideoCacheAsync } from 'expo-video';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { PERF_BUILD } from '@/lib/perfBuild';
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

// On Android the player caches native posts (app/(tabs)/index.tsx) under the
// bridge's URL, whose port changes with every launch, so nothing left in the
// cache can be used again. It can only be cleared while no player exists:
// here. The web build has no such function.
if (Platform.OS === 'android') {
  clearVideoCacheAsync().catch((e: Error) => console.warn(`[feed] the video cache wasn't cleared: ${e.message}`));
}

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
  const { did, isLoading } = useAuthStore();
  const rootSegment = useSegments()[0];

  // Expo Router resolves <Redirect> before the Stack mounts, avoiding the
  // flicker / re-entry from imperative router.replace() in an effect.
  if (isLoading) return null;
  const inAuth = rootSegment === '(auth)';
  // A perf build shows the feed, which is public, with nobody signed in.
  if (!did && !inAuth && !PERF_BUILD) return <Redirect href="/(auth)/login" />;
  if (did && inAuth) return <Redirect href="/(tabs)" />;

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
