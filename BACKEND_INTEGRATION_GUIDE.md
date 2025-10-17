# Simple Backend Integration Guide - Gift Tracker Instance

**Date:** 2025-10-16
**Approach:** API Key Authentication (Simple & Secure)

## Overview

This guide outlines a **simple, straightforward approach** for integrating the gift tracker instances with the main backend. Instead of complex JWT tokens, we use **API Keys** that are managed by admins.

## Architecture

### Simple Flow:
1. **Admin deploys tracker instance** → Generates unique API Key
2. **Admin assigns URL + API Key** → Updates account in admin panel
3. **Customer sees their tracker URL + API Key** → Displays in customer dashboard
4. **Instance authenticates with API Key** → All API calls use the API key
5. **Backend validates API Key + Account ID** → Grants access to account data

---

## Database Schema

### 1. TrackerInstance Collection (NEW)

Stores instance credentials and configuration.

```typescript
{
  accountId: ObjectId,           // Reference to TikTokAccount
  userId: ObjectId,              // Reference to User (for quick lookups)
  apiKey: string,                // Unique API key (UUID format)
  instanceUrl: string,           // https://account123.app.o3-ttgifts.com
  status: 'active' | 'inactive', // Instance status
  lastAccessedAt: Date,          // Last time instance called API
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
- { accountId: 1 } unique
- { apiKey: 1 } unique
- { userId: 1 }
```

### 2. InstanceData Collection (NEW)

Stores all instance-specific data (gift groups, config, etc.)

```typescript
{
  accountId: ObjectId,           // Reference to TikTokAccount
  dataType: string,              // 'gift-groups' | 'config' | 'analytics'
  data: Mixed,                   // Flexible schema for different data types
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
- { accountId: 1, dataType: 1 } unique
```

**Data Type Examples:**

**gift-groups:**
```json
{
  "dataType": "gift-groups",
  "data": {
    "group-1": {
      "name": "VIP Gifts",
      "goal": 50000,
      "color": "#ff0000",
      "giftIds": [5655, 5656, 5657]
    },
    "group-2": {
      "name": "Normal Gifts",
      "goal": 10000,
      "color": "#00ff00",
      "giftIds": [5658, 5659]
    }
  }
}
```

**config:**
```json
{
  "dataType": "config",
  "data": {
    "tiktokUsername": "@username",
    "theme": "dark",
    "language": "en",
    "notifications": true,
    "autoConnect": false
  }
}
```

---

## API Endpoints

### Authentication Middleware

All instance API endpoints use API Key authentication:

**Header:**
```
X-API-Key: <api-key>
X-Account-ID: <account-id>
```

**Validation:**
1. Extract API Key and Account ID from headers
2. Find TrackerInstance where `apiKey === X-API-Key` AND `accountId === X-Account-ID`
3. If found → Grant access
4. If not found → Return 401 Unauthorized
5. Update `lastAccessedAt` on success

---

### Instance API Routes

**Base URL:** `http://localhost:3001/api/instances`

#### 1. Load Gift Groups
```
GET /api/instances/:accountId/gift-groups

Headers:
  X-API-Key: abc-123-def-456
  X-Account-ID: 68f0b398d9073c50c7bb1b2f

Response:
{
  "success": true,
  "data": {
    "group-1": { "name": "VIP Gifts", "goal": 50000, ... },
    "group-2": { "name": "Normal Gifts", "goal": 10000, ... }
  }
}
```

#### 2. Save Gift Groups
```
POST /api/instances/:accountId/gift-groups

Headers:
  X-API-Key: abc-123-def-456
  X-Account-ID: 68f0b398d9073c50c7bb1b2f

Body:
{
  "groups": {
    "group-1": { "name": "VIP Gifts", "goal": 50000, ... },
    "group-2": { "name": "Normal Gifts", "goal": 10000, ... }
  }
}

Response:
{
  "success": true,
  "message": "Gift groups saved successfully"
}
```

#### 3. Load Configuration
```
GET /api/instances/:accountId/config

Headers:
  X-API-Key: abc-123-def-456
  X-Account-ID: 68f0b398d9073c50c7bb1b2f

Response:
{
  "success": true,
  "data": {
    "tiktokUsername": "@username",
    "theme": "dark",
    "language": "en"
  }
}
```

#### 4. Save Configuration
```
POST /api/instances/:accountId/config

Headers:
  X-API-Key: abc-123-def-456
  X-Account-ID: 68f0b398d9073c50c7bb1b2f

Body:
{
  "tiktokUsername": "@newusername",
  "theme": "light"
}

Response:
{
  "success": true,
  "message": "Configuration saved successfully"
}
```

---

## Admin Panel Changes

### AccountsView - Add API Key Management

**New Fields in Account Table:**
- **Instance URL** (editable)
- **API Key** (read-only, with "Generate" button)

**New Actions:**
- **Generate API Key** button → Creates new API key
- **Regenerate API Key** button → Replaces existing key
- **Copy API Key** button → Copies to clipboard

---

## Customer Dashboard Changes

### DashboardView - Display Instance Access

**New Section:** Shows for each account:
- Tracker URL (with copy button)
- API Key (hidden by default, with show/copy buttons)
- Status and last accessed time
- "Open Tracker" button

---

## Benefits

✅ **Simple**: Just API key + Account ID
✅ **Secure**: API keys can be easily rotated
✅ **Manageable**: Admins have full control
✅ **Visible**: Customers can see credentials
✅ **Scalable**: Easy to add more instances

---

**Ready to implement! 🚀**
