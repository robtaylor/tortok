// scripts/bsky-label-sampler.mjs
//
// Spike: Bluesky labels on bridged video posts
// (docs/architecture/decisions/spikes/bluesky-labels-on-bridged-video-posts.md).
//
// Replays Jetstream's app.bsky.feed.post stream from some hours ago, keeps
// the video posts, then asks Bluesky's public AppView what it knows about
// them now: the labels on each post (with and without naming Bluesky's
// moderation labeler in atproto-accept-labelers), engagement counts, the
// embed's playlist URL, and each author's profile labels and follower count.
//
// Writes the raw samples as JSON (public data; keep it out of the repo) and
// prints an aggregate summary with no handles or user DIDs. --summarize
// re-prints the summary from a saved file without sampling again.
//
// Usage (Node 22+, no dependencies):
//   node scripts/bsky-label-sampler.mjs --out /tmp/claude/labels.json \
//     [--hours-ago 24] [--max-posts 2000] [--max-seconds 600]
//   node scripts/bsky-label-sampler.mjs --summarize /tmp/claude/labels.json

import fs from 'node:fs';
import { parseArgs } from 'node:util';

// Same endpoint as backend/src/services/atprotoIngest.ts's default.
const JETSTREAM = 'wss://jetstream2.us-east.bsky.network/subscribe';
const APPVIEW = 'https://public.api.bsky.app/xrpc';
const BSKY_MOD = 'did:plc:ar7c4by46qjdydhdevvrndac'; // moderation.bsky.app
const BATCH = 25; // getPosts and getProfiles take at most 25
// The spike's label sets. Bluesky files graphic-media and gore under
// violence, not adult content, so they're counted separately.
const ADULT = new Set(['porn', 'sexual', 'nudity']);
const GRAPHIC = new Set(['graphic-media', 'gore']);
const HIDE = new Set(['!hide', '!takedown']);
const OPT_OUT = '!no-unauthenticated';

const { values: opts } = parseArgs({
  strict: true,
  options: {
    out: { type: 'string' }, summarize: { type: 'string' },
    'hours-ago': { type: 'string', default: '24' },
    'max-posts': { type: 'string', default: '2000' },
    'max-seconds': { type: 'string', default: '600' },
  },
});
const HOURS_AGO = Number(opts['hours-ago']);
const MAX_POSTS = Number(opts['max-posts']);
const MAX_SECONDS = Number(opts['max-seconds']);

function videoOf(embed) {
  const e = embed?.$type === 'app.bsky.embed.recordWithMedia' ? embed.media : embed;
  return e?.$type === 'app.bsky.embed.video' ? e : null;
}

const labelView = (l) => ({ src: l.src, val: l.val, neg: !!l.neg });

/** Replay Jetstream from HOURS_AGO; collect video posts. */
function sample() {
  const cursor = (Date.now() - HOURS_AGO * 3600_000) * 1000;
  const url = `${JETSTREAM}?wantedCollections=app.bsky.feed.post&cursor=${cursor}`;
  const posts = [];
  const stats = { events: 0, creates: 0, chars: 0, firstUs: null, lastUs: null, embedKinds: {} };
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let finished = false;
    const done = () => { finished = true; clearTimeout(timer); ws.close(); resolve({ posts, stats }); };
    const timer = setTimeout(done, MAX_SECONDS * 1000);
    ws.onerror = (e) => reject(new Error(`jetstream: ${e.message ?? 'error'}`));
    ws.onmessage = (msg) => {
      if (finished) return;
      stats.events++;
      stats.chars += msg.data.length; // UTF-16 units; close enough to bytes for a rate
      const ev = JSON.parse(msg.data);
      stats.firstUs ??= ev.time_us;
      stats.lastUs = ev.time_us;
      if (ev.kind !== 'commit' || ev.commit?.operation !== 'create') return;
      stats.creates++;
      const rec = ev.commit.record;
      const video = videoOf(rec.embed);
      if (!video) return;
      stats.embedKinds[rec.embed.$type] = (stats.embedKinds[rec.embed.$type] ?? 0) + 1;
      posts.push({
        uri: `at://${ev.did}/${ev.commit.collection}/${ev.commit.rkey}`,
        did: ev.did,
        aspectRatio: video.aspectRatio ?? null,
        videoCid: video.video?.ref?.$link ?? null,
        selfLabels: (rec.labels?.values ?? []).map((l) => labelView({ ...l, src: ev.did })),
      });
      if (posts.length % 200 === 0) console.error(`… ${posts.length} video posts`);
      if (posts.length >= MAX_POSTS) done();
    };
  });
}

async function xrpc(method, params, headers = {}) {
  const qs = new URLSearchParams();
  for (const [k, vs] of Object.entries(params)) for (const v of vs) qs.append(k, v);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${APPVIEW}/${method}?${qs}`, { headers });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${method}: rate-limited`);
}

/** Fetch `items` in batches of 25, sequentially (a shared public API); key the results. */
async function fetchAll(method, param, items, field, keyOf, headers) {
  const out = new Map();
  for (let i = 0; i < items.length; i += BATCH) {
    const res = await xrpc(method, { [param]: items.slice(i, i + BATCH) }, headers);
    for (const v of res[field]) out.set(keyOf(v), v);
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

async function collect(out) {
  console.error(`replaying Jetstream from ${HOURS_AGO} h ago…`);
  const { posts, stats } = await sample();
  console.error(`${posts.length} video posts of ${stats.creates} created posts; querying the AppView…`);

  const variants = { plain: {}, bskyMod: { 'atproto-accept-labelers': BSKY_MOD } };
  for (const [name, headers] of Object.entries(variants)) {
    const views = await fetchAll('app.bsky.feed.getPosts', 'uris', posts.map((p) => p.uri), 'posts', (v) => v.uri, headers);
    for (const p of posts) {
      const v = views.get(p.uri);
      p[name] = v && {
        labels: (v.labels ?? []).map(labelView),
        likes: v.likeCount ?? 0, reposts: v.repostCount ?? 0,
        playlist: v.embed?.playlist ?? v.embed?.media?.playlist ?? null,
      };
    }
  }

  const dids = [...new Set(posts.map((p) => p.did))];
  const profiles = await fetchAll('app.bsky.actor.getProfiles', 'actors', dids, 'profiles', (v) => v.did, variants.bskyMod);
  for (const p of posts) {
    const a = profiles.get(p.did);
    p.author = a && {
      labels: (a.labels ?? []).map(labelView),
      followers: a.followersCount ?? 0,
      bioTags: ((a.description ?? '').match(/#no\w+/gi) ?? []).map((t) => t.toLowerCase()),
    };
  }

  const data = { hoursAgo: HOURS_AGO, stats, posts };
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  return data;
}

function summarize({ hoursAgo, stats, posts }) {
  const n = posts.length;
  const hours = (stats.lastUs - stats.firstUs) / 3.6e9;
  const count = (pred, set = posts) => set.filter(pred).length;
  const share = (pred, set = posts) => { const k = count(pred, set); return `${k} (${set.length ? ((100 * k) / set.length).toFixed(1) : 0}%)`; };
  const has = (labels, vals) => (labels ?? []).some((l) => vals.has(l.val) && !l.neg);
  const any = (sets) => new Set(sets.flatMap((s) => [...s]));
  const NSFW = any([ADULT, GRAPHIC]);

  // Every label source the post's own view, its record and its author show.
  const allLabels = (p) => [...p.selfLabels, ...(p.bskyMod?.labels ?? []), ...(p.author?.labels ?? [])];
  const source = (l, p) => (l.src === p.did ? 'self' : l.src === BSKY_MOD ? 'bsky-mod' : 'other');
  const tally = (keys) => {
    const t = new Map();
    for (const k of keys) t.set(k, (t.get(k) ?? 0) + 1);
    return Object.fromEntries([...t].sort((a, b) => b[1] - a[1]));
  };
  const labelKeys = (pick) => posts.flatMap((p) => (pick(p) ?? []).map((l) => `${l.val} ← ${source(l, p)}`));

  const exists = (p) => !!p.bskyMod;
  const optedOut = (p) => has(p.author?.labels, new Set([OPT_OUT])) || (p.author?.bioTags ?? []).includes('#nobridge');
  const nsfw = (p) => has(allLabels(p), NSFW);
  const hidden = (p) => has(allLabels(p), HIDE);
  const portrait = (p) => !!p.aspectRatio && p.aspectRatio.height >= p.aspectRatio.width;
  const passes = (p) => p.bskyMod?.likes >= 50 || p.bskyMod?.reposts >= 10 || p.author?.followers >= 5000;
  const funnel = (stages) => {
    let set = posts;
    return Object.fromEntries(stages.map(([name, pred]) => {
      set = set.filter(pred);
      return [name, `${set.length} (${Math.round(set.length / hours)}/h)`];
    }));
  };
  const baseStages = [['exists', exists], ['notOptedOut', (p) => !optedOut(p)],
    ['notNsfwOrHidden', (p) => !nsfw(p) && !hidden(p)], ['portraitOrSquare', portrait]];
  const passing = posts.filter((p) => exists(p) && passes(p));

  return {
    hoursAgo,
    stream: {
      networkHours: +hours.toFixed(2), createdPosts: stats.creates, videoPosts: n,
      videoShareOfCreated: `${((100 * n) / stats.creates).toFixed(1)}%`,
      videoPerHour: Math.round(n / hours), eventsPerHour: Math.round(stats.events / hours),
      mbPerHour: +((stats.chars ?? stats.bytes) / hours / 1e6).toFixed(1), embedKinds: stats.embedKinds,
    },
    deleted: share((p) => !exists(p)),
    deletedPlainVsBskyMod: [count((p) => !p.plain), count((p) => !p.bskyMod)],
    labelsIdenticalPlainVsBskyMod: posts.every((p) => JSON.stringify(p.plain?.labels) === JSON.stringify(p.bskyMod?.labels)),
    otherLabelers: [...new Set(posts.flatMap((p) => allLabels(p).filter((l) => source(l, p) === 'other').map((l) => l.src)))],
    adult: {
      recordSelfLabel: share((p) => has(p.selfLabels, ADULT)),
      postView: share((p) => has(p.bskyMod?.labels, ADULT)),
      postViewBskyModOnly: share((p) => has(p.bskyMod?.labels?.filter((l) => l.src === BSKY_MOD), ADULT)
        && !has(p.selfLabels, ADULT) && !has(p.author?.labels, ADULT)),
      anySource: share((p) => has(allLabels(p), ADULT)),
    },
    graphic: { anySource: share((p) => has(allLabels(p), GRAPHIC)) },
    nsfwAnySource: share(nsfw),
    hidden: share(hidden),
    optedOut: share(optedOut),
    portraitOrSquare: share(portrait),
    passesThresholds: share(passes),
    nsfwAmongPassing: share(nsfw, passing),
    postLabels: tally(labelKeys((p) => p.bskyMod?.labels)),
    authorLabels: tally(labelKeys((p) => p.author?.labels)),
    authorBioTags: tally(posts.flatMap((p) => p.author?.bioTags ?? [])),
    funnelWithoutThresholds: funnel(baseStages),
    funnel: funnel([...baseStages, ['passesThresholds', passes]]),
    playlistIsDerivable: share((p) => p.bskyMod?.playlist
      === `https://video.bsky.app/watch/${encodeURIComponent(p.did)}/${p.videoCid}/playlist.m3u8`, posts.filter(exists)),
  };
}

async function main() {
  if (opts.summarize) {
    const data = JSON.parse(fs.readFileSync(opts.summarize, 'utf8'));
    // Files from the first version of this script stored self-labels as strings.
    for (const p of data.posts) {
      p.selfLabels = p.selfLabels.map((l) => (typeof l === 'string' ? { src: p.did, val: l, neg: false } : l));
      if (p.author) p.author.bioTags = p.author.bioTags.map((t) => t.toLowerCase());
    }
    console.log(JSON.stringify(summarize(data), null, 1));
    return;
  }
  if (!opts.out) throw new Error('--out <file> or --summarize <file> is required');
  if (!(HOURS_AGO > 0 && MAX_POSTS > 0 && MAX_SECONDS > 0)) throw new Error('bad numeric argument');
  console.log(JSON.stringify(summarize(await collect(opts.out)), null, 1));
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
