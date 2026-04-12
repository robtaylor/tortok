# Self-Hosting a TorTok Seeder

Run your own TorTok seeder node to help distribute video content via P2P.
The seeder pulls HLS video segments from the TorTok API, caches them locally,
and seeds them over WebTorrent to peers watching those videos.

## Requirements

- Docker (or compatible runtime like Podman)
- ~512 MB RAM minimum
- Persistent storage for cached video segments (grows with content)
- Outbound internet access (WebSocket to tracker, HTTPS to API/R2)

## Quick Start (Docker)

```bash
docker run -d \
  --name tortok-seeder \
  --restart unless-stopped \
  -p 8080:8080 \
  -v tortok-content:/data/content \
  ghcr.io/robtaylor/tortok-seeder:latest
```

Check health:

```bash
curl http://localhost:8080/health
# {"status":"ok","torrents":3,"peers":5,"uploadSpeed":12345,"seededVideos":3}
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `https://tortok-api.fly.dev` | TorTok API endpoint to poll for videos |
| `TRACKER_URL` | `wss://tortok-tracker.fly.dev` | Primary WebTorrent tracker |
| `CONTENT_DIR` | `/data/content` | Local directory for cached HLS segments |
| `POLL_INTERVAL_MS` | `60000` | How often to check for new videos (ms) |
| `HEALTH_PORT` | `8080` | Port for the health/stats HTTP server |

## Docker Compose

```yaml
services:
  tortok-seeder:
    image: ghcr.io/robtaylor/tortok-seeder:latest
    container_name: tortok-seeder
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - tortok-content:/data/content
    environment:
      - POLL_INTERVAL_MS=60000

volumes:
  tortok-content:
```

## Platform Guides

### Unraid

1. Go to **Docker** tab → **Add Container**
2. **Repository**: `ghcr.io/robtaylor/tortok-seeder:latest`
3. **Name**: `tortok-seeder`
4. Add a **Path** mapping:
   - Container path: `/data/content`
   - Host path: `/mnt/user/appdata/tortok-seeder/content`
5. Add a **Port** mapping: Host `8080` → Container `8080`
6. Click **Apply**

### Synology DSM

1. Open **Container Manager** (Docker)
2. **Registry** → Search `tortok-seeder` → Download
3. **Container** → **Create**
4. **Volume**: Add folder mapping `/docker/tortok-seeder/content` → `/data/content`
5. **Port**: Local `8080` → Container `8080`
6. **Environment**: Add variables as needed
7. **Apply** and start

### TrueNAS SCALE

1. Go to **Apps** → **Discover Apps** → **Custom App**
2. **Image**: `ghcr.io/robtaylor/tortok-seeder:latest`
3. **Storage**: Add host path `/mnt/pool/apps/tortok-seeder/content` → `/data/content`
4. **Networking**: Port `8080`
5. **Environment Variables**: Add as needed
6. Save and deploy

### Umbrel

Create `tortok-seeder/docker-compose.yml` in your Umbrel apps directory:

```yaml
services:
  tortok-seeder:
    image: ghcr.io/robtaylor/tortok-seeder:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ${APP_DATA_DIR}/content:/data/content
```

## Endpoints

| Path | Description |
|------|-------------|
| `GET /health` | Health check — returns status, torrent count, peer count, upload speed |
| `GET /torrents` | List all seeded torrents with stats |

## How It Works

1. On startup, the seeder seeds any previously cached content in `CONTENT_DIR`
2. Every `POLL_INTERVAL_MS`, it queries the TorTok API for the video feed
3. For each new video with an `hlsURL`, it downloads the HLS playlist and segments from R2
4. It seeds the downloaded content via WebTorrent, announcing to the tracker
5. When a peer (someone watching that video in the app) connects, the seeder uploads segments to them

## Resource Usage

- **CPU**: Minimal — WebTorrent is I/O bound, not CPU bound
- **RAM**: ~128 MB base + ~2 MB per seeded torrent
- **Disk**: Depends on content — each video is typically 5–50 MB of HLS segments
- **Network**: Upload proportional to peer demand. No download after initial cache.

## Troubleshooting

**No peers connecting**: Check that outbound WebSocket connections are allowed (port 443 to tracker). Some corporate firewalls block WSS.

**Health endpoint not responding**: Check the container is running and port 8080 is mapped correctly.

**Content not downloading**: Verify `API_URL` is reachable from the container. Run `curl https://tortok-api.fly.dev/videos/feed` to test.
