// scripts/jetstream-load.mjs
//
// Phase 3 Unit 2.5D step 15: can the production machine afford the
// bridge's Jetstream stream? Subscribes live to app.bsky.feed.post, does the
// bridge firehose's per-event work (parse every event, pick out video posts,
// check aspect ratio and self-labels), and reports resource use once a
// minute, then a summary. It keeps nothing and writes nothing.
//
// Usage (Node 22+, no dependencies):
//   node scripts/jetstream-load.mjs [--minutes 60]
//
// Run on a machine sized like production (see the plan's 2.5D step 15):
//   fly machine run node:22-alpine -a tortok-api -r lhr --name jetstream-load \
//     --vm-size shared-cpu-1x --vm-memory 512 --restart no --detach \
//     --file-local /load.mjs=scripts/jetstream-load.mjs \
//     -- node /load.mjs --minutes 60
// (the `--` stops flyctl reading --minutes as its own flag; the command
// replaces the image's CMD)
// then, once `fly machine list` shows it stopped:
//   fly logs -a tortok-api -i <id> --no-tail   # the JSON rows
//   fly machine destroy <id> -a tortok-api

import { parseArgs } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// Same endpoint as backend/src/services/atprotoIngest.ts's default.
const URL_ = 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
// The labels spike's adult and graphic sets (scripts/bsky-label-sampler.mjs).
const NSFW = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);

const { values } = parseArgs({ strict: true, options: { minutes: { type: 'string', default: '60' } } });
const MINUTES = Number(values.minutes);
if (!(MINUTES > 0 && Number.isInteger(MINUTES))) throw new Error('--minutes must be a positive integer');

const total = { events: 0, chars: 0, video: 0, portrait: 0, nsfwSelf: 0, reconnects: 0 };
// chars, not bytes: UTF-16 code units, which for this mostly-ASCII JSON is
// within a few percent of the bytes on the wire and keeps a byte scan off
// the hot path.
let win = { events: 0, chars: 0 };
const rows = [];
// Readings below the resolution (10 ms) are noise. The monitor's own timer
// costs a little CPU the bridge won't pay, so the CPU figures err high.
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();

function handle(data) {
  win.events++; win.chars += data.length;
  const ev = JSON.parse(data);
  if (ev.kind !== 'commit' || ev.commit?.operation !== 'create') return;
  const embed = ev.commit.record?.embed;
  const e = embed?.$type === 'app.bsky.embed.recordWithMedia' ? embed.media : embed;
  if (e?.$type !== 'app.bsky.embed.video') return;
  total.video++;
  const ar = e.aspectRatio;
  if (ar && ar.height >= ar.width) total.portrait++;
  if ((ev.commit.record.labels?.values ?? []).some((l) => NSFW.has(l.val))) total.nsfwSelf++;
}

function connect() {
  const ws = new WebSocket(URL_);
  ws.onmessage = (m) => handle(m.data);
  ws.onclose = () => { total.reconnects++; setTimeout(connect, 2000); };
}

const r1 = (n) => +n.toFixed(1);
const mb = (n) => r1(n / 1e6);
let lastCpu = process.cpuUsage();
let lastAt = performance.now();
function sampleMinute() {
  const now = performance.now();
  const secs = (now - lastAt) / 1000;
  const cpu = process.cpuUsage(lastCpu); // µs
  const mem = process.memoryUsage();
  const row = {
    minute: rows.length + 1,
    eventsPerSec: r1(win.events / secs),
    mbIn: mb(win.chars),
    cpuPctOfCore: r1((cpu.user + cpu.system) / (secs * 1e4)),
    rssMb: mb(mem.rss), heapMb: mb(mem.heapUsed),
    loopLagP99Ms: r1(lag.percentile(99) / 1e6), loopLagMaxMs: r1(lag.max / 1e6),
  };
  console.log(JSON.stringify(row));
  rows.push(row);
  total.events += win.events; total.chars += win.chars;
  win = { events: 0, chars: 0 };
  lastCpu = process.cpuUsage(); lastAt = now; lag.reset();
  if (rows.length === MINUTES) { summary(); process.exit(0); }
}

function summary() {
  const pick = (k) => {
    const c = rows.map((m) => m[k]).sort((a, b) => a - b);
    return { median: c[Math.floor(c.length / 2)], max: c.at(-1) };
  };
  console.log(JSON.stringify({
    summary: true, minutes: rows.length, events: total.events, mbIn: mb(total.chars),
    mbPerHour: mb((total.chars / rows.length) * 60), videoPosts: total.video,
    portrait: total.portrait, nsfwSelfLabelled: total.nsfwSelf, reconnects: total.reconnects,
    eventsPerSec: pick('eventsPerSec'), cpuPctOfCore: pick('cpuPctOfCore'),
    rssMb: pick('rssMb'), loopLagP99Ms: pick('loopLagP99Ms'), loopLagMaxMs: pick('loopLagMaxMs'),
  }));
}

console.log(JSON.stringify({ start: new Date().toISOString(), minutes: MINUTES, node: process.version }));
connect();
setInterval(sampleMinute, 60_000);
