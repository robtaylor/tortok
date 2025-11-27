# TorTok MVP Specification

This document outlines the Minimum Viable Product (MVP) for TorTok, focusing on core functionality to validate the concept.

## MVP Objectives

1. **Prove the Concept**: Demonstrate that P2P media delivery works on mobile
2. **Test Federation**: Validate metadata synchronization between instances
3. **Gather Feedback**: Learn from early users about UX and performance
4. **Identify Challenges**: Surface technical issues early

## Scope Definition

### In Scope (MVP)

✅ **User Features:**
- User registration and authentication
- Post photos (no video in MVP)
- View feed of photos from followed users
- Follow/unfollow users
- Like posts
- Basic profile page

✅ **Technical Features:**
- BitTorrent-based photo sharing (Android only)
- Simple metadata server (no federation in v1)
- Local caching
- Basic battery-aware seeding

✅ **Infrastructure:**
- Single metadata instance
- Docker deployment
- PostgreSQL database
- MinIO object storage (thumbnails only)

### Out of Scope (Post-MVP)

❌ **Deferred Features:**
- Video support
- Federation between instances
- Comments
- Stories/ephemeral content
- Direct messages
- Advanced search
- iOS app
- Live streaming
- Web interface

## Architecture (MVP)

```
┌─────────────────────────────────────┐
│   Android App (Kotlin)              │
│   • Photo capture/upload            │
│   • Torrent creation & seeding      │
│   • Feed viewing                    │
│   • P2P download                    │
└─────────────────────────────────────┘
           ↕ (HTTPS API)
┌─────────────────────────────────────┐
│   Metadata Server (TypeScript)      │
│   • REST API                        │
│   • PostgreSQL database             │
│   • No federation (single instance) │
└─────────────────────────────────────┘
           ↕ (storage)
┌─────────────────────────────────────┐
│   MinIO Object Storage              │
│   • Thumbnails only                 │
│   • Profile pictures                │
└─────────────────────────────────────┘

Meanwhile, media P2P:
Android App A ←── BitTorrent ──→ Android App B
      ↕                              ↕
  DHT + Public Trackers
```

## Feature Specifications

### 1. User Authentication

**Registration:**
- Email + password
- Username (unique)
- Display name
- Profile picture (optional)
- No email verification in MVP (simplicity)

**API Endpoints:**
```typescript
POST /api/v1/auth/register
{
  "email": "user@example.com",
  "password": "securepass123",
  "username": "alice",
  "displayName": "Alice Smith"
}

Response: { "token": "jwt-token", "user": {...} }

POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "securepass123"
}

Response: { "token": "jwt-token", "user": {...} }
```

**Mobile Implementation:**
```kotlin
data class RegisterRequest(
    val email: String,
    val password: String,
    val username: String,
    val displayName: String
)

class AuthRepository {
    suspend fun register(request: RegisterRequest): Result<AuthResponse> {
        return api.register(request)
    }

    suspend fun login(email: String, password: String): Result<AuthResponse> {
        return api.login(LoginRequest(email, password))
    }

    fun saveToken(token: String) {
        preferences.edit().putString("jwt_token", token).apply()
    }
}
```

### 2. Photo Posting

**Flow:**
1. User captures or selects photo
2. App compresses image (max 2048px width, JPEG quality 85%)
3. App creates BitTorrent from image file
4. App starts seeding
5. App uploads thumbnail to metadata server
6. App posts metadata (caption, magnet link) to API
7. API saves post to database

**API Endpoint:**
```typescript
POST /api/v1/posts
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data

{
  "caption": "Beautiful sunset!",
  "magnetLink": "magnet:?xt=urn:btih:...",
  "thumbnail": <file>,
  "imageWidth": 2048,
  "imageHeight": 1536,
  "fileSize": 1048576
}

Response: {
  "id": "uuid",
  "userId": "user-uuid",
  "caption": "Beautiful sunset!",
  "magnetLink": "magnet:?xt=urn:btih:...",
  "thumbnailUrl": "https://storage/thumbnails/abc123.jpg",
  "createdAt": "2025-01-23T10:30:00Z"
}
```

**Mobile Implementation:**
```kotlin
class PostComposer {
    suspend fun createPost(
        imageUri: Uri,
        caption: String
    ): Result<Post> {
        // 1. Compress image
        val compressed = imageCompressor.compress(imageUri, maxWidth = 2048)

        // 2. Create torrent
        val torrent = torrentEngine.createTorrent(compressed)
        val magnetLink = torrent.magnetLink

        // 3. Start seeding
        torrentEngine.seed(torrent)

        // 4. Generate thumbnail (400x400)
        val thumbnail = imageCompressor.compress(imageUri, maxWidth = 400)

        // 5. Upload to API
        return api.createPost(
            CreatePostRequest(
                caption = caption,
                magnetLink = magnetLink,
                thumbnail = thumbnail,
                imageWidth = compressed.width,
                imageHeight = compressed.height,
                fileSize = compressed.size
            )
        )
    }
}
```

**Torrent Creation:**
```kotlin
import org.libtorrent4j.*

class TorrentEngine {
    private val session = Session()

    init {
        session.start()
        // Add public trackers
        session.addDhtNode("router.bittorrent.com", 6881)
    }

    fun createTorrent(imageFile: File): TorrentInfo {
        val creator = FileStorage()
        creator.addFile(imageFile.path, imageFile.length())

        val torrent = TorrentBuilder(creator)
            .apply {
                setCreator("TorTok Android")
                setPrivacy(false) // Allow DHT
                addTracker("udp://tracker.opentrackr.org:1337/announce")
                addTracker("udp://tracker.openbittorrent.com:6969/announce")
            }
            .generate()

        return TorrentInfo(torrent)
    }

    fun seed(torrent: TorrentInfo) {
        val params = TorrentHandle.addTorrentParams()
        params.ti = torrent
        params.savePath = getStorageDir()

        session.add(params)
    }
}
```

### 3. Feed Viewing

**Flow:**
1. App fetches timeline from API
2. API returns posts from followed users
3. App displays thumbnails
4. When user taps photo, app downloads full image via P2P
5. App caches downloaded image

**API Endpoint:**
```typescript
GET /api/v1/timeline?limit=20&cursor=<timestamp>
Authorization: Bearer <jwt-token>

Response: {
  "posts": [
    {
      "id": "uuid",
      "user": {
        "id": "user-uuid",
        "username": "alice",
        "displayName": "Alice Smith",
        "avatarUrl": "https://storage/avatars/alice.jpg"
      },
      "caption": "Beautiful sunset!",
      "magnetLink": "magnet:?xt=urn:btih:...",
      "thumbnailUrl": "https://storage/thumbnails/abc123.jpg",
      "imageWidth": 2048,
      "imageHeight": 1536,
      "likeCount": 42,
      "isLiked": false,
      "createdAt": "2025-01-23T10:30:00Z"
    }
  ],
  "nextCursor": "2025-01-23T09:00:00Z",
  "hasMore": true
}
```

**Mobile UI (Jetpack Compose):**
```kotlin
@Composable
fun FeedScreen(viewModel: FeedViewModel) {
    val posts by viewModel.posts.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    LazyColumn {
        items(posts) { post ->
            PostCard(
                post = post,
                onLike = { viewModel.likePost(post.id) },
                onUserClick = { viewModel.navigateToProfile(post.user.id) },
                onImageClick = { viewModel.viewFullImage(post) }
            )
        }

        if (isLoading) {
            item { LoadingIndicator() }
        }
    }
}

@Composable
fun PostCard(
    post: Post,
    onLike: () -> Unit,
    onUserClick: () -> Unit,
    onImageClick: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
        // User header
        Row(
            modifier = Modifier.clickable(onClick = onUserClick),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AsyncImage(
                model = post.user.avatarUrl,
                contentDescription = "Avatar",
                modifier = Modifier.size(40.dp).clip(CircleShape)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(post.user.displayName, fontWeight = FontWeight.Bold)
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Thumbnail image
        AsyncImage(
            model = post.thumbnailUrl,
            contentDescription = post.caption,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(post.imageWidth.toFloat() / post.imageHeight)
                .clickable(onClick = onImageClick)
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Like button
        Row {
            IconButton(onClick = onLike) {
                Icon(
                    imageVector = if (post.isLiked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    contentDescription = "Like",
                    tint = if (post.isLiked) Color.Red else Color.Gray
                )
            }
            Text("${post.likeCount} likes")
        }

        // Caption
        if (post.caption.isNotEmpty()) {
            Text(
                text = buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(post.user.username)
                    }
                    append(" ${post.caption}")
                }
            )
        }
    }
}
```

### 4. P2P Image Download

**Flow:**
1. User taps thumbnail to view full image
2. App checks local cache (by magnet link hash)
3. If not cached:
   - Query DHT for peers
   - Connect to peers via BitTorrent
   - Download image file
   - Save to cache
4. Display full image

**Implementation:**
```kotlin
class ImageDownloader(
    private val torrentEngine: TorrentEngine,
    private val cacheManager: CacheManager
) {
    suspend fun downloadImage(magnetLink: String): Result<File> {
        // Check cache first
        val infohash = extractInfohash(magnetLink)
        cacheManager.get(infohash)?.let { return Result.success(it) }

        // Download via BitTorrent
        return withContext(Dispatchers.IO) {
            try {
                val file = torrentEngine.download(magnetLink)

                // Save to cache
                cacheManager.put(infohash, file)

                Result.success(file)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}

// TorrentEngine extension
fun TorrentEngine.download(magnetLink: String): File {
    val params = AddTorrentParams.parseMagnetUri(magnetLink)
    params.savePath(getCacheDir())

    val handle = session.addTorrent(params)

    // Wait for download to complete
    while (!handle.status().isFinished) {
        Thread.sleep(100)
    }

    return File(handle.savePath(), handle.torrentFile().name())
}
```

### 5. Following System

**API Endpoints:**
```typescript
POST /api/v1/follows
Authorization: Bearer <jwt-token>
{
  "userId": "user-uuid-to-follow"
}

Response: { "success": true }

DELETE /api/v1/follows/:userId
Authorization: Bearer <jwt-token>

Response: { "success": true }

GET /api/v1/users/:userId/followers
GET /api/v1/users/:userId/following
```

**Database Schema:**
```sql
CREATE TABLE follows (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
```

### 6. Like System

**API Endpoint:**
```typescript
POST /api/v1/posts/:postId/like
Authorization: Bearer <jwt-token>

Response: { "success": true, "likeCount": 43 }

DELETE /api/v1/posts/:postId/like
Authorization: Bearer <jwt-token>

Response: { "success": true, "likeCount": 42 }
```

**Database Schema:**
```sql
CREATE TABLE likes (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user ON likes(user_id);
```

## Database Schema (MVP)

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Posts
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    caption TEXT,
    magnet_link TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    image_width INT NOT NULL,
    image_height INT NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

-- Follows (already defined above)
-- Likes (already defined above)

-- Timeline view (materialized for performance)
CREATE MATERIALIZED VIEW timeline AS
SELECT
    p.id,
    p.user_id,
    p.caption,
    p.magnet_link,
    p.thumbnail_url,
    p.image_width,
    p.image_height,
    p.created_at,
    u.username,
    u.display_name,
    u.avatar_url,
    COUNT(DISTINCT l.user_id) as like_count
FROM posts p
JOIN users u ON p.user_id = u.id
LEFT JOIN likes l ON p.id = l.post_id
GROUP BY p.id, u.id;

CREATE INDEX idx_timeline_user_id ON timeline(user_id);
CREATE INDEX idx_timeline_created_at ON timeline(created_at DESC);

-- Refresh timeline periodically
REFRESH MATERIALIZED VIEW timeline;
```

## API Implementation (TypeScript/Fastify)

### Server Setup

```typescript
// src/server.ts
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import postRoutes from './routes/posts';
import userRoutes from './routes/users';
import followRoutes from './routes/follows';

const prisma = new PrismaClient();
const server = Fastify({ logger: true });

// JWT authentication
server.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET!
});

server.decorate('authenticate', async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// CORS
server.register(require('@fastify/cors'), {
  origin: true
});

// Multipart (file uploads)
server.register(require('@fastify/multipart'));

// Routes
server.register(authRoutes, { prefix: '/api/v1/auth' });
server.register(postRoutes, { prefix: '/api/v1/posts', prisma });
server.register(userRoutes, { prefix: '/api/v1/users', prisma });
server.register(followRoutes, { prefix: '/api/v1/follows', prisma });

// Start server
server.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
  if (err) throw err;
  console.log(`Server listening at ${address}`);
});
```

### Routes Example

```typescript
// src/routes/posts.ts
import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { uploadToStorage } from '../lib/storage';

const postRoutes: FastifyPluginAsync = async (server, opts) => {
  const prisma = opts.prisma as PrismaClient;

  // Create post
  server.post('/', {
    onRequest: [server.authenticate]
  }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No thumbnail provided' });
    }

    const thumbnail = await data.toBuffer();
    const fields = data.fields as any;

    // Upload thumbnail to storage
    const thumbnailUrl = await uploadToStorage(thumbnail, 'thumbnails');

    // Create post in database
    const post = await prisma.post.create({
      data: {
        userId: request.user.id,
        caption: fields.caption?.value || '',
        magnetLink: fields.magnetLink.value,
        thumbnailUrl,
        imageWidth: parseInt(fields.imageWidth.value),
        imageHeight: parseInt(fields.imageHeight.value),
        fileSize: parseInt(fields.fileSize.value)
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true
          }
        }
      }
    });

    return reply.code(201).send(post);
  });

  // Get timeline
  server.get('/timeline', {
    onRequest: [server.authenticate]
  }, async (request, reply) => {
    const { limit = 20, cursor } = request.query as any;

    // Get posts from followed users
    const posts = await prisma.post.findMany({
      where: {
        user: {
          followers: {
            some: {
              followerId: request.user.id
            }
          }
        },
        ...(cursor && {
          createdAt: {
            lt: new Date(cursor)
          }
        })
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true
          }
        },
        _count: {
          select: { likes: true }
        },
        likes: {
          where: { userId: request.user.id },
          select: { userId: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    const formattedPosts = posts.map(post => ({
      ...post,
      likeCount: post._count.likes,
      isLiked: post.likes.length > 0,
      _count: undefined,
      likes: undefined
    }));

    return {
      posts: formattedPosts,
      nextCursor: posts.length > 0 ? posts[posts.length - 1].createdAt.toISOString() : null,
      hasMore: posts.length === limit
    };
  });
};

export default postRoutes;
```

## Mobile App Structure (Android)

```
app/
├── src/main/java/com/tortok/
│   ├── TorTokApplication.kt
│   ├── ui/
│   │   ├── MainActivity.kt
│   │   ├── auth/
│   │   │   ├── LoginScreen.kt
│   │   │   └── RegisterScreen.kt
│   │   ├── feed/
│   │   │   ├── FeedScreen.kt
│   │   │   ├── FeedViewModel.kt
│   │   │   └── PostCard.kt
│   │   ├── post/
│   │   │   ├── CreatePostScreen.kt
│   │   │   └── CreatePostViewModel.kt
│   │   ├── profile/
│   │   │   ├── ProfileScreen.kt
│   │   │   └── ProfileViewModel.kt
│   │   └── viewer/
│   │       └── ImageViewerScreen.kt
│   ├── data/
│   │   ├── api/
│   │   │   ├── TorTokApi.kt
│   │   │   ├── AuthApi.kt
│   │   │   └── PostApi.kt
│   │   ├── repository/
│   │   │   ├── AuthRepository.kt
│   │   │   ├── PostRepository.kt
│   │   │   └── UserRepository.kt
│   │   └── model/
│   │       ├── User.kt
│   │       ├── Post.kt
│   │       └── AuthResponse.kt
│   ├── torrent/
│   │   ├── TorrentEngine.kt
│   │   ├── TorrentManager.kt
│   │   └── SeedingService.kt
│   ├── cache/
│   │   └── CacheManager.kt
│   └── di/
│       └── AppModule.kt
```

## Testing Strategy

### Backend Tests
```typescript
// test/posts.test.ts
import { test } from 'tap';
import { build } from '../src/app';

test('POST /api/v1/posts - creates a new post', async (t) => {
  const app = await build();

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: {
      authorization: 'Bearer ' + testToken
    },
    payload: {
      caption: 'Test post',
      magnetLink: 'magnet:?xt=urn:btih:test',
      thumbnail: testImageBuffer
    }
  });

  t.equal(response.statusCode, 201);
  t.ok(response.json().id);
});
```

### Android Tests
```kotlin
@Test
fun createPost_success() = runTest {
    val repository = PostRepository(mockApi, mockTorrentEngine)

    val result = repository.createPost(
        imageUri = mockUri,
        caption = "Test post"
    )

    assertTrue(result.isSuccess)
    assertEquals("Test post", result.getOrNull()?.caption)
}

@Test
fun downloadImage_fromCache() = runTest {
    val downloader = ImageDownloader(mockTorrentEngine, mockCacheManager)

    // Populate cache
    whenever(mockCacheManager.get(any())).thenReturn(mockFile)

    val result = downloader.downloadImage("magnet:?xt=urn:btih:test")

    assertTrue(result.isSuccess)
    verify(mockTorrentEngine, never()).download(any())
}
```

## Deployment (MVP)

### Docker Compose
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tortok
      POSTGRES_USER: tortok
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio:
    image: minio/minio
    command: server /data
    environment:
      MINIO_ROOT_USER: ${MINIO_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio_data:/data

  api:
    build: .
    environment:
      DATABASE_URL: postgresql://tortok:${DB_PASSWORD}@postgres:5432/tortok
      S3_ENDPOINT: http://minio:9000
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - minio

volumes:
  postgres_data:
  minio_data:
```

## Success Metrics

### Technical Metrics
- [ ] P2P download success rate > 80%
- [ ] Average download time < 5 seconds
- [ ] Battery drain < 10%/hour while seeding
- [ ] API response time < 200ms (p95)
- [ ] Zero data loss

### User Metrics
- [ ] 10+ beta testers
- [ ] 100+ posts created
- [ ] Users successfully download from peers (not HTTP fallback)
- [ ] Average session length > 5 minutes
- [ ] Positive feedback on P2P performance

## Timeline

**Week 1-2: Backend Development**
- Set up project structure
- Implement authentication
- Create post API
- Set up database

**Week 3-4: Android App (Core)**
- Project setup with Jetpack Compose
- Authentication screens
- Feed UI
- Profile screens

**Week 5-6: Torrent Integration**
- Integrate libtorrent
- Implement torrent creation
- Implement download/seeding
- Test P2P connectivity

**Week 7: Testing & Polish**
- Bug fixes
- Performance optimization
- Battery optimization
- UI polish

**Week 8: Beta Release**
- Deploy to small group of testers
- Gather feedback
- Iterate based on feedback

## Next Steps After MVP

1. **iOS App**: Port to iOS using iTorrent
2. **Federation**: Implement ActivityPub for multi-instance support
3. **Video Support**: Add video encoding and HLS streaming
4. **Comments**: Add commenting system
5. **Search**: Implement full-text search
6. **Web Interface**: Build web client

---

## Appendix: API Reference

See full API documentation in [docs/api/README.md](../api/README.md)

## Appendix: Code Examples

See complete code examples in [examples/](../../examples/)
