# PeerTube Reference Patterns

PeerTube is the most successful implementation of federated video + P2P streaming, making it an excellent reference for TorTok. This document extracts key patterns and lessons learned.

## PeerTube Overview

**Project:** Decentralized video platform
**Launch:** 2018
**Federation:** ActivityPub
**P2P:** Originally WebTorrent, now HLS + P2P Media Loader (since v6.0)
**Stack:** TypeScript, Angular, Express, PostgreSQL, Redis
**Scale:** Thousands of instances, millions of users

## Key Architecture Patterns

### 1. Hybrid Federation + P2P Architecture

PeerTube separates concerns effectively:

```
┌─────────────────────────────────────────┐
│         Metadata Layer                  │
│    (Federated via ActivityPub)          │
│  • User accounts                        │
│  • Video metadata                       │
│  • Comments, likes, follows             │
│  • Channel information                  │
└─────────────────────────────────────────┘
              ↕ (federation)
┌─────────────────────────────────────────┐
│       Media Delivery Layer              │
│        (P2P via WebRTC)                 │
│  • Video chunks                         │
│  • Peer connections                     │
│  • HTTP fallback                        │
└─────────────────────────────────────────┘
```

**Lesson for TorTok:**
- Keep metadata and media delivery completely separate
- Metadata travels via federation protocol
- Media travels via P2P directly between clients
- Don't try to federate media itself

### 2. Progressive P2P Adoption

PeerTube's P2P evolution:

**2018-2023: WebTorrent**
- Browser-based BitTorrent
- WebRTC for peer connections
- Good for small files
- Struggled with live streaming

**2023+: P2P Media Loader + HLS**
- Switched to HLS-based P2P
- Better mobile support
- Adaptive bitrate streaming
- Improved performance

**Lesson for TorTok:**
- Start with proven technology (libtorrent for mobile)
- HLS + adaptive bitrate is essential for video
- WebRTC data channels better than WebTorrent protocol for mobile
- Be willing to evolve P2P strategy based on real-world usage

### 3. Federation Implementation

**PeerTube's ActivityPub Usage:**

```typescript
// Following a remote channel
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Follow",
  "actor": "https://instance1.com/accounts/alice",
  "object": "https://instance2.com/video-channels/bob_channel"
}

// Publishing a new video
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://instance1.com/accounts/alice",
  "object": {
    "type": "Video",
    "id": "https://instance1.com/videos/123",
    "name": "My awesome video",
    "duration": "PT5M30S",
    "url": [
      {
        "type": "Link",
        "mediaType": "video/mp4",
        "href": "https://instance1.com/static/videos/123.mp4"
      },
      {
        "type": "Link",
        "mediaType": "application/x-mpegURL",
        "href": "https://instance1.com/static/streaming-playlists/hls/123/master.m3u8",
        "tag": [
          {
            "type": "Infohash",
            "name": "SHA1 torrent infohash"
          }
        ]
      }
    ],
    "content": "Video description",
    "published": "2025-01-23T10:30:00Z"
  }
}
```

**Key Patterns:**
- Use ActivityPub `Video` object type
- Include multiple URL types (MP4, HLS, torrent)
- Metadata includes duration, thumbnail, description
- Federation is async (queued jobs)

**Lesson for TorTok:**
- Extend ActivityPub with custom object types if needed
- Include all necessary media URLs in federated objects
- Use async job queues for federation delivery
- Implement retry logic for failed deliveries

### 4. Database Schema Patterns

**PeerTube's Core Tables:**

```sql
-- Videos (similar to TorTok's posts)
CREATE TABLE video (
    id INTEGER PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    duration INTEGER, -- seconds
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0,
    remote BOOLEAN DEFAULT false, -- Is this a remote video?
    url VARCHAR(2000), -- Remote URL if federated
    channel_id INTEGER REFERENCES video_channel(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Video Files (multiple qualities)
CREATE TABLE video_file (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES video(id),
    resolution INTEGER, -- 720, 1080, etc.
    size BIGINT, -- bytes
    fps INTEGER,
    infohash VARCHAR(40), -- BitTorrent infohash
    torrent_filename VARCHAR(255),
    file_url VARCHAR(2000)
);

-- Video Streaming Playlists (HLS)
CREATE TABLE video_streaming_playlist (
    id INTEGER PRIMARY KEY,
    video_id INTEGER REFERENCES video(id),
    type INTEGER, -- 1 = HLS
    playlist_url VARCHAR(2000),
    p2p_media_loader_info_hashes TEXT[] -- Array of infohashes
);

-- Channels (similar to TorTok users)
CREATE TABLE video_channel (
    id INTEGER PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    account_id INTEGER REFERENCES account(id),
    remote BOOLEAN DEFAULT false,
    url VARCHAR(2000)
);

-- Federation tracking
CREATE TABLE actor_follow (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES actor(id),
    target_actor_id INTEGER REFERENCES actor(id),
    state VARCHAR(50), -- 'pending', 'accepted', 'rejected'
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(actor_id, target_actor_id)
);

-- Redundancy (seeding)
CREATE TABLE video_redundancy (
    id INTEGER PRIMARY KEY,
    video_file_id INTEGER REFERENCES video_file(id),
    strategy VARCHAR(50), -- 'most-views', 'trending', 'recently-added'
    file_url VARCHAR(2000),
    created_at TIMESTAMP,
    expires_at TIMESTAMP
);
```

**Lesson for TorTok:**
- Store multiple file versions (qualities) per post
- Track local vs remote content with `remote` flag
- Keep federation state (pending, accepted, rejected)
- Implement redundancy/seeding strategy table
- Use UUIDs for global identification across federation

### 5. Seeding Strategy

**PeerTube's Redundancy System:**

```typescript
// Redundancy strategies
enum RedundancyStrategy {
  MOST_VIEWS = 'most-views',         // Seed most popular
  TRENDING = 'trending',              // Seed trending content
  RECENTLY_ADDED = 'recently-added'   // Seed new content
}

// Redundancy worker (background job)
class RedundancyScheduler {
  async createRedundancies() {
    // Get videos that need redundancy
    const videos = await this.findVideosToRedundancy()

    for (const video of videos) {
      // Download video to local instance
      await this.downloadVideo(video)

      // Seed via WebTorrent/P2P Media Loader
      await this.seedVideo(video)

      // Track redundancy
      await VideoRedundancyModel.create({
        videoFileId: video.id,
        strategy: this.strategy,
        expiresAt: this.calculateExpiry()
      })
    }
  }

  private findVideosToRedundancy() {
    switch (this.strategy) {
      case RedundancyStrategy.MOST_VIEWS:
        return VideoModel.findAll({
          order: [['views', 'DESC']],
          limit: 100
        })

      case RedundancyStrategy.TRENDING:
        // Calculate trending score
        return this.findTrendingVideos()

      case RedundancyStrategy.RECENTLY_ADDED:
        return VideoModel.findAll({
          order: [['createdAt', 'DESC']],
          limit: 100
        })
    }
  }
}
```

**Lesson for TorTok:**
- Implement configurable seeding strategies
- Instances can choose to seed popular content
- Set expiry dates for seeded content (LRU eviction)
- Background workers manage seeding automatically
- Admins can configure redundancy limits (storage, bandwidth)

### 6. Video Transcoding Pipeline

**PeerTube's Transcoding:**

```typescript
// Job queue for video processing
class VideoTranscodingJob {
  async process(videoId: number) {
    const video = await VideoModel.findById(videoId)
    const inputFile = video.getOriginalFile()

    // 1. Create multiple quality versions
    for (const resolution of [240, 360, 480, 720, 1080]) {
      if (inputFile.resolution >= resolution) {
        await this.transcode({
          inputPath: inputFile.path,
          outputPath: this.getOutputPath(video, resolution),
          resolution,
          fps: inputFile.fps
        })
      }
    }

    // 2. Create HLS playlist
    await this.createHLSPlaylist(video)

    // 3. Generate thumbnails
    await this.generateThumbnails(video)

    // 4. Create torrent files
    for (const videoFile of video.VideoFiles) {
      await this.createTorrent(videoFile)
    }

    // 5. Update video status
    video.state = VideoState.PUBLISHED
    await video.save()

    // 6. Federate if needed
    if (video.privacy === VideoPrivacy.PUBLIC) {
      await this.federateVideo(video)
    }
  }
}
```

**Lesson for TorTok:**
- Use job queues for async processing
- Generate multiple qualities server-side
- Create HLS playlists for adaptive streaming
- Generate torrents after transcoding complete
- Federate only after all processing done

### 7. Instance Administration

**PeerTube Admin Features:**

```typescript
// Instance configuration
interface InstanceConfig {
  name: string
  shortDescription: string
  description: string
  terms: string
  codeOfConduct: string
  moderationInformation: string
  administrator: string
  maintenanceLifetime: string
  businessModel: string

  signup: {
    enabled: boolean
    limit: number
    requiresEmailVerification: boolean
    requiresApproval: boolean
  }

  user: {
    videoQuota: number // bytes per user
    videoQuotaDaily: number
  }

  transcoding: {
    enabled: boolean
    threads: number
    resolutions: {
      '240p': boolean
      '360p': boolean
      '480p': boolean
      '720p': boolean
      '1080p': boolean
      '2160p': boolean
    }
  }

  import: {
    videos: {
      http: { enabled: boolean }
      torrent: { enabled: boolean }
    }
  }

  autoBlacklist: {
    videos: {
      ofUsers: {
        enabled: boolean
      }
    }
  }

  followers: {
    instance: {
      enabled: boolean
      manualApproval: boolean
    }
  }
}
```

**Admin Moderation Tools:**
- Block users
- Remove videos
- Block remote instances
- Manual user approval
- Auto-moderation rules
- Content reporting system

**Lesson for TorTok:**
- Make instance highly configurable
- Give admins granular control
- Implement user quotas
- Support manual approval workflows
- Build comprehensive moderation tools

### 8. Client-Side P2P Integration

**PeerTube Video Player (Angular):**

```typescript
import { P2PMediaLoaderPlugin } from '@peertube/p2p-media-loader-plugin'

class VideoPlayer {
  initializePlayer(videoUrl: string, hlsUrl: string) {
    const player = videojs('video-player', {
      plugins: {
        p2pMediaLoader: {
          // P2P settings
          core: {
            swarmId: this.getSwarmId(hlsUrl),
            trackerAnnounce: [
              'wss://tracker.openwebtorrent.com',
              'wss://tracker.btorrent.xyz'
            ]
          },

          // Segment settings
          segments: {
            forwardSegmentCount: 20,
            swarmId: this.getSwarmId(hlsUrl)
          },

          // HTTP fallback
          loader: {
            simultaneousHttpDownloads: 3,
            httpDownloadProbability: 0.1, // Prefer P2P
            httpDownloadMaxPriority: 1
          }
        }
      }
    })

    // Load HLS source
    player.src({
      src: hlsUrl,
      type: 'application/x-mpegURL'
    })

    // Monitor P2P stats
    this.monitorP2PStats(player)
  }

  private monitorP2PStats(player: any) {
    setInterval(() => {
      const stats = player.p2pMediaLoader().getStats()

      console.log('P2P Downloaded:', stats.p2pDownloaded)
      console.log('HTTP Downloaded:', stats.httpDownloaded)
      console.log('Peers:', stats.numPeers)
      console.log('P2P Ratio:', stats.p2pDownloaded / (stats.p2pDownloaded + stats.httpDownloaded))
    }, 5000)
  }
}
```

**Lesson for TorTok:**
- Integrate P2P at player level (not app level)
- Monitor P2P statistics for debugging
- Provide HTTP fallback always
- Use WebSocket for tracker connections
- Handle peer disconnections gracefully

### 9. Federation Discovery

**How PeerTube instances find each other:**

```typescript
// NodeInfo endpoint (standard for federated services)
GET https://instance.com/.well-known/nodeinfo
{
  "links": [
    {
      "rel": "http://nodeinfo.diaspora.software/ns/schema/2.0",
      "href": "https://instance.com/nodeinfo/2.0.json"
    }
  ]
}

GET https://instance.com/nodeinfo/2.0.json
{
  "version": "2.0",
  "software": {
    "name": "peertube",
    "version": "6.0.0"
  },
  "protocols": ["activitypub"],
  "services": {
    "inbound": [],
    "outbound": []
  },
  "usage": {
    "users": {
      "total": 150,
      "activeMonth": 45,
      "activeHalfyear": 89
    },
    "localPosts": 3425,
    "localComments": 12890
  },
  "openRegistrations": true,
  "metadata": {
    "themeColor": "#F1680D",
    "defaultNSFWPolicy": "blur",
    "categories": [1, 2, 3]
  }
}

// WebFinger for user discovery
GET https://instance.com/.well-known/webfinger?resource=acct:alice@instance.com
{
  "subject": "acct:alice@instance.com",
  "aliases": [
    "https://instance.com/accounts/alice"
  ],
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://instance.com/accounts/alice"
    }
  ]
}
```

**Lesson for TorTok:**
- Implement NodeInfo 2.0 standard
- Expose WebFinger for user discovery
- Publish instance statistics
- Make federation discoverable
- Support standard federation protocols

### 10. Performance Optimizations

**PeerTube's Caching Strategy:**

```typescript
// Redis caching
class CacheService {
  // Cache video metadata
  async getVideo(id: number): Promise<Video> {
    const cacheKey = `video:${id}`
    const cached = await redis.get(cacheKey)

    if (cached) {
      return JSON.parse(cached)
    }

    const video = await VideoModel.findById(id)
    await redis.setex(cacheKey, 3600, JSON.stringify(video)) // 1 hour

    return video
  }

  // Cache ActivityPub actors
  async getRemoteActor(url: string): Promise<Actor> {
    const cacheKey = `actor:${url}`
    const cached = await redis.get(cacheKey)

    if (cached) {
      return JSON.parse(cached)
    }

    const actor = await this.fetchRemoteActor(url)
    await redis.setex(cacheKey, 86400, JSON.stringify(actor)) // 24 hours

    return actor
  }

  // Cache instance stats
  async getInstanceStats(): Promise<Stats> {
    const cacheKey = 'stats:instance'
    const cached = await redis.get(cacheKey)

    if (cached) {
      return JSON.parse(cached)
    }

    const stats = await this.calculateStats()
    await redis.setex(cacheKey, 300, JSON.stringify(stats)) // 5 minutes

    return stats
  }
}
```

**Database Optimizations:**

```sql
-- Indexes for common queries
CREATE INDEX video_channel_id_idx ON video(channel_id);
CREATE INDEX video_created_at_idx ON video(created_at DESC);
CREATE INDEX video_views_idx ON video(views DESC);
CREATE INDEX actor_follow_actor_id_idx ON actor_follow(actor_id);
CREATE INDEX actor_follow_target_actor_id_idx ON actor_follow(target_actor_id);

-- Materialized view for trending videos
CREATE MATERIALIZED VIEW trending_videos AS
SELECT
  v.id,
  v.uuid,
  v.name,
  v.views,
  v.likes,
  (v.views * 0.3 + v.likes * 0.7) / (EXTRACT(EPOCH FROM (NOW() - v.created_at)) / 3600) as trending_score
FROM video v
WHERE v.created_at > NOW() - INTERVAL '7 days'
ORDER BY trending_score DESC;

-- Refresh every hour
REFRESH MATERIALIZED VIEW trending_videos;
```

**Lesson for TorTok:**
- Cache everything that's fetched frequently
- Use Redis for session and API caching
- Create indexes on all foreign keys and query columns
- Use materialized views for complex aggregations
- Refresh materialized views periodically

## Key Takeaways for TorTok

### What to Copy from PeerTube

1. **Hybrid Architecture**: Separate metadata (federated) from media (P2P)
2. **ActivityPub Federation**: Use proven federation protocol
3. **HLS + P2P**: Adaptive bitrate streaming over WebRTC
4. **Redundancy System**: Let instances automatically seed popular content
5. **Admin Controls**: Granular instance configuration
6. **NodeInfo Standard**: Make instances discoverable
7. **Job Queues**: Async processing for everything heavy
8. **Caching Strategy**: Redis for API, materialized views for analytics

### What to Adapt/Simplify

1. **Simpler Federation**: Start with basic ActivityPub subset
2. **Mobile-First**: Native apps instead of web-first
3. **Photos First**: Skip video complexity initially
4. **Lighter Stack**: Go instead of TypeScript for backend
5. **No Transcoding Initially**: Users upload pre-compressed photos
6. **Simpler Moderation**: Basic block lists initially

### What to Avoid

1. **Over-Engineering Federation**: PeerTube has complex federation logic—keep it simple initially
2. **Too Many Video Formats**: Start with one or two quality levels
3. **Complex Permissions**: Simple public/private initially
4. **Heavy Frontend Framework**: React Native adds complexity, go native

## PeerTube Code References

**Official Repository:** https://github.com/Chocobozzz/PeerTube

**Key Files to Study:**

```
server/
├── models/
│   ├── video/video.ts           # Video model & queries
│   └── actor/actor-follow.ts    # Federation follows
├── lib/
│   ├── activitypub/             # ActivityPub implementation
│   │   ├── send/                # Sending activities
│   │   └── process/             # Processing activities
│   ├── job-queue/               # Background jobs
│   └── redundancy/              # Seeding strategies
└── controllers/
    ├── api/
    │   └── videos/              # Video API endpoints
    └── activitypub/             # Federation endpoints

client/
└── src/
    ├── assets/
    │   └── player/              # Video.js player setup
    └── app/
        └── +videos/             # Video components
```

## Conclusion

PeerTube demonstrates that federated social media with P2P delivery is not only possible but practical at scale. The key lessons are:

1. Separation of concerns (metadata vs media)
2. Progressive enhancement (HTTP fallback always available)
3. Instance autonomy (admins control their instance)
4. Standard protocols (ActivityPub, NodeInfo, WebFinger)
5. Performance matters (caching, indexes, job queues)

TorTok should adopt PeerTube's proven patterns while simplifying for mobile-first, photo-focused use case.

## Further Reading

- [PeerTube Documentation](https://docs.joinpeertube.org/)
- [PeerTube Architecture](https://docs.joinpeertube.org/contribute/architecture)
- [ActivityPub in PeerTube](https://docs.joinpeertube.org/api/activitypub)
- [P2P Media Loader Integration](https://github.com/Novage/p2p-media-loader)
