export type SeedConditions = { canSeed: boolean; reason?: string };

const BATTERY_THRESHOLD = 0.3;

// Lazy imports — expo-battery and expo-network require native modules that
// aren't available in Expo Go. Defer the import so the app doesn't crash
// on load; if the modules are missing, we default to canSeed: true.
let Battery: typeof import('expo-battery') | null = null;
let Network: typeof import('expo-network') | null = null;
let modulesLoaded = false;

async function loadModules(): Promise<void> {
  if (modulesLoaded) return;
  modulesLoaded = true;
  try {
    Battery = await import('expo-battery');
  } catch {
    console.warn('[deviceConditions] expo-battery unavailable');
  }
  try {
    Network = await import('expo-network');
  } catch {
    console.warn('[deviceConditions] expo-network unavailable');
  }
}

async function evaluate(): Promise<SeedConditions> {
  await loadModules();

  if (Battery) {
    const level = await Battery.getBatteryLevelAsync();
    if (level >= 0 && level < BATTERY_THRESHOLD) {
      return { canSeed: false, reason: `battery ${Math.round(level * 100)}% < 30%` };
    }
  }

  if (Network) {
    const networkState = await Network.getNetworkStateAsync();
    if (networkState.type !== Network.NetworkStateType.WIFI) {
      return { canSeed: false, reason: `network type: ${networkState.type}` };
    }
  }

  return { canSeed: true };
}

export const checkConditions = evaluate;

export function subscribeToConditionChanges(
  onChange: (c: SeedConditions) => void,
): () => void {
  let last: boolean | null = null;
  let batterySub: { remove(): void } | null = null;
  let batteryStateSub: { remove(): void } | null = null;
  let networkPoll: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  const notify = async () => {
    const c = await evaluate();
    if (cancelled) return;
    if (c.canSeed !== last) {
      last = c.canSeed;
      onChange(c);
    }
  };

  // Set up subscriptions after modules are loaded.
  void loadModules().then(() => {
    if (cancelled) return;

    if (Battery) {
      batterySub = Battery.addBatteryLevelListener(() => void notify());
      batteryStateSub = Battery.addBatteryStateListener(() => void notify());
    }

    // expo-network doesn't have a live listener — poll on a slow cadence.
    networkPoll = setInterval(() => void notify(), 30_000);

    void notify();
  });

  return () => {
    cancelled = true;
    batterySub?.remove();
    batteryStateSub?.remove();
    if (networkPoll) clearInterval(networkPoll);
  };
}
