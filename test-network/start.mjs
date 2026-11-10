// test-network/start.mjs
//
// A throwaway atproto network for end-to-end tests: a PLC directory and a PDS
// from Bluesky's own test harness (@atproto/dev-env), plus one test account
// with an app password. See
// docs/architecture/decisions/spikes/test-pds-in-ci.md.
//
// Writes the account and service URLs to $E2E_NETWORK_FILE (default
// /tmp/tortok-e2e/network.json) once everything is up, then runs until it
// gets SIGTERM or SIGINT. Nothing persists: PLC is in memory and the PDS
// uses a temporary directory.
//
// Usage: node start.mjs   (Node 22+, after `npm ci` in this directory)

import fs from 'node:fs';
import path from 'node:path';
import { TestNetworkNoAppView } from '@atproto/dev-env';
import { AtpAgent } from '@atproto/api';

const PLC_PORT = Number(process.env.E2E_PLC_PORT ?? 2582);
const PDS_PORT = Number(process.env.E2E_PDS_PORT ?? 2583);
const OUT = process.env.E2E_NETWORK_FILE ?? '/tmp/tortok-e2e/network.json';
const HANDLE = 'alice.test';

const network = await TestNetworkNoAppView.create({
  plc: { port: PLC_PORT },
  pds: { port: PDS_PORT, hostname: 'localhost' },
});

const agent = new AtpAgent({ service: network.pds.url });
const { data: account } = await agent.createAccount({
  handle: HANDLE,
  email: 'alice@example.com',
  // Random per run; tests sign in with the app password below.
  password: crypto.randomUUID(),
});
const { data: appPassword } = await agent.com.atproto.server.createAppPassword({ name: 'detox' });

const info = {
  plcUrl: network.plc.url,
  pdsUrl: network.pds.url,
  did: account.did,
  handle: HANDLE,
  appPassword: appPassword.password,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(info, null, 2));
console.log(`test network up: PLC ${info.plcUrl}, PDS ${info.pdsUrl}, ${HANDLE} = ${info.did}`);
console.log(`wrote ${OUT}`);

async function shutdown() {
  await network.close();
  fs.rmSync(OUT, { force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
