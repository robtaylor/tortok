// An express router on an ephemeral port, mounted as index.ts mounts it, for
// tests that call a route over HTTP.

import express from 'express';
import type { Router } from 'express';
import type { AddressInfo } from 'net';

export interface TestServer {
  /** The server's origin, e.g. http://127.0.0.1:54321. */
  base: string;
  getJson(path: string): Promise<{ status: number; body: any }>;
  close(): void;
}

export function startServer(mount: string, router: Router): TestServer {
  const app = express();
  app.use(mount, router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    async getJson(path) {
      const res = await fetch(`${base}${path}`);
      return { status: res.status, body: await res.json() };
    },
    close: () => { server.close(); },
  };
}

/**
 * The /videos routes, on the real clock unless given another. Call it after
 * createTestDb(): the routes load ../../db, which reads DATABASE_URL when
 * first imported.
 */
export async function startFeedServer(now?: () => Date): Promise<TestServer> {
  return startServer('/videos', (await import('../../routes/videos')).createVideosRouter({ now }));
}

/** The rkeys of a feed response's items, in the order served. */
export const feedRkeys = (body: { videos: { id: string }[] }): string[] =>
  body.videos.map((v) => v.id.split('/').pop()!);
