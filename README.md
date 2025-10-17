# TikTok Gift Tracker Instance

A containerized TikTok gift tracking application that monitors gifts for one TikTok username and provides a real-time dashboard. Now supports dynamic environment-based configuration for easy multi-instance deployment.

## Features

- **Real-time Gift Tracking**: Monitor TikTok Live gifts as they happen
- **Dynamic Configuration**: Set all configuration via environment variables
- **Backend Integration**: Syncs data with backend API (o3-ttgifts.com)
- **Docker-Ready**: Fully containerized for easy deployment
- **Multi-Instance Support**: Designed to run multiple instances simultaneously via Instance Manager

## Quick Start - Standalone

### Build

```bash
docker build -t gift-tracker .
```

### Run with Environment Variables

```bash
docker run -d --name gift-tracker-user1 \
  -p 3000:3000 \
  -e API_KEY=066e8866-e7a3-46d3-9efc-d00c7c9172b5 \
  -e ACCOUNT_ID=68f0c824f05516c475153ab6 \
  -e TIKTOK_USERNAME=best_family05 \
  -e PORT=3000 \
  -e BACKEND_API_URL=https://o3-ttgifts.com/api/instances \
  gift-tracker
```

Then open http://localhost:3000 to view the dashboard.

## Multi-Instance Management

For managing multiple tracker instances, use the **Gift Instance Manager**:

📦 See: `/path/to/gift-instance-manager/` directory

The Instance Manager provides:
- Web UI for creating and managing multiple instances
- Automatic port allocation
- Start/Stop/Delete controls
- Log viewing
- Health monitoring

### Using Instance Manager

1. Build this Docker image first:
   ```bash
   docker build -t gift-tracker:latest .
   ```

2. Start the Instance Manager (see its README)

3. Create instances via the web dashboard at `http://localhost:4000`

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Unique API key for backend authentication | `066e8866-e7a3-46d3-9efc-d00c7c9172b5` |
| `ACCOUNT_ID` | Backend account identifier | `68f0c824f05516c475153ab6` |
| `TIKTOK_USERNAME` | TikTok username to track (without @) | `best_family05` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `production` |
| `BACKEND_API_URL` | Backend API endpoint | `https://o3-ttgifts.com/api/instances` |
| `DASH_PASSWORD` | Legacy dashboard password | `changeme` |
| `DEBUG_MODE` | Enable debug logging | `false` |

## Configuration

### Gift Groups

Gift groups are now loaded from the backend API automatically. No need to modify local files.

To configure groups, use the backend API or the Instance Manager dashboard.

### Custom Configuration

If you need to override default settings, you can still mount custom config files:

```bash
docker run -v $(pwd)/config:/app/config:ro ...
```

## Architecture

```
┌─────────────────────────────────────────────┐
│         Gift Tracker Instance               │
│                                             │
│  ┌──────────────┐        ┌──────────────┐  │
│  │   TikTok     │───────▶│   Express    │  │
│  │ Live Connect │        │    Server    │  │
│  └──────────────┘        └──────────────┘  │
│         │                       │          │
│         │                       │          │
│         ▼                       ▼          │
│  ┌──────────────┐        ┌──────────────┐  │
│  │ Gift Counter │        │  WebSocket   │  │
│  │   Service    │        │   (Socket.io)│  │
│  └──────────────┘        └──────────────┘  │
│         │                       │          │
│         └───────────┬───────────┘          │
│                     ▼                       │
│            ┌──────────────┐                │
│            │  Dashboard   │                │
│            │     UI       │                │
│            └──────────────┘                │
└─────────────────────────────────────────────┘
                     │
                     ▼
            Backend API (o3-ttgifts.com)
```

## Notes

* Counters sync with backend API for persistence
* Dashboard provides real-time updates via WebSocket
* Supports auto-reconnection to TikTok Live
* Health monitoring and error tracking included
* Deploy anywhere Docker runs (VM, Cloud Run, ECS, etc.)

# PROD Release


## Build and PUSH
* from the repo root
gcloud builds submit --tag us-central1-docker.pkg.dev/o3-tt-subscription/gift-containers/gift-tracker:latest

## Cloud Run service per Tiktok Username
USER=best_family05
PASS=$(openssl rand -base64 12)      

gcloud run deploy gift-yala-ss3 \
  --image us-central1-docker.pkg.dev/o3-tt-subscription/gift-containers/gift-tracker:v1.0 \
  --region us-central1 \
  --memory 256Mi --min-instances 1 --max-instances 3 \
  --set-env-vars TIKTOK_USERNAME=${USER},DASH_PASSWORD=${PASS} \
  --allow-unauthenticated

## PAUSE/Suspend
gcloud run services update gift-${USER} --min-instances 0 --region us-central1

## RESUME 
gcloud run services update gift-${USER} --min-instances 1 --region us-central1

## Change TikTok Username
gcloud run services update gift-${USER} --set-env-vars TIKTOK_USERNAME=newUser --region us-central1

## Upgrade to new image
gcloud run services update gift-${USER} --image ...:v0.4 --region us-central1

## DELETE
gcloud run services delete gift-yala-ss3 --region us-central1


