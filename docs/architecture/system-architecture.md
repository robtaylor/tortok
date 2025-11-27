# TorTok System Architecture

This document describes the complete system architecture for TorTok, a decentralized Instagram-like platform using BitTorrent for media delivery and federated nodes for metadata management.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [System Components](#system-components)
3. [Data Flow](#data-flow)
4. [Network Topology](#network-topology)
5. [Scalability Considerations](#scalability-considerations)
6. [Security Architecture](#security-architecture)

## Architecture Overview

TorTok uses a hybrid architecture that separates concerns:
- **Media Layer**: Fully decentralized P2P using BitTorrent protocol
- **Metadata Layer**: Federated instances using ActivityPub-inspired protocol
- **Discovery Layer**: DHT for peer discovery, federation for content discovery

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER (Mobile Apps)                  │
│                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  UI/UX Layer │  │ Torrent Engine │  │ P2P Media Player  │  │
│  │  (Native)    │  │ (libtorrent)   │  │ (P2P Media Loader)│  │
│  └──────────────┘  └────────────────┘  └───────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Metadata API Client (REST/WebSocket)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Local Storage (SQLite cache, media files)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                    (HTTPS for metadata)
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    METADATA LAYER (Federated)                   │
│                                                                 │
│  Instance 1            Instance 2            Instance N        │
│  ┌────────────┐        ┌────────────┐        ┌────────────┐    │
│  │ REST API   │        │ REST API   │        │ REST API   │    │
│  ├────────────┤        ├────────────┤        ├────────────┤    │
│  │ Federation │←──────→│ Federation │←──────→│ Federation │    │
│  │ Engine     │        │ Engine     │        │ Engine     │    │
│  ├────────────┤        ├────────────┤        ├────────────┤    │
│  │ PostgreSQL │        │ PostgreSQL │        │ PostgreSQL │    │
│  ├────────────┤        ├────────────┤        ├────────────┤    │
│  │ Object     │        │ Object     │        │ Object     │    │
│  │ Storage    │        │ Storage    │        │ Storage    │    │
│  └────────────┘        └────────────┘        └────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              ↕
                    (Federation Protocol)
                              ↕
                     Other Instances Worldwide

Meanwhile, MEDIA flows peer-to-peer:

Mobile App A ←──────── WebRTC Data Channels ────────→ Mobile App B
      ↕                                                     ↕
   DHT Node                                            DHT Node
      ↕                                                     ↕
┌─────────────────────────────────────────────────────────────────┐
│              INFRASTRUCTURE LAYER (Optional)                    │
│                                                                 │
│  • Public BitTorrent Trackers                                  │
│  • STUN Servers (NAT discovery)                                │
│  • TURN Servers (NAT relay fallback)                           │
│  • DHT Bootstrap Nodes                                         │
│  • Optional: Instance-run CDN (HTTP fallback)                  │
└─────────────────────────────────────────────────────────────────┘
```

## System Components

### 1. Mobile Applications (iOS/Android)

The mobile apps are the primary interface and also act as torrent seeders.

#### Responsibilities
- User interface for browsing, posting, and interacting
- Creating torrents from user-generated media
- Seeding torrents (battery-aware)
- Downloading media from peers via BitTorrent/WebRTC
- Communicating with metadata instances
- Local caching of feed data

#### Key Subsystems

**Torrent Engine**
- Library: libtorrent (C++ core)
  - iOS: iTorrent wrapper
  - Android: jlibtorrent/TorrentStream-Android wrapper
- Functions:
  - Create .torrent files or magnet links
  - Seed local media files
  - Download from peers
  - DHT participation

**P2P Media Player**
- Library: P2P Media Loader
- Protocol: HLS (HTTP Live Streaming) over WebRTC
- Functions:
  - Adaptive bitrate streaming
  - Peer discovery via WebRTC signaling
  - Chunk-based downloading with prioritization
  - HTTP fallback when P2P unavailable
  - Automatic quality switching

**Metadata Client**
- Protocol: REST API + WebSocket (for real-time updates)
- Functions:
  - Authentication (OAuth2/JWT)
  - Fetch user feed
  - Post new content
  - Social interactions (likes, comments, follows)
  - Push notifications

**Local Storage**
- Database: SQLite
  - Cached feed data
  - User profiles
  - Torrent metadata
- File System:
  - Downloaded media (with LRU eviction)
  - Thumbnails
  - User-created content awaiting upload

### 2. Federated Metadata Nodes

These are server instances that store user data and federate with each other.

#### Responsibilities
- User account management
- Store post metadata (text, magnet links, timestamps)
- Social graph (follows, followers, blocks)
- Federation with other instances
- Content moderation
- API for mobile clients

#### Key Subsystems

**REST API Server**
- Framework Options:
  - Go: Gin, Echo, or Fiber
  - TypeScript: Express, Fastify, or NestJS
- Endpoints:
  - `/api/v1/accounts` - User management
  - `/api/v1/posts` - Create/read posts
  - `/api/v1/timeline` - Get user feed
  - `/api/v1/social` - Follows, likes, etc.
- Authentication: JWT with refresh tokens

**Federation Engine**
- Protocol: Simplified ActivityPub
  - Activity types: Create, Update, Delete, Follow, Like, Announce
  - Actor model: Users and instances
  - Inbox/Outbox pattern
- Functions:
  - Send activities to remote instances
  - Receive and process remote activities
  - Instance discovery and verification
  - Signature verification (HTTP Signatures)

**Database**
- Primary: PostgreSQL
  - Tables: users, posts, follows, likes, instances, activities
  - Full-text search on posts
  - Indexes for timeline queries
- Alternative: SQLite for small instances

**Object Storage**
- Purpose: Thumbnails, profile pictures, banner images
- Options:
  - Self-hosted: MinIO
  - Cloud: AWS S3, Google Cloud Storage, Cloudflare R2
- Strategy:
  - Generate thumbnails server-side
  - Serve via CDN
  - Optional: Store thumbnails as tiny torrents too

**Background Jobs**
- Queue: Redis + Bull (Node.js) or NATS
- Jobs:
  - Federation delivery (async)
  - Thumbnail generation
  - Database cleanup
  - Analytics processing

### 3. P2P Media Delivery Layer

This layer handles the actual transfer of photos and videos between peers.

#### Components

**BitTorrent DHT (Distributed Hash Table)**
- Implementation: Mainline DHT (Kademlia-based)
- Functions:
  - Peer discovery without trackers
  - Decentralized torrent metadata lookup
  - Resilient to tracker failures

**WebRTC Signaling & Data Channels**
- Purpose: Establish direct peer connections
- Flow:
  1. App discovers peers via DHT or tracker
  2. Exchange connection info via signaling server (WebSocket)
  3. ICE negotiation (STUN for public IP, TURN if needed)
  4. Establish WebRTC data channel
  5. Transfer media chunks

**STUN Servers**
- Purpose: NAT traversal - discover public IP address
- Options: Public servers (Google, Mozilla) or self-hosted
- Cost: Free for public servers

**TURN Servers**
- Purpose: Relay traffic when direct P2P connection fails
- When needed: ~15-30% of mobile connections (carrier-grade NAT)
- Implementation: coturn (open source)
- Cost: Bandwidth charges for relayed data

**Public BitTorrent Trackers**
- Purpose: Peer discovery and swarm coordination
- Examples: tracker.opentrackr.org, tracker.openbittorrent.com
- Optional: Run private tracker for network-specific content

### 4. Infrastructure Services

**Load Balancers**
- For metadata node API endpoints
- Options: nginx, HAProxy, or cloud load balancers

**CDN (Optional)**
- Accelerate metadata API responses
- Serve thumbnails globally
- Options: Cloudflare, Fastly, or self-hosted Varnish

**Monitoring**
- Metrics: Prometheus + Grafana
- Logging: ELK stack or Loki
- Alerting: PagerDuty or custom webhooks

**Backup & Recovery**
- Database backups (PostgreSQL WAL archiving)
- Object storage replication
- Disaster recovery procedures

## Data Flow

### Upload Flow (User Posts a Photo)

```
1. Mobile App
   ↓
   [User captures/selects photo]
   ↓
   [App compresses and optimizes image]
   ↓
   [App creates BitTorrent from image file]
   ↓
   [Generate magnet link: magnet:?xt=urn:btih:ABC123...]
   ↓
   [Start seeding torrent locally]
   ↓
   [Generate thumbnail (small JPEG)]
   ↓
   [HTTP POST to metadata node]
   {
     "content": "Beautiful sunset!",
     "magnet_link": "magnet:?xt=urn:btih:ABC123...",
     "media_type": "image",
     "thumbnail": "<base64 or upload separately>"
   }

2. Metadata Node (User's Home Instance)
   ↓
   [Authenticate request]
   ↓
   [Store post in database]
   ↓
   [Upload thumbnail to object storage]
   ↓
   [Queue federation job]
   ↓
   [Return success to app]

3. Federation (Background Job)
   ↓
   [Query database for user's followers]
   ↓
   [Group followers by instance]
   ↓
   [For each remote instance:]
     ↓
     [Create ActivityPub "Create" activity]
     {
       "@context": "https://www.w3.org/ns/activitystreams",
       "type": "Create",
       "actor": "https://instance1.com/users/alice",
       "object": {
         "type": "Note",
         "content": "Beautiful sunset!",
         "attachment": {
           "type": "Document",
           "mediaType": "image/jpeg",
           "url": "magnet:?xt=urn:btih:ABC123...",
           "thumbnail": "https://instance1.com/thumbnails/xyz.jpg"
         }
       }
     }
     ↓
     [Sign with HTTP Signatures]
     ↓
     [POST to remote instance inbox]

4. Remote Metadata Nodes
   ↓
   [Verify signature]
   ↓
   [Store activity in database]
   ↓
   [Update followers' timelines]

5. Mobile App (Seeding)
   ↓
   [Continue seeding for 24-48 hours]
   ↓
   [Battery-aware: pause if battery < 50%]
   ↓
   [Announce to DHT and tracker]
```

### Download Flow (User Views Feed Item)

```
1. Mobile App
   ↓
   [Fetch timeline from home metadata instance]
   ↓
   [Receive post metadata including magnet link]
   ↓
   [Display thumbnail (loaded from metadata node)]
   ↓
   [User taps to view full image/video]

2. P2P Download Initiation
   ↓
   [Parse magnet link]
   ↓
   [Query DHT for peers seeding this torrent]
   ↓
   [Contact tracker for peer list]
   ↓
   [Discover 10-50 peers]

3. WebRTC Connection Setup
   ↓
   [For each peer:]
     ↓
     [Connect to signaling server]
     ↓
     [Exchange ICE candidates]
     ↓
     [STUN query: determine public IP]
     ↓
     [Try direct connection]
     ↓
     [If fail: use TURN relay]
     ↓
     [Establish WebRTC data channel]

4. Media Streaming (for video)
   ↓
   [P2P Media Loader initialized with magnet link]
   ↓
   [Request HLS manifest from peers]
   ↓
   [Download video segments in priority order:]
     - Next 5 seconds (high priority)
     - Following 30 seconds (medium priority)
     - Rest of video (low priority)
   ↓
   [Adaptive bitrate: switch quality based on bandwidth]
   ↓
   [If no peers: HTTP fallback to CDN]
   ↓
   [Begin playback as soon as initial segments arrive]

5. Become Seeder
   ↓
   [Downloaded chunks are automatically seeded]
   ↓
   [Cache management: keep for N hours or until storage full]
   ↓
   [LRU eviction when cache limit reached]
```

### Federation Synchronization Flow

```
Instance A                 Instance B                 Instance C
    │                          │                          │
    │ User follows @bob@B      │                          │
    ├─────────────────────────→│                          │
    │  POST /inbox             │                          │
    │  Activity: Follow        │                          │
    │                          │                          │
    │←─────────────────────────┤                          │
    │  Accept                  │                          │
    │                          │                          │
    │                          │ @bob posts photo         │
    │                          │                          │
    │←─────────────────────────┤                          │
    │  POST /inbox             │                          │
    │  Activity: Create        │                          │
    │  (photo post)            │                          │
    │                          │                          │
    │ Store in DB              │                          │
    │ Add to follower timeline │                          │
    │                          │                          │
    │ User @alice boosts       │                          │
    ├─────────────────────────→│                          │
    │  Activity: Announce      ├─────────────────────────→│
    │                          │  Forward to @carol@C     │
```

## Network Topology

### Metadata Federation Topology

The metadata layer uses a **hub-and-spoke** model per instance with **mesh federation** globally:

```
      Instance A                Instance B
         Users                     Users
        /  |  \                   /  |  \
       U1  U2  U3                U4  U5  U6
           \    \_______  _______/   /
            \           \/          /
             \__________/\__________/
                Federation Links
```

**Characteristics:**
- Each user connects only to their home instance (spoke)
- Instances federate with instances that have followers/following (mesh)
- No global federation required (only federate where social graph demands)
- Scales horizontally with user distribution

### P2P Media Topology

The media layer uses a **pure peer-to-peer mesh**:

```
        App A ←──→ App B
         ↕ ╲       ╱ ↕
         ↕   ╲   ╱   ↕
         ↕     ╳     ↕
         ↕   ╱   ╲   ↕
         ↕ ╱       ╲ ↕
        App C ←──→ App D
```

**Characteristics:**
- No central point of failure
- Bandwidth scales with number of peers
- Each app is both client and server
- DHT provides decentralized peer discovery

### Hybrid Topology Advantages

1. **Metadata**: Federated model provides moderation, identity, and social graph
2. **Media**: P2P model eliminates bandwidth costs and scales automatically
3. **Best of both worlds**: Governance + Decentralization

## Scalability Considerations

### Horizontal Scaling

**Metadata Nodes:**
- Run multiple instances worldwide
- Geographic distribution reduces latency
- Each instance is independent (shared-nothing architecture)
- Database replication within instance (read replicas)

**P2P Layer:**
- Automatically scales with users
- More users = more seeders = better performance
- Popular content has many seeders
- Rare content may need instance-level seeding support

### Performance Optimization

**Metadata Queries:**
- Index on `user_id`, `created_at` for timeline queries
- Materialized views for complex aggregations
- Cache frequently accessed data in Redis
- Pagination with cursor-based approach

**Federation:**
- Async job processing (don't block on federation)
- Batch deliveries to same instance
- Circuit breaker pattern for failing instances
- Exponential backoff for retries

**Media Delivery:**
- Adaptive bitrate reduces bandwidth waste
- Chunk prioritization ensures smooth playback
- HTTP fallback prevents stalls
- Prefetching for next likely viewed content

### Storage Scaling

**Metadata:**
- PostgreSQL can handle billions of rows
- Partition by time if needed (archive old posts)
- Object storage is infinitely scalable

**Media (on mobile):**
- Aggressive cache eviction
- User-configurable cache size
- Stream-only mode (no persistent storage)

## Security Architecture

### Authentication & Authorization

**User Authentication:**
- OAuth2 with JWT access tokens (short-lived, 15 min)
- Refresh tokens (long-lived, stored in DB)
- Password hashing: Argon2id or bcrypt
- Optional: 2FA with TOTP

**Instance-to-Instance:**
- HTTP Signatures (ActivityPub standard)
- Each instance has keypair (RSA 2048-bit min)
- Verify all incoming federation requests

### Data Integrity

**Torrent Verification:**
- BitTorrent protocol includes SHA-1 hash verification
- Infohash prevents tampering
- Automatic rejection of corrupt chunks

**Metadata Integrity:**
- Digital signatures on activities
- Instance reputation system
- User-level blocking and instance-level defederation

### Privacy Considerations

**User Privacy:**
- HTTPS for all metadata API calls
- Optional: Tor support for metadata queries
- Magnet links reveal user is interested in content (similar to BitTorrent)
- DHT announces are semi-public (IP address visible to peers)

**Mitigation:**
- VPN support encouraged
- Option to use TURN-only mode (no direct P2P)
- Private instances (whitelist federation)

### Content Moderation

**Instance-Level:**
- Admin tools to remove posts (removes metadata, not torrent)
- User reporting system
- Automated NSFW detection (TensorFlow on-device or server-side)

**Federation-Level:**
- Block lists (instances can block other instances)
- Shared block lists (community-maintained)
- Content warnings and filters

### Attack Mitigation

**DoS Protection:**
- Rate limiting on API endpoints
- Federation request throttling
- CAPTCHA on registration
- Proof-of-work for posting (optional)

**Spam Prevention:**
- New account restrictions (post limit, follow limit)
- Reputation system (age of account, follower count)
- Instance admin approval for new users

**Sybil Attacks:**
- Instance-level identity verification
- Cost of running instance as barrier
- Federation web-of-trust

## Deployment Architecture

See [Metadata Node Deployment Guide](../deployment/metadata-node.md) for detailed deployment instructions.

### Single-Instance Deployment

For small communities (<1000 users):

```
┌────────────────────────────────────────┐
│         Google Cloud Run               │
│  ┌──────────────────────────────────┐  │
│  │  Metadata API (auto-scaling)     │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
               ↕
┌────────────────────────────────────────┐
│    Cloud SQL PostgreSQL (single zone)  │
└────────────────────────────────────────┘
               ↕
┌────────────────────────────────────────┐
│    Cloud Storage (thumbnails)          │
└────────────────────────────────────────┘
```

Cost: ~$30-50/month

### Multi-Region Deployment

For larger instances (>10,000 users):

```
   ┌──── Global Load Balancer ────┐
   │                               │
   ↓                               ↓
[Region: US]                  [Region: EU]
  API Cluster                   API Cluster
  PostgreSQL Primary            PostgreSQL Replica
  Redis Cache                   Redis Cache
  Object Storage               Object Storage
```

Cost: ~$500-1000/month

## Future Enhancements

1. **Live Streaming**: WebRTC-based live video with P2P distribution
2. **Stories**: Ephemeral content with automatic cleanup
3. **E2E Encryption**: Encrypted private messages using Signal Protocol
4. **Blockchain Verification**: Optional content hash anchoring for tamper-evidence
5. **Mobile-to-Mobile Sync**: Mesh networking for offline operation
6. **AI Moderation**: On-device NSFW detection and content classification

## References

- [Technology Stack Document](technology-stack.md)
- [Data Models](data-models.md)
- [Federation Protocol](federation-protocol.md)
- [P2P Streaming Guide](../guides/p2p-streaming.md)
- [Security Guide](../guides/security.md)
