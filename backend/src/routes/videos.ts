import { Router, Response } from 'express';
import { query, getClient } from '../db';
import { AuthRequest, authenticateJWT, optionalAuth } from '../middleware/auth';
import { validate, schemas } from '../middleware/validate';

const router = Router();

/**
 * POST /videos
 * Create a new video
 */
router.post('/', authenticateJWT, validate(schemas.createVideo), async (req: AuthRequest, res: Response) => {
  const client = await getClient();

  try {
    const { caption, magnetLink, torrentFileUrl, posterUrl, durationSeconds, width, height, hashtags } = req.body;
    const userId = req.user!.userId;

    await client.query('BEGIN');

    // Create video
    const videos = await client.query<any>(
      `INSERT INTO videos (user_id, caption, magnet_link, torrent_file_url, poster_url, duration_seconds, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, caption, magnet_link, torrent_file_url, poster_url,
                 duration_seconds, width, height, like_count, view_count, created_at`,
      [userId, caption, magnetLink, torrentFileUrl || null, posterUrl, durationSeconds, width, height]
    );

    const video = videos.rows[0];

    // Process hashtags
    if (hashtags && hashtags.length > 0) {
      for (const tag of hashtags) {
        // Insert or get hashtag
        const result = await client.query<any>(
          `INSERT INTO hashtags (name, usage_count)
           VALUES ($1, 1)
           ON CONFLICT (name) DO UPDATE SET usage_count = hashtags.usage_count + 1
           RETURNING id`,
          [tag.toLowerCase()]
        );

        const hashtagId = result.rows[0].id;

        // Link video to hashtag
        await client.query(
          'INSERT INTO video_hashtags (video_id, hashtag_id) VALUES ($1, $2)',
          [video.id, hashtagId]
        );
      }
    }

    await client.query('COMMIT');

    // Get user info
    const users = await query<any>('SELECT username, display_name, avatar_url FROM users WHERE id = $1', [userId]);
    const user = users[0];

    res.status(201).json({
      id: video.id,
      user: {
        id: userId,
        username: user.username,
        displayName: user.display_name,
        avatarURL: user.avatar_url,
      },
      caption: video.caption,
      magnetLink: video.magnet_link,
      torrentFileUrl: video.torrent_file_url,
      posterURL: video.poster_url,
      durationSeconds: video.duration_seconds,
      width: video.width,
      height: video.height,
      hashtags: hashtags || [],
      likeCount: 0,
      isLiked: false,
      createdAt: video.created_at,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /feed
 * Get video feed — UNIONs native `videos` rows with mirrored
 * `bridged_posts` rows (Phase 3 Unit 2.5, ADR-010-A). Single
 * playback path: bridged content is already mirrored to R2 with a
 * magnet by slice 3, so the client renders both shapes through the
 * same WebTorrent + expo-video pipeline. The `source` discriminator
 * + `bsky` sub-object are the only client-visible difference.
 *
 * `mirror_state = 'mirrored'` is the load-bearing filter on the
 * bridged side — pending/expired/declined rows MUST NOT appear in
 * the feed (preserves the single-playback-path invariant; magnets
 * for non-mirrored rows are null/stale).
 */
router.get('/feed', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = req.user?.userId;

    // UNION ALL of native + bridged rows projected into a common
    // shape. Each branch tags itself via the `source` literal column;
    // hashtags/is_liked only mean something on the native side and
    // project empty/false on the bridged side. Order by created time
    // across both (`v.created_at` for native, `record_created_at` for
    // bridged — i.e. the original Bluesky post time, not when our
    // indexer noticed it).
    //
    // Param order:
    //   $1 limit, $2 offset, $3 userId (only when authed)
    //
    // Note: `like_count` on `videos` is NOT NULL DEFAULT 0 but
    // `bridged_posts.like_count` is nullable until first poll —
    // COALESCE on the bridged branch keeps the projected column type
    // consistent.
    const sql = `
      SELECT * FROM (
        SELECT
          'tortok'::text AS source,
          v.id::text AS id,
          v.caption AS caption,
          v.magnet_link AS magnet_link,
          v.torrent_file_url AS torrent_file_url,
          v.poster_url AS poster_url,
          v.duration_seconds AS duration_seconds,
          v.width AS width,
          v.height AS height,
          v.like_count AS like_count,
          v.created_at AS created_at,
          u.id::text AS user_id,
          u.username AS username,
          u.display_name AS display_name,
          u.avatar_url AS avatar_url,
          COALESCE(
            (SELECT array_agg(h.name)
             FROM hashtags h
             JOIN video_hashtags vh ON vh.hashtag_id = h.id
             WHERE vh.video_id = v.id),
            ARRAY[]::text[]
          ) AS hashtags,
          ${userId
            ? `EXISTS(SELECT 1 FROM likes WHERE user_id = $3 AND video_id = v.id)`
            : `false`} AS is_liked,
          NULL::text AS bsky_at_uri,
          NULL::text AS bsky_handle
        FROM videos v
        JOIN users u ON v.user_id = u.id

        UNION ALL

        SELECT
          'bsky'::text AS source,
          bp.bsky_at_uri AS id,
          COALESCE(bp.text, '') AS caption,
          bp.magnet_link AS magnet_link,
          bp.torrent_file_url AS torrent_file_url,
          bp.poster_url AS poster_url,
          COALESCE(bp.duration_ms / 1000, 0) AS duration_seconds,
          COALESCE(bp.width, 0) AS width,
          COALESCE(bp.height, 0) AS height,
          COALESCE(bp.like_count, 0) AS like_count,
          bp.record_created_at AS created_at,
          bp.bsky_did AS user_id,
          bp.bsky_handle AS username,
          COALESCE(bp.bsky_display_name, bp.bsky_handle) AS display_name,
          bp.bsky_avatar_url AS avatar_url,
          ARRAY[]::text[] AS hashtags,
          false AS is_liked,
          bp.bsky_at_uri AS bsky_at_uri,
          bp.bsky_handle AS bsky_handle
        FROM bridged_posts bp
        WHERE bp.mirror_state = 'mirrored'
          AND bp.r2_path IS NOT NULL
          AND bp.magnet_link IS NOT NULL
      ) feed
      ORDER BY created_at DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `;

    const rows = await query<any>(
      sql,
      userId ? [limit, offset, userId] : [limit, offset]
    );

    const formattedVideos = rows.map((v: any) => {
      const base = {
        id: v.id,
        user: {
          id: v.user_id,
          username: v.username,
          displayName: v.display_name,
          avatarURL: v.avatar_url,
        },
        caption: v.caption,
        magnetLink: v.magnet_link,
        torrentFileUrl: v.torrent_file_url,
        posterURL: v.poster_url,
        durationSeconds: v.duration_seconds,
        width: v.width,
        height: v.height,
        hashtags: v.hashtags || [],
        likeCount: v.like_count || 0,
        isLiked: v.is_liked || false,
        createdAt: v.created_at,
        source: v.source as 'tortok' | 'bsky',
      };
      if (v.source === 'bsky') {
        return {
          ...base,
          bsky: {
            atUri: v.bsky_at_uri,
            handle: v.bsky_handle,
          },
        };
      }
      return base;
    });

    // Touch `last_played_at` on bridged items returned by this batch
    // so the storage-decay job (slice 3) only expires mirrors that
    // are genuinely cold. Without this, every mirror would decay on
    // the BSKY_DECAY_DAYS clock regardless of demand. Skip the UPDATE
    // entirely when no bridged items appeared in the batch.
    const bridgedAtUris = rows
      .filter((v: any) => v.source === 'bsky')
      .map((v: any) => v.bsky_at_uri);
    if (bridgedAtUris.length > 0) {
      await query(
        `UPDATE bridged_posts SET last_played_at = NOW() WHERE bsky_at_uri = ANY($1)`,
        [bridgedAtUris]
      );
    }

    res.json({
      videos: formattedVideos,
      nextCursor: rows.length === limit ? (offset + limit).toString() : null,
      hasMore: rows.length === limit,
    });
  } catch (error) {
    console.error('Get feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /videos/:id/like
 * Like/unlike a video
 */
router.post('/:id/like', authenticateJWT, validate(schemas.likeVideo), async (req: AuthRequest, res: Response) => {
  const client = await getClient();

  try {
    const videoId = req.params.id;
    const userId = req.user!.userId;
    const { liked } = req.body;

    await client.query('BEGIN');

    // Only adjust like_count when the like-row actually changed. Previously
    // the counter was updated unconditionally, so a double-like (INSERT ON
    // CONFLICT DO NOTHING → 0 rows, but UPDATE +1) or double-unlike
    // (DELETE → 0 rows, but UPDATE -1) would drift the counter. This was
    // B3 in the Phase 0a punch list.
    if (liked) {
      const insertResult = await client.query(
        `INSERT INTO likes (user_id, video_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, video_id) DO NOTHING`,
        [userId, videoId]
      );

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        await client.query(
          'UPDATE videos SET like_count = like_count + 1 WHERE id = $1',
          [videoId]
        );
      }
    } else {
      const deleteResult = await client.query(
        'DELETE FROM likes WHERE user_id = $1 AND video_id = $2',
        [userId, videoId]
      );

      if (deleteResult.rowCount && deleteResult.rowCount > 0) {
        await client.query(
          'UPDATE videos SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
          [videoId]
        );
      }
    }

    await client.query('COMMIT');

    res.json({ success: true, liked });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Like video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * POST /videos/:id/view
 * Record a video view
 */
router.post('/:id/view', optionalAuth, validate(schemas.recordView), async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user?.userId;
    const { watchedDuration, completionRate, source } = req.body;

    // Record view
    await query(
      `INSERT INTO views (user_id, video_id, watched_duration, completion_rate, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, videoId, watchedDuration, completionRate, source || 'http']
    );

    // Increment view count
    await query(
      'UPDATE videos SET view_count = view_count + 1 WHERE id = $1',
      [videoId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Record view error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /videos/:id
 * Get a single video
 */
router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user?.userId;

    const videos = await query<any>(
      `SELECT
        v.id, v.caption, v.magnet_link, v.torrent_file_url, v.poster_url,
        v.duration_seconds, v.width, v.height, v.like_count, v.view_count, v.created_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url,
        COALESCE(
          (SELECT array_agg(h.name)
           FROM hashtags h
           JOIN video_hashtags vh ON vh.hashtag_id = h.id
           WHERE vh.video_id = v.id),
          ARRAY[]::text[]
        ) as hashtags,
        ${userId ? `EXISTS(SELECT 1 FROM likes WHERE user_id = $2 AND video_id = v.id) as is_liked` : 'false as is_liked'}
       FROM videos v
       JOIN users u ON v.user_id = u.id
       WHERE v.id = $1`,
      userId ? [videoId, userId] : [videoId]
    );

    if (videos.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const v = videos[0];

    res.json({
      id: v.id,
      user: {
        id: v.user_id,
        username: v.username,
        displayName: v.display_name,
        avatarURL: v.avatar_url,
      },
      caption: v.caption,
      magnetLink: v.magnet_link,
      torrentFileUrl: v.torrent_file_url,
      posterURL: v.poster_url,
      durationSeconds: v.duration_seconds,
      width: v.width,
      height: v.height,
      hashtags: v.hashtags || [],
      likeCount: v.like_count || 0,
      isLiked: v.is_liked || false,
      createdAt: v.created_at,
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /videos/:id/urls
 * Update magnet_link / torrent_file_url on a video. Owner-only.
 *
 * There is no admin role yet, so the authorisation answer for v0 is
 * "only the video's uploader can rewrite its URLs". The old version of
 * this handler did not check the owner at all, which let any
 * authenticated user overwrite anyone's URLs — that was B4 in the
 * Phase 0a punch list.
 */
router.patch('/:id/urls', authenticateJWT, validate(schemas.updateVideoUrls), async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.userId;
    const { magnetLink, torrentFileUrl } = req.body;

    // Ownership check first: 404 if the video doesn't exist, 403 if it
    // exists but belongs to someone else. We deliberately use 403 rather
    // than 404-as-obfuscation here — leaking "this video exists" is fine,
    // leaking "anyone can rewrite it" is not.
    const owners = await query<{ user_id: string }>(
      'SELECT user_id FROM videos WHERE id = $1',
      [videoId]
    );

    if (owners.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (owners[0].user_id !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (magnetLink !== undefined) {
      updates.push(`magnet_link = $${paramCount++}`);
      values.push(magnetLink);
    }

    if (torrentFileUrl !== undefined) {
      updates.push(`torrent_file_url = $${paramCount++}`);
      values.push(torrentFileUrl);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No updates provided' });
      return;
    }

    values.push(videoId);
    const result = await query<any>(
      `UPDATE videos SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id`,
      values
    );

    if (result.length === 0) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    res.json({ success: true, videoId });
  } catch (error) {
    console.error('Update video URLs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
