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

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const TAB_BAR_HEIGHT = 80;
const VIDEO_HEIGHT = SCREEN_HEIGHT - TAB_BAR_HEIGHT;
// Stable reference so `useVideoPlayer` doesn't see a fresh initializer on
// every render (which can cause the player to be rebuilt on unrelated state
// changes like like-count updates).
function configurePlayer(p: { loop: boolean; muted: boolean }) {
  p.loop = true;
  p.muted = false;
}

const VideoItem = memo(function VideoItem({
  video,
  isActive,
  isAdjacent,
  token,
}: {
  video: Video;
  isActive: boolean;
  isAdjacent: boolean;
  token: string | null;
}) {
  // Optimistic like: `delta` records the pending change on top of the
  // server-confirmed `video.isLiked` / `video.likeCount`. Rollback is a
  // single `setDelta(prev)` — no mirrored arithmetic to keep in sync.
  const [delta, setDelta] = useState<-1 | 0 | 1>(0);
  const [likePending, setLikePending] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const liked = delta === 0 ? video.isLiked : delta === 1;
  const likeCount = video.likeCount + delta;

  // ---------------------------------------------------------------------------
  // Display state machine — the single source of truth for what the user sees.
  //
  // States:
  //   poster   — poster/cover image visible, video layer invisible
  //   playing  — video visible, playback active (first frame has rendered)
  //   paused   — video visible, playback paused (play icon overlay)
  //   error    — error overlay with retry button
  //   empty    — no poster, no video URL (placeholder text)
  //
  // Transitions:
  //   poster  → playing   playingChange(isPlaying: true) — first frame rendered
  //   poster  → error     statusChange(status: 'error')
  //   playing → paused    user tap
  //   playing → poster    scroll away (!isActive)
  //   paused  → playing   user tap, or scroll away then back (isActive)
  //   paused  → poster    scroll away (!isActive)
  //   error   → poster    retry (player.replace)
  //   *       → poster    player/source change (reset)
  // ---------------------------------------------------------------------------
  type DisplayState = 'poster' | 'playing' | 'paused' | 'error' | 'empty';
  const [displayState, setDisplayState] = useState<DisplayState>(
    !video.posterURL && !video.magnetLink ? 'empty' : 'poster',
  );

  // Only mount a player for the active cell and its immediate neighbors —
  // inactive cells that are simply scrolled-past render their poster and
  // nothing else. Prevents the FlatList window from holding N simultaneous
  // AVPlayer / ExoPlayer instances that we aren't using.
  const shouldLoadPlayer = isActive || isAdjacent;
  const p2pUrl = useP2PUrl(
    shouldLoadPlayer ? video.magnetLink : null,
    video.torrentFileUrl,
  );

  // p2pUrl is already null when !shouldLoadPlayer (magnetLink was null).
  const videoUrl = p2pUrl;

  const player = useVideoPlayer(videoUrl, configurePlayer);

  // Transition: scroll away → poster, scroll back → resume playing
  useEffect(() => {
    if (!isActive) {
      setDisplayState((s) => (s === 'playing' || s === 'paused') ? 'poster' : s);
    } else {
      // Scroll back to a paused cell → auto-play
      setDisplayState((s) => s === 'paused' ? 'playing' : s);
    }
  }, [isActive]);

  // Transition: player events drive state changes
  useEffect(() => {
    if (!player) {
      setDisplayState((s) => s === 'empty' ? 'empty' : 'poster');
      return;
    }

    const statusSub = player.addListener('statusChange', (payload) => {
      if (payload.status === 'error') {
        setDisplayState('error');
      }
      // When player becomes ready, retry play() — calling play() while
      // loading is a no-op on some platforms.
      if (payload.status === 'readyToPlay') {
        player.play();
      }
    });

    const playingSub = player.addListener('playingChange', (payload) => {
      if (payload.isPlaying) {
        // First frame has been decoded and presented — safe to show video
        setDisplayState('playing');
      }
    });

    return () => {
      statusSub.remove();
      playingSub.remove();
    };
  }, [player, retryKey]);

  // Drive the player based on display state
  useEffect(() => {
    if (!player) return;
    if (displayState === 'playing') {
      player.play();
    } else {
      player.pause();
    }
  }, [player, displayState]);

  const hashtagLine = useMemo(
    () => video.hashtags.map((h) => `#${h}`).join(' '),
    [video.hashtags],
  );

  const handleTogglePlay = () => {
    setDisplayState((s) => s === 'playing' ? 'paused' : s === 'paused' ? 'playing' : s);
  };

  const handleRetry = () => {
    if (!player || videoUrl === null) return;
    // expo-video's `replace()` swaps the internal player; listeners bound to
    // the old instance stop firing. Bumping retryKey forces the event
    // listeners above to re-subscribe.
    player.replace(videoUrl);
    setDisplayState('poster');
    setRetryKey((k) => k + 1);
  };

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

  return (
    <View style={styles.videoContainer}>
      {/* Poster — always rendered; hidden once video is playing/paused */}
      {video.posterURL && displayState === 'poster' ? (
        <Image
          source={{ uri: video.posterURL }}
          style={styles.video}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          testID="videoPoster"
        />
      ) : null}

      {videoUrl ? (
        <Pressable style={styles.video} onPress={handleTogglePlay} testID="videoPressable">
          <VideoView
            player={player}
            style={[styles.video, displayState === 'poster' && styles.invisible]}
            contentFit="cover"
            nativeControls={false}
          />
        </Pressable>
      ) : null}

      {displayState === 'empty' ? (
        <View style={[styles.video, styles.noVideo]}>
          <Text style={styles.noVideoText}>No video available</Text>
        </View>
      ) : null}

      {/* Buffering spinner — only when there's no poster to mask the wait */}
      {videoUrl && isActive && displayState === 'poster' && !video.posterURL ? (
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

      {/* Overlay: user info + caption */}
      <View style={styles.bottomOverlay}>
        <Text style={styles.username}>@{video.user.username}</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {video.caption}
        </Text>
        {video.hashtags.length > 0 && (
          <Text style={styles.hashtags}>{hashtagLine}</Text>
        )}
      </View>

      {/* Overlay: action buttons */}
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

export default function FeedScreen() {
  const token = useAuthStore((s) => s.token);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', token],
    queryFn: () => getFeed(token),
    enabled: !!token,
  });

  const videos = useMemo(() => data?.videos ?? [], [data]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  // Warm the native image cache for the neighbors of the active cell so
  // that swipes land on an already-drawn poster, not on a spinner.
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
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <VideoItem
          video={item}
          isActive={index === activeIndex}
          isAdjacent={Math.abs(index - activeIndex) === 1}
          token={token}
        />
      )}
      pagingEnabled
      snapToInterval={VIDEO_HEIGHT}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      getItemLayout={(_, index) => ({
        length: VIDEO_HEIGHT,
        offset: VIDEO_HEIGHT * index,
        index,
      })}
      // Narrow the FlatList render window. Defaults mount ~10 screens of
      // cells; we only need the active cell + its two neighbors (the
      // preload budget matches `shouldLoadPlayer`'s adjacency rule).
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
