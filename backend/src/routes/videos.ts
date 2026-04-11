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
    const { caption, magnetLink, hlsUrl, thumbnailUrl, durationSeconds, width, height, hashtags } = req.body;
    const userId = req.user!.userId;

    await client.query('BEGIN');

    // Create video
    const videos = await client.query<any>(
      `INSERT INTO videos (user_id, caption, magnet_link, hls_url, thumbnail_url, duration_seconds, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, caption, magnet_link, hls_url, thumbnail_url,
                 duration_seconds, width, height, like_count, view_count, created_at`,
      [userId, caption, magnetLink, hlsUrl || null, thumbnailUrl, durationSeconds, width, height]
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
      hlsURL: video.hls_url,
      thumbnailURL: video.thumbnail_url,
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
 * Get video feed
 */
router.get('/feed', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = req.user?.userId;

    // Get videos with user info and hashtags
    const videos = await query<any>(
      `SELECT
        v.id, v.caption, v.magnet_link, v.hls_url, v.thumbnail_url,
        v.duration_seconds, v.width, v.height, v.like_count, v.view_count, v.created_at,
        u.id as user_id, u.username, u.display_name, u.avatar_url,
        COALESCE(
          (SELECT array_agg(h.name)
           FROM hashtags h
           JOIN video_hashtags vh ON vh.hashtag_id = h.id
           WHERE vh.video_id = v.id),
          ARRAY[]::text[]
        ) as hashtags,
        ${userId ? `EXISTS(SELECT 1 FROM likes WHERE user_id = $3 AND video_id = v.id) as is_liked` : 'false as is_liked'}
       FROM videos v
       JOIN users u ON v.user_id = u.id
       ORDER BY v.created_at DESC
       LIMIT $1 OFFSET $2`,
      userId ? [limit, offset, userId] : [limit, offset]
    );

    const formattedVideos = videos.map((v: any) => ({
      id: v.id,
      user: {
        id: v.user_id,
        username: v.username,
        displayName: v.display_name,
        avatarURL: v.avatar_url,
      },
      caption: v.caption,
      magnetLink: v.magnet_link,
      hlsURL: v.hls_url,
      thumbnailURL: v.thumbnail_url,
      durationSeconds: v.duration_seconds,
      width: v.width,
      height: v.height,
      hashtags: v.hashtags || [],
      likeCount: v.like_count || 0,
      isLiked: v.is_liked || false,
      createdAt: v.created_at,
    }));

    res.json({
      videos: formattedVideos,
      nextCursor: videos.length === limit ? (offset + limit).toString() : null,
      hasMore: videos.length === limit,
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

    if (liked) {
      // Add like
      await client.query(
        `INSERT INTO likes (user_id, video_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, video_id) DO NOTHING`,
        [userId, videoId]
      );

      await client.query(
        'UPDATE videos SET like_count = like_count + 1 WHERE id = $1',
        [videoId]
      );
    } else {
      // Remove like
      await client.query(
        'DELETE FROM likes WHERE user_id = $1 AND video_id = $2',
        [userId, videoId]
      );

      await client.query(
        'UPDATE videos SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
        [videoId]
      );
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
        v.id, v.caption, v.magnet_link, v.hls_url, v.thumbnail_url,
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
      hlsURL: v.hls_url,
      thumbnailURL: v.thumbnail_url,
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
 * Update hls_url / magnet_link on a video. Owner-only.
 *
 * There is no admin role yet, so the authorisation answer for v0 is
 * "only the video's uploader can rewrite its URLs". The old version of
 * this handler did not check the owner at all, which let any
 * authenticated user overwrite anyone's URLs — that was B4 in the
 * Phase 0a punch list.
 */
router.patch('/:id/urls', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const videoId = req.params.id;
    const userId = req.user!.userId;
    const { hlsUrl, magnetLink } = req.body;

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

    if (hlsUrl !== undefined) {
      updates.push(`hls_url = $${paramCount++}`);
      values.push(hlsUrl);
    }

    if (magnetLink !== undefined) {
      updates.push(`magnet_link = $${paramCount++}`);
      values.push(magnetLink);
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
