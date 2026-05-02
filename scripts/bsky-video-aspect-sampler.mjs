#!/usr/bin/env node
// scripts/bsky-video-aspect-sampler.mjs
//
// Connects to Jetstream (Bluesky PBC's JSON wrapper around the
// atproto firehose) and tallies aspect ratios of
// app.bsky.embed.video posts in real time. Used to size Unit 2.5's
// mirror filter thresholds before locking the plan (see
// ~/.claude/plans/squishy-stargazing-hopcroft.md).
//
// Usage:
//   node scripts/bsky-video-aspect-sampler.mjs
//   node scripts/bsky-video-aspect-sampler.mjs --duration 1800
//
// Why Jetstream and not subscribeRepos?
//   The official firehose is CBOR-encoded with embedded CAR blocks.
//   Parsing requires @atproto/repo + @atproto/sync. Jetstream emits
//   the same data as plain JSON over WebSocket, filtered server-side
//   by collection. For a one-off sampler this is dramatically simpler.
//   Endpoint: https://github.com/bluesky-social/jetstream
//
// Uses Node's built-in WebSocket (Node 22+); no npm deps needed.

const JETSTREAM_URL =
  'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

const args = process.argv.slice(2);
const durationArg = args.indexOf('--duration');
const DURATION_SEC = durationArg >= 0 ? Number(args[durationArg + 1]) : 1800; // 30 min default
const PRINT_EVERY_SEC = 60;

// Aspect-ratio buckets. height/width = 1.0 is square, > 1.0 is
// taller-than-wide (portrait), < 1.0 is wider-than-tall (landscape).
const buckets = {
  vertical_strict: 0, // h/w >= 1.7  → close to true 9:16
  vertical_loose: 0, // 1.0 < h/w < 1.7 → 4:5, 3:4, IG-default, etc.
  square: 0, // h/w === 1.0
  horizontal: 0, // h/w < 1.0 → 16:9 etc.
  no_aspect: 0, // record had video embed but no aspectRatio field
};

let totalPosts = 0;
let totalVideoPosts = 0;
const startTime = Date.now();

const log = (msg) => console.log(`[sampler ${elapsedStr()}] ${msg}`);
const elapsedStr = () => `+${((Date.now() - startTime) / 1000).toFixed(0)}s`;

const printSummary = (label) => {
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('');
  console.log(`=== ${label} (${elapsed.toFixed(0)}s elapsed) ===`);
  console.log(`Total app.bsky.feed.post records:  ${totalPosts}`);
  console.log(`  with app.bsky.embed.video:        ${totalVideoPosts}`);
  console.log(`    vertical_strict (h/w >= 1.7):   ${buckets.vertical_strict}`);
  console.log(`    vertical_loose (1.0 < h/w < 1.7): ${buckets.vertical_loose}`);
  console.log(`    square (h/w == 1.0):            ${buckets.square}`);
  console.log(`    horizontal (h/w < 1.0):         ${buckets.horizontal}`);
  console.log(`    no aspectRatio field:           ${buckets.no_aspect}`);
  if (totalVideoPosts > 0) {
    const portrait = buckets.vertical_strict + buckets.vertical_loose;
    const portraitOrSquare = portrait + buckets.square;
    const pct = (n) => `${((n / totalVideoPosts) * 100).toFixed(1)}%`;
    console.log('  Filter projections:');
    console.log(`    h/w >= 1.0 (portrait+square):    ${portraitOrSquare} (${pct(portraitOrSquare)})`);
    console.log(`    h/w >= 1.2 (loose+strict):       ${portrait} (${pct(portrait)})`);
    console.log(`    h/w >= 1.7 (strict 9:16 only):   ${buckets.vertical_strict} (${pct(buckets.vertical_strict)})`);
    console.log(`  Rate: ${(totalVideoPosts / (elapsed / 60)).toFixed(1)} video posts/min`);
  }
  console.log('');
};

const ws = new WebSocket(JETSTREAM_URL);

ws.addEventListener('open', () => log(`connected: ${JETSTREAM_URL}`));
ws.addEventListener('error', (e) => log(`WS error: ${e.message ?? '(no detail)'}`));
ws.addEventListener('close', (e) => log(`WS closed: ${e.code} ${e.reason ?? ''}`));

ws.addEventListener('message', (msg) => {
  let event;
  try {
    event = JSON.parse(typeof msg.data === 'string' ? msg.data : new TextDecoder().decode(msg.data));
  } catch {
    return;
  }

  if (event.kind !== 'commit') return;
  if (event.commit?.operation !== 'create') return;
  if (event.commit?.collection !== 'app.bsky.feed.post') return;

  totalPosts++;
  const embed = event.commit?.record?.embed;
  if (embed?.$type !== 'app.bsky.embed.video') return;

  totalVideoPosts++;
  const ar = embed?.aspectRatio;
  if (!ar?.width || !ar?.height) {
    buckets.no_aspect++;
    return;
  }

  const ratio = ar.height / ar.width;
  if (ratio >= 1.7) buckets.vertical_strict++;
  else if (ratio > 1.0) buckets.vertical_loose++;
  else if (ratio === 1.0) buckets.square++;
  else buckets.horizontal++;
});

const intervalId = setInterval(() => printSummary('interim'), PRINT_EVERY_SEC * 1000);

setTimeout(() => {
  clearInterval(intervalId);
  printSummary('FINAL');
  ws.close();
  process.exit(0);
}, DURATION_SEC * 1000);

process.on('SIGINT', () => {
  log('SIGINT — printing summary and exiting');
  clearInterval(intervalId);
  printSummary('FINAL (interrupted)');
  ws.close();
  process.exit(0);
});
