import * as Battery from 'expo-battery';
import * as Network from 'expo-network';

export type SeedConditions = { canSeed: boolean; reason?: string };

const BATTERY_THRESHOLD = 0.3;

async function evaluate(): Promise<SeedConditions> {
  const [level, networkState] = await Promise.all([
    Battery.getBatteryLevelAsync(),
    Network.getNetworkStateAsync(),
  ]);

  if (level >= 0 && level < BATTERY_THRESHOLD) {
    return { canSeed: false, reason: `battery ${Math.round(level * 100)}% < 30%` };
  }

  if (networkState.type !== Network.NetworkStateType.WIFI) {
    return { canSeed: false, reason: `network type: ${networkState.type}` };
  }

  return { canSeed: true };
}

export const checkConditions = evaluate;

export function subscribeToConditionChanges(
  onChange: (c: SeedConditions) => void,
): () => void {
  let last: boolean | null = null;

  const notify = async () => {
    const c = await evaluate();
    if (c.canSeed !== last) {
      last = c.canSeed;
      onChange(c);
    }
  };

  const batterySub = Battery.addBatteryLevelListener(() => void notify());
  const batteryStateSub = Battery.addBatteryStateListener(() => void notify());

  // expo-network doesn't have a live listener — poll on a slow cadence.
  // Battery changes are the primary trigger; network polling catches Wi-Fi
  // ↔ cellular transitions within 30 seconds.
  const networkPoll = setInterval(() => void notify(), 30_000);

  // Fire once immediately so the caller gets the initial state.
  void notify();

  return () => {
    batterySub.remove();
    batteryStateSub.remove();
    clearInterval(networkPoll);
  };
}
