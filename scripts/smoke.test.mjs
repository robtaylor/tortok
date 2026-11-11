// Tests for scripts/smoke.mjs, run as a CLI against a stub backend:
//   npm run test:scripts
//
// The stub serves a real production torrent (fixtures/bbb-01.torrent, as
// published at content.tortok.net/test-content/ by
// scripts/seed-prod-test-content.mjs) and the clip it describes
// (test-content/clips/bbb-01.mp4), so the decoder meets create-torrent's
// actual output. 179 pieces of 16 KiB; the last is short.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./smoke.mjs', import.meta.url));
const TORRENT = readFileSync(new URL('./fixtures/bbb-01.torrent', import.meta.url));
const FILE = readFileSync(new URL('../test-content/clips/bbb-01.mp4', import.meta.url));
const BTIH = '2800ecd68564a29c14561b6d90fbce7d6de95825';

// Each test sets `state` to shape what the stub serves.
let state;
let base;
const defaults = () => ({
  health: { status: 'healthy', database: 'ok', sha: 'abc123def456', buildTime: '2026-11-11T00:00:00Z' },
  magnet: (b) => `magnet:?xt=urn:btih:${BTIH}&dn=bbb-01.mp4&ws=${encodeURIComponent(`${b}/files/bbb-01.mp4`)}`,
  file: FILE,
  ignoreRange: false,
  turn: { iceServers: [{ urls: 'stun:x:3478' }, { urls: 'turn:x:3478', username: 'u', credential: 'c' }] },
});

const server = createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return json(200, state.health);
  if (req.url === '/turn/credentials') return json(200, state.turn);
  if (req.url === '/videos/feed') {
    return json(200, { videos: [{ id: 'v1', magnetLink: state.magnet(base), torrentFileUrl: `${base}/files/bbb-01.torrent` }] });
  }
  if (req.url === '/files/bbb-01.torrent') {
    res.writeHead(200);
    return res.end(TORRENT);
  }
  if (req.url === '/files/bbb-01.mp4') {
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    if (!m || state.ignoreRange) {
      res.writeHead(200);
      return res.end(state.file);
    }
    res.writeHead(206);
    return res.end(state.file.subarray(Number(m[1]), Number(m[2]) + 1));
  }
  res.writeHead(404);
  res.end();
});

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function smoke(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, base, ...args], (err, stdout) => {
      resolve({ code: err ? err.code : 0, out: stdout });
    });
  });
}

test('passes against a correctly populated backend', async () => {
  state = defaults();
  const { code, out } = await smoke('--expect-sha', 'abc123');
  assert.equal(code, 0, out);
  assert.match(out, /ok {4}webseed: v1 — 1 webseed\(s\); pieces 0 and 178 of 179 verified/);
  assert.match(out, /all checks passed/);
});

test('verifies pieces when the webseed ignores Range', async () => {
  state = { ...defaults(), ignoreRange: true };
  const { code, out } = await smoke();
  assert.equal(code, 0, out);
});

test('fails a feed item whose magnet has no webseed', async () => {
  state = { ...defaults(), magnet: () => `magnet:?xt=urn:btih:${BTIH}&dn=bbb-01.mp4` };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /FAIL {2}webseed: v1 — magnet has no webseed \(ws=\)/);
});

test('fails when the webseed serves bytes that do not match the torrent', async () => {
  const bad = Buffer.from(FILE);
  bad[bad.length - 1] ^= 0xff;
  state = { ...defaults(), file: bad };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /piece 178 fails its hash/);
});

test("fails when the .torrent doesn't match the magnet's info hash", async () => {
  state = { ...defaults(), magnet: (b) => `magnet:?xt=urn:btih:${'0'.repeat(40)}&ws=${encodeURIComponent(`${b}/files/bbb-01.mp4`)}` };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /doesn't match the magnet's 0000/);
});

test('fails when the deployed SHA is not the expected one', async () => {
  state = defaults();
  const { code, out } = await smoke('--expect-sha', 'fff');
  assert.equal(code, 1);
  assert.match(out, /FAIL {2}version — \/health reports abc123def456, expected fff/);
});

test('fails when the image reports no SHA', async () => {
  state = { ...defaults(), health: { ...defaults().health, sha: null } };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /built without GIT_SHA/);
});

test('fails when Postgres is unreachable', async () => {
  state = { ...defaults(), health: { ...defaults().health, database: 'unreachable' } };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /FAIL {2}version — \/health: HTTP 200, status=healthy, database=unreachable/);
});

test('fails when TURN credentials are missing', async () => {
  state = { ...defaults(), turn: { iceServers: [{ urls: 'stun:x:3478' }] } };
  const { code, out } = await smoke();
  assert.equal(code, 1);
  assert.match(out, /no TURN server \(is TURN_SECRET set\?\)/);
});

test('writes the deployed SHA with --sha-file', async () => {
  state = defaults();
  const dir = mkdtempSync(join(tmpdir(), 'smoke-'));
  const { code } = await smoke('--sha-file', join(dir, 'sha'));
  assert.equal(code, 0);
  assert.equal(readFileSync(join(dir, 'sha'), 'utf8'), 'abc123def456\n');
});
