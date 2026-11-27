// How playback went on a device, from its log. The app logs one line per
// video watched: "[playback] " and a JSON record (tortok/lib/playbackTrace.ts,
// which documents the fields). This reads those lines out of one or more
// device logs (`adb logcat`, or a device farm's download) and prints, for
// each log and playback kind, how long videos took to start and how often
// they stalled.
//
//   node scripts/playback-report.mjs <device-log>... [--each] [--json]
//
//   --each  also list every video
//   --json  print the summaries as JSON instead
//
// A video's start time is from becoming the active item to the later of the
// poster giving way and the first frame being drawn. A video left before
// that has no start time; `waited` counts those left after WAITED_MS or
// more, which someone gave up on rather than swiped past.
//
// Two figures say how it played. `stall time` is the share of playing time
// spent in the stalls the player reported. `not playing` is the share of the
// time after a video started in which its position didn't advance, whatever
// the player reported: it also counts pauses, and time updates the app was
// too busy to take. Where they disagree, the truth is between them.
//
// No dependencies.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const TAG = '[playback]';
/** Leaving an unstarted video after this long is giving up on it. */
export const WAITED_MS = 5_000;

class ReportError extends Error {}

/** The records in a log's text, in order, without repeats; and how many tagged lines couldn't be read. */
export function parseLog(text) {
  const records = new Map();
  let unreadable = 0;
  for (const line of text.split('\n')) {
    const tagged = line.indexOf(TAG);
    if (tagged < 0) continue;
    let record = null;
    try {
      record = JSON.parse(line.slice(line.indexOf('{', tagged), line.lastIndexOf('}') + 1));
    } catch {
      // counted below
    }
    if (record?.v !== 1 || typeof record.post !== 'string' || typeof record.at !== 'number') {
      unreadable++;
      continue;
    }
    // A log saved in overlapping parts repeats lines.
    records.set(`${record.post} ${record.at}`, record);
  }
  return { records: [...records.values()].sort((a, b) => a.at - b.at), unreadable };
}

/** Milliseconds from becoming active to a playing picture, or null if it never came. */
export function startMs(r) {
  if (r.shownMs === null) return null;
  return Math.max(r.shownMs, r.frameMs ?? r.shownMs);
}

/** The value at or below which `p` of the sorted values fall (nearest rank), or null of none. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/** One summary per playback kind present, `hls` before `torrent`. */
export function summarise(records) {
  const kinds = [...new Set(records.map((r) => r.kind))].sort();
  return kinds.map((kind) => {
    const of = records.filter((r) => r.kind === kind);
    const started = of.filter((r) => startMs(r) !== null);
    const starts = started.map(startMs).sort((a, b) => a - b);
    const sum = (f) => started.reduce((n, r) => n + f(r), 0);
    const stallMs = sum((r) => r.stallMs);
    const playedMs = sum((r) => r.playedMs);
    const afterStartMs = sum((r) => r.activeMs - startMs(r));
    return {
      kind,
      videos: of.length,
      started: started.length,
      startMedianMs: percentile(starts, 0.5),
      startP90Ms: percentile(starts, 0.9),
      startMaxMs: starts.at(-1) ?? null,
      // For a torrent, how long the bridge took to offer a URL.
      urlMedianMs: percentile(started.map((r) => r.urlMs).filter((v) => v !== null).sort((a, b) => a - b), 0.5),
      stalled: started.filter((r) => r.stalls > 0).length,
      stalls: sum((r) => r.stalls),
      // Of the time spent playing or waiting to, the share spent waiting.
      stallShare: playedMs + stallMs > 0 ? stallMs / (playedMs + stallMs) : null,
      idleShare: afterStartMs > 0 ? sum((r) => Math.max(0, r.activeMs - startMs(r) - r.playedMs)) / afterStartMs : null,
      waited: of.filter((r) => startMs(r) === null && r.error === null && r.activeMs >= WAITED_MS).length,
      errors: of.filter((r) => r.error !== null).length,
      lagMaxMs: Math.max(0, ...of.map((r) => r.lagMs)),
    };
  });
}

const ms = (v) => (v === null ? '-' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
const share = (v) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

/** The report for one log, as text. */
export function render(name, { records, unreadable }, { each = false } = {}) {
  const out = [`${name}: ${records.length} video(s)`];
  if (unreadable) out.push(`  ${unreadable} ${TAG} line(s) could not be read`);
  if (records.length === 0) return out.join('\n');
  out.push(table([
    ['kind', 'videos', 'started', 'start median', 'p90', 'max', 'url median', 'stalled', 'stalls', 'stall time', 'not playing', 'waited', 'errors', 'lag max'],
    ...summarise(records).map((s) => [
      s.kind, s.videos, s.started, ms(s.startMedianMs), ms(s.startP90Ms), ms(s.startMaxMs), ms(s.urlMedianMs),
      s.stalled, s.stalls, share(s.stallShare), share(s.idleShare), s.waited, s.errors, ms(s.lagMaxMs),
    ]),
  ]));
  if (each) {
    out.push('', table([
      ['at', 'kind', 'post', 'start', 'url', 'ready', 'active', 'played', 'stalls', 'stalled for', 'lag', 'error'],
      ...records.map((r) => [
        new Date(r.at).toISOString().slice(11, 19), r.kind, r.post.split('/').pop(), ms(startMs(r)), ms(r.urlMs), ms(r.readyMs),
        ms(r.activeMs), ms(r.playedMs), r.stalls, ms(r.stallMs), ms(r.lagMs), r.error ?? '',
      ]),
    ]));
  }
  return out.join('\n');
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  for (const f of flags) if (f !== '--each' && f !== '--json') throw new ReportError(`unexpected argument ${f}`);
  if (files.length === 0) throw new ReportError('usage: playback-report.mjs <device-log>... [--each] [--json]');
  const logs = files.map((file) => ({ name: basename(file), ...parseLog(readFileSync(file, 'utf8')) }));
  if (flags.has('--json')) {
    console.log(JSON.stringify(logs.map(({ name, records, unreadable }) => ({ name, unreadable, kinds: summarise(records) })), null, 2));
  } else {
    console.log(logs.map((log) => render(log.name, log, { each: flags.has('--each') })).join('\n\n'));
  }
  // A log with no records usually means the wrong file, or a build that doesn't log them.
  if (logs.some((log) => log.records.length === 0)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof ReportError ? err.message : err);
    process.exitCode = 2;
  }
}
