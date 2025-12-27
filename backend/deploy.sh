#!/bin/bash

# TorTok Metadata Server - Google Cloud Run Deployment Script
# Fully idempotent - can be run multiple times safely

set -e

# Change to script directory (where Dockerfile is)
cd "$(dirname "$0")"

echo "🚀 TorTok Metadata Server - Google Cloud Deployment"
echo "===================================================="
echo ""

# Configuration
PROJECT_ID="tortok"
REGION="us-central1"
SERVICE_NAME="tortok-metadata-server"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
INSTANCE_NAME="tortok-db"
DB_NAME="tortok"
DB_USER="tortok-user"
SECRETS_FILE=".deployment-secrets"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Login check
echo "📋 Checking authentication..."
CURRENT_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null)

if [ -z "$CURRENT_ACCOUNT" ]; then
    echo "🔐 Please authenticate with Google Cloud..."
    gcloud auth login
else
    echo "✅ Authenticated as: $CURRENT_ACCOUNT"
fi

# Set project
echo ""
echo "📦 Setting project to: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Create project if it doesn't exist
echo ""
echo "🔍 Checking if project exists..."
if ! gcloud projects describe $PROJECT_ID &> /dev/null; then
    echo "📦 Creating project: $PROJECT_ID"
    gcloud projects create $PROJECT_ID --name="TorTok Production"
else
    echo "✅ Project exists: $PROJECT_ID"
fi

# Enable required APIs
echo ""
echo "🔧 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com \
    run.googleapis.com \
    sqladmin.googleapis.com \
    compute.googleapis.com \
    secretmanager.googleapis.com

# Build Docker image
echo ""
echo "🏗️  Building Docker image..."
echo "Image: $IMAGE_NAME"

gcloud builds submit --tag $IMAGE_NAME

# Create or get Cloud SQL instance
echo ""
echo "🗄️  Checking for Cloud SQL instance..."

if ! gcloud sql instances describe $INSTANCE_NAME &> /dev/null 2>&1; then
    echo "📦 Creating Cloud SQL PostgreSQL instance..."
    echo "⏱️  This will take 5-10 minutes..."

    # Generate and save password
    DB_PASSWORD=$(openssl rand -base64 32)
    mkdir -p "$(dirname "$SECRETS_FILE")"
    echo "DB_PASSWORD=$DB_PASSWORD" > "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"

    gcloud sql instances create $INSTANCE_NAME \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --root-password="$(openssl rand -base64 32)"

    # Create database
    gcloud sql databases create $DB_NAME --instance=$INSTANCE_NAME

    # Create user
    gcloud sql users create $DB_USER \
        --instance=$INSTANCE_NAME \
        --password="$DB_PASSWORD"

    echo "✅ Database created"
    echo "📋 Database password saved to: $SECRETS_FILE"
else
    echo "✅ Cloud SQL instance exists: $INSTANCE_NAME"

    # Load existing password or generate warning
    if [ -f "$SECRETS_FILE" ]; then
        source "$SECRETS_FILE"
        echo "✅ Loaded database password from: $SECRETS_FILE"
    else
        echo "⚠️  Warning: Database exists but password file not found"
        echo "    If you need to reset the password, use:"
        echo "    gcloud sql users set-password $DB_USER --instance=$INSTANCE_NAME --password=NEW_PASSWORD"
        DB_PASSWORD=""
    fi
fi

# Get connection name
CONNECTION_NAME=$(gcloud sql instances describe $INSTANCE_NAME --format="value(connectionName)")
echo "📡 Connection name: $CONNECTION_NAME"

# Create or update DATABASE_URL secret (only if we have the password)
if [ -n "$DB_PASSWORD" ]; then
    echo ""
    echo "🔐 Setting up database URL secret..."

    DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@/$DB_NAME?host=/cloudsql/$CONNECTION_NAME"

    if gcloud secrets describe tortok-db-url &> /dev/null 2>&1; then
        echo "✅ Secret exists, updating..."
        echo -n "$DATABASE_URL" | gcloud secrets versions add tortok-db-url --data-file=-
    else
        echo "📦 Creating secret..."
        echo -n "$DATABASE_URL" | gcloud secrets create tortok-db-url --data-file=-
    fi

    # Grant Cloud Run service account access to the secret
    echo "🔑 Granting secret access to Cloud Run service account..."
    PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
    gcloud secrets add-iam-policy-binding tortok-db-url \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet 2>/dev/null || true
else
    echo "⚠️  Skipping database URL secret (no password available)"
fi

# Generate or load JWT secret
echo ""
echo "🔐 Setting up JWT secret..."

if [ -f "$SECRETS_FILE" ]; then
    source "$SECRETS_FILE"
    if [ -z "$JWT_SECRET" ]; then
        JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
        echo "JWT_SECRET=$JWT_SECRET" >> "$SECRETS_FILE"
        echo "✅ Generated new JWT secret"
    else
        echo "✅ Using existing JWT secret"
    fi
else
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    mkdir -p "$(dirname "$SECRETS_FILE")"
    echo "JWT_SECRET=$JWT_SECRET" > "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    echo "✅ Generated new JWT secret"
fi

# Deploy to Cloud Run
echo ""
echo "🚀 Deploying to Cloud Run..."

gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 10 \
    --min-instances 0 \
    --set-env-vars "NODE_ENV=production,JWT_SECRET=$JWT_SECRET,INSTANCE_NAME=TorTok Production" \
    --set-cloudsql-instances "$CONNECTION_NAME" \
    --set-secrets "DATABASE_URL=tortok-db-url:latest"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Deployment Information"
echo "========================="
echo "Service URL: $SERVICE_URL"
echo "Region: $REGION"
echo "Project: $PROJECT_ID"
echo "Database: $CONNECTION_NAME"
echo ""
echo "🔗 API Endpoints:"
echo "  - Health: $SERVICE_URL/health"
echo "  - Instance Info: $SERVICE_URL/.well-known/tortok"
echo "  - Register: POST $SERVICE_URL/auth/register"
echo "  - Login: POST $SERVICE_URL/auth/login"
echo "  - Feed: GET $SERVICE_URL/videos/feed"
echo ""
echo "📝 Test the deployment:"
echo "   curl $SERVICE_URL/health"
echo ""
echo "🔒 Secrets stored in: $SECRETS_FILE (keep this file secure!)"
echo ""
