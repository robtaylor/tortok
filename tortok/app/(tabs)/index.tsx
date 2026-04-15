import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getFeed, likeVideo, type Video } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

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

function VideoItem({
  video,
  isActive,
  token,
}: {
  video: Video;
  isActive: boolean;
  token: string | null;
}) {
  // Optimistic like: `delta` records the pending change on top of the
  // server-confirmed `video.isLiked` / `video.likeCount`. Rollback is a
  // single `setDelta(prev)` — no mirrored arithmetic to keep in sync.
  const [delta, setDelta] = useState<-1 | 0 | 1>(0);
  const [likePending, setLikePending] = useState(false);
  const [status, setStatus] = useState<VideoPlayerStatus>('loading');
  const [isPaused, setIsPaused] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const liked = delta === 0 ? video.isLiked : delta === 1;
  const likeCount = video.likeCount + delta;

  const videoUrl: string | null = video.hlsURL;
  const player = useVideoPlayer(videoUrl, configurePlayer);

  // Track player status for buffering/error overlays
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('statusChange', (payload) => {
      setStatus(payload.status);
    });
    return () => sub.remove();
  }, [player, retryKey]);

  // Play/pause based on visibility.
  useEffect(() => {
    if (!player) return;
    if (isActive && videoUrl && !isPaused) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, isActive, videoUrl, isPaused]);

  const hashtagLine = useMemo(
    () => video.hashtags.map((h) => `#${h}`).join(' '),
    [video.hashtags],
  );

  const handleTogglePlay = () => {
    setIsPaused((p) => !p);
  };

  const handleRetry = () => {
    if (!player || videoUrl === null) return;
    // expo-video's `replace()` swaps the internal player; listeners bound to
    // the old instance stop firing. Bumping retryKey forces the statusChange
    // useEffect above to re-subscribe. Any future `player.replace()` call
    // site MUST also bump retryKey.
    player.replace(videoUrl);
    setStatus('loading');
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
      {videoUrl ? (
        <Pressable style={styles.video} onPress={handleTogglePlay} testID="videoPressable">
          <VideoView
            player={player}
            style={styles.video}
            contentFit="cover"
            nativeControls={false}
          />
        </Pressable>
      ) : (
        <View style={[styles.video, styles.noVideo]}>
          <Text style={styles.noVideoText}>No video available</Text>
        </View>
      )}

      {/* Buffering indicator */}
      {videoUrl && status === 'loading' ? (
        <View style={styles.centerOverlay} pointerEvents="none" testID="videoBuffering">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}

      {/* Paused indicator */}
      {videoUrl && status === 'readyToPlay' && isActive && isPaused ? (
        <View style={styles.centerOverlay} pointerEvents="none" testID="videoPaused">
          <FontAwesome name="play" size={60} color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}

      {/* Error overlay with retry */}
      {videoUrl && status === 'error' ? (
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
}

export default function FeedScreen() {
  const token = useAuthStore((s) => s.token);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', token],
    queryFn: () => getFeed(token),
    enabled: !!token,
  });

  const videos = data?.videos || [];

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

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
        <VideoItem video={item} isActive={index === activeIndex} token={token} />
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
