# TorTok: Decentralized Video Reels Platform

**"TikTok meets BitTorrent"**

A decentralized, peer-to-peer short-form video platform where video reels are streamed via BitTorrent and metadata is managed through federated nodes.

## 🚀 Quick Start - See It Run!

Want to see TorTok running right now?

```bash
cd /Users/roberttaylor/Code/tortok
./run-demo.sh
```

This opens a standalone demo in Xcode. Follow the on-screen instructions to see the full UI in ~2 minutes!

📖 **For detailed setup instructions**: See [HOW_TO_RUN.md](HOW_TO_RUN.md)

## Core Concept

TorTok combines the best of federated social networks (like Mastodon) with peer-to-peer video streaming (using HLS + WebRTC) to create a scalable, decentralized alternative to TikTok/Instagram Reels - with zero video hosting costs.

### Key Features

- **Short-Form Vertical Video**: 15-60 second video reels, like TikTok/Instagram Reels
- **P2P Video Streaming**: HLS adaptive bitrate streaming over WebRTC + BitTorrent
- **Zero Hosting Costs**: Peer-to-peer delivery eliminates video bandwidth costs (~90% savings)
- **Federated Metadata**: User profiles, posts, and social graphs managed by federated metadata nodes
- **iOS-First MVP**: Native iOS app with foreground seeding and battery optimization
- **Open Source**: MIT licensed, built on proven technologies (LibTorrent, P2P Media Loader)
- **Easy Deployment**: Simple deployment of metadata nodes on cloud platforms
- **Instance Moderation**: Distributed trust model with instance-level controls

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                iOS APP (Swift + AVFoundation)                │
│  • Record vertical video (15-60s)                           │
│  • Encode to HLS (720p, 480p, 360p)                         │
│  • Create torrents from HLS segments                        │
│  • Stream videos via P2P + HTTP fallback                    │
│  • Foreground seeding while watching                        │
└──────────────────────────────────────────────────────────────┘
                            ↕ (HTTPS + WebSocket)
┌──────────────────────────────────────────────────────────────┐
│              FEDERATED METADATA NODES                        │
│  • Store video metadata (caption, magnet link, thumbnail)   │
│  • Manage user profiles, follows, likes                     │
│  • Federation with other instances (future)                 │
│  • REST API + WebSocket for real-time feed                  │
└──────────────────────────────────────────────────────────────┘

Meanwhile, HLS video streaming flows peer-to-peer:
iOS App A ←─── HLS over WebRTC + BitTorrent ───→ iOS App B
      ↕                                              ↕
  P2P Media Loader + DHT + STUN/TURN
```

## Documentation

### Architecture & Design
- [System Architecture](docs/architecture/system-architecture.md) - Complete system design and component interaction
- [Technology Stack](docs/architecture/technology-stack.md) - Selected technologies and justifications
- [Data Models](docs/architecture/data-models.md) - Database schemas and data structures
- [Federation Protocol](docs/architecture/federation-protocol.md) - Metadata synchronization specification

### Deployment
- [Metadata Node Deployment](docs/deployment/metadata-node.md) - Deploy your own metadata instance
- [Infrastructure Setup](docs/deployment/infrastructure.md) - Cloud infrastructure configuration
- [Monitoring & Operations](docs/deployment/monitoring.md) - Running and maintaining nodes

### Guides
- [Technical Challenges](docs/guides/technical-challenges.md) - Key challenges and solutions
- [Mobile Development](docs/guides/mobile-development.md) - Building the mobile apps
- [P2P Streaming](docs/guides/p2p-streaming.md) - Implementing torrent-based media delivery
- [Security & Privacy](docs/guides/security.md) - Security considerations

### Prototypes & Designs
- [Video Reels MVP Specification](designs/mvp-video-reels-specification.md) - iOS-first video reels MVP
- [iOS MVP Specification](designs/mvp-ios-specification.md) - Original iOS specification
- [API Specification](designs/api-specification.md) - REST API documentation (TBD)

## Research & References

This project builds on extensive research into:
- **Mobile Torrent**: libtorrent, iTorrent (iOS), LibreTorrent (Android)
- **P2P Streaming**: P2P Media Loader, WebRTC, HLS adaptive streaming
- **Federation**: ActivityPub, PeerTube architecture, Mastodon patterns
- **Decentralized Systems**: IPFS, libp2p, DHT-based discovery

See [Research Summary](docs/research-summary.md) for complete findings.

## Technology Stack

### iOS App (MVP)
- **Language**: Swift 5.9+
- **UI Framework**: SwiftUI
- **Video**: AVFoundation (recording, encoding, playback)
- **Torrent**: LibTorrent (C++ with Obj-C++ bridge)
- **P2P**: P2P Media Loader + WebRTC
- **Networking**: Alamofire
- **Caching**: GRDB.swift (SQLite)
- **Image Loading**: Kingfisher

### Metadata Server
- **Backend**: TypeScript/Node.js (MVP) or Go (production)
- **Framework**: Fastify or Express
- **Database**: PostgreSQL
- **Cache**: Redis
- **Jobs**: BullMQ for async processing
- **Deployment**: Docker on Google Cloud Run

### Video Format
- **Container**: HLS (HTTP Live Streaming)
- **Codec**: H.264 (universal) or H.265 (better compression)
- **Qualities**: 720p, 480p, 360p (adaptive bitrate)
- **Segment Length**: 4 seconds
- **Frame Rate**: 30 FPS

### Infrastructure
- **STUN**: Free public STUN servers (Google, Mozilla)
- **TURN**: Self-hosted coturn ($15-30/month)
- **Trackers**: Public BitTorrent trackers
- **Storage**: Cloudflare R2 or S3 (thumbnails + HTTP fallback)

## Getting Started

### For Users
1. Download the mobile app (iOS/Android)
2. Create account on a metadata instance
3. Start sharing photos and videos

### For Instance Admins
1. See [Metadata Node Deployment Guide](docs/deployment/metadata-node.md)
2. Deploy using provided Docker images
3. Configure federation with other instances

### For Developers
1. Read the [System Architecture](docs/architecture/system-architecture.md)
2. Review the [Video Reels MVP Specification](designs/mvp-video-reels-specification.md)
3. Follow the [iOS Development Guide](docs/guides/ios-development.md)
4. Check out [Technical Challenges & Solutions](docs/guides/technical-challenges.md)

## Project Status

**Current Phase**: Architecture & Research → Ready for Development

- [x] Technology research completed
- [x] Architecture design completed
- [x] MVP specification finalized (video reels focus)
- [ ] iOS app development starting
- [ ] Metadata server development starting
- [ ] Beta testing (3-4 months out)
- [ ] Production release (6-8 months out)

## Contributing

This is currently a research and design project. Once the architecture is finalized, we'll welcome contributions for:
- Mobile app development (iOS/Android)
- Metadata server implementation
- Infrastructure tooling
- Documentation

## License

TBD (To be determined based on project direction)

## Contact & Community

- **GitHub**: [Repository will be public once prototype is ready]
- **Documentation**: This repository
- **Discussions**: [To be created]

## Acknowledgments

This project is inspired by and builds upon:
- **PeerTube**: Federated video platform with P2P delivery
- **Mastodon**: Proven ActivityPub federation at scale
- **BitTorrent**: Decentralized file distribution protocol
- **WebTorrent/P2P Media Loader**: Browser-based P2P streaming

## Frequently Asked Questions

### Why BitTorrent instead of IPFS?
BitTorrent is more mature for large media files and has better mobile library support. IPFS could be used for thumbnails and metadata in future versions.

### How do you handle illegal content?
Instance administrators moderate local content. Federation allows instances to block other instances. The torrent protocol itself is neutral; enforcement happens at the metadata layer.

### What about battery drain from seeding?
Apps use battery-aware seeding: only seed when charging or battery >50%. Desktop clients and optional dedicated servers provide long-term availability.

### Can't torrents be tracked?
Users can optionally use VPNs. The system supports trackerless operation via DHT. Private instances can run their own trackers.

### How do you prevent spam?
Instance-level anti-spam measures, proof-of-work for posting, rate limiting, and federation blocklists.
