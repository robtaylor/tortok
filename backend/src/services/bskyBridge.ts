// The Bluesky bridge as one service (Decision 0023): the firehose indexes
// candidates, the poller decides which reach the feed. index.ts starts and
// stops it as a unit, alongside atproto ingest.

import { envBool } from '../config';
import { BskyFirehose, bskyFirehoseFromEnv } from './bskyFirehose';
import { BskyEngagementPoller, bskyEngagementPollerFromEnv } from './bskyEngagementPoller';

export class BskyBridge {
  constructor(private readonly firehose: BskyFirehose, private readonly poller: BskyEngagementPoller) {}

  /** Reads the firehose's cursor and subscribes, then starts polling. Throws only if Postgres does. */
  async start(): Promise<void> {
    await this.firehose.start();
    this.poller.start();
  }

  /** Saves the firehose's cursor and lets the poller finish its batch. */
  async stop(): Promise<void> {
    await Promise.all([this.firehose.stop(), this.poller.stop()]);
  }
}

/**
 * The bridge if `BRIDGE_ENABLED` is `true`, else null. It defaults to false,
 * so dev, e2e and a fresh deploy don't index Bluesky until asked to; it is
 * also the bridge's off switch.
 */
export function bridgeFromEnv(): BskyBridge | null {
  if (!envBool('BRIDGE_ENABLED', false)) return null;
  return new BskyBridge(bskyFirehoseFromEnv(), bskyEngagementPollerFromEnv());
}
