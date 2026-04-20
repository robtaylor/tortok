import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Dimensions,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getFeed, likeVideo, type Video } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useP2PUrl } from '@/lib/webtorrent/useP2PUrl';
import { usePrefetch } from '@/lib/webtorrent/usePrefetch';
import { useSeedPolicy } from '@/lib/webtorrent/useSeedPolicy';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const TAB_BAR_HEIGHT = 80;
const VIDEO_HEIGHT = SCREEN_HEIGHT - TAB_BAR_HEIGHT;

function configurePlayer(p: { loop: boolean; muted: boolean; timeUpdateEventInterval: number }) {
  p.loop = true;
  p.muted = false;
  // 100ms for accurate first-frame detection. The self-removing listener
  // in the player events effect unsubscribes after the first frame, so
  // this only fires ~1-5 times per video load, not continuously.
  p.timeUpdateEventInterval = 0.1;
}

// ---------------------------------------------------------------------------
// Display state machine
// ---------------------------------------------------------------------------
//
// States:
//   idle     — poster visible, no player
//   loading  — poster visible, player buffering behind it
//   playing  — video visible, playback active
//   paused   — video visible, playback paused
//   error    — error overlay with retry
//   empty    — no content
//
// Only the active cell mounts a player. Adjacent cells are data-prefetched
// by usePrefetch (no player mounted). Poster visible in idle + loading → no
// black gap.

type DisplayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'empty';

const VideoItem = memo(function VideoItem({
  video,
  isActive,
  offset,
  token,
}: {
  video: Video;
  isActive: boolean;
  offset: number;
  token: string | null;
}) {
  const pos = offset === 0 ? 'curr' : offset === 1 ? 'next' : offset === -1 ? 'prev' : 'off';
  const tag = video.caption.slice(0, 20);
  const vid = video.id.slice(0, 6);
  const pre = `[${pos}] [${vid}:${tag}]`;
  // Ref so event listeners always log the current position, not the one
  // captured at registration time (player is stable → effects don't re-run).
  const preRef = useRef(pre);
  preRef.current = pre;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // --- Profiling timeline (all Date.now(), no bridge lag) ---
  const tl = useRef<Record<string, number>>({});
  const stamp = useCallback((label: string) => { tl.current[label] = Date.now(); }, []);
  const dumpTimeline = useCallback(() => {
    const t = tl.current;
    if (!t.activate) return;
    const d = (a: string, b: string) => {
      const va = t[a], vb = t[b];
      return va && vb ? `${b}-${a}=${vb - va}ms` : `${b}=?`;
    };
    console.log(
      `${preRef.current} TIMELINE: total=${Date.now() - t.activate}ms | ` +
      [
        d('activate', 'replaceAsync'),
        d('replaceAsync', 'replaceResolved'),
        d('replaceResolved', 'readyToPlay'),
        d('readyToPlay', 'playingChange'),
        d('playingChange', 'renderPlaying'),
      ].join(' | '),
    );
  }, []);

  // --- Like state ---
  const [delta, setDelta] = useState<-1 | 0 | 1>(0);
  const [likePending, setLikePending] = useState(false);
  const liked = delta === 0 ? video.isLiked : delta === 1;
  const likeCount = video.likeCount + delta;

  // --- Display state ---
  const [displayState, setDisplayState] = useState<DisplayState>(
    !video.posterURL && !video.magnetLink ? 'empty' : 'idle',
  );

  // Only the active cell resolves a URL.
  const p2pUrl = useP2PUrl(
    isActive ? video.magnetLink : null,
    video.torrentFileUrl,
    tag,
  );

  // Stable player — created once at mount, source swapped via replaceAsync.
  // Avoids 500-750ms native player construction cost on every scroll.
  const player = useVideoPlayer(null, configurePlayer);

  // Log display state transitions.
  useEffect(() => {
    console.log(`${pre} → ${displayState}`);
    if (displayState === 'playing') {
      stamp('renderPlaying');
      dumpTimeline();
    }
  }, [displayState]);

  // --- When isActive changes ---
  useEffect(() => {
    console.log(`${pre} ${isActive ? 'ACTIVATE' : 'DEACTIVATE'}`);
    if (isActive) {
      tl.current = {};
      stamp('activate');
    }
    if (!isActive) {
      setDisplayState((s) =>
        s === 'playing' || s === 'paused' || s === 'loading' || s === 'error'
          ? 'idle'
          : s,
      );
      player.pause();
    }
  }, [isActive, player]);

  // --- When URL resolves/drops: swap source on the stable player ---
  useEffect(() => {
    if (p2pUrl) {
      stamp('replaceAsync');
      console.log(`${pre} replaceAsync`);
      setDisplayState((s) => (s === 'idle' ? 'loading' : s));
      player.replaceAsync(p2pUrl).then(() => {
        stamp('replaceResolved');
        console.log(`${pre} replaceAsync resolved`);
      });
    } else {
      setDisplayState((s) =>
        s === 'loading' || s === 'playing' || s === 'paused' ? 'idle' : s,
      );
    }
  }, [p2pUrl, player]);

  // --- Player events ---
  useEffect(() => {
    if (!player) return;

    const statusSub = player.addListener('statusChange', (payload) => {
      console.log(`${preRef.current} statusChange: ${payload.status}${payload.error ? ` — ${payload.error.message}` : ''}`);
      if (payload.status === 'error') {
        setDisplayState((s) =>
          s === 'loading' || s === 'playing' ? 'error' : s,
        );
      }
      if (payload.status === 'readyToPlay') {
        stamp('readyToPlay');
        if (isActiveRef.current) {
          player.play();
        } else {
          console.log(`${preRef.current} readyToPlay SKIPPED (inactive)`);
        }
      }
    });

    const playingSub = player.addListener('playingChange', (payload) => {
      console.log(`${preRef.current} playingChange: ${payload.isPlaying}`);
      if (payload.isPlaying) {
        stamp('playingChange');
        setDisplayState((s) => (s === 'loading' ? 'playing' : s));
      }
    });

    return () => {
      statusSub.remove();
      playingSub.remove();
    };
  }, [player]);

  // First-frame detector — diagnostic only. Measures actual decode latency.
  useEffect(() => {
    if (!player || !p2pUrl) return;
    let removed = false;
    const timeSub = player.addListener('timeUpdate', (payload) => {
      if (!removed && payload.currentTime > 0) {
        removed = true;
        console.log(`${preRef.current} FIRST_FRAME at ${payload.currentTime.toFixed(3)}s`);
        timeSub.remove();
      }
    });
    return () => {
      if (!removed) timeSub.remove();
    };
  }, [player, p2pUrl]);

  // --- Drive player from state ---
  useEffect(() => {
    if (!player) return;
    if (displayState === 'playing') {
      player.play();
    } else if (displayState === 'paused') {
      player.pause();
    }
  }, [player, displayState]);

  // --- Handlers ---
  const handleTogglePlay = () => {
    setDisplayState((s) =>
      s === 'playing' ? 'paused' : s === 'paused' ? 'playing' : s,
    );
  };

  const handleRetry = () => {
    if (!player || !p2pUrl) return;
    player.replaceAsync(p2pUrl);
    setDisplayState('loading');
  };

  const hashtagLine = useMemo(
    () => video.hashtags.map((h) => `#${h}`).join(' '),
    [video.hashtags],
  );

  const handleLike = async () => {
    if (!token || likePending) return;
    const nextLiked = !liked;
    const nextDelta: -1 | 0 | 1 =
      nextLiked === video.isLiked ? 0 : nextLiked ? 1 : -1;
    const prevDelta = delta;
    setDelta(nextDelta);
    setLikePending(true);
    try {
      await likeVideo(video.id, nextLiked, token);
    } catch (err) {
      console.warn('like request failed, rolling back', err);
      setDelta(prevDelta);
    } finally {
      setLikePending(false);
    }
  };

  const showPoster = displayState === 'idle' || displayState === 'loading';
  const showVideo = displayState === 'playing' || displayState === 'paused';

  return (
    <View style={styles.videoContainer}>
      {video.posterURL && showPoster ? (
        <Image
          source={{ uri: video.posterURL }}
          style={styles.video}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          testID="videoPoster"
        />
      ) : null}

      <Pressable style={styles.video} onPress={handleTogglePlay} testID="videoPressable">
        <VideoView
          player={player}
          style={[styles.video, !showVideo && styles.invisible]}
          contentFit="cover"
          nativeControls={false}
        />
      </Pressable>

      {displayState === 'empty' ? (
        <View style={[styles.video, styles.noVideo]}>
          <Text style={styles.noVideoText}>No video available</Text>
        </View>
      ) : null}

      {displayState === 'loading' && !video.posterURL ? (
        <View style={styles.centerOverlay} pointerEvents="none" testID="videoBuffering">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}

      {displayState === 'paused' ? (
        <View style={styles.centerOverlay} pointerEvents="none" testID="videoPaused">
          <FontAwesome name="play" size={60} color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}

      {displayState === 'error' ? (
        <View style={styles.centerOverlay} testID="videoError">
          <FontAwesome name="exclamation-triangle" size={36} color="#ff4444" />
          <Text style={styles.errorOverlayText}>Failed to load video</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            testID="videoRetryButton"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.bottomOverlay}>
        <Text style={styles.username}>@{video.user.username}</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {video.caption}
        </Text>
        {video.hashtags.length > 0 && (
          <Text style={styles.hashtags}>{hashtagLine}</Text>
        )}
      </View>

      <View style={styles.actionsOverlay}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleLike}
          disabled={likePending}
        >
          <FontAwesome
            name={liked ? 'heart' : 'heart-o'}
            size={30}
            color={liked ? '#ff2d55' : '#fff'}
          />
          <Text style={styles.actionCount}>{likeCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <FontAwesome name="comment-o" size={30} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <FontAwesome name="share" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// FeedScreen
// ---------------------------------------------------------------------------

export default function FeedScreen() {
  const token = useAuthStore((s) => s.token);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', token],
    queryFn: () => getFeed(token),
    enabled: !!token,
  });

  const videos = useMemo(() => data?.videos ?? [], [data]);

  usePrefetch(videos, activeIndex);
  useSeedPolicy(videos[activeIndex] ?? null);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const keyExtractor = useCallback((item: Video) => item.id, []);
  const renderItem = useCallback(
    ({ item, index }: { item: Video; index: number }) => (
      <VideoItem
        video={item}
        isActive={index === activeIndex}
        offset={index - activeIndex}
        token={token}
      />
    ),
    [activeIndex, token],
  );

  useEffect(() => {
    const urls = [-2, -1, 1, 2]
      .map((offset) => videos[activeIndex + offset]?.posterURL)
      .filter((u): u is string => !!u);
    if (urls.length) Image.prefetch(urls, 'memory-disk');
  }, [activeIndex, videos]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load feed</Text>
      </View>
    );
  }

  if (videos.length === 0) {
    return (
      <View style={styles.centered} testID="emptyFeedView">
        <Text style={styles.emptyTitle} testID="emptyFeedTitle">
          No videos yet
        </Text>
        <Text style={styles.emptySubtitle}>Be the first to post!</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={videos}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      snapToInterval={VIDEO_HEIGHT}
      snapToAlignment="start"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({
        length: VIDEO_HEIGHT,
        offset: VIDEO_HEIGHT * index,
        index,
      })}
      initialNumToRender={1}
      maxToRenderPerBatch={2}
      windowSize={3}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 16,
  },
  videoContainer: {
    height: VIDEO_HEIGHT,
    width: SCREEN_WIDTH,
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  invisible: {
    opacity: 0,
  },
  noVideo: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideoText: {
    color: '#888',
    fontSize: 16,
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  errorOverlayText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  retryButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 80,
  },
  username: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  hashtags: {
    color: '#ccc',
    fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  actionsOverlay: {
    position: 'absolute',
    right: 12,
    bottom: 40,
    alignItems: 'center',
    gap: 20,
  },
  actionButton: {
    alignItems: 'center',
  },
  actionCount: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
});
