// Values from the network (Jetstream, a PDS, Bluesky's AppView) as this
// service can store them. Postgres is stricter than JSON and JavaScript in
// three ways that matter here, and a value it refuses fails its statement
// every time it is tried.

const dropNul = (_key: string, value: unknown) =>
  (typeof value === 'string' ? value.replaceAll('\u0000', '') : value);

/**
 * Parse JSON from the network, dropping U+0000 from its strings: Postgres
 * text can't hold one. Dropped here, before anything reads the value,
 * validation, de-duplication and policy all see the string that is stored.
 * (Dropped only on the way into the database, two labels that differ by a NUL
 * become one key, and the statement that stores them fails.)
 */
export function parseJson(text: string): unknown {
  // JSON can only write a NUL as this escape, so most text skips the reviver.
  return text.includes('\\u0000') ? JSON.parse(text, dropNul) : JSON.parse(text);
}

/**
 * A datetime string as a Date, or null if it isn't one, or is before year 1.
 * JavaScript reads dates back to 271,821 BC; a timestamptz starts at 4713 BC.
 */
export function timestamp(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1 ? null : d;
}

/** The largest value an INTEGER column holds. The Lexicons set no maximum on a width, a height or a count. */
export const MAX_INTEGER = 2_147_483_647;

/** A whole number from `min` up that an INTEGER column holds, or null. */
export function integer(v: unknown, min = 0): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= MAX_INTEGER ? v : null;
}
