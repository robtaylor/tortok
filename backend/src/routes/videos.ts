import { Router, Request, Response } from 'express';
import { trackerUrls } from '../config';
import { feedItem, feedPage, type FeedContext } from '../services/feedView';

const TRACKERS = trackerUrls();

export interface VideosRouteDeps {
  /** The clock the feed judges bridged posts' checks by (Decision 0025); a test passes the bridge's. */
  now?: () => Date;
}

export function createVideosRouter(deps: VideosRouteDeps = {}): Router {
  const now = deps.now ?? (() => new Date());
  const router = Router();

  /**
   * Blob URLs point at PUBLIC_BASE_URL (set in deployed environments, which
   * sit behind a TLS-terminating proxy), else at the host the request used.
   */
  function feedContext(req: Request): FeedContext {
    const blobBase = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return { blobBase, trackers: TRACKERS, now: now() };
  }

  /**
   * GET /feed
   * Indexed posts, native and bridged, newest first (Phase 3 Units 2.5B and
   * 2.5D; shape in services/feedView.ts). Paged by `offset`; `nextCursor` is
   * the next offset.
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

  return router;
}
