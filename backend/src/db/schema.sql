-- TorTok Metadata Database Schema

-- Phase 3 Unit 2.5C: drop the legacy native tables. Content reaches the
-- AppView only through atproto now (posts, below). views goes too: its
-- UUID video_id pointed at videos, and Phase 4 designs view storage afresh
-- (open-problems/view-counting.md).
--
-- This file runs on every boot, and later phases may well reuse names such
-- as likes, follows or views. So each table is dropped only while it still
-- has a column that only its legacy shape had; a new table of the same
-- name is left alone. Children before parents; DROP TABLE takes each
-- table's triggers with it.
DO $$
DECLARE
    legacy RECORD;
BEGIN
    FOR legacy IN SELECT * FROM (VALUES
        (1, 'views', 'watched_duration'),
        (2, 'likes', 'video_id'),
        (3, 'video_hashtags', 'hashtag_id'),
        (4, 'hashtags', 'usage_count'),
        (5, 'follows', 'follower_instance'),
        (6, 'videos', 'poster_url'),
        (7, 'users', 'password_hash')
    ) AS t(ord, tbl, col) ORDER BY ord
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema()
                     AND table_name = legacy.tbl AND column_name = legacy.col) THEN
            EXECUTE format('DROP TABLE %I', legacy.tbl);
        END IF;
    END LOOP;
END $$;
DROP FUNCTION IF EXISTS update_user_counts();
DROP FUNCTION IF EXISTS update_video_count();

-- Unit 2.5 (v2) Phase 0: drop attempt-1 bridge tables. Main is reset
-- to pre-attempt-1, but dev DBs still carry these tables; running the
-- schema on boot will drop them. Safe to keep here permanently — the
-- DROPs are idempotent and these table names will not be reused.
DROP TABLE IF EXISTS bridged_posts;
DROP TABLE IF EXISTS bridge_cursor;

-- Phase 3 Unit 2.5A: atproto-native index (Decision 0017). Everything
-- below is rebuildable from the network except ingest_cursor and
-- known_accounts, which are operator-local (Decision 0017 item 2).

-- One row per indexed post record. Blobs are stored as CIDs; the feed
-- builds URLs on the AppView's blob route at read time.
CREATE TABLE IF NOT EXISTS posts (
    at_uri TEXT PRIMARY KEY,                -- at://did/collection/rkey
    did TEXT NOT NULL,
    collection TEXT NOT NULL,               -- 'app.tortok.video.post' | 'app.bsky.feed.post'
    rkey TEXT NOT NULL,
    cid TEXT NOT NULL,                      -- record CID; a change means an edit
    text TEXT,                              -- caption
    video_cid TEXT,                         -- bridged posts: the video blob
    thumbnail_cid TEXT,                     -- poster blob
    duration_ms INTEGER,
    width INTEGER,                          -- the record's aspectRatio
    height INTEGER,
    hashtags TEXT[],
    magnet_link TEXT,                       -- app.tortok rows
    info_hash TEXT,
    torrent_cid TEXT,                       -- torrentBlob (Decision 0020)
    record_created_at TIMESTAMPTZ NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_collection_created
    ON posts (collection, record_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_did ON posts (did);
CREATE INDEX IF NOT EXISTS idx_posts_info_hash ON posts (info_hash);

-- Unit 2.5D: bridged app.bsky.feed.post rows (Decision 0023). The firehose
-- indexes them unchecked and due (bridge_next_check_at = now). The
-- engagement poller sets bridge_checked_at each time it re-reads the post
-- from Bluesky's AppView, bridge_next_check_at for when it should next, and
-- bridge_qualified_at once the post has passed the NSFW and opt-out checks
-- and an engagement threshold. The feed serves a bridged row only once
-- bridge_qualified_at is set, and only while bridge_next_check_at is less
-- than a day past (Decision 0025). Every bridged row has a check due, until
-- the poller deletes it (Decision 0024). All three stay NULL on app.tortok
-- rows.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bridge_checked_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bridge_qualified_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS bridge_next_check_at TIMESTAMPTZ;
-- The poller's queue: bridged rows by when they're due. Replaces the first
-- version's index on bridge_checked_at.
DROP INDEX IF EXISTS idx_posts_bridge_checked;
-- hls_url was a stored copy of the playlist URL the feed builds from
-- video_cid; it was never read, and no bridged row existed when it went.
ALTER TABLE posts DROP COLUMN IF EXISTS hls_url;
CREATE INDEX IF NOT EXISTS idx_posts_bridge_due
    ON posts (bridge_next_check_at) WHERE collection = 'app.bsky.feed.post';
-- Before Decision 0024 the poller cleared bridge_next_check_at on a served
-- row 30 days after its createdAt, and never looked at it again. Any such row
-- goes back in the queue, where the poller deletes it or carries on checking.
-- Its check counts as due since the epoch, not since now: the feed serves a
-- row for a day after its check falls due (Decision 0025), and this one
-- hasn't been read.
UPDATE posts SET bridge_next_check_at = 'epoch'
 WHERE collection = 'app.bsky.feed.post' AND bridge_next_check_at IS NULL;
-- The feed: servable rows only (native posts with a magnet, qualified bridged
-- posts), in feed order, so a page reads its own rows and not the hundreds of
-- thousands of unqualified bridged ones. Its predicate is the first
-- condition of feedView.ts's WHERE clause, word for word.
CREATE INDEX IF NOT EXISTS idx_posts_feed
    ON posts (record_created_at DESC, at_uri)
    WHERE ((collection = 'app.tortok.video.post' AND magnet_link IS NOT NULL)
       OR (collection = 'app.bsky.feed.post' AND bridge_qualified_at IS NOT NULL AND video_cid IS NOT NULL));

-- Authors of bridged posts, as Bluesky's AppView describes them
-- (app.bsky.actor.getProfiles), refreshed by the engagement poller. Kept
-- apart from `profiles`, which ingest resolves from the author's own DID
-- document and PDS, so the bridge never overwrites a native author's row.
-- nobridge is Decision 0023 item 4's text signal, #nobridge in the bio or
-- display name; its label signal, !no-unauthenticated, is in `labels`.
CREATE TABLE IF NOT EXISTS bridge_authors (
    did TEXT PRIMARY KEY,
    handle TEXT,                            -- NULL when the AppView reports handle.invalid
    display_name TEXT,
    avatar_url TEXT,                        -- Bluesky's CDN
    followers_count INTEGER,
    nobridge BOOLEAN NOT NULL DEFAULT FALSE,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every label the AppView sees, whatever happens to its subject (Decision
-- 0023 item 2): self-labels from records and profiles, and labels from
-- labelers on getPosts responses. Policy, such as not indexing NSFW bridged
-- posts, is applied over this table, never by leaving labels out of it.
-- Columns follow com.atproto.label.defs#label; one row per (subject,
-- subject_cid, src, val), holding the latest label, so a negation replaces
-- what it negates. subject_cid is '' for a label on the whole subject, as in
-- Bluesky's AppView, so it can be part of the key.
CREATE TABLE IF NOT EXISTS labels (
    subject TEXT NOT NULL,                  -- the label's uri: an AT-URI or a DID
    src TEXT NOT NULL,                      -- labeler DID; the author's DID for self-labels
    val TEXT NOT NULL,
    neg BOOLEAN NOT NULL DEFAULT FALSE,
    subject_cid TEXT NOT NULL DEFAULT '',   -- one version of a record, or '' for the whole subject
    cts TIMESTAMPTZ NOT NULL,               -- when the label was made
    exp TIMESTAMPTZ,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subject, subject_cid, src, val)
);

-- Authors, resolved from their DID document and their PDS's
-- app.bsky.actor.profile record. handle is NULL when it doesn't verify.
CREATE TABLE IF NOT EXISTS profiles (
    did TEXT PRIMARY KEY,
    handle TEXT,
    display_name TEXT,
    avatar_cid TEXT,
    pds_endpoint TEXT,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Operator-local: where ingest resumes the Jetstream stream (time_us).
CREATE TABLE IF NOT EXISTS ingest_cursor (
    key TEXT PRIMARY KEY,
    cursor BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Operator-local: accounts backfilled with listRecords on boot.
-- source is how the DID became known: 'jetstream' or 'seed'.
CREATE TABLE IF NOT EXISTS known_accounts (
    did TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
