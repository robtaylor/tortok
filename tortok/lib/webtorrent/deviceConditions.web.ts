export type SeedConditions = { canSeed: boolean; reason?: string };

const BATTERY_THRESHOLD = 0.8;

interface BatteryManager extends EventTarget {
  charging: boolean;
  level: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

async function getBattery(): Promise<BatteryManager | null> {
  try {
    // Battery Status API — available in Chromium browsers, not Firefox/Safari.
    return await (navigator as any).getBattery();
  } catch {
    return null;
  }
}

function evaluateFromBattery(battery: BatteryManager | null): SeedConditions {
  if (!battery) return { canSeed: true }; // API unavailable → assume plugged in
  if (battery.charging) return { canSeed: true };
  if (battery.level >= BATTERY_THRESHOLD) return { canSeed: true };
  return {
    canSeed: false,
    reason: `battery ${Math.round(battery.level * 100)}% < 80% and not charging`,
  };
}

export async function checkConditions(): Promise<SeedConditions> {
  return evaluateFromBattery(await getBattery());
}

export function subscribeToConditionChanges(
  onChange: (c: SeedConditions) => void,
): () => void {
  let battery: BatteryManager | null = null;
  let last: boolean | null = null;
  let cancelled = false;

  const notify = () => {
    const c = evaluateFromBattery(battery);
    if (c.canSeed !== last) {
      last = c.canSeed;
      onChange(c);
    }
  };

  getBattery().then((b) => {
    if (cancelled) return;
    battery = b;
    if (!battery) {
      onChange({ canSeed: true });
      return;
    }
    battery.addEventListener('chargingchange', notify);
    battery.addEventListener('levelchange', notify);
    notify();
  });

  return () => {
    cancelled = true;
    if (battery) {
      battery.removeEventListener('chargingchange', notify);
      battery.removeEventListener('levelchange', notify);
    }
  };
}
