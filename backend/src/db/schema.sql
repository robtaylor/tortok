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
    hls_url TEXT,                           -- app.bsky rows (Decision 0010)
    record_created_at TIMESTAMPTZ NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_collection_created
    ON posts (collection, record_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_did ON posts (did);
CREATE INDEX IF NOT EXISTS idx_posts_info_hash ON posts (info_hash);

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
