import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { WebcastPushConnection } from 'tiktok-live-connector';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/* ── env ───────────────────────────── */
const PORT = process.env.PORT || 3000;
const BACKEND_API_URL = process.env.BACKEND_API_URL;
const API_KEY = process.env.API_KEY;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const USERNAME = process.env.TIKTOK_USERNAME;

// Validate required environment variables
if (!API_KEY || !ACCOUNT_ID) {
  console.error('❌ API_KEY and ACCOUNT_ID are required in .env file');
  console.error('   Please configure your instance credentials.');
  process.exit(1);
}

if (!USERNAME) {
  console.error('❌ TIKTOK_USERNAME is required in .env file');
  process.exit(1);
}

/* ── Backend-loaded configuration ──────────── */
let cfg = { target: 10_000 };  // Will be loaded from backend
let groups = {};               // Will be loaded from backend

/* ── runtime state ─────────────────── */
let counters = {};
let liveStatus = 'DISCONNECTED';   // DISCONNECTED | CONNECTING | ONLINE | OFFLINE
let viewers = 0;
let uniques = new Set();
let totalGifts = 0;
let totalDiamonds = 0;
let giftCatalog = [];

function initCounters() {
  counters = {};
  for (const g in groups) counters[g] = { count: 0, diamonds: 0 };
}
initCounters();

/* ── Backend API Helper Functions ──────────────────────────────────── */

// Create headers for backend API requests
function getBackendHeaders() {
  return {
    'X-API-Key': API_KEY,
    'X-Account-ID': ACCOUNT_ID,
    'Content-Type': 'application/json'
  };
}

// Load gift groups from backend
async function loadGiftGroupsFromBackend() {
  if (!BACKEND_API_URL) {
    console.log('⚠️ BACKEND_API_URL not set, skipping backend load');
    return {};
  }

  try {
    console.log(`📥 Loading gift groups from backend for account: ${ACCOUNT_ID}`);

    const response = await axios.get(
      `${BACKEND_API_URL}/${ACCOUNT_ID}/gift-groups`,
      { headers: getBackendHeaders(), timeout: 10000 }
    );

    if (response.data.success && response.data.data) {
      console.log(`✅ Loaded ${Object.keys(response.data.data).length} gift groups from backend`);
      return response.data.data;
    }

    return {};
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('ℹ️ No gift groups found in backend, starting fresh');
      return {};
    }
    console.error('❌ Failed to load gift groups from backend:', error.message);
    return {};
  }
}

// Save gift groups to backend
async function saveGiftGroupsToBackend(groupsData) {
  if (!BACKEND_API_URL) {
    console.log('⚠️ BACKEND_API_URL not set, skipping backend save');
    return;
  }

  try {
    await axios.post(
      `${BACKEND_API_URL}/${ACCOUNT_ID}/gift-groups`,
      { groups: groupsData },
      { headers: getBackendHeaders(), timeout: 10000 }
    );

    console.log('✅ Gift groups saved to backend');
  } catch (error) {
    console.error('❌ Failed to save gift groups to backend:', error.message);
  }
}

// Load configuration from backend
async function loadConfigFromBackend() {
  if (!BACKEND_API_URL) {
    console.log('⚠️ BACKEND_API_URL not set, skipping backend load');
    return { target: 10_000 };
  }

  try {
    console.log(`📥 Loading configuration from backend for account: ${ACCOUNT_ID}`);

    const response = await axios.get(
      `${BACKEND_API_URL}/${ACCOUNT_ID}/config`,
      { headers: getBackendHeaders(), timeout: 10000 }
    );

    if (response.data.success && response.data.data) {
      console.log(`✅ Configuration loaded from backend`);
      return response.data.data;
    }

    return { target: 10_000 };
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('ℹ️ No configuration found in backend, using defaults');
      return { target: 10_000 };
    }
    console.error('❌ Failed to load configuration from backend:', error.message);
    return { target: 10_000 };
  }
}

// Save configuration to backend
async function saveConfigToBackend(configData) {
  if (!BACKEND_API_URL) {
    console.log('⚠️ BACKEND_API_URL not set, skipping backend save');
    return;
  }

  try {
    await axios.post(
      `${BACKEND_API_URL}/${ACCOUNT_ID}/config`,
      configData,
      { headers: getBackendHeaders(), timeout: 10000 }
    );

    console.log('✅ Configuration saved to backend');
  } catch (error) {
    console.error('❌ Failed to save configuration to backend:', error.message);
  }
}

// Initialize: Load data from backend on startup
async function initializeFromBackend() {
  console.log('\n🔄 Initializing from backend...');

  const [loadedGroups, loadedConfig] = await Promise.all([
    loadGiftGroupsFromBackend(),
    loadConfigFromBackend()
  ]);

  groups = loadedGroups;
  cfg = loadedConfig;

  initCounters();

  console.log('✅ Backend initialization complete');
  console.log(`   - Groups: ${Object.keys(groups).length}`);
  console.log(`   - Target: ${cfg.target}\n`);
}

// Call initialization
await initializeFromBackend();

/* ── TikTok connector (created on demand) ─────────────────────────── */
let tiktok = null;

async function connectTikTok() {
  if (liveStatus === 'CONNECTING' || liveStatus === 'ONLINE') return;

  liveStatus = 'CONNECTING'; broadcast();
  try {
    tiktok = new WebcastPushConnection(USERNAME, {
      enableExtendedGiftInfo: true,
      signServerUrl: 'https://sign.furetto.dev/api/sign'
    });

    /* … listeners (streamEnd, viewer, member) stay the same … */

    tiktok.on('gift', data => {
      io.emit('giftStream', data);       // still echo raw event to the UI

      /* 1️⃣  Calculate how many gifts to add (delta) */
      let delta = 0;

      if (data.giftType === 1) {               // streak-capable gifts
        if (data.repeatEnd) {
          delta = data.repeatCount;            // count once, at the end
        } else {
          return;                              // ignore in-progress ticks
        }
      } else {
        /* Non-streak gifts arrive once with repeatCount === 1 */
        delta = data.repeatCount || 1;
      }

      /* 2️⃣  Global totals */
      totalGifts += delta;
      totalDiamonds += data.diamondCount * delta;

      /* add unseen gift to catalog */
      if (!giftCatalog.find(g => g.id === data.giftId)) {
        giftCatalog.push({
          id: data.giftId,
          name: data.giftName,
          diamondCost: data.diamondCount,
          iconUrl: data.giftPictureUrl || null
        });
        io.emit('giftCatalog', giftCatalog);      // update all clients
      }

      /* 3️⃣  Per-group totals */
      const gid = Object.keys(groups).find(k =>
        (groups[k].giftIds || []).includes(data.giftId)
      );
      if (gid) {
        counters[gid].count += delta;
        counters[gid].diamonds += data.diamondCount * delta;
      }

      /* 4️⃣  Broadcast updated payload */
      broadcast();
    });

    await tiktok.connect();              // may throw if stream offline
    liveStatus = 'ONLINE';

    /* ── NEW: fetch full gift catalogue after successful connect ── */
    giftCatalog = (await tiktok.fetchAvailableGifts().catch(() => []))
      .map(g => ({
        id: g.id,
        name: g.name,
        diamondCost: g.diamondCost,
        iconUrl: g.image?.url_list?.[0] || null
      }));
    io.emit('giftCatalog', giftCatalog); // send to all dashboards
  } catch (err) {
    console.error('Connect failed:', err.message);
    liveStatus = 'OFFLINE';
  }
  broadcast();
}

async function disconnectTikTok() {
  if (tiktok) {
    try { await tiktok.disconnect(); } catch { }
    tiktok = null;
  }
  liveStatus = 'DISCONNECTED';
  broadcast();
}

/* ── Express, static, auth, overlay public -------------------------- */
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const pub = path.join(__dirname, '..', 'public');

// Public routes (no auth required)
app.use('/overlay.html', express.static(path.join(pub, 'overlay.html')));
app.use('/overlay.js', express.static(path.join(pub, 'overlay.js')));
app.use('/styles.css', express.static(path.join(pub, 'styles.css')));

// Public routes - serve static files
app.use(express.static(pub));

// Root route - redirects to login or dashboard based on session
app.get('/', (_, res) => res.sendFile(path.join(pub, 'index.html')));

// Explicit routes for better control
app.get('/login', (_, res) => res.sendFile(path.join(pub, 'login.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(pub, 'dashboard.html')));
app.get('/unauthorized', (_, res) => res.sendFile(path.join(pub, 'unauthorized.html')));

/* ── API routes ───────────────────────────────────────────────────── */

// API Key validation endpoint (public - no auth required)
app.post('/api/validate', (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: 'API Key is required'
    });
  }

  // Validate against server's API Key
  if (apiKey === API_KEY) {
    return res.json({
      success: true,
      accountId: ACCOUNT_ID,
      tiktokUsername: USERNAME
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid API Key'
  });
});

// Protected routes - require valid session
app.post('/api/connect', async (_, res) => { await connectTikTok(); res.json({ ok: true }); });
app.post('/api/disconnect', async (_, res) => { await disconnectTikTok(); res.json({ ok: true }); });

app.get('/api/state', (_, res) => res.json(buildPayload()));

app.post('/api/groups', async (req, res) => {
  try {
    groups = req.body || {};

    // Save to backend
    await saveGiftGroupsToBackend(groups);

    initCounters();
    broadcast();
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving groups:', error);
    res.status(500).json({ error: 'Failed to save groups' });
  }
});


app.post('/api/counter', (req, res) => {
  const { groupId, diamonds = null, count = null } = req.body || {};
  if (!groups[groupId]) return res.status(404).json({ error: 'group not found' });

  counters[groupId] ??= { count: 0, diamonds: 0 };
  if (diamonds !== null) counters[groupId].diamonds = Number(diamonds);
  if (count !== null) counters[groupId].count = Number(count);

  broadcast();
  res.json({ ok: true });
});

app.post('/api/target', async (req, res) => {
  try {
    cfg.target = Number(req.body?.target) || cfg.target;

    // Save to backend
    await saveConfigToBackend(cfg);

    broadcast();
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving target:', error);
    res.status(500).json({ error: 'Failed to save target' });
  }
});

app.post('/api/reset', (_, res) => {
  initCounters();
  uniques = new Set();
  viewers = 0;
  totalGifts = totalDiamonds = 0;
  broadcast();
  res.json({ ok: true });
});

/* ── Socket.IO initial emit ───────────────────────────────────────── */
io.on('connection', s => {
  s.emit('giftCatalog', giftCatalog);  // <── send current catalogue
  s.emit('update', buildPayload());
});

/* ── helpers ──────────────────────────────────────────────────────── */
function buildPayload() {
  return {
    counters,
    groups,
    target: cfg.target,
    stats: {
      liveStatus,
      username: USERNAME,
      liveViewers: viewers,
      uniqueJoins: uniques.size,
      totalGifts,
      totalDiamonds
    }
  };
}
function broadcast() { io.emit('update', buildPayload()); }

/* ── start server ─────────────────────────────────────────────────── */
http.listen(PORT, () => {
  console.log('\n🎉 TikTok Gift Tracker Instance - API Key Authentication');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🔐 Account ID: ${ACCOUNT_ID}`);
  console.log(`🎯 TikTok Username: @${USERNAME}`);
  if (BACKEND_API_URL) {
    console.log(`🌐 Backend API: ${BACKEND_API_URL}`);
  } else {
    console.log(`⚠️  No backend configured (running standalone)`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ Ready to track gifts!\n');
});
