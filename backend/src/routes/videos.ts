import { Router, Request, Response } from 'express';
import { query, getClient } from '../db';
import { AuthRequest, authenticateJWT, optionalAuth } from '../middleware/auth';
import { validate, schemas } from '../middleware/validate';
import { trackerUrls } from '../config';
import { feedItem, feedPage, type FeedContext } from '../services/feedView';

const router = Router();
const TRACKERS = trackerUrls();

/**
 * Blob URLs point at PUBLIC_BASE_URL (set in deployed environments, which
 * sit behind a TLS-terminating proxy), else at the host the request used.
 */
function feedContext(req: Request): FeedContext {
  const blobBase = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return { blobBase, trackers: TRACKERS };
}

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
 * Indexed app.tortok.video.post records, newest first (Phase 3 Unit 2.5B;
 * shape in services/feedView.ts). Paged by `offset`; `nextCursor` is the
 * next offset.
 */
router.get('/feed', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const videos = await feedPage(limit, offset, feedContext(req));
    res.json({
      videos,
      nextCursor: videos.length === limit ? String(offset + limit) : null,
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
 * One indexed post by AT-URI (URL-encoded), in the feed's shape.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const video = await feedItem(req.params.id, feedContext(req));
    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
    res.json(video);
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
