# Metadata Node Deployment Guide

This guide provides step-by-step instructions for deploying your own TorTok metadata instance.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Quick Start (Docker Compose)](#quick-start-docker-compose)
3. [Google Cloud Platform Deployment](#google-cloud-platform-deployment)
4. [AWS Deployment](#aws-deployment)
5. [Self-Hosted Deployment](#self-hosted-deployment)
6. [Configuration](#configuration)
7. [Maintenance & Operations](#maintenance--operations)

---

## Prerequisites

### Required Knowledge
- Basic Linux/command line skills
- Understanding of Docker and containers
- Familiarity with DNS configuration
- Basic database administration

### Required Resources

**Minimum Hardware:**
- 2 vCPU
- 4 GB RAM
- 20 GB storage (SSD recommended)
- 100 GB/month bandwidth

**For 1000+ active users:**
- 4 vCPU
- 8 GB RAM
- 50 GB storage
- 500 GB/month bandwidth

### Required Accounts
- Cloud provider account (GCP, AWS, or server provider)
- Domain name (for your instance URL)
- Email service (for notifications)
- Optional: Object storage account (S3, R2, etc.)

---

## Quick Start (Docker Compose)

### Local Development Setup

**1. Clone Repository**
```bash
git clone https://github.com/tortok/metadata-server.git
cd metadata-server
```

**2. Create Environment File**
```bash
cp .env.example .env
```

Edit `.env`:
```bash
# Database
DATABASE_URL=postgresql://tortok:password@postgres:5432/tortok

# Redis
REDIS_URL=redis://redis:6379

# Instance Configuration
INSTANCE_URL=https://example.tortok.com
INSTANCE_NAME="My TorTok Instance"
ADMIN_EMAIL=admin@example.com

# Secrets (generate with: openssl rand -hex 32)
JWT_SECRET=your_secret_here
SESSION_SECRET=your_secret_here

# Object Storage (MinIO for local dev)
S3_ENDPOINT=http://minio:9000
S3_BUCKET=tortok-media
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

# SMTP (for email notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

**3. Start Services**
```bash
docker-compose up -d
```

**4. Initialize Database**
```bash
docker-compose exec api npm run db:migrate
docker-compose exec api npm run db:seed
```

**5. Create Admin Account**
```bash
docker-compose exec api npm run create-admin
# Follow prompts to create admin user
```

**6. Access Instance**
- API: http://localhost:3000
- MinIO (object storage): http://localhost:9000
- PostgreSQL: localhost:5432

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tortok
      POSTGRES_USER: tortok
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tortok"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  api:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - .env
    ports:
      - "3000:3000"
    volumes:
      - ./src:/app/src  # Hot reload for development
    command: npm run dev

  worker:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - .env
    command: npm run worker

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

## Google Cloud Platform Deployment

### Architecture

```
┌─────────────────────────────────────────────┐
│         Cloud Load Balancer (HTTPS)         │
│     (SSL Certificate via Let's Encrypt)     │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│   Cloud Run (Auto-scaling API Containers)   │
│   • API Server (min 1, max 10 instances)    │
│   • Worker (background jobs)                │
└─────────────────────────────────────────────┘
          ↓                    ↓
┌──────────────────┐  ┌──────────────────────┐
│  Cloud SQL       │  │  Memorystore Redis   │
│  (PostgreSQL 15) │  │  (6 GB, HA)          │
└──────────────────┘  └──────────────────────┘
          ↓
┌─────────────────────────────────────────────┐
│        Cloud Storage (Media/Thumbnails)     │
└─────────────────────────────────────────────┘
```

### Step-by-Step Deployment

**1. Install Google Cloud SDK**
```bash
# Install gcloud CLI
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

**2. Enable Required APIs**
```bash
gcloud services enable \
  run.googleapis.com \
  sql-component.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage-api.googleapis.com \
  secretmanager.googleapis.com
```

**3. Create Cloud SQL Instance**
```bash
# Create PostgreSQL instance
gcloud sql instances create tortok-db \
  --database-version=POSTGRES_15 \
  --tier=db-g1-small \
  --region=us-central1 \
  --storage-size=20GB \
  --storage-type=SSD \
  --storage-auto-increase \
  --backup-start-time=03:00

# Set root password
gcloud sql users set-password postgres \
  --instance=tortok-db \
  --password=SECURE_PASSWORD_HERE

# Create database
gcloud sql databases create tortok \
  --instance=tortok-db

# Create application user
gcloud sql users create tortok \
  --instance=tortok-db \
  --password=APP_PASSWORD_HERE
```

**4. Create Redis Instance**
```bash
gcloud redis instances create tortok-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0
```

**5. Create Cloud Storage Bucket**
```bash
# Create bucket
gsutil mb -l us-central1 gs://tortok-media-UNIQUE_ID/

# Set public read access for thumbnails
gsutil iam ch allUsers:objectViewer gs://tortok-media-UNIQUE_ID/

# Enable CORS
cat > cors.json << EOF
[
  {
    "origin": ["https://your-instance.com"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

gsutil cors set cors.json gs://tortok-media-UNIQUE_ID/
```

**6. Store Secrets**
```bash
# Create secrets
echo -n "$(openssl rand -hex 32)" | gcloud secrets create jwt-secret --data-file=-
echo -n "$(openssl rand -hex 32)" | gcloud secrets create session-secret --data-file=-
echo -n "SMTP_PASSWORD" | gcloud secrets create smtp-password --data-file=-
```

**7. Build and Deploy to Cloud Run**

Create `Dockerfile`:
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

Build and push:
```bash
# Build container
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/tortok-api

# Deploy to Cloud Run
gcloud run deploy tortok-api \
  --image gcr.io/YOUR_PROJECT_ID/tortok-api \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --max-instances 10 \
  --memory 2Gi \
  --cpu 2 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "JWT_SECRET=jwt-secret:latest,SESSION_SECRET=session-secret:latest" \
  --add-cloudsql-instances YOUR_PROJECT_ID:us-central1:tortok-db \
  --vpc-connector tortok-connector
```

**8. Configure Domain**
```bash
# Map custom domain
gcloud run services update tortok-api \
  --platform managed \
  --region us-central1 \
  --add-cloudsql-instances YOUR_PROJECT_ID:us-central1:tortok-db

# Add domain mapping
gcloud beta run domain-mappings create \
  --service tortok-api \
  --domain tortok.example.com \
  --region us-central1
```

**9. Run Database Migrations**
```bash
# Get Cloud Run service URL
SERVICE_URL=$(gcloud run services describe tortok-api --region us-central1 --format 'value(status.url)')

# Run migrations via Cloud Run job
gcloud run jobs create tortok-migrate \
  --image gcr.io/YOUR_PROJECT_ID/tortok-api \
  --command npm \
  --args "run,db:migrate" \
  --add-cloudsql-instances YOUR_PROJECT_ID:us-central1:tortok-db

gcloud run jobs execute tortok-migrate
```

### Infrastructure as Code (Terraform)

Create `main.tf`:
```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Cloud SQL Instance
resource "google_sql_database_instance" "main" {
  name             = "tortok-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = "db-g1-small"
    availability_type = "REGIONAL"
    disk_size         = 20
    disk_type         = "PD_SSD"

    backup_configuration {
      enabled    = true
      start_time = "03:00"
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
    }
  }
}

resource "google_sql_database" "main" {
  name     = "tortok"
  instance = google_sql_database_instance.main.name
}

# Redis Instance
resource "google_redis_instance" "main" {
  name           = "tortok-redis"
  tier           = "STANDARD_HA"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "REDIS_7_0"
}

# Cloud Storage Bucket
resource "google_storage_bucket" "media" {
  name     = "${var.project_id}-tortok-media"
  location = var.region

  cors {
    origin          = ["https://${var.domain}"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  uniform_bucket_level_access = true
}

# Cloud Run Service
resource "google_cloud_run_service" "api" {
  name     = "tortok-api"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/tortok-api:latest"

        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
        }

        env {
          name  = "DATABASE_URL"
          value = "postgresql://${google_sql_user.main.name}:${google_sql_user.main.password}@/${google_sql_database.main.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
        }

        env {
          name  = "REDIS_URL"
          value = "redis://${google_redis_instance.main.host}:6379"
        }
      }
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "1"
        "autoscaling.knative.dev/maxScale" = "10"
        "run.googleapis.com/cloudsql-instances" = google_sql_database_instance.main.connection_name
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Allow unauthenticated access
resource "google_cloud_run_service_iam_member" "public" {
  service  = google_cloud_run_service.api.name
  location = google_cloud_run_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

variables {
  variable "project_id" {
    description = "GCP Project ID"
    type        = string
  }

  variable "region" {
    description = "GCP Region"
    type        = string
    default     = "us-central1"
  }

  variable "domain" {
    description = "Instance domain name"
    type        = string
  }
}
```

Deploy with Terraform:
```bash
terraform init
terraform plan
terraform apply
```

### Cost Estimate

| Service | Configuration | Monthly Cost |
|---------|--------------|--------------|
| Cloud Run (API) | 1-10 instances, 2vCPU, 2GB | $30-120 |
| Cloud SQL | db-g1-small, 20GB SSD | $25 |
| Memorystore Redis | 1GB, HA | $50 |
| Cloud Storage | 100GB, 1TB egress | $5 |
| Load Balancer | HTTPS | $18 |
| **Total** | | **$128-218/month** |

---

## AWS Deployment

### Architecture

```
Route 53 (DNS) → ALB (Load Balancer) → ECS Fargate (Containers)
                                         ↓
                            RDS PostgreSQL + ElastiCache Redis
                                         ↓
                                    S3 (Media)
```

### Quick Deploy with CDK

Create `lib/tortok-stack.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class TorTokStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'TorTokVPC', {
      maxAzs: 2,
      natGateways: 1
    });

    // RDS PostgreSQL
    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.SMALL
      ),
      vpc,
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7)
    });

    // ElastiCache Redis
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId)
    });

    const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
      cacheNodeType: 'cache.t4g.small',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref
    });

    // S3 Bucket
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      publicReadAccess: true,
      cors: [{
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedHeaders: ['*']
      }]
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // Fargate Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024
    });

    taskDef.addContainer('api', {
      image: ecs.ContainerImage.fromRegistry('YOUR_ECR_REPO/tortok-api:latest'),
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: `postgresql://${db.dbInstanceEndpointAddress}:5432/tortok`,
        S3_BUCKET: mediaBucket.bucketName
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'tortok' }),
      portMappings: [{ containerPort: 3000 }]
    });

    // Fargate Service
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2
    });

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true
    });

    const listener = alb.addListener('Listener', {
      port: 443,
      certificates: [/* Your ACM certificate */]
    });

    listener.addTargets('ECS', {
      port: 3000,
      targets: [service]
    });
  }
}
```

Deploy:
```bash
npm install -g aws-cdk
cdk bootstrap
cdk deploy
```

---

## Self-Hosted Deployment

### Using a VPS (DigitalOcean, Hetzner, etc.)

**1. Server Setup**
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

**2. Clone and Configure**
```bash
git clone https://github.com/tortok/metadata-server.git /opt/tortok
cd /opt/tortok
cp .env.example .env
nano .env  # Edit configuration
```

**3. Start Services**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

**4. Setup Nginx Reverse Proxy**
```nginx
# /etc/nginx/sites-available/tortok
server {
    listen 80;
    server_name tortok.example.com;

    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name tortok.example.com;

    ssl_certificate /etc/letsencrypt/live/tortok.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tortok.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site:
```bash
ln -s /etc/nginx/sites-available/tortok /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

**5. Setup SSL with Let's Encrypt**
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d tortok.example.com
```

---

## Configuration

### Environment Variables

```bash
# Instance Identity
INSTANCE_URL=https://tortok.example.com
INSTANCE_NAME="My TorTok Instance"
INSTANCE_DESCRIPTION="A decentralized Instagram alternative"
ADMIN_EMAIL=admin@example.com

# Database
DATABASE_URL=postgresql://user:pass@host:5432/database
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20

# Redis
REDIS_URL=redis://host:6379
REDIS_DB=0

# Security
JWT_SECRET=<generate-with-openssl-rand-hex-32>
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=30d
SESSION_SECRET=<generate-with-openssl-rand-hex-32>
BCRYPT_ROUNDS=12

# Object Storage
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=tortok-media
S3_REGION=us-east-1
S3_ACCESS_KEY=<your-key>
S3_SECRET_KEY=<your-secret>
S3_PUBLIC_URL=https://cdn.tortok.example.com

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@example.com
SMTP_PASSWORD=<app-password>
SMTP_FROM="TorTok <noreply@tortok.example.com>"

# Federation
FEDERATION_ENABLED=true
FEDERATION_MODE=public  # public, private, whitelist
FEDERATION_RETRY_ATTEMPTS=3
FEDERATION_TIMEOUT=5000  # ms

# Rate Limiting
RATE_LIMIT_WINDOW=60000  # 1 minute
RATE_LIMIT_MAX_REQUESTS=100

# Features
REGISTRATION_ENABLED=true
REGISTRATION_REQUIRES_APPROVAL=false
MAX_UPLOAD_SIZE=100MB  # Max file size
MAX_VIDEO_LENGTH=300  # seconds

# Monitoring
LOG_LEVEL=info  # error, warn, info, debug
SENTRY_DSN=<optional-sentry-dsn>
```

### Instance Configuration File

Create `config/instance.json`:
```json
{
  "version": "1.0.0",
  "name": "My TorTok Instance",
  "description": "A decentralized Instagram alternative",
  "admin": {
    "email": "admin@example.com",
    "account": "@admin"
  },
  "rules": [
    "Be respectful to others",
    "No spam or harassment",
    "No illegal content"
  ],
  "features": {
    "registration": true,
    "approvalRequired": false,
    "maxMediaSize": 104857600,
    "maxVideoLength": 300
  },
  "federation": {
    "enabled": true,
    "mode": "public",
    "blockedInstances": [],
    "allowedInstances": []
  },
  "limits": {
    "posts": {
      "hourly": 10,
      "daily": 100
    },
    "follows": {
      "hourly": 30,
      "daily": 100
    }
  }
}
```

---

## Maintenance & Operations

### Database Backups

**Automated Backups (PostgreSQL)**
```bash
# Create backup script
cat > /opt/tortok/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/backups/postgres
mkdir -p $BACKUP_DIR

# Backup database
docker-compose exec -T postgres pg_dump -U tortok tortok | gzip > $BACKUP_DIR/tortok_$DATE.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/tortok_$DATE.sql.gz s3://my-backup-bucket/
EOF

chmod +x /opt/tortok/backup.sh

# Add to crontab (daily at 3 AM)
crontab -e
# Add line:
0 3 * * * /opt/tortok/backup.sh
```

### Monitoring

**Prometheus Metrics**

Add to `docker-compose.yml`:
```yaml
prometheus:
  image: prom/prometheus:latest
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
    - prometheus_data:/prometheus
  ports:
    - "9090:9090"

grafana:
  image: grafana/grafana:latest
  ports:
    - "3001:3000"
  volumes:
    - grafana_data:/var/lib/grafana
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
```

Create `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'tortok-api'
    static_configs:
      - targets: ['api:3000']
```

### Log Management

**Centralized Logging with Loki**
```yaml
loki:
  image: grafana/loki:latest
  ports:
    - "3100:3100"
  volumes:
    - loki_data:/loki

promtail:
  image: grafana/promtail:latest
  volumes:
    - /var/log:/var/log
    - ./promtail-config.yml:/etc/promtail/config.yml
```

### Updates

**Update Docker Containers**
```bash
cd /opt/tortok

# Pull latest images
docker-compose pull

# Restart with new images
docker-compose up -d

# Run migrations if needed
docker-compose exec api npm run db:migrate

# Check logs
docker-compose logs -f api
```

### Health Checks

**API Health Endpoint**
```typescript
// GET /health
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    storage: await checkStorage()
  };

  const isHealthy = Object.values(checks).every(check => check.healthy);

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    checks
  });
});
```

**Uptime Monitoring**
- Use UptimeRobot or similar service
- Monitor `/health` endpoint
- Alert on downtime

---

## Troubleshooting

### Common Issues

**Database Connection Failures**
```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Test connection
docker-compose exec postgres psql -U tortok -d tortok -c "SELECT version();"
```

**Out of Memory**
```bash
# Check memory usage
docker stats

# Increase memory limits in docker-compose.yml
services:
  api:
    deploy:
      resources:
        limits:
          memory: 4G
```

**Federation Not Working**
```bash
# Check federation logs
docker-compose logs worker | grep federation

# Test instance connectivity
curl -I https://other-instance.com/.well-known/nodeinfo
```

### Getting Help

- Documentation: https://docs.tortok.org
- Community Forum: https://discuss.tortok.org
- GitHub Issues: https://github.com/tortok/metadata-server/issues
- Discord: https://discord.gg/tortok

---

## Next Steps

After deployment:

1. Create your admin account
2. Configure instance settings
3. Test federation with another instance
4. Set up monitoring and alerts
5. Configure backups
6. Invite users or open registration

See also:
- [System Architecture](../architecture/system-architecture.md)
- [Configuration Reference](configuration-reference.md)
- [Monitoring Guide](monitoring.md)
- [Troubleshooting Guide](troubleshooting.md)
