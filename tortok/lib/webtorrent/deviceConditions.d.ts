export type SeedConditions = { canSeed: boolean; reason?: string };

/** Check current battery + network conditions for seeding eligibility. */
export function checkConditions(): Promise<SeedConditions>;

/**
 * Subscribe to battery/network changes. Calls `onChange` whenever
 * seeding eligibility changes. Returns an unsubscribe function.
 */
export function subscribeToConditionChanges(
  onChange: (c: SeedConditions) => void,
): () => void;
