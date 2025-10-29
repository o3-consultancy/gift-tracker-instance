#!/bin/sh
set -e

echo "🔧 Generating .env file from environment variables..."

# Create .env file from environment variables
cat > /app/.env << EOF
# ==========================================
# TikTok Gift Tracker Instance - API Key Authentication
# ==========================================
# Generated automatically from Docker environment variables

# ─── Backend API Configuration ──────────────────────────────
BACKEND_API_URL=${BACKEND_API_URL:-https://o3-ttgifts.com/api/instances}

# ─── Instance Credentials ───────────────────────────────────
API_KEY=${API_KEY}
ACCOUNT_ID=${ACCOUNT_ID}

# ─── TikTok Configuration ───────────────────────────────────
TIKTOK_USERNAME=${TIKTOK_USERNAME}

# ─── Euler Stream API (Rate Limit Mitigation) ───────────────
EULER_API_KEY=${EULER_API_KEY:-euler_NzEyNDZkNzhmNDliNTc3M2FkMmNkYjM0ZDljMmVlMjFhMDNjNDcwM2MwMzk3NmUwYzE4YTdl}

# ─── Server Configuration ───────────────────────────────────
PORT=${PORT:-3000}
NODE_ENV=${NODE_ENV:-production}

# ─── Optional: Legacy Dashboard Password ───────────────────
DASH_PASSWORD=${DASH_PASSWORD:-changeme}

# ─── Debug Mode ──────────────────────────────────────────────
DEBUG_MODE=${DEBUG_MODE:-false}
EOF

echo "✅ .env file created successfully"
echo "📋 Configuration:"
echo "   - API_KEY: ${API_KEY:0:8}... (${#API_KEY} chars)"
echo "   - ACCOUNT_ID: ${ACCOUNT_ID}"
echo "   - TIKTOK_USERNAME: ${TIKTOK_USERNAME}"
echo "   - PORT: ${PORT:-3000}"
echo "   - BACKEND_API_URL: ${BACKEND_API_URL:-https://o3-ttgifts.com/api/instances}"

# Validate required variables
if [ -z "$API_KEY" ]; then
    echo "❌ ERROR: API_KEY environment variable is required"
    exit 1
fi

if [ -z "$ACCOUNT_ID" ]; then
    echo "❌ ERROR: ACCOUNT_ID environment variable is required"
    exit 1
fi

if [ -z "$TIKTOK_USERNAME" ]; then
    echo "❌ ERROR: TIKTOK_USERNAME environment variable is required"
    exit 1
fi

echo ""
echo "🚀 Starting TikTok Gift Tracker Instance..."
echo ""

# Execute the main command
exec "$@"
