// Read-only smoke check of a deployed backend (Decision 0016, commitment 8;
// WS2 of docs/plans/environments-staging-production-and-their-checks.md).
// Safe to run against production: it only reads.
//
//   node scripts/smoke.mjs <base-url> [--expect-sha <sha>] [--sha-file <path>] [--max-items <n>]
//
// Checks:
//   version  /health is healthy, Postgres reachable, and reports a git SHA
//            (the given one, with --expect-sha). With --sha-file <path>, the
//            reported SHA is also written there, for callers that compare it
//            with main.
//   contract /videos/feed returns items with a magnet and a .torrent URL;
//            /turn/credentials includes a TURN server with credentials.
//   webseed  for each feed item (up to --max-items, default 5): the .torrent's
//            info hash matches the magnet, and its first and last pieces,
//            fetched from the magnet's webseed (ws=) with no peers at all,
//            match the torrent's piece hashes. So a clip that can't start
//            without a peer fails here.
//
// Prints one line per check and exits non-zero if any failed. No dependencies,
// so CI can run it without an install.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const TIMEOUT_MS = 15000;

class SmokeError extends Error {}

function parseArgs(argv) {
  const opts = { base: null, expectSha: null, shaFile: null, maxItems: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expect-sha') opts.expectSha = argv[++i];
    else if (a === '--sha-file') opts.shaFile = argv[++i];
    else if (a === '--max-items') opts.maxItems = Number(argv[++i]);
    else if (!opts.base && !a.startsWith('--')) opts.base = a.replace(/\/+$/, '');
    else throw new SmokeError(`unexpected argument ${a}`);
  }
  if (!opts.base) throw new SmokeError('usage: smoke.mjs <base-url> [--expect-sha <sha>] [--sha-file <path>] [--max-items <n>]');
  if (!(opts.maxItems > 0)) throw new SmokeError('--max-items must be a positive number');
  return opts;
}

async function get(url, headers = {}) {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new SmokeError(`${url}: ${err.cause?.code ?? err.name ?? err.message}`);
  }
}

async function getJson(url) {
  const res = await get(url);
  const body = await res.text();
  try {
    return { status: res.status, json: JSON.parse(body) };
  } catch {
    throw new SmokeError(`${url}: HTTP ${res.status}, not JSON`);
  }
}

// --- bencode, just enough for .torrent files --------------------------------

/** Decodes the bencoded value at `i`; dicts record each value's raw byte span. */
function bdecode(buf, i = 0) {
  const c = buf[i];
  if (c === 0x69) { // i<int>e
    const end = buf.indexOf(0x65, i);
    return [Number(buf.subarray(i + 1, end).toString()), end + 1];
  }
  if (c === 0x6c) { // l...e
    const list = [];
    i++;
    while (buf[i] !== 0x65) {
      const [v, next] = bdecode(buf, i);
      list.push(v);
      i = next;
    }
    return [list, i + 1];
  }
  if (c === 0x64) { // d...e
    const dict = {};
    const spans = {};
    i++;
    while (buf[i] !== 0x65) {
      const [k, afterKey] = bdecode(buf, i);
      const [v, next] = bdecode(buf, afterKey);
      const key = k.toString('latin1');
      dict[key] = v;
      spans[key] = [afterKey, next];
      i = next;
    }
    Object.defineProperty(dict, '_spans', { value: spans });
    return [dict, i + 1];
  }
  if (c >= 0x30 && c <= 0x39) { // <len>:<bytes>
    const colon = buf.indexOf(0x3a, i);
    const len = Number(buf.subarray(i, colon).toString());
    const start = colon + 1;
    return [buf.subarray(start, start + len), start + len];
  }
  throw new SmokeError(`invalid bencode at byte ${i}`);
}

const sha1 = (b) => createHash('sha1').update(b).digest();

// --- checks -----------------------------------------------------------------

async function checkVersion({ base, expectSha, shaFile }) {
  const { status, json } = await getJson(`${base}/health`);
  if (status !== 200 || json.status !== 'healthy' || json.database !== 'ok') {
    throw new SmokeError(`/health: HTTP ${status}, status=${json.status}, database=${json.database}`);
  }
  if (!json.sha) throw new SmokeError('/health reports no git SHA: the image was built without GIT_SHA');
  if (shaFile) writeFileSync(shaFile, `${json.sha}\n`);
  if (expectSha && !json.sha.startsWith(expectSha)) {
    throw new SmokeError(`/health reports ${json.sha}, expected ${expectSha}`);
  }
  return `sha ${json.sha.slice(0, 12)}, built ${json.buildTime ?? 'unknown'}`;
}

async function checkFeed({ base }) {
  const { status, json } = await getJson(`${base}/videos/feed`);
  if (status !== 200) throw new SmokeError(`/videos/feed: HTTP ${status}`);
  const items = Array.isArray(json) ? json : json.videos;
  if (!Array.isArray(items)) throw new SmokeError('/videos/feed: no videos array');
  if (items.length === 0) throw new SmokeError('/videos/feed: empty');
  for (const v of items) {
    if (!v.id || typeof v.magnetLink !== 'string' || typeof v.torrentFileUrl !== 'string') {
      throw new SmokeError(`/videos/feed: item ${v.id ?? '?'} lacks id, magnetLink or torrentFileUrl`);
    }
  }
  return items;
}

async function checkTurn({ base }) {
  const { status, json } = await getJson(`${base}/turn/credentials`);
  if (status !== 200 || !Array.isArray(json.iceServers)) {
    throw new SmokeError(`/turn/credentials: HTTP ${status}, no iceServers`);
  }
  const urls = (s) => [].concat(s.urls);
  const turn = json.iceServers.find((s) => urls(s).some((u) => /^turns?:/.test(u)));
  if (!turn) throw new SmokeError('/turn/credentials: no TURN server (is TURN_SECRET set?)');
  if (!turn.username || !turn.credential) throw new SmokeError('/turn/credentials: TURN server without credentials');
  return urls(turn).join(', ');
}

async function checkWebseed(item) {
  const magnet = new URLSearchParams(item.magnetLink.replace(/^magnet:\?/, ''));
  const btih = (magnet.get('xt') ?? '').match(/^urn:btih:([0-9a-fA-F]{40})$/)?.[1]?.toLowerCase();
  if (!btih) throw new SmokeError('magnet has no hex btih');
  const webseeds = magnet.getAll('ws');
  if (webseeds.length === 0) throw new SmokeError('magnet has no webseed (ws=)');

  const res = await get(item.torrentFileUrl);
  if (res.status !== 200) throw new SmokeError(`.torrent: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const [torrent] = bdecode(buf);
  const span = torrent._spans?.info;
  if (!span) throw new SmokeError('.torrent has no info dictionary');
  const infoHash = sha1(buf.subarray(span[0], span[1])).toString('hex');
  if (infoHash !== btih) throw new SmokeError(`.torrent info hash ${infoHash} doesn't match the magnet's ${btih}`);

  const { info } = torrent;
  if (info.files) throw new SmokeError('multi-file torrents are not supported by this check');
  const pieceLength = info['piece length'];
  const count = info.pieces.length / 20;
  if (!Number.isInteger(count) || count !== Math.ceil(info.length / pieceLength)) {
    throw new SmokeError('.torrent piece table is inconsistent with its length');
  }

  // BEP 19: a webseed URL ending in "/" names a directory holding the file.
  const failures = [];
  for (const ws of webseeds) {
    const url = ws.endsWith('/') ? ws + encodeURIComponent(info.name.toString()) : ws;
    for (const index of new Set([0, count - 1])) {
      const start = index * pieceLength;
      const end = Math.min(start + pieceLength, info.length) - 1;
      const piece = await get(url, { Range: `bytes=${start}-${end}` });
      if (piece.status !== 206 && piece.status !== 200) {
        failures.push(`${url}: HTTP ${piece.status} for piece ${index}`);
        continue;
      }
      let body = Buffer.from(await piece.arrayBuffer());
      if (piece.status === 200) body = body.subarray(start, end + 1); // server ignored Range
      if (!sha1(body).equals(info.pieces.subarray(index * 20, index * 20 + 20))) {
        failures.push(`${url}: piece ${index} fails its hash`);
      }
    }
  }
  if (failures.length) throw new SmokeError(failures.join('; '));
  return `${webseeds.length} webseed(s); pieces 0 and ${count - 1} of ${count} verified`;
}

// --- runner -----------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let failed = 0;
  const run = async (name, fn) => {
    try {
      const detail = await fn();
      console.log(`ok    ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      failed++;
      const msg = err instanceof SmokeError ? err.message : `unexpected error: ${err.stack ?? err}`;
      console.log(`FAIL  ${name} — ${msg}`);
    }
  };

  console.log(`smoke: ${opts.base}`);
  await run('version', () => checkVersion(opts));
  let items = [];
  await run('contract: feed', async () => {
    items = await checkFeed(opts);
    return `${items.length} item(s)`;
  });
  await run('contract: turn', () => checkTurn(opts));
  for (const item of items.slice(0, opts.maxItems)) {
    await run(`webseed: ${item.id}`, () => checkWebseed(item));
  }
  if (items.length > opts.maxItems) console.log(`(checked ${opts.maxItems} of ${items.length} feed items)`);
  console.log(failed ? `smoke: ${failed} check(s) failed` : 'smoke: all checks passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof SmokeError ? err.message : err);
  process.exitCode = 2;
});
