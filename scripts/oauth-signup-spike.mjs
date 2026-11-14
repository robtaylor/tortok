// scripts/oauth-signup-spike.mjs
//
// Spike: creating a Bluesky account inside the sign-in flow
// (docs/architecture/decisions/spikes/creating-a-bluesky-account-inside-the-sign-in-flow.md).
//
// Does an atproto OAuth sign-in with `prompt=create` open the server's
// account-creation page, and does the flow then return to the client signed
// in as the new account?
//
// Usage (Node 22+, after `npm ci` in tortok/):
//
//   node scripts/oauth-signup-spike.mjs url [entryway]
//     Push the authorization request the tortok app would send (its own
//     client_id and app.tortok: redirect, display=touch, prompt=create) and
//     print the URL the app would open. Nothing is created.
//
//   node scripts/oauth-signup-spike.mjs loopback [entryway] [port]
//     The same request from a development loopback client, with a local
//     server on the redirect (port 8765 unless given). Open the printed URL
//     in a browser and finish the sign-up there; the script exchanges the
//     code, prints the new account's DID and handle, and revokes the
//     session. No tokens are printed or stored. SPIKE_OPEN=1 opens the URL
//     in the default browser (macOS).
//
// The entryway defaults to https://bsky.social. A loopback run there creates
// a real Bluesky account.
//
// Against the local test network (test-network/start.mjs), pass its PDS as
// the entryway and set SPIKE_PLC_URL=http://localhost:2582.
//
// It drives the app's own OAuth library, with keys and state held in memory.
// The three packages below aren't in tortok/package.json: they come with
// @atproto/oauth-client-expo.

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../tortok', import.meta.url));
const require = createRequire(`${APP_DIR}/package.json`);
const { OAuthClient } = require('@atproto/oauth-client');
const { JoseKey } = require('@atproto/jwk-jose');
const { buildAtprotoLoopbackClientMetadata } = require('@atproto/oauth-types');

const [mode, entryway = 'https://bsky.social'] = process.argv.slice(2);
// A bare host would be resolved as a handle, and sent as a login_hint.
if (!/^https?:\/\//.test(entryway)) throw new Error(`entryway must be an http(s) URL, got ${entryway}`);
/** The app's own client metadata. */
const APP_METADATA = JSON.parse(readFileSync(`${APP_DIR}/assets/oauth-client-metadata.json`, 'utf8'));

function memoryStore() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); } };
}

function makeClient(clientMetadata) {
  return new OAuthClient({
    responseMode: 'query',
    clientMetadata,
    // Required, and unused here: a server address is not resolved as a handle.
    handleResolver: 'https://bsky.social',
    allowHttp: entryway.startsWith('http://'),
    plcDirectoryUrl: process.env.SPIKE_PLC_URL || undefined,
    runtimeImplementation: {
      createKey: (algs) => JoseKey.generate(algs),
      getRandomValues: (n) => crypto.getRandomValues(new Uint8Array(n)),
      digest: (bytes, alg) => new Uint8Array(crypto.createHash(alg.name).update(bytes).digest()),
    },
    stateStore: memoryStore(),
    sessionStore: memoryStore(),
  });
}

// What ExpoOAuthClient.signIn(entryway, { prompt: 'create' }) adds to the request.
const APP_OPTIONS = { prompt: 'create', display: 'touch' };

/** Push the authorization request; returns the URL to open. */
async function authorize(client, redirectUri) {
  const url = await client.authorize(entryway, { ...APP_OPTIONS, redirect_uri: redirectUri });
  // Without a PAR endpoint the library builds the URL itself and the server has seen nothing.
  if (!url.searchParams.has('request_uri')) throw new Error(`${entryway} took no pushed request`);
  return url;
}

if (mode === 'url') {
  console.log((await authorize(makeClient(APP_METADATA), 'app.tortok:/auth/callback')).toString());
} else if (mode === 'loopback') {
  const port = Number(process.argv[4] ?? 8765);
  const redirect = `http://127.0.0.1:${port}/callback`;
  const client = makeClient(buildAtprotoLoopbackClientMetadata({ scope: APP_METADATA.scope, redirect_uris: [redirect] }));
  const url = await authorize(client, redirect);
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
    console.log(`callback params: ${[...u.searchParams.keys()].join(', ')}`);
    try {
      const { session } = await client.callback(u.searchParams, { redirect_uri: redirect });
      const info = await session.getTokenInfo();
      const r = await session.fetchHandler(`/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(session.sub)}`);
      const handle = r.ok ? (await r.json()).handle : `(describeRepo failed: ${r.status})`;
      const line = `signed in: did=${session.sub} handle=${handle} pds=${info.aud} scope="${info.scope}"`;
      console.log(line);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`The spike got a session.\n${line}\nYou can close this tab.\n`);
      // The spike has what it came for: give the grant back.
      await session.signOut().then(
        () => console.log('session revoked'),
        (err) => console.log(`session not revoked: ${err?.message ?? err}`),
      );
    } catch (err) {
      console.log(`callback failed: ${err?.message ?? err}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end(`The spike could not finish: ${err?.message ?? err}\n`);
    } finally {
      // The browser may keep its connection open; don't wait for it.
      server.close();
      server.closeAllConnections();
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`open this in a browser and finish the sign-up there:\n${url}\n\nwaiting on ${redirect} ...`);
    if (process.env.SPIKE_OPEN === '1') execFile('open', [url.toString()]);
  });
} else {
  console.error('usage: node scripts/oauth-signup-spike.mjs url|loopback [entryway] [port]');
  process.exit(2);
}
