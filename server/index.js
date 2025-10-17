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
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

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
let cfg = {
  target: 10_000,
  comboTimeout: 5000  // 5 seconds default - can be configured
};
let groups = {};               // Will be loaded from backend

/* ── runtime state ─────────────────── */
let counters = {};
let liveStatus = 'DISCONNECTED';   // DISCONNECTED | CONNECTING | ONLINE | OFFLINE
let viewers = 0;
let uniques = new Set();
let totalGifts = 0;
let totalDiamonds = 0;
let giftCatalog = [];

/* ── Auto-reconnection state ─────────────────── */
let reconnectAttempts = 0;
let reconnectTimer = null;
let isManualDisconnect = false;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;    // 2 seconds
const MAX_RECONNECT_DELAY = 60000;    // 60 seconds

/* ── Error logging system ─────────────────── */
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 50;

function logError(category, message, details = null) {
  const timestamp = new Date().toISOString();
  const errorEntry = {
    timestamp,
    category,
    message,
    details,
    attempt: reconnectAttempts
  };

  errorLog.unshift(errorEntry);
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.pop();
  }

  console.error(`[${category}] ${message}`, details || '');

  // Broadcast error to dashboard
  io.emit('error', errorEntry);
}

/* ── Debug mode and diagnostics ─────────────────── */
const diagnostics = {
  startTime: Date.now(),
  totalGiftsProcessed: 0,
  totalComboTimeouts: 0,
  totalReconnections: 0,
  totalBroadcasts: 0,
  totalErrors: 0,
  lastGiftTime: null,
  lastBroadcastTime: null,
  eventCounts: {
    gift: 0,
    member: 0,
    roomUser: 0,
    like: 0,
    chat: 0,
    connected: 0,
    disconnected: 0,
    error: 0,
    streamEnd: 0
  },
  performanceMetrics: {
    avgBroadcastInterval: 0,
    avgGiftProcessingTime: 0,
    broadcastIntervals: []
  }
};

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

function trackEvent(eventType) {
  if (diagnostics.eventCounts[eventType] !== undefined) {
    diagnostics.eventCounts[eventType]++;
  }
  debugLog(`Event tracked: ${eventType} (count: ${diagnostics.eventCounts[eventType]})`);
}

function updatePerformanceMetrics() {
  const now = Date.now();
  if (diagnostics.lastBroadcastTime) {
    const interval = now - diagnostics.lastBroadcastTime;
    diagnostics.performanceMetrics.broadcastIntervals.push(interval);

    // Keep only last 100 intervals
    if (diagnostics.performanceMetrics.broadcastIntervals.length > 100) {
      diagnostics.performanceMetrics.broadcastIntervals.shift();
    }

    // Calculate average
    const sum = diagnostics.performanceMetrics.broadcastIntervals.reduce((a, b) => a + b, 0);
    diagnostics.performanceMetrics.avgBroadcastInterval =
      Math.round(sum / diagnostics.performanceMetrics.broadcastIntervals.length);
  }
  diagnostics.lastBroadcastTime = now;
}

/* ── Broadcast optimization with debouncing ─────────────────── */
let broadcastTimer = null;
let pendingBroadcast = false;
const BROADCAST_DEBOUNCE_MS = 100; // 100ms debounce

function debouncedBroadcast() {
  pendingBroadcast = true;

  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
  }

  broadcastTimer = setTimeout(() => {
    if (pendingBroadcast) {
      broadcast();
      pendingBroadcast = false;
    }
    broadcastTimer = null;
  }, BROADCAST_DEBOUNCE_MS);
}

function initCounters() {
  counters = {};
  for (const g in groups) counters[g] = { count: 0, diamonds: 0 };
}
initCounters();

/* ── Backend sync batching ─────────────────── */
let syncQueue = [];
let syncTimer = null;
const SYNC_BATCH_DELAY = 2000; // 2 seconds
const MAX_SYNC_QUEUE_SIZE = 10;

function queueBackendSync(type, data) {
  syncQueue.push({
    type,
    data,
    timestamp: Date.now()
  });

  debugLog(`Queued backend sync: ${type}, queue size: ${syncQueue.length}`);

  // If queue is full, sync immediately
  if (syncQueue.length >= MAX_SYNC_QUEUE_SIZE) {
    debugLog('Queue full, syncing immediately');
    flushSyncQueue();
    return;
  }

  // Otherwise, debounce the sync
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    flushSyncQueue();
  }, SYNC_BATCH_DELAY);
}

async function flushSyncQueue() {
  if (syncQueue.length === 0) return;

  const itemsToSync = [...syncQueue];
  syncQueue = [];

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  debugLog(`Flushing sync queue: ${itemsToSync.length} items`);

  // Group by type
  const groupedSyncs = {
    config: [],
    groups: []
  };

  itemsToSync.forEach(item => {
    if (groupedSyncs[item.type]) {
      groupedSyncs[item.type].push(item);
    }
  });

  // Process each type (use latest data only)
  if (groupedSyncs.config.length > 0) {
    const latest = groupedSyncs.config[groupedSyncs.config.length - 1];
    await saveConfigToBackend(latest.data).catch(err =>
      debugLog('Config sync failed:', err.message)
    );
  }

  if (groupedSyncs.groups.length > 0) {
    const latest = groupedSyncs.groups[groupedSyncs.groups.length - 1];
    await saveGiftGroupsToBackend(latest.data).catch(err =>
      debugLog('Groups sync failed:', err.message)
    );
  }
}

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
  const defaultConfig = {
    target: 10_000,
    comboTimeout: 5000  // 5 seconds default
  };

  if (!BACKEND_API_URL) {
    console.log('⚠️ BACKEND_API_URL not set, skipping backend load');
    return defaultConfig;
  }

  try {
    console.log(`📥 Loading configuration from backend for account: ${ACCOUNT_ID}`);

    const response = await axios.get(
      `${BACKEND_API_URL}/${ACCOUNT_ID}/config`,
      { headers: getBackendHeaders(), timeout: 10000 }
    );

    if (response.data.success && response.data.data) {
      console.log(`✅ Configuration loaded from backend`);
      // Merge with defaults to ensure all properties exist
      return { ...defaultConfig, ...response.data.data };
    }

    return defaultConfig;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('ℹ️ No configuration found in backend, using defaults');
      return defaultConfig;
    }
    console.error('❌ Failed to load configuration from backend:', error.message);
    return defaultConfig;
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

/* ── Connection health monitoring ─────────────────── */
let healthCheckTimer = null;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const HEALTH_CHECK_TIMEOUT = 10000;   // 10 seconds

const connectionHealth = {
  isHealthy: true,
  lastHealthCheck: null,
  lastSuccessfulCheck: null,
  consecutiveFailures: 0,
  totalChecks: 0,
  totalFailures: 0,
  uptime: 0,
  lastActivity: null
};

function startHealthMonitoring() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }

  debugLog('Starting connection health monitoring');

  healthCheckTimer = setInterval(async () => {
    if (liveStatus !== 'ONLINE') {
      debugLog('Skipping health check - not online');
      return;
    }

    connectionHealth.totalChecks++;
    connectionHealth.lastHealthCheck = Date.now();

    debugLog(`Health check #${connectionHealth.totalChecks}`);

    try {
      // Check if we've received any activity recently
      const timeSinceActivity = connectionHealth.lastActivity
        ? Date.now() - connectionHealth.lastActivity
        : null;

      if (timeSinceActivity && timeSinceActivity > HEALTH_CHECK_TIMEOUT * 2) {
        console.warn(`⚠️  No activity for ${Math.round(timeSinceActivity / 1000)}s - connection may be stale`);
        connectionHealth.consecutiveFailures++;
        connectionHealth.totalFailures++;
        connectionHealth.isHealthy = false;

        // If too many failures, trigger reconnect
        if (connectionHealth.consecutiveFailures >= 3) {
          console.error('❌ Health check failed multiple times - triggering reconnect');
          logError('HEALTH', 'Connection health check failed', {
            consecutiveFailures: connectionHealth.consecutiveFailures,
            timeSinceActivity
          });
          await disconnectTikTok();
          await connectTikTok();
        }
      } else {
        connectionHealth.consecutiveFailures = 0;
        connectionHealth.isHealthy = true;
        connectionHealth.lastSuccessfulCheck = Date.now();
        debugLog('✓ Health check passed');
      }

      // Calculate uptime
      if (connectionHealth.lastSuccessfulCheck) {
        connectionHealth.uptime = Date.now() - diagnostics.startTime;
      }
    } catch (err) {
      console.error('Health check error:', err.message);
      connectionHealth.consecutiveFailures++;
      connectionHealth.totalFailures++;
      connectionHealth.isHealthy = false;
    }

    // Broadcast health status if debug mode
    if (DEBUG_MODE) {
      io.emit('healthStatus', connectionHealth);
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthMonitoring() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    debugLog('Stopped connection health monitoring');
  }
}

function recordActivity() {
  connectionHealth.lastActivity = Date.now();
  connectionHealth.consecutiveFailures = 0;
  connectionHealth.isHealthy = true;
}

/* ── TikTok connector (created on demand) ─────────────────────────── */
let tiktok = null;

/* ── Auto-reconnection with exponential backoff ─────────────────── */
function calculateReconnectDelay() {
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s (max)
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  return delay;
}

async function attemptReconnect() {
  if (isManualDisconnect) {
    console.log('⏸️  Manual disconnect - skipping auto-reconnect');
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('❌ Max reconnection attempts reached. Please reconnect manually.');
    logError('RECONNECT', 'Max reconnection attempts reached', { attempts: reconnectAttempts });
    liveStatus = 'OFFLINE';
    broadcast();
    return;
  }

  reconnectAttempts++;
  const delay = calculateReconnectDelay();

  console.log(`🔄 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);
  liveStatus = 'RECONNECTING';
  broadcast();

  reconnectTimer = setTimeout(async () => {
    try {
      console.log(`⚡ Attempting to reconnect (attempt ${reconnectAttempts})...`);
      await connectTikTok();

      if (liveStatus === 'ONLINE') {
        console.log('✅ Reconnection successful!');
        reconnectAttempts = 0; // Reset counter on success
      }
    } catch (err) {
      console.error(`❌ Reconnection attempt ${reconnectAttempts} failed:`, err.message);
      logError('RECONNECT', `Attempt ${reconnectAttempts} failed`, err.message);
      attemptReconnect(); // Try again
    }
  }, delay);
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

/* ── Gift combo tracking system ─────────────────────────────────── */
const giftComboTracker = new Map();

function trackGiftCombo(userId, giftId, data) {
  const key = `${userId}_${giftId}`;

  // Clear existing timeout if any
  if (giftComboTracker.has(key)) {
    clearTimeout(giftComboTracker.get(key).timeout);
  }

  // Use configurable timeout (fallback to 5000ms if not set)
  const timeoutDuration = cfg.comboTimeout || 5000;

  // Create timeout fallback to count gifts even if repeatEnd never comes
  const timeout = setTimeout(() => {
    console.log(`⚠️  Combo timeout (${timeoutDuration}ms) for gift ${data.giftName} - counting ${data.repeatCount} gifts`);
    diagnostics.totalComboTimeouts++;
    processGiftCount(data, data.repeatCount);
    giftComboTracker.delete(key);
  }, timeoutDuration);

  giftComboTracker.set(key, {
    data,
    timeout,
    lastUpdate: Date.now()
  });
}

function processGiftCount(data, delta) {
  if (delta <= 0) return;

  const startTime = Date.now();
  console.log(`🎁 Processing ${delta}x ${data.giftName} (${delta * data.diamondCount} diamonds)`);

  // Track diagnostics
  diagnostics.totalGiftsProcessed += delta;
  diagnostics.lastGiftTime = Date.now();
  recordActivity();

  /* Global totals */
  totalGifts += delta;
  totalDiamonds += data.diamondCount * delta;

  /* Add unseen gift to catalog */
  if (!giftCatalog.find(g => g.id === data.giftId)) {
    giftCatalog.push({
      id: data.giftId,
      name: data.giftName,
      diamondCost: data.diamondCount,
      iconUrl: data.giftPictureUrl || null
    });
    io.emit('giftCatalog', giftCatalog);
  }

  /* Per-group totals */
  const gid = Object.keys(groups).find(k =>
    (groups[k].giftIds || []).includes(data.giftId)
  );
  if (gid) {
    counters[gid].count += delta;
    counters[gid].diamonds += data.diamondCount * delta;
  }

  /* Broadcast updated payload (debounced) */
  debouncedBroadcast();

  // Track processing time
  const processingTime = Date.now() - startTime;
  diagnostics.performanceMetrics.avgGiftProcessingTime =
    Math.round((diagnostics.performanceMetrics.avgGiftProcessingTime + processingTime) / 2);

  debugLog(`Gift processed in ${processingTime}ms`);
}

async function connectTikTok() {
  if (liveStatus === 'CONNECTING' || liveStatus === 'ONLINE') return;

  // Cancel any pending reconnect timers
  cancelReconnect();
  isManualDisconnect = false;

  liveStatus = 'CONNECTING'; broadcast();

  try {
    console.log(`🔗 Connecting to @${USERNAME}'s TikTok Live...`);

    tiktok = new WebcastPushConnection(USERNAME, {
      enableExtendedGiftInfo: true,
      processInitialData: false,        // Skip old messages
      fetchRoomInfoOnConnect: true,     // Get room data on connect
      requestPollingIntervalMs: 1000,   // Faster updates (1 second)
      signServerUrl: 'https://sign.furetto.dev/api/sign'
    });

    /* ── IMPROVED: Gift event handler with combo tracking ── */
    tiktok.on('gift', data => {
      trackEvent('gift');
      recordActivity();
      io.emit('giftStream', data);  // Echo raw event to the UI

      const userId = data.userId || data.uniqueId || 'unknown';
      const key = `${userId}_${data.giftId}`;

      /* Enhanced combo tracking logic */
      if (data.giftType === 1) {
        // Streak-capable gifts (roses, etc.)
        if (data.repeatEnd) {
          // Combo finished - clear timeout and count gifts
          console.log(`✅ Combo ended: ${data.giftName} x${data.repeatCount}`);

          if (giftComboTracker.has(key)) {
            clearTimeout(giftComboTracker.get(key).timeout);
            giftComboTracker.delete(key);
          }

          processGiftCount(data, data.repeatCount);
        } else {
          // Combo in progress - track it with timeout fallback
          console.log(`🔄 Combo in progress: ${data.giftName} x${data.repeatCount}`);
          trackGiftCombo(userId, data.giftId, data);
        }
      } else {
        // Non-streak gifts - count immediately
        const delta = data.repeatCount || 1;
        console.log(`💎 Non-combo gift: ${data.giftName} x${delta}`);
        processGiftCount(data, delta);
      }
    });

    /* ── ENHANCED: Connection state event listeners with auto-reconnect ── */
    tiktok.on('connected', () => {
      trackEvent('connected');
      console.log('✅ Successfully connected to TikTok Live');
      liveStatus = 'ONLINE';
      reconnectAttempts = 0; // Reset on successful connection
      recordActivity();
      startHealthMonitoring(); // Start health checks
      broadcast();
    });

    tiktok.on('disconnected', () => {
      trackEvent('disconnected');
      console.log('⚠️  Disconnected from TikTok Live');
      logError('CONNECTION', 'Disconnected from TikTok Live');
      diagnostics.totalErrors++;

      // Stop health monitoring
      stopHealthMonitoring();

      // Clear all pending combo timeouts
      giftComboTracker.forEach((combo) => {
        clearTimeout(combo.timeout);
      });
      giftComboTracker.clear();

      liveStatus = 'DISCONNECTED';
      broadcast();

      // Attempt auto-reconnect unless it was manual
      if (!isManualDisconnect) {
        console.log('🔄 Connection lost - initiating auto-reconnect...');
        diagnostics.totalReconnections++;
        attemptReconnect();
      }
    });

    tiktok.on('error', (err) => {
      trackEvent('error');
      const errorMsg = err.message || err.toString();
      console.error('❌ TikTok connection error:', errorMsg);
      logError('CONNECTION', 'Connection error occurred', errorMsg);
      diagnostics.totalErrors++;

      liveStatus = 'OFFLINE';
      broadcast();

      // Attempt reconnect on error
      if (!isManualDisconnect) {
        console.log('🔄 Error detected - initiating auto-reconnect...');
        diagnostics.totalReconnections++;
        attemptReconnect();
      }
    });

    tiktok.on('streamEnd', () => {
      trackEvent('streamEnd');
      console.log('📴 Stream ended by host');
      logError('STREAM', 'Stream ended by host', { endTime: new Date().toISOString() });

      // Stop health monitoring
      stopHealthMonitoring();

      // Clear all pending combo timeouts
      giftComboTracker.forEach((combo) => {
        clearTimeout(combo.timeout);
      });
      giftComboTracker.clear();

      liveStatus = 'OFFLINE';
      broadcast();

      // Don't auto-reconnect when stream ends naturally
      console.log('ℹ️  Stream ended - not attempting reconnect');
    });

    /* ── NEW: Member join event for unique visitors ── */
    tiktok.on('member', (data) => {
      trackEvent('member');
      recordActivity();
      if (data.uniqueId) {
        uniques.add(data.uniqueId);
        console.log(`👋 New member joined: ${data.uniqueId} (Total unique: ${uniques.size})`);
        debouncedBroadcast();
      }
    });

    /* ── NEW: Viewer count tracking ── */
    tiktok.on('roomUser', (data) => {
      trackEvent('roomUser');
      recordActivity();
      if (data.viewerCount !== undefined) {
        viewers = data.viewerCount;
        console.log(`👀 Viewer count updated: ${viewers}`);
        debouncedBroadcast();
      }
    });

    /* ── NEW: Like event tracking (optional, for completeness) ── */
    tiktok.on('like', (data) => {
      trackEvent('like');
      recordActivity();
      debugLog(`❤️  ${data.uniqueId || 'Someone'} sent ${data.likeCount || 1} likes`);
    });

    /* ── NEW: Chat event tracking (optional, for monitoring) ── */
    tiktok.on('chat', (data) => {
      trackEvent('chat');
      recordActivity();
      debugLog(`💬 ${data.uniqueId}: ${data.comment}`);
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
    const errorMsg = err.message || err.toString();
    console.error('❌ Connect failed:', errorMsg);
    logError('CONNECTION', 'Initial connection failed', errorMsg);
    liveStatus = 'OFFLINE';

    // Attempt reconnect on initial connection failure
    if (!isManualDisconnect) {
      console.log('🔄 Initial connection failed - will retry...');
      attemptReconnect();
    }
  }
  broadcast();
}

async function disconnectTikTok() {
  console.log('🔌 Manual disconnect requested...');

  // Mark as manual disconnect to prevent auto-reconnect
  isManualDisconnect = true;
  cancelReconnect();

  if (tiktok) {
    try {
      await tiktok.disconnect();
    } catch (err) {
      console.error('Error during disconnect:', err.message);
      logError('DISCONNECT', 'Error during manual disconnect', err.message);
    }
    tiktok = null;
  }

  // Clear all pending combo timeouts
  giftComboTracker.forEach((combo) => {
    clearTimeout(combo.timeout);
  });
  giftComboTracker.clear();
  console.log('✅ Cleared all pending gift combos');

  liveStatus = 'DISCONNECTED';
  broadcast();
  console.log('📡 Disconnected successfully');
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

    // Queue batched save to backend
    queueBackendSync('groups', groups);

    initCounters();
    debouncedBroadcast();
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

  debouncedBroadcast();
  res.json({ ok: true });
});

app.post('/api/target', async (req, res) => {
  try {
    cfg.target = Number(req.body?.target) || cfg.target;

    // Queue batched save to backend
    queueBackendSync('config', cfg);

    debouncedBroadcast();
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

/* ── NEW: Error log endpoint ─────────────────────────────────────── */
app.get('/api/errors', (_, res) => {
  res.json({
    errors: errorLog,
    count: errorLog.length,
    reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    isReconnecting: liveStatus === 'RECONNECTING'
  });
});

app.post('/api/errors/clear', (_, res) => {
  errorLog.length = 0;
  console.log('🗑️  Error log cleared');
  broadcast();
  res.json({ ok: true });
});

/* ── NEW: Diagnostics endpoint ─────────────────────────────────────── */
app.get('/api/diagnostics', (_, res) => {
  const uptime = Date.now() - diagnostics.startTime;
  const uptimeHours = Math.floor(uptime / 3600000);
  const uptimeMinutes = Math.floor((uptime % 3600000) / 60000);

  res.json({
    diagnostics: {
      ...diagnostics,
      uptime,
      uptimeFormatted: `${uptimeHours}h ${uptimeMinutes}m`,
      debugMode: DEBUG_MODE
    },
    connectionHealth,
    syncQueueSize: syncQueue.length,
    pendingBroadcast,
    comboTrackersActive: giftComboTracker.size
  });
});

app.post('/api/diagnostics/reset', (_, res) => {
  // Reset diagnostics counters
  diagnostics.totalGiftsProcessed = 0;
  diagnostics.totalComboTimeouts = 0;
  diagnostics.totalReconnections = 0;
  diagnostics.totalBroadcasts = 0;
  diagnostics.totalErrors = 0;
  diagnostics.lastGiftTime = null;
  diagnostics.lastBroadcastTime = null;
  Object.keys(diagnostics.eventCounts).forEach(key => {
    diagnostics.eventCounts[key] = 0;
  });
  diagnostics.performanceMetrics.broadcastIntervals = [];

  console.log('📊 Diagnostics reset');
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
      totalDiamonds,
      // Connection health information
      reconnectAttempts,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      isReconnecting: liveStatus === 'RECONNECTING',
      errorCount: errorLog.length,
      lastError: errorLog.length > 0 ? errorLog[0] : null
    }
  };
}
function broadcast() {
  diagnostics.totalBroadcasts++;
  updatePerformanceMetrics();
  io.emit('update', buildPayload());
  debugLog(`Broadcast #${diagnostics.totalBroadcasts} sent`);
}

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
