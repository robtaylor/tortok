// Spike: a throwaway PLC + PDS, a test account, app-password login, a
// tortok record with blobs, and tortok's own ingest backfilling it.
import { TestNetworkNoAppView } from '@atproto/dev-env';
import { AtpAgent } from '@atproto/api';
import { createRequire } from 'node:module';
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

const network = await TestNetworkNoAppView.create({
  plc: { port: 2582 },
  pds: { port: 2583, hostname: 'localhost' },
});
console.log('Q1 up:', network.plc.url, network.pds.url, ms());

// Q2: account with a password, then an app password, then a fresh login.
const admin = new AtpAgent({ service: network.pds.url });
const acct = await admin.createAccount({ handle: 'alice.test', email: 'alice@example.com', password: 'hunter2hunter2' });
const { data: ap } = await admin.com.atproto.server.createAppPassword({ name: 'detox' });
const logins = [];
for (let i = 0; i < 25; i++) {
  const a = new AtpAgent({ service: network.pds.url });
  await a.login({ identifier: 'alice.test', password: ap.password });
  logins.push(a);
}
console.log('Q2 did:', acct.data.did, '25 app-password logins ok', ms());

// Q3: a tortok record with poster and torrent blobs.
const agent = logins[0];
const thumb = (await agent.uploadBlob(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { encoding: 'image/jpeg' })).data.blob;
const torrent = (await agent.uploadBlob(new TextEncoder().encode('d4:infod6:lengthi1e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee'), { encoding: 'application/x-bittorrent' })).data.blob;
const ih = 'a'.repeat(40);
const rec = await agent.com.atproto.repo.createRecord({
  repo: acct.data.did, collection: 'app.tortok.video.post', validate: false,
  record: { $type: 'app.tortok.video.post', magnetUri: `magnet:?xt=urn:btih:${ih}`, infoHash: ih, durationMs: 20000,
    caption: 'spike', thumbnailBlob: thumb, torrentBlob: torrent, createdAt: new Date().toISOString() },
});
console.log('Q3 record:', rec.data.uri, 'torrent mime', torrent.mimeType, ms());

// Q4: tortok ingest, with only its PLC URL changed, backfills the record.
process.env.DATABASE_URL = process.env.SPIKE_DB_URL ?? 'postgresql://localhost:5432/tortok_pds_spike';
const req = createRequire(new URL('../backend/package.json', import.meta.url));
const db = req('./dist/db');
const { AtprotoIngest } = req('./dist/services/atprotoIngest');
const { IdentityResolver } = req('./dist/atproto/identity');
await db.initializeDatabase();
const ingest = new AtprotoIngest({
  identity: new IdentityResolver({ plcDirectory: network.plc.url }),
  wsFactory: () => ({ on() {}, close() {} }), // no Jetstream: a local PDS isn't on the relay
});
await ingest.backfill(acct.data.did);
console.log('Q4 posts:', await db.query('SELECT at_uri, torrent_cid IS NOT NULL AS t FROM posts'));
console.log('Q4 profile:', await db.query('SELECT handle, pds_endpoint FROM profiles'), ms());

// Blob fetch through the PDS, as the 2.5B blob route will do it.
const blobRes = await fetch(`${network.pds.url}/xrpc/com.atproto.sync.getBlob?did=${acct.data.did}&cid=${torrent.ref.toString()}`);
console.log('blob:', blobRes.status, blobRes.headers.get('content-type'), ms());

// Q5 (for the app): does the PDS serve OAuth metadata?
const oauth = await fetch(`${network.pds.url}/.well-known/oauth-authorization-server`);
console.log('Q5 oauth metadata:', oauth.status);

await db.closeDatabase();
await network.close();
console.log('done', ms());
