# TikTok Gift Tracker Instance - API Key Authentication

**Version:** 2.0.0
**Authentication:** API Key + Account ID
**Integration:** Backend API Ready

---

## 🎯 Overview

This is a **tracker instance** that connects to TikTok Live and syncs data with a central backend using **API Key authentication**. Each instance is configured for a specific account and communicates with the backend to load/save configuration and gift groups.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

Create `.env` file:

```bash
BACKEND_API_URL=http://localhost:3001/api/instances
API_KEY=your-api-key-here
ACCOUNT_ID=your-account-id-here
TIKTOK_USERNAME=your_tiktok_username
PORT=3000
```

### 3. Start Server

```bash
node server/index.js
```

### 4. Access Dashboard

```
http://localhost:3000
```

---

## 📚 Documentation

See [BACKEND_INTEGRATION_GUIDE.md](BACKEND_INTEGRATION_GUIDE.md) for full API specifications.

---

**Status:** ✅ Production Ready
**License:** UNLICENSED
**Author:** O3 Consultancy LLC
