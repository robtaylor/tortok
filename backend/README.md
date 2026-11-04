# TorTok Metadata Server

Federated metadata server for TorTok - handles user authentication, video metadata, and social features.

## Features

- ✅ User registration and authentication (JWT)
- ✅ Video metadata storage
- ✅ Feed API
- ✅ Like/unlike videos
- ✅ View tracking
- ✅ Hashtag support
- ✅ PostgreSQL database
- ✅ Docker containerization
- ✅ Fly.io deployment

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 15
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Joi
- **Deployment**: Docker + Fly.io

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- npm or yarn

### Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your local database credentials
   ```

3. **Create PostgreSQL database**:
   ```bash
   createdb tortok
   ```

4. **Run database migrations** (schema will be auto-applied on first start):
   ```bash
   npm run dev
   ```

5. **Start development server**:
   ```bash
   npm run dev
   ```

   Server will start on `http://localhost:8080`

### Local Database Connection

Update `.env`:
```env
DATABASE_URL=postgresql://localhost:5432/tortok
JWT_SECRET=your-local-secret-key
INSTANCE_DOMAIN=localhost:8080
```

## API Endpoints

### Authentication

**POST /auth/register**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "password123",
  "displayName": "Alice"
}
```

Response:
```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "...",
    "username": "alice",
    ...
  }
}
```

**POST /auth/login**
```json
{
  "email": "alice@example.com",
  "password": "password123"
}
```

**GET /auth/me**
Headers: `Authorization: Bearer <token>`

### Videos

**GET /videos/feed**
Query params: `?limit=20&offset=0`

Response:
```json
{
  "videos": [...],
  "nextCursor": "20",
  "hasMore": true
}
```

**POST /videos**
Headers: `Authorization: Bearer <token>`
```json
{
  "caption": "My first video!",
  "magnetLink": "magnet:?xt=...",
  "torrentFileUrl": "https://cdn.example.com/video.torrent",
  "posterUrl": "https://cdn.example.com/poster.jpg",
  "durationSeconds": 30,
  "width": 1080,
  "height": 1920,
  "hashtags": ["test", "p2p"]
}
```

**POST /videos/:id/like**
Headers: `Authorization: Bearer <token>`
```json
{
  "liked": true
}
```

**POST /videos/:id/view**
Optional auth
```json
{
  "watchedDuration": 25,
  "completionRate": 0.83,
  "source": "p2p"
}
```

### Instance Info

**GET /.well-known/tortok**
Returns instance metadata for discovery

**GET /health**
Health check endpoint

## Deployment (Fly.io)

The backend deploys to Fly.io as app `tortok-api` (`fly.toml`), built from
the `Dockerfile` in this directory.

```bash
fly auth login
fly secrets set -a tortok-api JWT_SECRET=... DATABASE_URL=... TURN_SECRET=...
fly deploy
```

`fly.toml` never auto-stops the machine (`auto_stop_machines = "off"`) because the origin WebTorrent seeder runs
in this process and stops seeding if the machine idles out. Shutdown is
graceful on SIGTERM/SIGINT (HTTP server, then seeder, then Postgres pool)
within `kill_timeout`.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `JWT_SECRET` | Secret for signing JWTs | Required |
| `JWT_EXPIRES_IN` | Token expiration | `7d` |
| `INSTANCE_DOMAIN` | Instance domain name | `localhost` |
| `INSTANCE_NAME` | Display name | `TorTok Local` |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `*` |
| `CONTENT_ORIGIN_URL` | BEP-19 webseed origin | `http://localhost:8090` (dev), R2 bucket (prod) |
| `TRACKER_URLS` | Trackers the seeder announces to (comma-separated) | `ws://localhost:8000` (dev), `wss://tortok-tracker.fly.dev` (prod) |
| `TURN_SECRET` | coturn shared secret for `/turn/credentials` | unset → STUN only |

## Database Schema

See `src/db/schema.sql` for complete schema.

Main tables:
- `users` - User accounts
- `videos` - Video metadata
- `hashtags` - Hashtag definitions
- `video_hashtags` - Video-hashtag associations
- `follows` - Follow relationships
- `likes` - Video likes
- `views` - View analytics

## Testing

### Manual API Testing

```bash
# Register user
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123",
    "displayName": "Test User"
  }'

# Login
curl -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Get feed
curl http://localhost:8080/videos/feed
```

## Monitoring

```bash
fly logs -a tortok-api
fly status -a tortok-api
```

## Security

- ✅ Helmet.js security headers
- ✅ CORS configuration
- ✅ JWT authentication
- ✅ Password hashing (bcrypt)
- ✅ SQL injection protection (parameterized queries)
- ✅ Input validation (Joi)
- ✅ HTTPS only (`force_https` in `fly.toml`)

## Future Enhancements

- [ ] Federation (ActivityPub)
- [ ] Refresh tokens
- [ ] Rate limiting
- [ ] Redis caching
- [ ] WebSocket for real-time updates
- [ ] File upload for thumbnails
- [ ] Admin panel
- [ ] Analytics dashboard

## License

MIT
