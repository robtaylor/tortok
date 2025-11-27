# Technology Stack

This document details the recommended technologies, libraries, frameworks, and tools for building TorTok.

## Table of Contents
1. [Mobile Applications](#mobile-applications)
2. [Metadata Nodes](#metadata-nodes)
3. [Infrastructure Services](#infrastructure-services)
4. [Development Tools](#development-tools)
5. [Rationale & Alternatives](#rationale--alternatives)

## Mobile Applications

### iOS Application

**Language & Runtime:**
- **Swift 5.9+** - Modern, type-safe, optimized for iOS
- **iOS 16.0+** - Latest features while maintaining reasonable device support

**Core Libraries:**

| Component | Library | Version | Purpose |
|-----------|---------|---------|---------|
| Torrent Client | [iTorrent](https://github.com/XITRIX/iTorrent) | Latest | LibTorrent wrapper for iOS |
| P2P Streaming | Custom WebRTC + HLS | - | P2P Media Loader integration |
| Video Player | AVPlayer + AVFoundation | Native | HLS playback |
| Networking | URLSession + Alamofire | 5.8+ | HTTP API calls |
| WebSocket | Starscream | 4.0+ | Real-time updates |
| Database | GRDB.swift | 6.0+ | SQLite wrapper |
| Image Loading | Kingfisher | 7.0+ | Async image loading/caching |
| UI Framework | SwiftUI | Native | Modern declarative UI |

**Additional Dependencies:**
```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/XITRIX/iTorrent", from: "1.0.0"),
    .package(url: "https://github.com/Alamofire/Alamofire", from: "5.8.0"),
    .package(url: "https://github.com/daltoniam/Starscream", from: "4.0.0"),
    .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    .package(url: "https://github.com/onevcat/Kingfisher", from: "7.0.0"),
]
```

**WebRTC Integration:**
- **WebRTC Framework**: Google's WebRTC.framework
- **Installation**: Via CocoaPods or manual integration
- **Purpose**: NAT traversal, peer connections

**Architecture Pattern:**
- **MVVM** (Model-View-ViewModel) with SwiftUI
- **Combine** for reactive programming
- **Swift Concurrency** (async/await) for network calls

### Android Application

**Language & Runtime:**
- **Kotlin 1.9+** - Modern Android development
- **Android SDK**: API 26+ (Android 8.0+) - Covers 95%+ of devices

**Core Libraries:**

| Component | Library | Version | Purpose |
|-----------|---------|---------|---------|
| Torrent Client | [LibreTorrent](https://github.com/proninyaroslav/libretorrent) or [TorrentStream-Android](https://github.com/TorrentStream/TorrentStream-Android) | Latest | jlibtorrent wrapper |
| P2P Streaming | Custom WebRTC + HLS | - | P2P Media Loader port |
| Video Player | ExoPlayer | 2.19+ | HLS playback with DASH support |
| Networking | Retrofit + OkHttp | 2.9+ / 4.12+ | HTTP API calls |
| WebSocket | OkHttp WebSocket | 4.12+ | Real-time updates |
| Database | Room | 2.6+ | SQLite ORM |
| Image Loading | Coil | 2.5+ | Kotlin-first image loading |
| UI Framework | Jetpack Compose | 1.5+ | Modern declarative UI |
| Dependency Injection | Hilt | 2.48+ | DI framework |

**Gradle Dependencies:**
```kotlin
// build.gradle.kts
dependencies {
    // Torrent
    implementation("com.github.TorrentStream:TorrentStream-Android:2.8.0")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Video
    implementation("com.google.android.exoplayer:exoplayer:2.19.1")
    implementation("com.google.android.exoplayer:exoplayer-hls:2.19.1")

    // Database
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    // UI
    implementation("androidx.compose.ui:ui:1.5.4")
    implementation("androidx.compose.material3:material3:1.1.2")

    // Image loading
    implementation("io.coil-kt:coil-compose:2.5.0")

    // DI
    implementation("com.google.dagger:hilt-android:2.48")
    kapt("com.google.dagger:hilt-compiler:2.48")

    // WebRTC
    implementation("io.getstream:stream-webrtc-android:1.1.0")
}
```

**Architecture Pattern:**
- **MVVM** with Jetpack Compose
- **Kotlin Coroutines** for asynchronous operations
- **Flow** for reactive streams
- **Clean Architecture** (domain/data/presentation layers)

### Cross-Platform Considerations

**Why Not React Native/Flutter?**

Current decision: **Native apps** for both platforms

**Reasons:**
1. **Torrent Library Support**: LibTorrent has better native bindings
2. **Performance**: Media streaming benefits from native optimization
3. **WebRTC**: More mature WebRTC support in native
4. **Background Processing**: Native provides better control for seeding

**Future Consideration:**
- Shared business logic in Kotlin Multiplatform Mobile (KMM)
- UI remains native (SwiftUI/Compose)

## Metadata Nodes

### Backend Framework Options

#### Option 1: Go (Recommended for Production)

**Advantages:**
- Low memory footprint (~20MB per instance)
- Fast compilation and startup
- Excellent concurrency (goroutines)
- Single binary deployment
- Strong typing and tooling

**Stack:**
```
Language: Go 1.21+
Web Framework: Gin or Echo
Database ORM: GORM or sqlx
WebSocket: gorilla/websocket
Background Jobs: asynq (Redis-backed)
Testing: testify
```

**Dependencies:**
```go
// go.mod
require (
    github.com/gin-gonic/gin v1.9.1
    github.com/lib/pq v1.10.9 // PostgreSQL driver
    gorm.io/gorm v1.25.5
    gorm.io/driver/postgres v1.5.4
    github.com/golang-jwt/jwt/v5 v5.2.0
    github.com/gorilla/websocket v1.5.1
    github.com/hibiken/asynq v0.24.1
    github.com/redis/go-redis/v9 v9.3.0
)
```

#### Option 2: TypeScript/Node.js (Recommended for Rapid Development)

**Advantages:**
- Large ecosystem (npm)
- Familiar to web developers
- Great for ActivityPub (many existing libraries)
- Rapid iteration

**Stack:**
```
Language: TypeScript 5.0+
Runtime: Node.js 20 LTS
Web Framework: Fastify or NestJS
Database ORM: Prisma or TypeORM
WebSocket: ws or Socket.IO
Background Jobs: BullMQ (Redis-backed)
Testing: Jest or Vitest
```

**Dependencies:**
```json
// package.json
{
  "dependencies": {
    "fastify": "^4.24.3",
    "@fastify/jwt": "^7.2.3",
    "@fastify/websocket": "^8.3.1",
    "prisma": "^5.7.1",
    "@prisma/client": "^5.7.1",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.2",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.4",
    "tsx": "^4.6.2",
    "vitest": "^1.0.4"
  }
}
```

### Database

**Primary Database: PostgreSQL 15+**

**Why PostgreSQL?**
- Mature and battle-tested
- Excellent JSON support (JSONB for ActivityPub objects)
- Full-text search built-in
- Strong ACID guarantees
- Great performance for timeline queries

**Schema Design Principles:**
- Normalize user/post data
- Denormalize for read-heavy operations
- JSONB for flexible ActivityPub storage
- Partial indexes for performance

**Alternative: SQLite 3.40+**
- For small instances (<1000 users)
- Single file, zero configuration
- Write-ahead logging (WAL mode) for concurrency
- Limitation: Single writer at a time

### Caching Layer

**Redis 7.0+**

**Use Cases:**
- Session storage (JWT refresh tokens)
- Rate limiting
- Timeline caching
- Background job queue
- Real-time pub/sub

**Alternatives:**
- Memcached (simpler, no persistence)
- DragonflyDB (Redis-compatible, better performance)

### Object Storage

**For Thumbnails & Profile Images**

**Cloud Options:**

| Provider | Service | Cost (per GB/month) | CDN Integration |
|----------|---------|---------------------|-----------------|
| AWS | S3 | $0.023 | CloudFront |
| Google Cloud | Cloud Storage | $0.020 | Cloud CDN |
| Cloudflare | R2 | $0.015 | Free egress |
| Backblaze | B2 | $0.005 | Cloudflare partner |

**Recommendation: Cloudflare R2**
- Cheapest storage
- Free egress bandwidth
- S3-compatible API
- Built-in CDN

**Self-Hosted Option:**
- **MinIO** - S3-compatible object storage
- Good for on-premise or dedicated servers

### Federation Protocol

**ActivityPub Implementation**

**Libraries:**

| Language | Library | Status |
|----------|---------|--------|
| TypeScript | [Fedify](https://fedify.dev/) | Active, modern |
| TypeScript | [activitypub-express](https://github.com/immers-space/activitypub-express) | Mature |
| Go | [go-fed/activity](https://github.com/go-fed/activity) | Mature |
| Go | Custom implementation | Best control |

**Recommendation:**
- TypeScript: Use Fedify (excellent docs, type-safe)
- Go: Custom implementation (more control, less dependencies)

**HTTP Signatures:**
- Node: `http-signature` library
- Go: `go-fed/httpsig`

## Infrastructure Services

### STUN Servers (NAT Traversal)

**Free Public Options:**
```
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
stun:stun.stunprotocol.org:3478
```

**Self-Hosted:**
- **coturn** - Open source STUN/TURN server
- Installation: `apt-get install coturn`

### TURN Servers (NAT Relay)

**Self-Hosted: coturn**

```bash
# Installation
apt-get install coturn

# Configuration (/etc/turnserver.conf)
listening-port=3478
tls-listening-port=5349
realm=tortok.example.com
server-name=turn.example.com
fingerprint
lt-cred-mech
user=username:password
```

**Commercial Options:**
- **Twilio TURN** - Pay per GB
- **Xirsys** - WebRTC infrastructure provider

**Cost Estimation:**
- Self-hosted: ~$15/month (small VM)
- Commercial: $0.40-1.00 per GB relayed

### BitTorrent Trackers

**Public Trackers:**
```
udp://tracker.opentrackr.org:1337/announce
udp://tracker.openbittorrent.com:6969/announce
udp://open.demonii.com:1337/announce
```

**Self-Hosted:**
- **OpenTracker** - Lightweight, written in C
- **Chihaya** - Modern tracker in Go by CoreOS

### Deployment Platform

**Cloud Providers:**

#### Google Cloud Platform (Recommended)

| Service | Purpose | Cost Estimate |
|---------|---------|---------------|
| Cloud Run | API containers | $30-100/month |
| Cloud SQL | PostgreSQL | $10-50/month |
| Cloud Storage | Object storage | $2-20/month |
| Cloud CDN | Optional CDN | $10-50/month |
| Compute Engine | TURN server | $15-30/month |

**Total: $67-250/month depending on scale**

#### AWS Alternative

| Service | Purpose |
|---------|---------|
| ECS Fargate | API containers |
| RDS PostgreSQL | Database |
| S3 | Object storage |
| CloudFront | CDN |
| EC2 | TURN server |

#### Self-Hosted

**Requirements for 1000 users:**
- 2 vCPU, 4GB RAM for API server
- 2 vCPU, 2GB RAM for PostgreSQL
- 1 vCPU, 1GB RAM for Redis
- 1 vCPU, 1GB RAM for TURN server
- Total: ~$40/month on DigitalOcean/Hetzner

### Container Orchestration

**Docker Compose (Small Instances)**
- Simple deployment
- Single server
- Easy local development

**Kubernetes (Large Instances)**
- Multi-region deployment
- Auto-scaling
- High availability
- Complex setup

**Recommendation:**
- Start with Docker Compose
- Migrate to Kubernetes when >5000 users

### Monitoring & Observability

**Metrics: Prometheus + Grafana**
- **Prometheus**: Time-series metrics database
- **Grafana**: Visualization dashboards
- **Node Exporter**: Server metrics
- **Custom metrics**: Application-level monitoring

**Logging: Loki + Promtail**
- **Loki**: Log aggregation (like Prometheus for logs)
- **Promtail**: Log shipper
- Alternative: ELK stack (Elasticsearch, Logstash, Kibana)

**Tracing: Jaeger or Tempo**
- Distributed tracing for debugging
- OpenTelemetry compatible

**Alerting:**
- Prometheus Alertmanager
- Integrate with PagerDuty, Slack, or email

## Development Tools

### Version Control
- **Git** with GitHub/GitLab
- **Conventional Commits** for changelog generation
- **Semantic Versioning**

### CI/CD

**GitHub Actions (Recommended)**
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v4
      - run: go test ./...

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@v5
```

**Alternatives:**
- GitLab CI
- CircleCI
- Jenkins (self-hosted)

### Code Quality

**Go:**
- `golangci-lint` - Meta-linter
- `gofmt` / `goimports` - Code formatting
- `go vet` - Static analysis

**TypeScript:**
- ESLint - Linting
- Prettier - Code formatting
- TypeScript compiler in strict mode

**Mobile:**
- SwiftLint (iOS)
- Detekt (Android/Kotlin)

### Testing

**Backend:**
- Unit tests: Go's `testing` package or Jest (TS)
- Integration tests: Testcontainers
- E2E tests: Postman/Newman

**Mobile:**
- Unit tests: XCTest (iOS), JUnit (Android)
- UI tests: XCUITest (iOS), Espresso (Android)
- Snapshot tests: Swift Snapshot Testing, Paparazzi (Android)

### Infrastructure as Code

**Terraform**
- Provision cloud infrastructure
- Supports GCP, AWS, Azure
- Declarative configuration

```hcl
# main.tf
resource "google_cloud_run_service" "api" {
  name     = "tortok-api"
  location = "us-central1"

  template {
    spec {
      containers {
        image = "gcr.io/project/tortok-api:latest"
      }
    }
  }
}
```

### API Documentation

**OpenAPI 3.0 (Swagger)**
- Generate from code or write manually
- Interactive documentation with Swagger UI
- Client SDK generation

**Tools:**
- Go: swaggo/swag
- TypeScript: @nestjs/swagger

### Local Development

**Docker Compose for Dependencies**
```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tortok
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  minio:
    image: minio/minio
    command: server /data
    ports:
      - "9000:9000"
```

**Mock Servers:**
- Prism (OpenAPI mocking)
- Mock Service Worker (MSW) for frontend

## Rationale & Alternatives

### Why These Choices?

#### Go vs TypeScript for Backend

**Go Chosen for Production:**
- **Performance**: 10x lower memory usage
- **Deployment**: Single binary, no runtime needed
- **Concurrency**: Goroutines scale better than Node workers
- **Operational simplicity**: Fewer moving parts

**TypeScript Good for:**
- Rapid prototyping
- Teams familiar with JavaScript
- Rich ActivityPub library ecosystem

#### Native vs Cross-Platform Mobile

**Native Chosen:**
- **Torrent libraries**: Better native support
- **Background execution**: More control on native
- **Performance**: Critical for video streaming
- **Ecosystem**: ExoPlayer (Android), AVFoundation (iOS) are best-in-class

**Flutter/React Native Issues:**
- Limited torrent library support
- WebRTC integration more complex
- Background limitations on iOS

#### PostgreSQL vs MySQL

**PostgreSQL Chosen:**
- **JSON support**: Superior JSONB for ActivityPub
- **Full-text search**: Built-in with good performance
- **Standards compliance**: Better SQL standard adherence
- **Extensions**: PostGIS, pgvector for future features

#### Redis vs Memcached

**Redis Chosen:**
- **Persistence**: Can survive restarts
- **Data structures**: Lists, sets, sorted sets
- **Pub/Sub**: Real-time messaging
- **Job queue**: BullMQ backend

### Technology Alternatives Considered

#### Backend Frameworks

| Framework | Language | Pros | Cons | Decision |
|-----------|----------|------|------|----------|
| **Gin** | Go | Fast, simple | Less structure | ✅ Selected |
| Actix-Web | Rust | Very fast | Steep learning curve | ❌ Too complex |
| FastAPI | Python | Great DX | Slower, more memory | ❌ Performance |
| NestJS | TypeScript | Full-featured | Heavy | ⚠️ Prototype only |

#### Databases

| Database | Pros | Cons | Decision |
|----------|------|------|----------|
| **PostgreSQL** | Feature-rich, JSONB | More complex than MySQL | ✅ Selected |
| MySQL | Simple, fast | Limited JSON support | ❌ |
| CockroachDB | Distributed, Postgres-compatible | Expensive | ❌ Overkill |
| SQLite | Zero-config | Single writer | ✅ Small instances |

#### Mobile P2P Streaming

| Technology | Pros | Cons | Decision |
|------------|------|------|----------|
| **P2P Media Loader** | HLS support, production-ready | Browser-focused | ✅ Port to native |
| WebTorrent | Popular | No React Native support | ❌ |
| Custom libtorrent | Full control | More development effort | ⚠️ Fallback |

## Version Matrix

### Minimum Supported Versions

| Component | Minimum Version | Reason |
|-----------|----------------|---------|
| iOS | 16.0 | SwiftUI features, 85%+ device coverage |
| Android | API 26 (8.0) | Background limits, 95%+ coverage |
| Go | 1.21 | Generics, improved performance |
| Node.js | 20 LTS | Current LTS, ES2022 support |
| PostgreSQL | 15 | JSON improvements, performance |
| Redis | 7.0 | ACL improvements |

### Recommended Production Versions (as of 2025)

- Go: **1.22**
- Node.js: **20.11 LTS**
- TypeScript: **5.3**
- PostgreSQL: **16**
- Redis: **7.2**
- iOS SDK: **17**
- Android: **API 34** (target), **API 26** (minimum)

## Dependency Management

### Go
```bash
go mod init github.com/tortok/metadata-server
go mod tidy
```

### Node.js
```bash
npm init -y
npm install <packages>
# or
pnpm install
```

### iOS
```swift
// Package.swift (Swift Package Manager)
// or Podfile (CocoaPods)
```

### Android
```kotlin
// build.gradle.kts
// Gradle version catalogs recommended
```

## Security Considerations

### Dependencies

**Automated Vulnerability Scanning:**
- **Dependabot** (GitHub) - Automatic PRs for updates
- **Snyk** - Comprehensive vulnerability database
- **npm audit** / `go mod verify`

**Supply Chain Security:**
- Pin dependency versions in production
- Use lockfiles (package-lock.json, go.sum)
- Verify checksums
- Scan Docker images with Trivy

### Secrets Management

**Development:**
- `.env` files (gitignored)
- Never commit secrets to git

**Production:**
- Google Secret Manager
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets

## Performance Benchmarks

### Expected Performance (Metadata Node)

**Hardware: 2 vCPU, 4GB RAM**

| Metric | Target | Notes |
|--------|--------|-------|
| Timeline query | <100ms | Cached timelines |
| API requests/sec | 1000+ | With connection pooling |
| Concurrent users | 5000+ | With proper indexing |
| Database connections | 100 | PgBouncer pooling |
| Memory usage | <2GB | Go binary |
| Cold start | <1s | Serverless |

### Mobile App Performance Targets

| Metric | Target |
|--------|--------|
| App launch | <2s |
| Feed scroll FPS | 60 FPS |
| Video start time | <3s (P2P), <1s (HTTP fallback) |
| Image load time | <500ms (cached), <2s (network) |
| Battery drain | <5%/hour while seeding |

## Next Steps

1. Review [System Architecture](system-architecture.md) for overall design
2. Check [Data Models](data-models.md) for database schemas
3. See [Deployment Guide](../deployment/metadata-node.md) for setup instructions
4. Read [Mobile Development Guide](../guides/mobile-development.md) for app development

## References

- [libtorrent Documentation](https://www.libtorrent.org/)
- [P2P Media Loader GitHub](https://github.com/Novage/p2p-media-loader)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [Fedify Framework](https://fedify.dev/)
- [WebRTC for Mobile](https://webrtc.org/native-code/android/)
