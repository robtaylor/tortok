// Network values as the index can store them (atproto/json.ts).

import { integer, MAX_INTEGER, parseJson, timestamp } from '../atproto/json';

test('parseJson drops U+0000 from strings at any depth, and nothing else', () => {
  const value = { text: 'a\u0000b', tags: ['c\u0000', 'd'], n: 5, nested: { ok: true, s: '\u0000' } };
  expect(parseJson(JSON.stringify(value))).toEqual({ text: 'ab', tags: ['c', 'd'], n: 5, nested: { ok: true, s: '' } });
  // The six characters backslash-u-0000, written out in a post, are not a NUL.
  expect(parseJson(JSON.stringify({ text: 'type \\u0000 for NUL' }))).toEqual({ text: 'type \\u0000 for NUL' });
  expect(() => parseJson('not json')).toThrow();
});

test('timestamp reads a datetime, and refuses what Postgres has no timestamp for', () => {
  expect(timestamp('2026-11-12T10:00:00.000Z')).toEqual(new Date('2026-11-12T10:00:00.000Z'));
  expect(timestamp('0001-01-01T00:00:00.000Z')).not.toBeNull();
  // JavaScript reads this; a timestamptz starts at 4713 BC.
  expect(timestamp('-010000-01-01T00:00:00.000Z')).toBeNull();
  expect(timestamp('soon')).toBeNull();
  expect(timestamp(1_700_000_000)).toBeNull();
});

test('integer takes a whole number an INTEGER column holds, from the minimum up', () => {
  expect(integer(0)).toBe(0);
  expect(integer(MAX_INTEGER)).toBe(MAX_INTEGER);
  expect(integer(0, 1)).toBeNull();
  for (const v of [MAX_INTEGER + 1, -1, 1.5, '5', null, NaN]) expect(integer(v)).toBeNull();
});
