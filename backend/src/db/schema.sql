-- TorTok Metadata Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    bio TEXT,
    avatar_url TEXT,
    instance_domain VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(username, instance_domain),
    UNIQUE(email, instance_domain)
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT NOT NULL,
    magnet_link TEXT NOT NULL,
    hls_url TEXT,
    poster_url TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    like_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hashtags table
CREATE TABLE IF NOT EXISTS hashtags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Video hashtags junction table
CREATE TABLE IF NOT EXISTS video_hashtags (
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    hashtag_id UUID NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, hashtag_id)
);

-- Follows table
CREATE TABLE IF NOT EXISTS follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    follower_instance VARCHAR(255),
    followed_instance VARCHAR(255),
    is_remote BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(follower_id, followed_id)
);

-- Likes table
CREATE TABLE IF NOT EXISTS likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, video_id)
);

-- Views table (for analytics)
CREATE TABLE IF NOT EXISTS views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    watched_duration INTEGER,
    completion_rate DECIMAL(3,2),
    source VARCHAR(50), -- 'p2p', 'http', 'cache'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followed_id ON follows(followed_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_video_id ON likes(video_id);
CREATE INDEX IF NOT EXISTS idx_views_video_id ON views(video_id);
CREATE INDEX IF NOT EXISTS idx_views_created_at ON views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hashtags_name ON hashtags(name);

-- Update follower/following counts (triggers)
CREATE OR REPLACE FUNCTION update_user_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Increment counts
        UPDATE users SET follower_count = follower_count + 1 WHERE id = NEW.followed_id;
        UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSIF TG_OP = 'DELETE' THEN
        -- Decrement counts
        UPDATE users SET follower_count = follower_count - 1 WHERE id = OLD.followed_id;
        UPDATE users SET following_count = following_count - 1 WHERE id = OLD.follower_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add torrent_file_url column (ADR-009 optimization: inline .torrent metadata)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS torrent_file_url TEXT;

-- Rename thumbnail_url → poster_url (it's a full-res still frame, not a thumbnail)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'videos' AND column_name = 'thumbnail_url') THEN
    ALTER TABLE videos RENAME COLUMN thumbnail_url TO poster_url;
  END IF;
END $$;

-- Add count columns if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS video_count INTEGER DEFAULT 0;

DROP TRIGGER IF EXISTS update_user_counts_trigger ON follows;
CREATE TRIGGER update_user_counts_trigger
AFTER INSERT OR DELETE ON follows
FOR EACH ROW EXECUTE FUNCTION update_user_counts();

-- Update video count trigger
CREATE OR REPLACE FUNCTION update_video_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users SET video_count = video_count + 1 WHERE id = NEW.user_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users SET video_count = video_count - 1 WHERE id = OLD.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_video_count_trigger ON videos;
CREATE TRIGGER update_video_count_trigger
AFTER INSERT OR DELETE ON videos
FOR EACH ROW EXECUTE FUNCTION update_video_count();

-- ─── Phase 3 Unit 2.5 — inbound Bluesky bridge (ADR-010 + ADR-010-A) ───
-- Indexes posts from Bluesky's Jetstream that match the v1 filter stack
-- (aspect ratio + opt-out + popularity + labelers). Mirror-state machine
-- governs which rows surface in the feed:
--   pending  — passed index filters, awaiting engagement promotion
--   mirrored — promoted, bytes copied to R2, magnet generated
--   declined — never qualified within decline window
--   expired  — mirror decayed (re-mirror on re-promotion)
-- Only `mirrored` rows appear in the feed (single-playback-path
-- invariant). Engagement + mirror columns null/default until the
-- engagement poller and mirror pipeline (later slices) populate them.
-- Schema separate from `videos` per ADR-010-A; Unit 4 may merge later.
CREATE TABLE IF NOT EXISTS bridged_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Identity / dedup
    bsky_at_uri TEXT NOT NULL UNIQUE,
    bsky_did TEXT NOT NULL,
    bsky_handle TEXT,
    bsky_display_name TEXT,
    bsky_avatar_url TEXT,
    -- Record content
    text TEXT,
    video_cid TEXT NOT NULL,
    video_bsky_playlist_url TEXT NOT NULL,
    poster_url TEXT,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    aspect_ratio_w INTEGER,
    aspect_ratio_h INTEGER,
    -- Filter signals (opt-out check stubbed in this slice — always-false)
    author_excluded BOOLEAN DEFAULT FALSE,
    -- Timestamps
    record_created_at TIMESTAMPTZ,
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    -- Engagement (poller writes; null until first poll)
    like_count INTEGER,
    repost_count INTEGER,
    reply_count INTEGER,
    author_followers_count INTEGER,
    engagement_polled_at TIMESTAMPTZ,
    -- Mirror state machine
    mirror_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (mirror_state IN ('pending', 'mirrored', 'declined', 'expired')),
    mirrored_at TIMESTAMPTZ,
    r2_path TEXT,
    magnet_link TEXT,
    torrent_file_url TEXT,
    last_played_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bridged_posts_state_indexed_at
    ON bridged_posts(mirror_state, indexed_at);
CREATE INDEX IF NOT EXISTS idx_bridged_posts_state_record_created_at
    ON bridged_posts(mirror_state, record_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridged_posts_bsky_did
    ON bridged_posts(bsky_did);
CREATE INDEX IF NOT EXISTS idx_bridged_posts_state_last_played_at
    ON bridged_posts(mirror_state, last_played_at);

-- Single-row table for the Jetstream cursor (atproto `time_us` value).
-- Persisted as TEXT to side-step int width concerns on BIGINT-ish values.
-- Cursor is updated AFTER successful inserts so a crash mid-insert
-- replays from the last committed event on restart.
CREATE TABLE IF NOT EXISTS bridge_cursor (
    key TEXT PRIMARY KEY,
    cursor TEXT,
    updated_at TIMESTAMPTZ
);
