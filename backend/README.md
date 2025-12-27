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
- ✅ Google Cloud Run deployment

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 15
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: Joi
- **Deployment**: Docker + Google Cloud Run

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
  "hlsUrl": "https://cdn.example.com/video.m3u8",
  "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
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

## Google Cloud Deployment

### Prerequisites

1. **Install Google Cloud CLI**:
   ```bash
   # macOS
   brew install google-cloud-sdk

   # Or download from https://cloud.google.com/sdk/docs/install
   ```

2. **Authenticate**:
   ```bash
   gcloud auth login
   ```

3. **Set account**:
   ```bash
   gcloud config set account rob@shape.build
   ```

### Deploy

Run the deployment script:

```bash
./deploy.sh
```

This will:
1. ✅ Create Google Cloud project (if needed)
2. ✅ Enable required APIs
3. ✅ Build Docker image
4. ✅ Create PostgreSQL Cloud SQL instance
5. ✅ Deploy to Cloud Run
6. ✅ Configure environment variables

### Manual Deployment Steps

If you prefer manual deployment:

```bash
# Set project
gcloud config set project tortok-prod

# Build image
gcloud builds submit --tag gcr.io/tortok-prod/tortok-metadata-server

# Deploy
gcloud run deploy tortok-metadata-server \
  --image gcr.io/tortok-prod/tortok-metadata-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "JWT_SECRET=your-secret" \
  --set-cloudsql-instances "tortok-prod:us-central1:tortok-db"
```

### Database Setup

1. **Create Cloud SQL instance**:
   ```bash
   gcloud sql instances create tortok-db \
     --database-version=POSTGRES_15 \
     --tier=db-f1-micro \
     --region=us-central1
   ```

2. **Create database**:
   ```bash
   gcloud sql databases create tortok --instance=tortok-db
   ```

3. **Set up connection string as secret**:
   ```bash
   echo -n "postgresql://user:password@/tortok?host=/cloudsql/tortok-prod:us-central1:tortok-db" | \
   gcloud secrets create tortok-db-url --data-file=-
   ```

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

### Cloud Run Logs

```bash
gcloud run services logs read tortok-metadata-server \
  --region=us-central1 \
  --limit=50
```

### Metrics

Cloud Run console: https://console.cloud.google.com/run

Monitor:
- Request count
- Latency
- Error rate
- Container instances

## Scaling

Cloud Run autoscales based on traffic:
- **Min instances**: 0 (scales to zero)
- **Max instances**: 10
- **CPU**: 1 vCPU
- **Memory**: 512 Mi

Adjust in deployment:
```bash
gcloud run services update tortok-metadata-server \
  --max-instances=20 \
  --min-instances=1 \
  --memory=1Gi
```

## Cost Estimation

### Free Tier (Google Cloud)

- Cloud Run: 2M requests/month free
- Cloud SQL: db-f1-micro instance ~$10/month
- Container Registry: 0.5GB storage free

### Expected Costs (Low Traffic)

- **Database**: ~$10/month (smallest instance)
- **Cloud Run**: ~$0 (within free tier for <2M requests)
- **Total**: ~$10-15/month

## Security

- ✅ Helmet.js security headers
- ✅ CORS configuration
- ✅ JWT authentication
- ✅ Password hashing (bcrypt)
- ✅ SQL injection protection (parameterized queries)
- ✅ Input validation (Joi)
- ✅ HTTPS only (Cloud Run default)

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
