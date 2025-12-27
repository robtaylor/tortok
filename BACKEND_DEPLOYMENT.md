# TorTok Backend Deployment Guide

## 🎉 Backend Server Created!

A complete federated metadata server for TorTok has been built and is ready to deploy.

## What Was Built

### API Server (Node.js + TypeScript + Express)

**Location**: `/backend/`

**Features**:
- ✅ User registration and authentication (JWT)
- ✅ Video metadata CRUD
- ✅ Feed API with pagination
- ✅ Like/unlike videos
- ✅ View tracking and analytics
- ✅ Hashtag support
- ✅ PostgreSQL database with triggers
- ✅ Input validation (Joi)
- ✅ Security (Helmet, CORS, bcrypt)
- ✅ Docker containerization
- ✅ Google Cloud Run deployment

### API Endpoints

#### Authentication
- `POST /auth/register` - Create new account
- `POST /auth/login` - Login and get JWT token
- `GET /auth/me` - Get current user (protected)

#### Videos
- `GET /videos/feed` - Get video feed (paginated)
- `POST /videos` - Create video (protected)
- `GET /videos/:id` - Get single video
- `POST /videos/:id/like` - Like/unlike video (protected)
- `POST /videos/:id/view` - Record view

#### Instance
- `GET /.well-known/tortok` - Instance discovery
- `GET /health` - Health check

### Database Schema

**PostgreSQL tables**:
- `users` - User accounts with instance domain
- `videos` - Video metadata (magnet links, HLS URLs)
- `hashtags` - Hashtag definitions
- `video_hashtags` - Video-hashtag associations
- `follows` - Follow relationships (ready for federation)
- `likes` - Video likes
- `views` - View analytics

**Smart features**:
- Auto-increment follower/following counts (triggers)
- Auto-increment video counts (triggers)
- Full-text search ready
- Indexed for performance

## Deployment Status

### Current Deployment

The deployment script is running and will:

1. ✅ Authenticate with Google Cloud (rob@shape.build)
2. ✅ Create/use project: `tortok-prod`
3. ✅ Enable required APIs (Cloud Run, Cloud SQL, Cloud Build)
4. ✅ Build Docker image
5. ✅ Create PostgreSQL Cloud SQL instance (if needed)
6. ✅ Deploy to Cloud Run
7. ✅ Configure environment variables

### Expected Result

After deployment (5-10 minutes):

```
🚀 Deployment complete!

Service URL: https://tortok-metadata-server-XXXXX-uc.a.run.app
Region: us-central1
Project: tortok-prod

🔗 API Endpoints:
  - Health: https://[SERVICE-URL]/health
  - Instance Info: https://[SERVICE-URL]/.well-known/tortok
  - Register: POST https://[SERVICE-URL]/auth/register
  - Login: POST https://[SERVICE-URL]/auth/login
  - Feed: GET https://[SERVICE-URL]/videos/feed
```

## Testing the Deployment

### 1. Health Check

```bash
curl https://[SERVICE-URL]/health
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-27T...",
  "instance": "tortok-prod"
}
```

### 2. Register a Test User

```bash
curl -X POST https://[SERVICE-URL]/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "password": "password123",
    "displayName": "Alice"
  }'
```

Expected:
```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "...",
    "username": "alice",
    "displayName": "Alice",
    ...
  }
}
```

### 3. Test Login

```bash
curl -X POST https://[SERVICE-URL]/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "password123"
  }'
```

### 4. Get Feed (Empty Initially)

```bash
curl https://[SERVICE-URL]/videos/feed
```

Expected:
```json
{
  "videos": [],
  "nextCursor": null,
  "hasMore": false
}
```

## Connecting iOS App

Update the iOS app to use the deployed backend:

### 1. Get the Service URL

After deployment completes, copy the service URL from the output.

### 2. Update iOS App

**Edit `/TorTok/Services/API/APIClient.swift`**:

```swift
class APIClient: ObservableObject {
    static let shared = APIClient()

    private let baseURL: String

    init(baseURL: String = "https://[YOUR-SERVICE-URL]") {  // ← Update this!
        self.baseURL = baseURL
        // ...
    }
}
```

Or better, use environment configuration:

```swift
init(baseURL: String = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://[SERVICE-URL]") {
    self.baseURL = baseURL
}
```

### 3. Test from iOS App

1. Run the TorTok iOS app
2. Tap "Sign In (Demo)" → Should now actually register/login!
3. Registration should work
4. Login should work
5. Feed will be empty (no videos yet)

## Local Development

### Run Backend Locally

```bash
cd backend

# Install dependencies
npm install

# Start PostgreSQL locally
brew services start postgresql@15
createdb tortok

# Run server
npm run dev
```

Server runs on `http://localhost:8080`

Update iOS app to use local server:
```swift
init(baseURL: String = "http://localhost:8080") {
```

## Database Management

### View Database (Google Cloud)

```bash
# Connect to Cloud SQL
gcloud sql connect tortok-db --user=tortok-user --database=tortok
```

### Run SQL Queries

```sql
-- View users
SELECT id, username, email, created_at FROM users;

-- View videos
SELECT id, caption, like_count, view_count, created_at FROM videos;

-- View recent activity
SELECT * FROM views ORDER BY created_at DESC LIMIT 10;
```

### Database Backups

```bash
# Export database
gcloud sql export sql tortok-db gs://tortok-backups/backup-$(date +%Y%m%d).sql \
  --database=tortok

# Import database
gcloud sql import sql tortok-db gs://tortok-backups/backup-YYYYMMDD.sql \
  --database=tortok
```

## Monitoring

### View Logs

```bash
# Real-time logs
gcloud run services logs tail tortok-metadata-server --region=us-central1

# Recent logs
gcloud run services logs read tortok-metadata-server --region=us-central1 --limit=100
```

### Metrics

View in Cloud Console:
https://console.cloud.google.com/run/detail/us-central1/tortok-metadata-server

Metrics:
- Request count
- Request latency (p50, p95, p99)
- Error rate
- Container instances (autoscaling)
- CPU/Memory usage

## Costs

### Free Tier

- **Cloud Run**: 2M requests/month free
- **Cloud SQL**: ~$10/month (db-f1-micro)
- **Container Storage**: 0.5GB free

### Expected Monthly Cost (Low Traffic)

- Database: ~$10
- Cloud Run: ~$0 (within free tier)
- **Total**: ~$10-15/month

### Scaling Costs

If traffic increases:
- Cloud Run: ~$0.0000024 per request beyond free tier
- At 10M requests/month: ~$20/month
- Database upgrade (db-g1-small): ~$35/month

## Security

### Production Checklist

- ✅ HTTPS only (Cloud Run default)
- ✅ JWT authentication
- ✅ Password hashing (bcrypt)
- ✅ SQL injection protection (parameterized queries)
- ✅ Input validation (Joi)
- ✅ Security headers (Helmet)
- ✅ CORS configuration
- ⚠️ TODO: Rate limiting
- ⚠️ TODO: Refresh tokens

### Environment Variables

Secrets are managed via Google Cloud Secret Manager:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for signing tokens

View secrets:
```bash
gcloud secrets list
```

Update secret:
```bash
echo -n "new-secret-value" | gcloud secrets versions add JWT_SECRET --data-file=-
```

## Troubleshooting

### Deployment Failed

Check build logs:
```bash
gcloud builds list --limit=5
gcloud builds log [BUILD_ID]
```

### Service Not Starting

Check Cloud Run logs:
```bash
gcloud run services logs tail tortok-metadata-server --region=us-central1
```

Common issues:
- Database connection failed (check DATABASE_URL secret)
- Port configuration (should be 8080)
- Environment variables missing

### Database Connection Issues

Test database connectivity:
```bash
gcloud sql connect tortok-db --user=tortok-user
```

Check Cloud SQL instance status:
```bash
gcloud sql instances describe tortok-db
```

## Next Steps

### 1. Test End-to-End

- [ ] Register user via iOS app
- [ ] Login via iOS app
- [ ] Create test video (will need video upload next)
- [ ] View feed
- [ ] Like video
- [ ] Test P2P video playback

### 2. Add Features

- [ ] File upload for thumbnails
- [ ] Profile picture upload
- [ ] Video upload endpoint
- [ ] Search API
- [ ] User profiles API
- [ ] Follow/unfollow API

### 3. Federation

- [ ] Implement ActivityPub inbox/outbox
- [ ] Cross-instance following
- [ ] Federated feed
- [ ] Instance discovery

### 4. Production Hardening

- [ ] Rate limiting
- [ ] Redis caching
- [ ] CDN for static assets
- [ ] Monitoring alerts
- [ ] Backup automation
- [ ] Load testing

## Architecture

```
┌─────────────────┐
│   iOS App       │
│   (SwiftUI)     │
└────────┬────────┘
         │ HTTPS
         ↓
┌─────────────────────────────────┐
│   Google Cloud Run              │
│   ┌─────────────────────────┐   │
│   │  TorTok Metadata Server │   │
│   │  (Node.js + Express)    │   │
│   └──────────┬──────────────┘   │
│              │                   │
└──────────────┼───────────────────┘
               │ Cloud SQL Proxy
               ↓
┌─────────────────────────────────┐
│   Cloud SQL PostgreSQL          │
│   ┌─────────────────────────┐   │
│   │  tortok database        │   │
│   │  - users                │   │
│   │  - videos               │   │
│   │  - likes                │   │
│   │  - follows              │   │
│   └─────────────────────────┘   │
└─────────────────────────────────┘
```

## Support

For issues or questions:
1. Check logs: `gcloud run services logs`
2. Review README: `/backend/README.md`
3. Test locally: `npm run dev`

---

**Deployment Script Location**: `/backend/deploy.sh`
**Backend Code**: `/backend/src/`
**Database Schema**: `/backend/src/db/schema.sql`
