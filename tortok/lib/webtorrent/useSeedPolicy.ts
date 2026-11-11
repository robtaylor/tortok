import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { torrentOf, type Video } from '@/lib/api';
import { notifyWatched, stopAll, pauseSeeding, resumeSeeding } from './seedPolicy';
import { subscribeToConditionChanges } from './deviceConditions';

// Rough bitrate estimate for byte budget tracking (2 MB/s).
const BITRATE_ESTIMATE = 2 * 1024 * 1024;

/**
 * Hook that manages the client seeding policy lifecycle.
 * Call from FeedScreen with the currently-active video.
 *
 * - Tracks recently-watched videos and holds their torrents for seeding
 * - Pauses seeding when battery/network conditions are unfavorable
 * - Stops all seeding when the app goes to the background
 */
export function useSeedPolicy(activeVideo: Video | null): void {
  const prevMagnet = useRef<string | null>(null);

  // Notify seed policy when active video changes.
  useEffect(() => {
    const playback = activeVideo && torrentOf(activeVideo);
    if (!activeVideo || !playback) return;
    if (playback.magnetLink === prevMagnet.current) return;
    prevMagnet.current = playback.magnetLink;

    const bytes = activeVideo.durationSeconds * BITRATE_ESTIMATE;
    notifyWatched(playback, bytes);
  }, [activeVideo]);

  // Subscribe to device condition changes.
  useEffect(() => {
    const unsubscribe = subscribeToConditionChanges((c) => {
      if (c.canSeed) {
        resumeSeeding();
      } else {
        pauseSeeding();
      }
    });
    return unsubscribe;
  }, []);

  // Pause/stop on app background, resume on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        resumeSeeding();
      } else if (state === 'background') {
        stopAll();
      } else {
        // 'inactive' is transient (iOS system alert, Control Center) —
        // pause holds but keep the queue so we can resume.
        pauseSeeding();
      }
    });
    return () => {
      sub.remove();
      stopAll();
    };
  }, []);
}
