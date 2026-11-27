// Tests for the playback report: reading records out of a device log, and
// the figures it derives. Run with `npm run test:scripts`.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseLog, percentile, render, startMs, summarise, WAITED_MS } from './playback-report.mjs';

const SCRIPT = fileURLToPath(new URL('./playback-report.mjs', import.meta.url));

/** A record as the app logs it; `over` replaces fields. */
const record = (over = {}) => ({
  v: 1, post: 'at://did:plc:a/app.bsky.feed.post/aaa', kind: 'hls', at: 1_000_000,
  urlMs: 5, readyMs: 300, shownMs: 350, frameMs: 340, activeMs: 10_000, playedMs: 9_000, loops: 0,
  stalls: 0, stallMs: 0, lagMs: 20, error: null, ...over,
});
/** A logcat line carrying a record. */
const line = (r) => `11-27 17:00:00.000  1234  5678 I ReactNativeJS: [playback] ${JSON.stringify(r)}`;

test('reads records out of a device log, in time order, each once', () => {
  const a = record({ at: 2_000 });
  const b = record({ at: 1_000, post: 'at://did:plc:a/app.tortok.video.post/bbb', kind: 'torrent' });
  const log = [
    '11-27 17:00:00.000  1234  5678 I ReactNativeJS: [curr] [aaa:caption] ACTIVATE',
    line(a),
    '--------- beginning of main',
    line(b),
    line(a), // a log saved in overlapping parts repeats lines
    '',
  ].join('\n');
  assert.deepEqual(parseLog(log), { records: [b, a], unreadable: 0 });
});

test('reads a record a dev build logs, quoted and after a timestamp', () => {
  const r = record();
  const log = `I ReactNativeJS: '[+12.345s]', '[playback] ${JSON.stringify(r)}'`;
  assert.deepEqual(parseLog(log).records, [r]);
});

test('counts tagged lines it cannot read, and reads the rest', () => {
  const r = record();
  const log = [
    line(r),
    'I ReactNativeJS: [playback] {"v":1,"post":"at://x","kind":"hls","at":5,"urlMs"', // cut short
    'I ReactNativeJS: [playback] nothing here',
    `I ReactNativeJS: [playback] ${JSON.stringify({ ...r, v: 2 })}`, // a shape this doesn't know
  ].join('\n');
  assert.deepEqual(parseLog(log), { records: [r], unreadable: 3 });
});

test('a start is the later of the poster giving way and the first frame', () => {
  assert.equal(startMs(record({ shownMs: 350, frameMs: 340 })), 350);
  assert.equal(startMs(record({ shownMs: 350, frameMs: 900 })), 900);
  assert.equal(startMs(record({ shownMs: 350, frameMs: null })), 350);
  assert.equal(startMs(record({ shownMs: null, frameMs: 340 })), null);
});

test('percentiles are by nearest rank', () => {
  const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(values, 0.5), 500);
  assert.equal(percentile(values, 0.9), 900);
  assert.equal(percentile([42], 0.9), 42);
  assert.equal(percentile([], 0.5), null);
});

test('summarises each kind: starts, stalls, videos given up on, errors', () => {
  const records = [
    record({ at: 1, shownMs: 300, frameMs: 280 }),
    record({ at: 2, shownMs: 500, frameMs: 520, stalls: 2, stallMs: 1_000, playedMs: 9_000 }),
    record({ at: 3, shownMs: 900, frameMs: 880, lagMs: 700 }),
    record({ at: 4, shownMs: null, frameMs: null, readyMs: null, activeMs: 400 }), // swiped past
    record({ at: 5, shownMs: null, frameMs: null, readyMs: null, activeMs: WAITED_MS }), // given up on
    record({ at: 6, shownMs: null, frameMs: null, readyMs: null, activeMs: 9_000, error: 'Source error' }),
    record({ at: 7, kind: 'torrent', urlMs: 1_200, shownMs: 2_000, frameMs: 1_900 }),
  ];
  const [hls, torrent] = summarise(records);
  assert.deepEqual(hls, {
    kind: 'hls',
    videos: 6,
    started: 3,
    startMedianMs: 520,
    startP90Ms: 900,
    startMaxMs: 900,
    urlMedianMs: 5,
    stalled: 1,
    stalls: 2,
    stallShare: 1_000 / 28_000,
    // Each ran 10 s and played 9 s: 700, 480 and 100 ms after its start went unplayed.
    idleShare: 1_280 / 28_280,
    waited: 1,
    errors: 1,
    lagMaxMs: 700,
  });
  assert.deepEqual(
    { kind: torrent.kind, videos: torrent.videos, startMedianMs: torrent.startMedianMs, urlMedianMs: torrent.urlMedianMs, stallShare: torrent.stallShare, idleShare: torrent.idleShare },
    { kind: 'torrent', videos: 1, startMedianMs: 2_000, urlMedianMs: 1_200, stallShare: 0, idleShare: 0 },
  );
});

test('renders a table, and each video on request', () => {
  const parsed = { records: [record({ shownMs: 1_500, frameMs: 1_400, stalls: 1, stallMs: 250 })], unreadable: 2 };
  const text = render('pixel.log', parsed, { each: true });
  assert.match(text, /^pixel\.log: 1 video\(s\)\n {2}2 \[playback\] line\(s\) could not be read\n/);
  assert.match(text, /\nhls +1 +1 +1\.5 s +1\.5 s +1\.5 s +5 ms +1 +1 +2\.7% +0\.0% +0 +0 +20 ms\n/);
  assert.match(text, /\n00:16:40 +hls +aaa +1\.5 s +5 ms +300 ms +10\.0 s +9\.0 s +1 +250 ms +20 ms$/);
  assert.equal(render('empty.log', { records: [], unreadable: 0 }), 'empty.log: 0 video(s)');
});

const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [SCRIPT, ...args], (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
});

test('the command reports each log, and fails on one with no records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'playback-report-'));
  const good = join(dir, 'pixel.log');
  const empty = join(dir, 'empty.log');
  writeFileSync(good, `${line(record())}\n`);
  writeFileSync(empty, 'I ReactNativeJS: nothing of ours\n');

  const ok = await run(good);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^pixel\.log: 1 video\(s\)\nkind +videos +started/);

  const json = await run(good, '--json');
  assert.equal(JSON.parse(json.stdout)[0].kinds[0].startMedianMs, 350);

  const both = await run(good, empty);
  assert.equal(both.code, 1);
  assert.match(both.stdout, /empty\.log: 0 video\(s\)/);

  assert.equal((await run()).code, 2);
  assert.equal((await run(good, '--verbose')).code, 2);
});
