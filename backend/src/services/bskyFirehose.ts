// Phase 3 Unit 2.5D: the inbound Bluesky bridge's firehose (Decisions 0010,
// 0023). Subscribes to `app.bsky.feed.post` on Jetstream, on its own socket
// and cursor (jetstream.ts), and indexes portrait or square video posts into
// `posts` with their video CID (the feed builds Bluesky's HLS URL from it)
// and no magnet.
//
// - Every candidate's self-labels go to `labels`, whatever happens to it.
// - A post self-labelled with a value in the NSFW set is not indexed, and an
//   edit that adds such a label removes it.
// - An author the engagement poller has recorded as opted out, or whose
//   labels mark them NSFW, is not indexed (bridgePolicy.ts).
// - Rows are indexed unchecked and due: the feed serves a bridged row only
//   once the poller has set bridge_qualified_at. An edit clears it and makes
//   the row due again, so the edited post waits for the poller.
//
// Deletes remove the row; its labels stay (Decision 0023 item 2).

import { bridgeAspectMin, bridgeNsfwLabels } from '../config';
import { query as defaultQuery } from '../db';
import type { QueryFn } from '../db';
import { BSKY_POST_NSID, parseBskyVideoPost } from '../atproto/bskyPost';
import { replaceSelfLabels, selfLabels } from '../atproto/labels';
import { authorExcluded, deleteBridged, postExcluded } from './bridgePolicy';
import { JetstreamSubscription, parseCommit } from './jetstream';
import type { JetstreamEvent, WebSocketLike } from './jetstream';
const CURSOR_KEY = 'jetstream-bsky-posts';
const STATS_EVERY_MS = 15 * 60_000;

export interface BskyFirehoseOptions {
  db?: QueryFn;
  wsFactory?: (url: string) => WebSocketLike;
  /** Jetstream subscribe endpoint, without query string. */
  jetstreamUrl?: string;
  cursorFlushMs?: number;
  nsfwLabels?: ReadonlySet<string>;
  /** Minimum height/width (1 = square or portrait). */
  aspectMin?: number;
}

const UPSERT_SQL = `
  INSERT INTO posts (
    at_uri, did, collection, rkey, cid, text, video_cid,
    width, height, hashtags, record_created_at, bridge_next_check_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
  ON CONFLICT (at_uri) DO UPDATE SET
    cid = EXCLUDED.cid, text = EXCLUDED.text, video_cid = EXCLUDED.video_cid,
    width = EXCLUDED.width, height = EXCLUDED.height,
    hashtags = EXCLUDED.hashtags, record_created_at = EXCLUDED.record_created_at,
    indexed_at = NOW(), bridge_qualified_at = NULL, bridge_next_check_at = NOW()
  WHERE posts.cid IS DISTINCT FROM EXCLUDED.cid
`;


export class BskyFirehose {
  private readonly db: QueryFn;
  private readonly jetstream: JetstreamSubscription;
  private readonly nsfwLabels: ReadonlySet<string>;
  private readonly aspectMin: number;
  private statsTimer: NodeJS.Timeout | null = null;
  readonly stats = { indexed: 0, nsfw: 0, 'author-excluded': 0, deleted: 0 };

  constructor(opts: BskyFirehoseOptions = {}) {
    this.db = opts.db ?? defaultQuery;
    this.nsfwLabels = opts.nsfwLabels ?? bridgeNsfwLabels();
    this.aspectMin = opts.aspectMin ?? bridgeAspectMin();
    this.jetstream = new JetstreamSubscription({
      tag: 'bridge', collections: [BSKY_POST_NSID], cursorKey: CURSOR_KEY,
      onEvent: (e) => this.handleEvent(e), db: this.db, wsFactory: opts.wsFactory,
      url: opts.jetstreamUrl, cursorFlushMs: opts.cursorFlushMs,
    });
  }

  async start(): Promise<void> {
    await this.jetstream.start();
    this.statsTimer = setInterval(() => this.logStats(), STATS_EVERY_MS);
    console.log(`[bridge] started: aspect >= ${this.aspectMin}, NSFW labels ${[...this.nsfwLabels].join(',')}`);
  }

  async stop(): Promise<void> {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    await this.jetstream.stop();
    this.logStats();
  }

  private logStats(): void {
    console.log(`[bridge] ${Object.entries(this.stats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  /** Handle one Jetstream event. Public so tests can drive it directly. */
  async handleEvent(event: JetstreamEvent): Promise<void> {
    const c = parseCommit(event, BSKY_POST_NSID);
    if (!c) return;
    const { did, rkey, uri } = c;

    // Most deletes on the stream are of posts the bridge never indexed.
    if (c.operation === 'delete') {
      if (await deleteBridged(this.db, uri)) this.stats.deleted++;
      return;
    }

    const post = parseBskyVideoPost(did, c.record, this.aspectMin);
    if (typeof post === 'string') {
      // An edit can take a post out of the candidates (Bluesky has no edits
      // yet, but the protocol allows them).
      if (c.operation === 'update') await deleteBridged(this.db, uri);
      return;
    }

    const labels = selfLabels(uri, did, c.record, post.createdAt);
    await replaceSelfLabels(this.db, uri, did, labels);
    if (await postExcluded(this.db, uri, this.nsfwLabels)) {
      this.stats.nsfw++;
      await deleteBridged(this.db, uri);
      return;
    }
    // Author state comes from the engagement poller, which reads profiles.
    if (await authorExcluded(this.db, did, this.nsfwLabels)) {
      this.stats['author-excluded']++;
      await deleteBridged(this.db, uri);
      return;
    }

    await this.db(UPSERT_SQL, [
      uri, did, BSKY_POST_NSID, rkey, c.cid, post.text, post.videoCid,
      post.width, post.height, post.hashtags, post.createdAt,
    ]);
    this.stats.indexed++;
  }
}

/** Build the service from the environment: `JETSTREAM_URL`, `BRIDGE_NSFW_LABELS`, `BRIDGE_ASPECT_MIN`. */
export function bskyFirehoseFromEnv(): BskyFirehose {
  return new BskyFirehose({ jetstreamUrl: process.env.JETSTREAM_URL || undefined });
}
