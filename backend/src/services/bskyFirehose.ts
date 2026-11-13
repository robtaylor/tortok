// Phase 3 Unit 2.5D: the inbound Bluesky bridge's firehose (Decisions 0010,
// 0023, 0024). Subscribes to `app.bsky.feed.post` on Jetstream, on its own socket
// and cursor (jetstream.ts), and indexes portrait or square video posts into
// `posts` with their video CID (the feed builds Bluesky's HLS URL from it)
// and no magnet.
//
// - Every candidate's self-labels go to `labels`, whatever happens to it.
// - A post self-labelled with a value in the NSFW set is not indexed, and an
//   edit that adds such a label removes it.
// - An author the engagement poller has recorded as opted out, or whose
//   labels mark them NSFW, is not indexed (bridgePolicy.ts), and a post from
//   one removes whatever bridged rows they still have. That holds for a day
//   after the poller last read them. After that their next post is indexed
//   like anyone's, so its first check reads them again and deletes it if
//   they are still excluded (Decision 0024 item 3).
// - Rows are indexed unchecked and due: the feed serves a bridged row only
//   once the poller has set bridge_qualified_at. An edit clears it and makes
//   the row due again, so the edited post waits for the poller.
// - indexed_at is this service's clock at indexing, and is what the poller
//   counts a post's age from (Decision 0024 item 2). An edit restarts it.
//
// Deletes remove the row; its labels stay (Decision 0023 item 2).

import { bridgeAspectMin, bridgeNsfwLabels } from '../config';
import { query as defaultQuery } from '../db';
import type { QueryFn } from '../db';
import { BSKY_POST_NSID, parseBskyVideoPost } from '../atproto/bskyPost';
import { replaceSelfLabels, selfLabels } from '../atproto/labels';
import { deleteBridged, deleteBridgedBy, exclusionStands, postExcluded } from './bridgePolicy';
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
  now?: () => Date;
}

const UPSERT_SQL = `
  INSERT INTO posts (
    at_uri, did, collection, rkey, cid, text, video_cid,
    width, height, hashtags, record_created_at, indexed_at, bridge_next_check_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
  ON CONFLICT (at_uri) DO UPDATE SET
    cid = EXCLUDED.cid, text = EXCLUDED.text, video_cid = EXCLUDED.video_cid,
    width = EXCLUDED.width, height = EXCLUDED.height,
    hashtags = EXCLUDED.hashtags, record_created_at = EXCLUDED.record_created_at,
    indexed_at = EXCLUDED.indexed_at, bridge_qualified_at = NULL,
    bridge_next_check_at = EXCLUDED.bridge_next_check_at
  WHERE posts.cid IS DISTINCT FROM EXCLUDED.cid
`;

export class BskyFirehose {
  private readonly db: QueryFn;
  private readonly jetstream: JetstreamSubscription;
  private readonly nsfwLabels: ReadonlySet<string>;
  private readonly aspectMin: number;
  private readonly now: () => Date;
  private statsTimer: NodeJS.Timeout | null = null;
  readonly stats = { indexed: 0, nsfw: 0, 'author-excluded': 0, deleted: 0 };

  constructor(opts: BskyFirehoseOptions = {}) {
    this.db = opts.db ?? defaultQuery;
    this.nsfwLabels = opts.nsfwLabels ?? bridgeNsfwLabels();
    this.aspectMin = opts.aspectMin ?? bridgeAspectMin();
    this.now = opts.now ?? (() => new Date());
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

    const now = this.now();
    const post = parseBskyVideoPost(did, c.record, this.aspectMin, now);
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
    // Every bridged row of an excluded author goes, as in the poller, which
    // only sees an author through their due rows. An exclusion the poller
    // hasn't confirmed lately isn't acted on here: the post is indexed,
    // unserved, and its first check reads the author again.
    if (await exclusionStands(this.db, did, this.nsfwLabels, now)) {
      this.stats['author-excluded']++;
      await deleteBridgedBy(this.db, [did]);
      return;
    }

    await this.db(UPSERT_SQL, [
      uri, did, BSKY_POST_NSID, rkey, c.cid, post.text, post.videoCid,
      post.width, post.height, post.hashtags, post.createdAt, now,
    ]);
    this.stats.indexed++;
  }
}

/** Build the service from the environment: `JETSTREAM_URL`, `BRIDGE_NSFW_LABELS`, `BRIDGE_ASPECT_MIN`. */
export function bskyFirehoseFromEnv(): BskyFirehose {
  return new BskyFirehose({ jetstreamUrl: process.env.JETSTREAM_URL || undefined });
}
