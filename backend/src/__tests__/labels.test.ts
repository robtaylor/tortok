// Labels (Decision 0023 item 2): parsing self-labels and AppView labels,
// the live-label check, and upserts into `labels` against a real Postgres.

import { createTestDb, TestDb } from './helpers/testDb';
import { hasLabel, replaceSelfLabels, selfLabels, upsertLabels, viewLabels } from '../atproto/labels';
import type { Label } from '../atproto/labels';
import { bridgeNsfwLabels } from '../config';

const DID = 'did:plc:author';
const MOD = 'did:plc:ar7c4by46qjdydhdevvrndac';
const URI = `at://${DID}/app.bsky.feed.post/3kabc`;
const T0 = new Date('2026-11-01T00:00:00Z');
const T1 = new Date('2026-11-02T00:00:00Z');

const label = (over: Partial<Label> = {}): Label => ({
  subject: URI, src: MOD, val: 'porn', neg: false, subjectCid: null, cts: T0, exp: null, ...over,
});

describe('selfLabels', () => {
  test('reads selfLabels values with the author as source', () => {
    const record = { labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'porn' }, { val: 'gore' }] } };
    expect(selfLabels(URI, DID, record, T0)).toEqual([
      label({ src: DID, val: 'porn' }),
      label({ src: DID, val: 'gore' }),
    ]);
  });

  test('skips malformed entries and tolerates missing labels', () => {
    const record = { labels: { values: [{ val: '' }, { val: 7 }, 'porn', { val: 'x'.repeat(129) }, { val: 'nudity' }] } };
    expect(selfLabels(URI, DID, record, T0).map((l) => l.val)).toEqual(['nudity']);
    expect(selfLabels(URI, DID, {}, T0)).toEqual([]);
    expect(selfLabels(URI, DID, { labels: [] }, T0)).toEqual([]);
    expect(selfLabels(URI, DID, null, T0)).toEqual([]);
  });
});

describe('viewLabels', () => {
  test('reads AppView labels, keeping neg, cid and exp', () => {
    const got = viewLabels([
      { src: MOD, uri: URI, cid: 'bafyrec', val: 'porn', cts: T0.toISOString(), ver: 1, sig: {} },
      { src: MOD, uri: DID, val: '!hide', neg: true, cts: T1.toISOString(), exp: T1.toISOString() },
    ]);
    expect(got).toEqual([
      label({ subjectCid: 'bafyrec' }),
      label({ subject: DID, val: '!hide', neg: true, cts: T1, exp: T1 }),
    ]);
  });

  test('skips labels missing a source, subject, value or valid timestamp', () => {
    const cts = T0.toISOString();
    expect(viewLabels([
      { uri: URI, val: 'porn', cts },
      { src: MOD, val: 'porn', cts },
      { src: MOD, uri: URI, cts },
      { src: MOD, uri: URI, val: 'porn', cts: 'yesterday' },
      { src: MOD, uri: URI, val: 'porn' },
    ])).toEqual([]);
    expect(viewLabels(undefined)).toEqual([]);
  });
});

test('hasLabel ignores negated, expired and other values', () => {
  const nsfw = bridgeNsfwLabels();
  expect(hasLabel([label()], nsfw, T1)).toBe(true);
  expect(hasLabel([label({ val: '!takedown' })], nsfw, T1)).toBe(true);
  expect(hasLabel([label({ neg: true })], nsfw, T1)).toBe(false);
  expect(hasLabel([label({ exp: T0 })], nsfw, T1)).toBe(false);
  expect(hasLabel([label({ val: 'spam' })], nsfw, T1)).toBe(false);
});

test('bridgeNsfwLabels reads BRIDGE_NSFW_LABELS', () => {
  const saved = process.env.BRIDGE_NSFW_LABELS;
  try {
    process.env.BRIDGE_NSFW_LABELS = ' porn , gore ';
    expect([...bridgeNsfwLabels()]).toEqual(['porn', 'gore']);
    process.env.BRIDGE_NSFW_LABELS = ' , ';
    expect(() => bridgeNsfwLabels()).toThrow(/no label values/);
  } finally {
    if (saved === undefined) delete process.env.BRIDGE_NSFW_LABELS;
    else process.env.BRIDGE_NSFW_LABELS = saved;
  }
});

describe('upsertLabels', () => {
  let testDb: TestDb;
  let db: typeof import('../db');

  const rows = () => db.query(
    'SELECT subject, src, val, neg, subject_cid, cts, exp FROM labels ORDER BY subject, subject_cid, src, val',
  );

  beforeAll(async () => {
    testDb = await createTestDb();
    db = await import('../db');
    for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
    await db.initializeDatabase();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await db?.closeDatabase();
    await testDb?.drop();
  });

  beforeEach(() => db.query('DELETE FROM labels'));

  test('stores each label once per (subject, src, val)', async () => {
    await upsertLabels(db.query, [label(), label({ src: DID }), label({ subject: DID, val: '!hide' })]);
    await upsertLabels(db.query, [label()]);
    expect(await rows()).toHaveLength(3);
  });

  test('a newer negation replaces the label; an older replay does not undo it', async () => {
    await upsertLabels(db.query, [label()]);
    await upsertLabels(db.query, [label({ neg: true, cts: T1 })]);
    await upsertLabels(db.query, [label({ cts: T0 })]);
    expect(await rows()).toEqual([
      { subject: URI, src: MOD, val: 'porn', neg: true, subject_cid: '', cts: T1, exp: null },
    ]);
  });

  test('a batch repeating a key keeps its latest label', async () => {
    await upsertLabels(db.query, [label({ neg: true, cts: T1 }), label({ cts: T0 })]);
    expect((await rows()).map((r: { neg: boolean }) => r.neg)).toEqual([true]);
  });

  test('a label on one version of a record is kept apart from one on the whole record', async () => {
    await upsertLabels(db.query, [label(), label({ subjectCid: 'bafyrec', neg: true, cts: T1 })]);
    expect((await rows()).map((r: { subject_cid: string; neg: boolean }) => [r.subject_cid, r.neg]))
      .toEqual([['', false], ['bafyrec', true]]);
  });

  test('re-reading an unchanged label writes nothing', async () => {
    await upsertLabels(db.query, [label()]);
    const [before] = await db.query('SELECT indexed_at, xmin::text AS xmin FROM labels');
    await upsertLabels(db.query, [label()]);
    expect(await db.query('SELECT indexed_at, xmin::text AS xmin FROM labels')).toEqual([before]);
  });

  test('replaceSelfLabels deletes self-labels the author removed, and nothing else', async () => {
    const self = (val: string) => label({ src: DID, val });
    await upsertLabels(db.query, [label()]); // the moderation labeler's, untouched
    await replaceSelfLabels(db.query, URI, DID, [self('porn'), self('gore')]);
    await replaceSelfLabels(db.query, URI, DID, [self('gore')]);
    expect((await rows()).map((r: { src: string; val: string }) => [r.src, r.val]))
      .toEqual([[MOD, 'porn'], [DID, 'gore']]);
    await replaceSelfLabels(db.query, URI, DID, []);
    expect((await rows()).map((r: { src: string }) => r.src)).toEqual([MOD]);
    await expect(replaceSelfLabels(db.query, URI, DID, [label()])).rejects.toThrow(/self-label/);
  });

  test('an empty batch is a no-op', async () => {
    await upsertLabels(db.query, []);
    expect(await rows()).toEqual([]);
  });
});
