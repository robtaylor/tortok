import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  Linking,
  ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { authorLabel, blueskyPostUrl, getFeed, type Video } from '@/lib/api';
import { PERF_BUILD, perfFeed } from '@/lib/perfBuild';
import { PLAYBACK_TAG, type PlaybackRecord, PlaybackTrace, TICK_MS } from '@/lib/playbackTrace';
import { usePlaybackUrl } from '@/lib/usePlaybackUrl';
import { recordView, WatchSession } from '@/lib/watchHistory';
import { useAppViewStore } from '@/stores/appview';
import { usePrefetch } from '@/lib/webtorrent/usePrefetch';
import { useSeedPolicy } from '@/lib/webtorrent/useSeedPolicy';

const PHONE_ASPECT = 9 / 16; // width / height

function configurePlayer(p: { loop: boolean; muted: boolean; timeUpdateEventInterval: number }) {
  p.loop = true;
  p.muted = false;
  // 100ms, for the watch history's time accounting (lib/watchHistory.ts),
  // which listens while the item is active.
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
//
// Only the active cell mounts a player. Adjacent cells are data-prefetched
// by usePrefetch (no player mounted). Poster visible in idle + loading → no
// black gap.

type DisplayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

const VideoItem = memo(function VideoItem({
  video,
  isActive,
  offset,
  videoWidth,
  videoHeight,
}: {
  video: Video;
  isActive: boolean;
  offset: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const pos = offset === 0 ? 'curr' : offset === 1 ? 'next' : offset === -1 ? 'prev' : 'off';
  const tag = video.caption.slice(0, 20);
  const vid = (video.id.split('/').pop() ?? video.id).slice(0, 6); // the record key
  const pre = `[${pos}] [${vid}:${tag}]`;
  // Ref so event listeners always log the current position, not the one
  // captured at registration time (player is stable → effects don't re-run).
  const preRef = useRef(pre);
  preRef.current = pre;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // What this stint as the active item measures about playback
  // (lib/playbackTrace.ts); null while the item isn't active.
  const trace = useRef<PlaybackTrace | null>(null);

  // --- Display state ---
  const [displayState, setDisplayState] = useState<DisplayState>('idle');

  // Only the active cell resolves a URL (lib/usePlaybackUrl.ts).
  const sourceUrl = usePlaybackUrl(video, isActive, tag);
  const bskyUrl = blueskyPostUrl(video);

  const { kind } = video.playback;
  // On Android the player caches a native post's source. It loops and
  // buffers well ahead, so with no cache it fetches a short clip from the
  // bridge several times over, and each fetch costs this thread seconds on a
  // slow phone (docs/architecture/p2p-torrent.md). iOS loops by seeking and
  // its cache loads differently; neither has been measured.
  const source = sourceUrl && kind === 'torrent' && Platform.OS === 'android'
    ? { uri: sourceUrl, useCaching: true }
    : sourceUrl;

  // Stable player — created once at mount, source swapped via replaceAsync.
  // Avoids 500-750ms native player construction cost on every scroll.
  const player = useVideoPlayer(null, configurePlayer);

  // Log display state transitions; the first to `playing` is the poster
  // giving way.
  useEffect(() => {
    console.log(`${pre} → ${displayState}`);
    if (displayState === 'playing') trace.current?.mark('shown', Date.now());
  }, [displayState]);

  // --- One stint as the active item: a watch-history session, kept on the
  // device only (lib/watchHistory.ts), and a playback trace, logged as one
  // line when it ends. Declared before the effect that swaps the source: an
  // HLS item has its URL in the render that makes it active, so that effect
  // marks the trace in the same commit. ---
  // Read when the stint ends, so new hashtags on the same post don't restart it.
  const hashtags = useRef(video.hashtags);
  hashtags.current = video.hashtags;
  useEffect(() => {
    if (!isActive) return;
    const session = new WatchSession();
    const stint = new PlaybackTrace(Date.now());
    trace.current = stint;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => session.onTime(currentTime, player.duration));
    const ticker = setInterval(() => stint.tick(Date.now()), TICK_MS);
    // The trace ends when the item is left or the app leaves the foreground,
    // whichever comes first: timers stop in the background, and the time
    // away isn't playback.
    const endTrace = () => {
      if (trace.current !== stint) return;
      trace.current = null;
      clearInterval(ticker);
      const view = session.end();
      const record: PlaybackRecord = {
        v: 1, post: video.id, kind, ...stint.end(Date.now()), playedMs: view.watchedMs, loops: view.loops,
      };
      console.log(`${PLAYBACK_TAG} ${JSON.stringify(record)}`);
    };
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') endTrace();
    });
    return () => {
      sub.remove();
      app.remove();
      endTrace();
      recordView(video.id, hashtags.current, session.end());
    };
  }, [isActive, player, video.id, kind]);

  // --- When isActive changes ---
  useEffect(() => {
    console.log(`${pre} ${isActive ? 'ACTIVATE' : 'DEACTIVATE'}`);
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
    if (sourceUrl) {
      trace.current?.mark('url', Date.now());
      console.log(`${pre} replaceAsync`);
      setDisplayState((s) => (s === 'idle' ? 'loading' : s));
      player.replaceAsync(source).then(() => {
        console.log(`${pre} replaceAsync resolved`);
      });
    } else {
      setDisplayState((s) =>
        s === 'loading' || s === 'playing' || s === 'paused' ? 'idle' : s,
      );
    }
  }, [sourceUrl, player]);

  // --- Player events ---
  useEffect(() => {
    if (!player) return;

    const statusSub = player.addListener('statusChange', (payload) => {
      console.log(`${preRef.current} statusChange: ${payload.status}${payload.error ? ` — ${payload.error.message}` : ''}`);
      trace.current?.status(payload.status, Date.now(), payload.error?.message);
      if (payload.status === 'error') {
        setDisplayState((s) =>
          s === 'loading' || s === 'playing' ? 'error' : s,
        );
      }
      if (payload.status === 'readyToPlay') {
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
        if (!isActiveRef.current) {
          console.log(`${preRef.current} playingChange PAUSED (inactive)`);
          player.pause();
          return;
        }
        setDisplayState((s) => (s === 'loading' ? 'playing' : s));
      }
    });

    return () => {
      statusSub.remove();
      playingSub.remove();
    };
  }, [player]);

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
    if (!player || !source) return;
    player.replaceAsync(source);
    setDisplayState('loading');
  };

  const hashtagLine = useMemo(
    () => video.hashtags.join(' '),
    [video.hashtags],
  );

  const showPoster = displayState === 'idle' || displayState === 'loading' || !isActive;
  const showVideo = isActive && (displayState === 'playing' || displayState === 'paused');
  // On web, useVideoPlayer(null) renders <video src=""> which triggers a
  // browser warning and a redundant network request. Skip mounting the
  // VideoView entirely until we have a real source.
  const mountPlayer = Platform.OS !== 'web' || !!sourceUrl;

  return (
    <View style={[styles.videoContainer, { width: videoWidth, height: videoHeight }]}>
      {isActive ? (
        // For end-to-end tests: the active item's display state, readable as
        // an accessibility label on iOS and Android alike.
        <View
          testID="activeVideoState"
          accessibilityLabel={displayState}
          style={styles.stateMarker}
          pointerEvents="none"
        />
      ) : null}
      {video.posterURL && showPoster ? (
        <Image
          source={{ uri: video.posterURL }}
          style={styles.video}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          testID="videoPoster"
        />
      ) : null}

      <Pressable
        style={styles.video}
        onPress={handleTogglePlay}
        testID="videoPressable"
      >
        {mountPlayer ? (
          <VideoView
            player={player}
            style={[styles.video, !showVideo && styles.invisible]}
            contentFit="cover"
            nativeControls={false}
            onFirstFrameRender={() => trace.current?.mark('frame', Date.now())}
          />
        ) : null}
      </Pressable>

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
        <Text style={styles.username} testID={isActive ? 'activeVideoAuthor' : undefined}>
          {authorLabel(video.author)}
        </Text>
        {bskyUrl ? (
          <Pressable
            onPress={() => void Linking.openURL(bskyUrl)}
            accessibilityRole="link"
            accessibilityLabel="Open on Bluesky"
            hitSlop={8}
            style={styles.bridgeBadge}
            testID={isActive ? 'activeVideoBlueskyBadge' : undefined}
          >
            <FontAwesome name="external-link" size={11} color="#fff" />
            <Text style={styles.bridgeBadgeText}>via Bluesky</Text>
          </Pressable>
        ) : null}
        <Text style={styles.caption} numberOfLines={2} testID={isActive ? 'activeVideoCaption' : undefined}>
          {video.caption}
        </Text>
        {video.hashtags.length > 0 && (
          <Text style={styles.hashtags}>{hashtagLine}</Text>
        )}
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// FeedScreen
// ---------------------------------------------------------------------------

export default function FeedScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList>(null);
  const [layout, setLayout] = useState<{ w: number; h: number } | null>(null);
  const fallbackW = useRef(Dimensions.get('window').width).current;

  const onFeedLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout((prev) => (prev?.w === width && prev?.h === height ? prev : { w: width, h: height }));
  }, []);

  // Measured height = actual space between header and tab bar.
  // On web, constrain width to 9:16 phone column.
  const videoHeight = layout?.h ?? 0;
  const videoWidth = Platform.OS === 'web'
    ? Math.min(layout?.w ?? fallbackW, Math.round(videoHeight * PHONE_ASPECT))
    : (layout?.w ?? fallbackW);

  // The feed is public: it needs no session. Keyed by AppView, so choosing
  // another one in Profile loads that AppView's feed.
  const appViewUrl = useAppViewStore((s) => s.url);
  const { data, isLoading, error } = useQuery({
    queryKey: ['feed', appViewUrl],
    queryFn: () => (PERF_BUILD ? perfFeed(appViewUrl) : getFeed(appViewUrl)),
  });

  // The screen only says the feed failed; the log says why.
  useEffect(() => {
    if (error) console.warn(`[feed] failed to load from ${appViewUrl}: ${error.name}: ${error.message}`);
  }, [error, appViewUrl]);

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
        videoWidth={videoWidth}
        videoHeight={videoHeight}
      />
    ),
    [activeIndex, videoWidth, videoHeight],
  );

  // Web: mouse drag to scroll between videos.
  // Refs so handlers stay stable across scrolls (no useMemo churn).
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const videosLenRef = useRef(videos.length);
  videosLenRef.current = videos.length;
  const dragStart = useRef<{ y: number; index: number } | null>(null);
  const webDragHandlers = useMemo(() => {
    if (Platform.OS !== 'web') return {};
    const DRAG_THRESHOLD = 50;
    return {
      onPointerDown: (e: { nativeEvent: { clientY: number } }) => {
        dragStart.current = { y: e.nativeEvent.clientY, index: activeIndexRef.current };
      },
      onPointerUp: (e: { nativeEvent: { clientY: number } }) => {
        if (!dragStart.current) return;
        const dy = dragStart.current.y - e.nativeEvent.clientY;
        const fromIndex = dragStart.current.index;
        dragStart.current = null;
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        const nextIndex = dy > 0
          ? Math.min(fromIndex + 1, videosLenRef.current - 1)
          : Math.max(fromIndex - 1, 0);
        if (nextIndex !== fromIndex) {
          listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
        }
      },
    };
  }, []);

  useEffect(() => {
    const urls = [-2, -1, 1, 2]
      .map((offset) => videos[activeIndex + offset]?.posterURL)
      .filter((u): u is string => !!u);
    if (urls.length) Image.prefetch(urls, 'memory-disk');
  }, [activeIndex, videos]);

  let content;
  if (isLoading || !layout) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  } else if (error) {
    content = (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to load feed</Text>
      </View>
    );
  } else if (videos.length === 0) {
    content = (
      <View style={styles.centered} testID="emptyFeedView">
        <Text style={styles.emptyTitle} testID="emptyFeedTitle">
          No videos yet
        </Text>
        <Text style={styles.emptySubtitle}>Be the first to post!</Text>
      </View>
    );
  } else {
    content = (
      <FlatList
        ref={listRef}
        data={videos}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        snapToInterval={videoHeight}
        snapToAlignment="start"
        // One video per swipe, however fast: without this a fast fling on
        // Android carried past several items (caught by e2e/feed.test.ts).
        disableIntervalMomentum
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: videoHeight,
          offset: videoHeight * index,
          index,
        })}
        style={{ width: videoWidth }}
        testID="videoFeed"
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={5}
      />
    );
  }

  return (
    <View style={styles.feedRoot} onLayout={onFeedLayout} {...webDragHandlers}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  stateMarker: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
  },
  feedRoot: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
  },
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
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  invisible: {
    opacity: 0,
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
  bridgeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(32,139,254,0.85)', // Bluesky blue
  },
  bridgeBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
});
