# Technical Challenges and Solutions

This document addresses the major technical challenges in building a decentralized, P2P Instagram-like platform and provides practical solutions.

## Table of Contents
1. [Mobile Battery Drain from Seeding](#mobile-battery-drain-from-seeding)
2. [NAT Traversal on Mobile Networks](#nat-traversal-on-mobile-networks)
3. [Content Discovery Without Centralized Search](#content-discovery-without-centralized-search)
4. [Metadata Synchronization Performance](#metadata-synchronization-performance)
5. [Cold Start Problem (No Seeders)](#cold-start-problem-no-seeders)
6. [Video Format Optimization for P2P](#video-format-optimization-for-p2p)
7. [Storage Limits on Mobile](#storage-limits-on-mobile)
8. [Content Moderation in Decentralized System](#content-moderation-in-decentralized-system)
9. [Privacy and Anonymity](#privacy-and-anonymity)
10. [Spam and Abuse Prevention](#spam-and-abuse-prevention)

---

## Mobile Battery Drain from Seeding

### Problem

Continuous BitTorrent seeding on mobile devices causes significant battery drain, making the app unusable for extended periods.

**Challenges:**
- Traditional torrent clients run continuously
- Network activity prevents CPU from sleeping
- Radio keeps cellular/WiFi active
- Users expect mobile apps to be battery-efficient

### Solution: Battery-Aware Seeding

#### Implementation Strategy

**1. Conditional Seeding Based on Battery State**

```kotlin
// Android example
class BatteryAwareSeeder(context: Context) {
    private val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

    fun shouldSeed(): Boolean {
        val batteryLevel = getBatteryLevel()
        val isCharging = isCharging()
        val batteryPolicy = getUserPreference()

        return when (batteryPolicy) {
            BatteryPolicy.ALWAYS -> true
            BatteryPolicy.CHARGING_ONLY -> isCharging
            BatteryPolicy.HIGH_BATTERY -> batteryLevel > 50 || isCharging
            BatteryPolicy.NEVER -> false
        }
    }

    private fun getBatteryLevel(): Int {
        return batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun isCharging(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
               status == BatteryManager.BATTERY_STATUS_FULL
    }
}
```

**2. Intelligent Seeding Scheduler**

```swift
// iOS example
class SeedingScheduler {
    enum SeedingStrategy {
        case aggressive  // Seed for 48 hours
        case moderate    // Seed for 24 hours
        case minimal     // Seed for 6 hours
        case onDemand    // Only while viewing
    }

    func scheduleSeedingFor(torrent: Torrent, strategy: SeedingStrategy) {
        let duration = getDuration(for: strategy)

        Task {
            await seed(torrent, for: duration)
            await pauseSeedingIfNeeded()
        }
    }

    private func pauseSeedingIfNeeded() async {
        let batteryLevel = UIDevice.current.batteryLevel
        let batteryState = UIDevice.current.batteryState

        if batteryState == .unplugged && batteryLevel < 0.5 {
            await torrentEngine.pauseAllSeeding()
        }
    }
}
```

**3. Foreground Service with Notification (Android)**

```kotlin
class TorrentSeedingService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Start seeding
        torrentEngine.startSeeding()

        // Register battery monitor
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))

        return START_STICKY
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("TorTok Seeding")
            .setContentText("Sharing your content with the network")
            .setSmallIcon(R.drawable.ic_upload)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
```

#### User Controls

**Settings UI:**
```
Seeding Policy:
  ( ) Always seed (highest contribution)
  (•) Seed when charging (recommended)
  ( ) Seed when battery >50%
  ( ) Only while viewing content
  ( ) Never seed (leech mode)

Seeding Duration:
  New uploads: [24 hours ▼]
  Downloaded content: [6 hours ▼]

Network Preference:
  [✓] Seed on WiFi
  [ ] Seed on cellular data
```

#### Expected Impact

| Scenario | Battery Drain | User Experience |
|----------|---------------|-----------------|
| No seeding controls | 15-25%/hour | Unusable |
| Charging only | 0% (charging) | Good |
| Battery >50% | 5-8%/hour | Acceptable |
| On-demand only | 2-3%/hour | Minimal impact |

---

## NAT Traversal on Mobile Networks

### Problem

Mobile carriers use Carrier-Grade NAT (CGNAT), often symmetric NAT, which blocks direct peer-to-peer connections.

**Challenges:**
- ~70% of mobile users behind symmetric NAT
- No port forwarding possible
- Traditional BitTorrent hole-punching doesn't work
- P2P connections fail without relay

### Solution: WebRTC with STUN/TURN

#### Architecture

```
Mobile App A                                   Mobile App B
    │                                              │
    ├─── STUN Request ──→ STUN Server              │
    │    (discover public IP)                      │
    │                                              │
    ├─────────── Signaling (SDP Exchange) ────────→│
    │         via WebSocket to Signaling Server    │
    │                                              │
    ├─── ICE Candidate Exchange ──────────────────→│
    │                                              │
    │                                              │
    ├───── Try Direct Connection ─────────────────→│
    │      (works for ~70% of pairs)              │
    │                                              │
    │  ✗ Failed (both behind symmetric NAT)       │
    │                                              │
    ├────── Fallback to TURN Relay ──────────────→ │
    │                TURN Server                   │
    │        (relays media packets)               │
    └──────────────────────────────────────────────┘
```

#### Implementation

**1. WebRTC Peer Connection Setup**

```typescript
// Signaling via WebSocket
class P2PConnection {
  private pc: RTCPeerConnection;

  constructor() {
    this.pc = new RTCPeerConnection({
      iceServers: [
        // Public STUN servers (free)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // TURN server (self-hosted)
        {
          urls: 'turn:turn.tortok.com:3478',
          username: 'user',
          credential: 'pass'
        }
      ],
      iceCandidatePoolSize: 10
    });

    this.pc.ondatachannel = (event) => {
      const dataChannel = event.channel;
      this.handleDataChannel(dataChannel);
    };
  }

  async createOffer(remoteUserId: string): Promise<RTCSessionDescriptionInit> {
    // Create data channel for torrent chunks
    const dataChannel = this.pc.createDataChannel('torrent', {
      ordered: false, // Allow out-of-order delivery for speed
      maxRetransmits: 0 // Don't retransmit (torrent protocol handles it)
    });

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Send offer to remote peer via signaling server
    await this.sendSignal(remoteUserId, { type: 'offer', sdp: offer });

    return offer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(answer);
  }

  private async handleDataChannel(channel: RTCDataChannel) {
    channel.onmessage = (event) => {
      // Received torrent chunk
      const chunk = new Uint8Array(event.data);
      this.processTorrentChunk(chunk);
    };
  }
}
```

**2. TURN Server Configuration (coturn)**

```bash
# /etc/turnserver.conf

# Listening ports
listening-port=3478
tls-listening-port=5349

# Realm
realm=tortok.com
server-name=turn.tortok.com

# Authentication
fingerprint
lt-cred-mech
user=tortok:secretpassword

# External IP (for NAT)
external-ip=YOUR.PUBLIC.IP.ADDRESS/INTERNAL.IP

# Logging
verbose
log-file=/var/log/turnserver.log

# Limits (prevent abuse)
max-bps=1024000  # 1 Mbps per allocation
total-quota=100  # 100 connections max
bps-capacity=0   # No global limit

# Security
no-multicast-peers
no-cli
no-loopback-peers
no-tcp-relay
```

Start server:
```bash
sudo turnserver -c /etc/turnserver.conf
```

**3. Signaling Server (WebSocket)**

```go
// Go WebSocket signaling server
type SignalingServer struct {
    clients map[string]*websocket.Conn
    mu      sync.RWMutex
}

func (s *SignalingServer) HandleSignal(userId string, msg SignalMessage) {
    s.mu.RLock()
    targetConn, exists := s.clients[msg.TargetUser]
    s.mu.RUnlock()

    if !exists {
        // User offline, queue message
        s.queueMessage(msg.TargetUser, msg)
        return
    }

    // Forward signal to target
    targetConn.WriteJSON(msg)
}

type SignalMessage struct {
    Type       string `json:"type"` // "offer", "answer", "ice-candidate"
    From       string `json:"from"`
    TargetUser string `json:"target"`
    SDP        string `json:"sdp,omitempty"`
    Candidate  string `json:"candidate,omitempty"`
}
```

#### Cost Optimization

**TURN Usage Statistics:**
- ~15-30% of connections need TURN relay
- Average video chunk size: 1-2 MB
- With 1000 active users, ~200 use TURN
- Bandwidth: ~200 users × 10 MB/day = 2 GB/day = 60 GB/month

**Cost:**
- Self-hosted: $15/month (small VM) + bandwidth
- Commercial (Twilio): $0.40/GB = ~$24/month

**Optimization Strategies:**
1. Only relay signaling, not media when possible
2. Use TURN as last resort (try direct first)
3. Implement UDP hole punching before TURN
4. Cache WebRTC connections for repeated transfers
5. Encourage WiFi usage (better NAT traversal)

---

## Content Discovery Without Centralized Search

### Problem

Without a centralized index, how do users discover new content across federated instances?

**Challenges:**
- No global database to query
- Full-text search across instances is expensive
- Privacy concerns with indexing everything
- Spam and abuse in decentralized search

### Solution: Multi-Layer Discovery

#### 1. Local Instance Search

Each metadata node maintains its own search index.

**PostgreSQL Full-Text Search:**

```sql
-- Create GIN index for fast text search
CREATE INDEX posts_search_idx ON posts
USING GIN (to_tsvector('english', content || ' ' || COALESCE(caption, '')));

-- Search query
SELECT * FROM posts
WHERE to_tsvector('english', content || ' ' || COALESCE(caption, ''))
  @@ to_tsquery('english', 'sunset & beach')
ORDER BY created_at DESC
LIMIT 20;
```

**Alternative: Meilisearch or Typesense**

```typescript
// External search engine for better relevance
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({ host: 'http://localhost:7700' });

// Index posts
await client.index('posts').addDocuments([
  {
    id: '1',
    content: 'Beautiful sunset at the beach!',
    author: 'alice',
    created_at: 1704067200,
    hashtags: ['sunset', 'beach', 'nature']
  }
]);

// Search
const results = await client.index('posts').search('sunset', {
  filter: 'created_at > 1704000000',
  sort: ['created_at:desc']
});
```

#### 2. Federated Timeline

Users see posts from accounts they follow, aggregated from multiple instances.

```sql
-- Get federated timeline for user
SELECT p.* FROM posts p
JOIN follows f ON p.user_id = f.following_id
WHERE f.follower_id = :current_user_id
  AND p.created_at > :since
ORDER BY p.created_at DESC
LIMIT 50;
```

#### 3. Hashtag Discovery

Hashtags work across federation.

```go
// Hashtag extraction and indexing
func ExtractHashtags(content string) []string {
    re := regexp.MustCompile(`#(\w+)`)
    matches := re.FindAllStringSubmatch(content, -1)

    hashtags := make([]string, len(matches))
    for i, match := range matches {
        hashtags[i] = strings.ToLower(match[1])
    }
    return hashtags
}

// Query posts by hashtag (federated)
func GetPostsByHashtag(db *sql.DB, hashtag string) ([]Post, error) {
    query := `
        SELECT p.* FROM posts p
        JOIN post_hashtags ph ON p.id = ph.post_id
        JOIN hashtags h ON ph.hashtag_id = h.id
        WHERE h.name = $1
        ORDER BY p.created_at DESC
        LIMIT 50
    `
    // ... execute query
}
```

#### 4. DHT-Based Content Discovery

For discovering torrents without metadata nodes.

**Magnetico: Self-Hosted DHT Crawler**

```bash
# Install magnetico
docker run -d \
  --name magnetico \
  -p 8080:8080 \
  -v /data/magnetico:/root/.local/share/magnetico \
  skobkin/magnetico
```

**Custom DHT Crawler:**

```python
import libtorrent as lt

# Create DHT node
session = lt.session()
session.listen_on(6881, 6891)

# Crawl DHT for tortok-tagged torrents
dht_state = session.dht_state()
for bucket in dht_state.buckets:
    for node in bucket.nodes:
        # Query node for tortok content
        pass
```

#### 5. Relay/Indexing Instances

Special instances that aggregate content from many instances.

```
      [User Instance A] ──┐
                         │
      [User Instance B] ──┼──→ [Relay Instance] → [Search API]
                         │      (indexes 100+ instances)
      [User Instance C] ──┘
```

**Relay Implementation:**

```typescript
// Relay instance subscribes to many instances
class RelayInstance {
  private subscribedInstances: string[] = [
    'https://instance1.com',
    'https://instance2.com',
    // ... 100+ instances
  ];

  async aggregateContent() {
    for (const instance of this.subscribedInstances) {
      const timeline = await fetch(`${instance}/api/v1/timelines/public`);
      const posts = await timeline.json();

      // Index posts for search
      await this.indexPosts(posts);
    }
  }

  async indexPosts(posts: Post[]) {
    // Store in search index (Meilisearch, Algolia, etc.)
    await this.searchEngine.addDocuments(posts);
  }
}
```

#### 6. Trending Algorithm (Local)

Each instance calculates trending content independently.

```sql
-- Trending posts (last 24 hours)
SELECT
  p.id,
  p.content,
  p.created_at,
  COUNT(DISTINCT l.user_id) as like_count,
  COUNT(DISTINCT c.id) as comment_count,
  COUNT(DISTINCT s.user_id) as share_count,
  (
    COUNT(DISTINCT l.user_id) * 1.0 +
    COUNT(DISTINCT c.id) * 2.0 +
    COUNT(DISTINCT s.user_id) * 3.0
  ) / (EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600) as trending_score
FROM posts p
LEFT JOIN likes l ON p.id = l.post_id
LEFT JOIN comments c ON p.id = c.post_id
LEFT JOIN shares s ON p.id = s.post_id
WHERE p.created_at > NOW() - INTERVAL '24 hours'
GROUP BY p.id
ORDER BY trending_score DESC
LIMIT 20;
```

---

## Metadata Synchronization Performance

### Problem

ActivityPub federation can be slow when synchronizing across many instances, leading to delays in timeline updates.

### Solution: Optimize Federation Delivery

#### 1. Asynchronous Federation

Never block API requests on federation delivery.

```typescript
// User posts → Immediately return success → Federation happens in background
async function createPost(userId: string, content: string, magnetLink: string) {
  // 1. Save post to local database (fast)
  const post = await db.posts.create({
    userId,
    content,
    magnetLink,
    createdAt: new Date()
  });

  // 2. Return immediately to user
  res.status(201).json({ success: true, postId: post.id });

  // 3. Queue federation job (async)
  await jobQueue.add('federate-post', {
    postId: post.id,
    userId
  });
}
```

#### 2. Batch Deliveries

Group activities by instance to reduce HTTP requests.

```go
// Batch multiple activities to same instance
type FederationBatch struct {
    TargetInstance string
    Activities     []Activity
}

func BatchFederationJobs(activities []Activity) []FederationBatch {
    batches := make(map[string][]Activity)

    for _, activity := range activities {
        instance := getInstanceFromActor(activity.Actor)
        batches[instance] = append(batches[instance], activity)
    }

    result := make([]FederationBatch, 0, len(batches))
    for instance, activities := range batches {
        result = append(result, FederationBatch{
            TargetInstance: instance,
            Activities:     activities,
        })
    }
    return result
}
```

#### 3. Circuit Breaker Pattern

Don't waste time on failing instances.

```typescript
import CircuitBreaker from 'opossum';

const federationBreaker = new CircuitBreaker(sendToInstance, {
  timeout: 3000, // 3 second timeout
  errorThresholdPercentage: 50, // Open circuit if 50% fail
  resetTimeout: 30000 // Try again after 30 seconds
});

federationBreaker.fallback(() => {
  // Instance is down, queue for retry later
  queueForRetry();
});

async function sendToInstance(instance: string, activity: Activity) {
  return await federationBreaker.fire(instance, activity);
}
```

#### 4. Caching Layer

Cache frequently accessed federated data.

```typescript
import Redis from 'ioredis';
const redis = new Redis();

async function getUserFromRemoteInstance(instanceUrl: string, userId: string) {
  // Check cache first
  const cached = await redis.get(`user:${instanceUrl}:${userId}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from remote instance
  const response = await fetch(`${instanceUrl}/api/v1/accounts/${userId}`);
  const user = await response.json();

  // Cache for 1 hour
  await redis.setex(`user:${instanceUrl}:${userId}`, 3600, JSON.stringify(user));

  return user;
}
```

#### 5. Pagination and Cursor-Based Loading

Don't load entire timelines at once.

```sql
-- Cursor-based pagination (more efficient than OFFSET)
SELECT * FROM posts
WHERE created_at < :cursor_timestamp
  AND user_id IN (SELECT following_id FROM follows WHERE follower_id = :user_id)
ORDER BY created_at DESC
LIMIT 20;
```

```typescript
// API response includes cursor for next page
{
  "posts": [...],
  "nextCursor": "2025-01-15T10:30:00Z",
  "hasMore": true
}
```

---

## Cold Start Problem (No Seeders)

### Problem

New uploads have no seeders except the original uploader. If they go offline, content becomes unavailable.

### Solution: Multi-Tier Seeding Strategy

#### 1. Uploader Seeding Commitment

```typescript
class UploadManager {
  async uploadMedia(file: File): Promise<string> {
    // Create torrent
    const torrent = await this.createTorrent(file);

    // Start seeding
    await this.torrentEngine.seed(torrent);

    // Commit to seed for 48 hours
    await this.seedingScheduler.schedule(torrent, {
      minimumDuration: 48 * 60 * 60, // 48 hours in seconds
      batteryPolicy: 'smart' // Pause if battery low, resume when charging
    });

    // Announce aggressively
    await this.announceToTrackers(torrent, { interval: 5 * 60 }); // Every 5 min

    return torrent.magnetLink;
  }
}
```

#### 2. Instance-Level Seeding

Metadata nodes optionally seed popular local content.

```go
// Automatic instance seeding for local posts
type InstanceSeeder struct {
    torrentClient *libtorrent.Session
    db            *sql.DB
}

func (s *InstanceSeeder) SeedPopularContent() {
    // Find popular posts from last 7 days
    posts := s.db.Query(`
        SELECT magnet_link, file_size
        FROM posts
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND like_count > 10
        ORDER BY like_count DESC
        LIMIT 100
    `)

    for _, post := range posts {
        // Download and seed if not already seeding
        if !s.torrentClient.IsSeed(post.MagnetLink) {
            s.torrentClient.AddMagnet(post.MagnetLink)
        }
    }
}
```

**Storage Management:**
```go
// LRU eviction when storage full
func (s *InstanceSeeder) EvictOldContent() {
    totalSize := s.torrentClient.GetTotalSize()
    maxSize := 100 * 1024 * 1024 * 1024 // 100 GB limit

    if totalSize > maxSize {
        // Remove least recently accessed torrents
        torrents := s.torrentClient.GetTorrents()
        sort.Slice(torrents, func(i, j int) bool {
            return torrents[i].LastActive.Before(torrents[j].LastActive)
        })

        for _, torrent := range torrents {
            s.torrentClient.Remove(torrent.Hash)
            totalSize -= torrent.Size

            if totalSize <= maxSize {
                break
            }
        }
    }
}
```

#### 3. Viewer Seeding

Users who view content automatically become seeders.

```swift
// iOS: Automatic seeding after viewing
class MediaPlayer {
    func playVideo(magnetLink: String) async {
        // Download and play
        let torrent = await torrentEngine.download(magnetLink)
        await videoPlayer.play(torrent.file)

        // Continue seeding for 6 hours after viewing
        await seedingScheduler.schedule(torrent, duration: 6 * 3600)
    }
}
```

#### 4. HTTP Fallback (CDN)

If no seeders are available, fall back to HTTP delivery.

```typescript
// P2P Media Loader with HTTP fallback
const loader = new P2PMediaLoader({
  segments: {
    swarmId: torrentInfoHash,
    trackerAnnounce: ['wss://tracker.example.com'],
  },
  // HTTP fallback URLs
  httpSegmentUrl: (segment) => {
    return `https://cdn.tortok.com/media/${torrentInfoHash}/${segment.id}`;
  },
  // Prioritize P2P, fallback to HTTP if no peers
  p2pLoader: {
    simultaneousHttpDownloads: 3,
    httpDownloadProbability: 0.1, // Prefer P2P 90% of time
  }
});
```

**CDN Implementation:**
```bash
# Cloudflare R2 + Workers
# Automatically fetch from metadata node if not cached

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const cache = caches.default;
  let response = await cache.match(request);

  if (!response) {
    // Fetch from origin (metadata node)
    response = await fetch(request);
    // Cache for 30 days
    event.waitUntil(cache.put(request, response.clone()));
  }

  return response;
}
```

#### 5. Seed Incentives

Gamification and community encouragement.

**User Profile Stats:**
```
@alice's Profile
━━━━━━━━━━━━━━━
Seeding Stats:
  • Total uploaded: 50.2 GB
  • Ratio: 2.5 (seed/leech)
  • Active seeds: 12
  • Badge: 🌟 Super Seeder

Contribution Rank: Top 5% of instance
```

**Reputation System:**
```sql
CREATE TABLE user_seeding_stats (
    user_id UUID PRIMARY KEY,
    total_uploaded BIGINT DEFAULT 0, -- bytes
    total_downloaded BIGINT DEFAULT 0,
    active_seeds INT DEFAULT 0,
    reputation_score INT GENERATED ALWAYS AS (
        LEAST(100, (total_uploaded / NULLIF(total_downloaded, 0))::int * 20)
    ) STORED
);

-- Users with high reputation get perks
-- e.g., higher upload limits, verified badge, etc.
```

---

## Video Format Optimization for P2P

### Problem

Large video files are slow to download on mobile networks and difficult to stream via P2P.

### Solution: Adaptive Bitrate Streaming with Chunking

#### HLS (HTTP Live Streaming) Format

**Chunking Strategy:**

```bash
# FFmpeg command to create HLS chunks
ffmpeg -i input.mp4 \
  -c:v libx264 -c:a aac \
  -f hls \
  -hls_time 4 \  # 4-second segments
  -hls_playlist_type vod \
  -hls_segment_filename 'segment_%03d.ts' \
  -hls_flags independent_segments \
  -master_pl_name master.m3u8 \
  \
  # Multiple quality levels
  -map 0:v -map 0:a -s:v:0 1920x1080 -b:v:0 5000k -maxrate:v:0 5350k \
  -map 0:v -map 0:a -s:v:1 1280x720 -b:v:1 2800k -maxrate:v:1 2996k \
  -map 0:v -map 0:a -s:v:2 854x480 -b:v:2 1400k -maxrate:v:2 1498k \
  -map 0:v -map 0:a -s:v:3 640x360 -b:v:3 800k -maxrate:v:3 856k \
  \
  output_%v.m3u8
```

**Output Structure:**
```
video/
├── master.m3u8        # Master playlist
├── 1080p.m3u8         # 1080p quality playlist
├── 720p.m3u8          # 720p quality playlist
├── 480p.m3u8          # 480p quality playlist
├── 360p.m3u8          # 360p quality playlist
├── segment_1080_000.ts
├── segment_1080_001.ts
├── segment_720_000.ts
└── ...
```

**Master Playlist (master.m3u8):**
```m3u8
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
```

#### On-Device Encoding (Mobile)

```swift
// iOS: Encode video to HLS on device before uploading
import AVFoundation

class VideoEncoder {
    func encodeToHLS(sourceURL: URL, outputDir: URL) async throws {
        let asset = AVAsset(url: sourceURL)

        // Create export session
        guard let exportSession = AVAssetExportSession(
            asset: asset,
            presetName: AVAssetExportPreset1280x720
        ) else {
            throw EncodingError.exportSessionFailed
        }

        exportSession.outputURL = outputDir.appendingPathComponent("output.m3u8")
        exportSession.outputFileType = .m3u8 // HLS

        await exportSession.export()

        if exportSession.status != .completed {
            throw EncodingError.encodingFailed(exportSession.error)
        }
    }
}
```

#### P2P Chunk Prioritization

```typescript
// Download chunks just-in-time for playback
class ChunkScheduler {
  private currentPosition: number = 0;
  private downloadedChunks: Set<number> = new Set();

  getPriority(chunkIndex: number): number {
    const distance = Math.abs(chunkIndex - this.currentPosition);

    if (distance === 0) return 10; // Currently playing
    if (distance <= 5) return 9;   // Next 20 seconds (5 chunks × 4s)
    if (distance <= 15) return 5;  // Next minute
    if (distance <= 30) return 2;  // Next 2 minutes
    return 1;                      // Rest of video
  }

  async downloadChunks(chunks: Chunk[]) {
    // Sort by priority
    chunks.sort((a, b) => this.getPriority(b.index) - this.getPriority(a.index));

    // Download high-priority chunks first
    for (const chunk of chunks) {
      if (!this.downloadedChunks.has(chunk.index)) {
        await this.downloadChunk(chunk);
      }
    }
  }
}
```

#### Codec Selection

**H.264 vs H.265 vs AV1:**

| Codec | Compression | Compatibility | Encode Speed | Recommendation |
|-------|-------------|---------------|--------------|----------------|
| H.264 | Baseline | Universal | Fast | ✅ Primary |
| H.265 | 50% better | iOS/Android native | Medium | ⚠️ Optional |
| AV1 | 60% better | Limited hardware | Slow | ❌ Future |

**Recommendation:**
- **Primary:** H.264 (universal compatibility)
- **Optional:** H.265 for users who opt-in (50% bandwidth savings)

#### Quality Presets

```typescript
interface QualityPreset {
  name: string;
  resolution: string;
  bitrate: number; // kbps
  fps: number;
}

const QUALITY_PRESETS: QualityPreset[] = [
  { name: '1080p', resolution: '1920x1080', bitrate: 5000, fps: 30 },
  { name: '720p',  resolution: '1280x720',  bitrate: 2800, fps: 30 },
  { name: '480p',  resolution: '854x480',   bitrate: 1400, fps: 30 },
  { name: '360p',  resolution: '640x360',   bitrate: 800,  fps: 30 },
];

// Auto-select based on network speed
function selectQuality(bandwidthKbps: number): QualityPreset {
  for (const preset of QUALITY_PRESETS) {
    if (bandwidthKbps >= preset.bitrate * 1.5) {
      return preset;
    }
  }
  return QUALITY_PRESETS[QUALITY_PRESETS.length - 1]; // Lowest quality
}
```

---

## Storage Limits on Mobile

### Problem

Mobile devices have limited storage, but torrenting requires storing downloaded content.

### Solution: Intelligent Cache Management

#### 1. Configurable Cache Size

```kotlin
// Android: User-configurable cache
object CacheSettings {
    enum class CacheSize(val bytes: Long) {
        SMALL(512 * 1024 * 1024),  // 512 MB
        MEDIUM(2 * 1024 * 1024 * 1024),  // 2 GB
        LARGE(5 * 1024 * 1024 * 1024),   // 5 GB
        UNLIMITED(Long.MAX_VALUE)
    }

    fun setMaxCacheSize(size: CacheSize) {
        preferences.edit()
            .putLong("max_cache_size", size.bytes)
            .apply()

        // Trigger eviction if over limit
        enforceLimit()
    }
}
```

#### 2. LRU Eviction Strategy

```swift
// iOS: Least Recently Used cache eviction
class TorrentCache {
    struct CachedTorrent {
        let hash: String
        let size: Int64
        let lastAccessed: Date
        let filePath: URL
    }

    private var cache: [String: CachedTorrent] = [:]
    private let maxSize: Int64

    func addTorrent(_ torrent: CachedTorrent) {
        cache[torrent.hash] = torrent
        enforceLimit()
    }

    func accessTorrent(_ hash: String) {
        guard var torrent = cache[hash] else { return }
        torrent.lastAccessed = Date()
        cache[hash] = torrent
    }

    private func enforceLimit() {
        let totalSize = cache.values.reduce(0) { $0 + $1.size }

        guard totalSize > maxSize else { return }

        // Sort by last accessed (oldest first)
        let sorted = cache.values.sorted { $0.lastAccessed < $1.lastAccessed }

        var sizeToFree = totalSize - maxSize
        for torrent in sorted {
            if sizeToFree <= 0 { break }

            // Delete file
            try? FileManager.default.removeItem(at: torrent.filePath)

            // Remove from cache
            cache.removeValue(forKey: torrent.hash)

            sizeToFree -= torrent.size
        }
    }
}
```

#### 3. Streaming-Only Mode

Don't persist chunks to disk—stream directly to memory.

```typescript
// Stream to memory buffer instead of disk
class MemoryStreamer {
  private buffers: Map<string, ArrayBuffer> = new Map();
  private maxMemory: number = 100 * 1024 * 1024; // 100 MB

  async streamChunk(chunkId: string, data: ArrayBuffer) {
    // Store in memory
    this.buffers.set(chunkId, data);

    // Evict old chunks if over limit
    this.enforceMemoryLimit();

    // Pass to video player
    await this.videoPlayer.appendBuffer(data);

    // After playing, delete from memory
    setTimeout(() => {
      this.buffers.delete(chunkId);
    }, 30000); // Keep for 30s in case of buffering
  }

  private enforceMemoryLimit() {
    const totalSize = Array.from(this.buffers.values())
      .reduce((sum, buf) => sum + buf.byteLength, 0);

    if (totalSize > this.maxMemory) {
      // Delete oldest chunks
      const oldest = Array.from(this.buffers.keys())[0];
      this.buffers.delete(oldest);
    }
  }
}
```

#### 4. Automatic Cleanup

```kotlin
// Android: Clean up old content periodically
class CacheCleanupWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val threshold = System.currentTimeMillis() - 24 * 60 * 60 * 1000 // 24 hours

        // Delete files older than threshold
        val cacheDir = applicationContext.cacheDir
        cacheDir.listFiles()?.forEach { file ->
            if (file.lastModified() < threshold) {
                file.delete()
            }
        }

        return Result.success()
    }
}

// Schedule daily cleanup
val cleanupRequest = PeriodicWorkRequestBuilder<CacheCleanupWorker>(
    1, TimeUnit.DAYS
).build()

WorkManager.getInstance(context).enqueue(cleanupRequest)
```

---

## Content Moderation in Decentralized System

### Problem

Illegal or harmful content can spread across federated network. How to moderate without centralized control?

### Solution: Multi-Level Moderation

#### 1. Instance-Level Moderation

Each instance admin has full control over local content.

```sql
-- Admin removes post (soft delete)
UPDATE posts SET
  deleted = true,
  deleted_at = NOW(),
  deleted_by = :admin_id,
  delete_reason = :reason
WHERE id = :post_id;

-- Also remove from federation
INSERT INTO moderation_actions (post_id, action, reason)
VALUES (:post_id, 'DELETE', :reason);
```

#### 2. User Reporting System

```typescript
// Users can report content
interface Report {
  reportedPostId: string;
  reportedBy: string;
  reason: 'spam' | 'nsfw' | 'illegal' | 'harassment' | 'other';
  details: string;
  createdAt: Date;
}

async function reportPost(report: Report) {
  await db.reports.create(report);

  // Notify moderators
  await notifyModerators(report);

  // Auto-hide if multiple reports
  const reportCount = await db.reports.count({
    where: { reportedPostId: report.reportedPostId }
  });

  if (reportCount >= 3) {
    await autoHidePost(report.reportedPostId);
  }
}
```

#### 3. Instance Blocking (Defederation)

Instances can block other instances entirely.

```go
// Block another instance
func BlockInstance(instanceURL string, reason string) error {
    return db.Create(&BlockedInstance{
        URL:       instanceURL,
        Reason:    reason,
        BlockedAt: time.Now(),
    }).Error
}

// Check if instance is blocked before federating
func IsInstanceBlocked(instanceURL string) bool {
    var count int64
    db.Model(&BlockedInstance{}).Where("url = ?", instanceURL).Count(&count)
    return count > 0
}
```

#### 4. Shared Block Lists

Community-maintained lists of problematic instances.

```typescript
// Import shared block list
async function importBlockList(url: string) {
  const response = await fetch(url);
  const blockList: BlockListEntry[] = await response.json();

  for (const entry of blockList) {
    await db.blockedInstances.upsert({
      where: { url: entry.instance },
      update: { reason: entry.reason },
      create: {
        url: entry.instance,
        reason: entry.reason,
        source: 'community-blocklist'
      }
    });
  }
}

// Popular block lists
const BLOCK_LISTS = [
  'https://blocklist.tortok.org/spam.json',
  'https://fediblock.org/blocklist.json'
];
```

#### 5. NSFW Detection

On-device or server-side AI classification.

```python
# Server-side NSFW detection (Python)
from tensorflow import keras
import numpy as np
from PIL import Image

class NSFWDetector:
    def __init__(self):
        self.model = keras.models.load_model('nsfw_model.h5')

    def classify(self, image_path: str) -> dict:
        img = Image.open(image_path).resize((224, 224))
        img_array = np.array(img) / 255.0
        img_array = np.expand_dims(img_array, 0)

        prediction = self.model.predict(img_array)[0]

        return {
            'sfw': float(prediction[0]),
            'nsfw': float(prediction[1]),
            'is_nsfw': prediction[1] > 0.7
        }

# Auto-tag NSFW posts
detector = NSFWDetector()
result = detector.classify('uploaded_image.jpg')

if result['is_nsfw']:
    db.execute("UPDATE posts SET nsfw = true WHERE id = ?", post_id)
```

#### 6. Content Warnings

Users can mark and filter sensitive content.

```sql
-- Content warning system
ALTER TABLE posts ADD COLUMN content_warning VARCHAR(255);
ALTER TABLE posts ADD COLUMN is_sensitive BOOLEAN DEFAULT false;

-- User preferences
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY,
    hide_nsfw BOOLEAN DEFAULT true,
    hide_sensitive BOOLEAN DEFAULT false,
    hide_content_warnings TEXT[] DEFAULT ARRAY[]::TEXT[]
);

-- Filter timeline based on preferences
SELECT p.* FROM posts p
WHERE NOT (
    (p.is_sensitive AND :user_hides_sensitive) OR
    (p.nsfw AND :user_hides_nsfw) OR
    (p.content_warning = ANY(:user_hidden_warnings))
)
ORDER BY created_at DESC;
```

---

## Privacy and Anonymity

### Problem

BitTorrent reveals IP addresses to peers. How to protect user privacy?

### Solution: Optional Privacy Features

#### 1. VPN Support

Encourage VPN usage and detect VPN status.

```kotlin
// Android: Detect if user is using VPN
fun isVpnActive(): Boolean {
    val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = connectivityManager.activeNetwork ?: return false
    val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false

    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
}

// Warn user if not using VPN
if (!isVpnActive() && userWantsPrivacy) {
    showVpnRecommendation()
}
```

#### 2. Tor Support (Experimental)

Route metadata API calls through Tor.

```typescript
// Use SOCKS5 proxy for Tor
import { SocksProxyAgent } from 'socks-proxy-agent';

const torProxy = new SocksProxyAgent('socks5://127.0.0.1:9050');

async function fetchViaFor(url: string) {
  const response = await fetch(url, {
    agent: torProxy
  });
  return response.json();
}
```

**Limitation:** BitTorrent over Tor is discouraged (slow, high latency)

#### 3. TURN-Only Mode

Use TURN relay for all P2P connections (hides IP from peers).

```typescript
// Force TURN relay (no direct P2P)
const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'turn:turn.tortok.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ],
  iceTransportPolicy: 'relay' // Force relay, no direct connections
});
```

**Trade-off:** Higher bandwidth cost, slower speeds

#### 4. Private Instances

Instances that don't federate publicly.

```yaml
# Instance configuration
instance:
  federation:
    mode: private # 'public', 'private', 'whitelist'
    whitelist:
      - https://trusted-instance1.com
      - https://trusted-instance2.com

  discovery:
    public_timeline: false  # Don't expose public timeline
    user_directory: false    # Don't list users publicly
```

---

## Spam and Abuse Prevention

### Problem

Decentralized systems are vulnerable to spam, bots, and abuse.

### Solution: Multi-Layered Protection

#### 1. Rate Limiting

```go
// Redis-based rate limiting
func CheckRateLimit(userID string, action string) error {
    key := fmt.Sprintf("ratelimit:%s:%s", userID, action)
    count, err := redisClient.Incr(ctx, key).Result()
    if err != nil {
        return err
    }

    // Set expiry on first request
    if count == 1 {
        redisClient.Expire(ctx, key, time.Hour)
    }

    // Limits
    limits := map[string]int64{
        "post":    10,  // 10 posts per hour
        "follow":  30,  // 30 follows per hour
        "like":    100, // 100 likes per hour
    }

    if count > limits[action] {
        return errors.New("rate limit exceeded")
    }

    return nil
}
```

#### 2. New Account Restrictions

```sql
-- Restrict new accounts
CREATE TABLE account_restrictions (
    user_id UUID PRIMARY KEY,
    created_at TIMESTAMP,
    post_limit INT DEFAULT 3,      -- Only 3 posts per day for first week
    follow_limit INT DEFAULT 10,   -- Only 10 follows per day
    restrictions_until TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
);

-- Check if user can post
SELECT COUNT(*) FROM posts
WHERE user_id = :user_id
  AND created_at > NOW() - INTERVAL '1 day'
HAVING COUNT(*) < (
    SELECT post_limit FROM account_restrictions WHERE user_id = :user_id
);
```

#### 3. CAPTCHA on Registration

```typescript
// Use hCaptcha or reCAPTCHA
import axios from 'axios';

async function verifyCaptcha(token: string): Promise<boolean> {
  const response = await axios.post('https://hcaptcha.com/siteverify', {
    secret: process.env.HCAPTCHA_SECRET,
    response: token
  });

  return response.data.success;
}

// Registration endpoint
app.post('/api/v1/register', async (req, res) => {
  const { username, password, captchaToken } = req.body;

  // Verify CAPTCHA
  if (!await verifyCaptcha(captchaToken)) {
    return res.status(400).json({ error: 'Invalid CAPTCHA' });
  }

  // Create account
  await createUser(username, password);
});
```

#### 4. Proof-of-Work for Posting

```typescript
// Require computational work for each post
import crypto from 'crypto';

function verifyProofOfWork(content: string, nonce: number, difficulty: number): boolean {
  const hash = crypto.createHash('sha256')
    .update(content + nonce.toString())
    .digest('hex');

  const prefix = '0'.repeat(difficulty);
  return hash.startsWith(prefix);
}

// Client must find valid nonce before posting
async function createPost(content: string) {
  let nonce = 0;
  const difficulty = 4; // Requires ~16 attempts on average

  while (!verifyProofOfWork(content, nonce, difficulty)) {
    nonce++;
  }

  // Submit post with proof
  await api.post('/posts', { content, nonce });
}
```

#### 5. Reputation System

```sql
-- User reputation score
CREATE TABLE user_reputation (
    user_id UUID PRIMARY KEY,
    score INT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- Increase reputation for positive actions
CREATE OR REPLACE FUNCTION update_reputation()
RETURNS TRIGGER AS $$
BEGIN
    -- Getting followed: +1
    -- Getting liked: +0.5
    -- Seeding content: +2 per GB
    UPDATE user_reputation
    SET score = score + NEW.points,
        last_updated = NOW()
    WHERE user_id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Users with low reputation face stricter rate limits
SELECT post_limit FROM account_restrictions
WHERE user_id = :user_id
  AND (SELECT score FROM user_reputation WHERE user_id = :user_id) < 10;
```

---

## Summary

These solutions address the major technical challenges in building a decentralized Instagram-like platform:

1. **Battery Drain**: Battery-aware seeding with user controls
2. **NAT Traversal**: WebRTC with STUN/TURN infrastructure
3. **Discovery**: Multi-layer approach (local search, federation, DHT, relays)
4. **Federation Performance**: Async jobs, batching, circuit breakers
5. **Cold Start**: Multi-tier seeding (uploader, instance, viewers, CDN fallback)
6. **Video Optimization**: HLS adaptive streaming with chunk prioritization
7. **Storage**: LRU cache eviction and streaming-only mode
8. **Moderation**: Instance-level control, defederation, shared blocklists
9. **Privacy**: VPN support, TURN-only mode, private instances
10. **Spam**: Rate limiting, new account restrictions, CAPTCHA, PoW, reputation

The key insight is that **no single solution is perfect**—combining multiple strategies creates a robust, resilient system that can scale while maintaining decentralization.

## Next Steps

- [System Architecture](../architecture/system-architecture.md)
- [Technology Stack](../architecture/technology-stack.md)
- [Metadata Node Deployment](../deployment/metadata-node.md)
- [MVP Specification](../../designs/mvp-specification.md)
