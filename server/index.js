import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { WebcastPushConnection, SignConfig } from 'tiktok-live-connector';
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
const EULER_API_KEY = process.env.EULER_API_KEY;
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;

// Configure Euler Stream API if key is provided
if (EULER_API_KEY) {
  SignConfig.apiKey = EULER_API_KEY;
  SignConfig.signServerUrl = 'https://tiktok.eulerstream.com';
  console.log('✅ Euler Stream API configured for rate limit mitigation');
  console.log(`   Sign Server: ${SignConfig.signServerUrl}`);
  console.log(`   API Key: ${EULER_API_KEY.substring(0, 20)}...${EULER_API_KEY.substring(EULER_API_KEY.length - 10)} (${EULER_API_KEY.length} chars)`);
} else {
  console.log('⚠️  No Euler Stream API key - using free tier (rate limits may apply)');
  console.log('   Using default sign server (rate limits may apply)');
  console.log('   EULER_API_KEY env var is empty or undefined');
}

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

/* ── Manual connection control (NO auto-reconnect) ─────────────────── */
let isManualDisconnect = false;  // Track if user manually disconnected

/* ── Error logging system ─────────────────── */
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 50;

function logError(category, message, details = null) {
  const timestamp = new Date().toISOString();
  const errorEntry = {
    timestamp,
    category,
    message,
    details
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

function initCounters(preserveValues = true) {
  // Optionally preserve existing counter values when re-initializing
  const oldCounters = preserveValues ? { ...counters } : {};

  counters = {};
  for (const g in groups) {
    // Use existing counter values if they exist (and preserveValues is true), otherwise start at zero
    counters[g] = oldCounters[g] || { count: 0, diamonds: 0 };
  }
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

        // If too many failures, disconnect and wait for user to reconnect
        if (connectionHealth.consecutiveFailures >= 3) {
          console.error('❌ Health check failed multiple times - disconnecting');
          logError('HEALTH', 'Connection health check failed - Manual reconnection required', {
            consecutiveFailures: connectionHealth.consecutiveFailures,
            timeSinceActivity
          });
          await disconnectTikTok();
          console.log('ℹ️  Please click Connect to reconnect');
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

/* ── NO AUTO-RECONNECT - User must manually reconnect ─────────────────── */
// All auto-reconnection logic removed - connection requires manual user action

/* ── Gift combo tracking system ─────────────────────────────────── */
const giftComboTracker = new Map();

function trackGiftCombo(userId, giftId, data) {
  const key = `${userId}_${giftId}`;

  // Clear existing timeout if any
  if (giftComboTracker.has(key)) {
    const existing = giftComboTracker.get(key);
    clearTimeout(existing.timeout);
  }

  // Use configurable timeout (fallback to 5000ms if not set)
  const timeoutDuration = cfg.comboTimeout || 5000;

  // Clone the current repeatCount to avoid closure issues
  const currentRepeatCount = data.repeatCount;
  const giftName = data.giftName;

  // Create timeout fallback to count gifts even if repeatEnd never comes
  const timeout = setTimeout(() => {
    const tracker = giftComboTracker.get(key);

    // Only process if this combo hasn't been counted yet
    if (tracker && !tracker.counted) {
      console.log(`⚠️  Combo timeout (${timeoutDuration}ms) for gift ${giftName} - counting ${currentRepeatCount} gifts`);
      diagnostics.totalComboTimeouts++;

      // Mark as counted BEFORE processing to prevent race conditions
      tracker.counted = true;
      processGiftCount(data, currentRepeatCount);
      giftComboTracker.delete(key);
    }
  }, timeoutDuration);

  giftComboTracker.set(key, {
    data,
    timeout,
    lastUpdate: Date.now(),
    counted: false  // Flag to track if gifts have been counted
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
  // Prevent connecting if already connecting or connected
  if (liveStatus === 'CONNECTING' || liveStatus === 'ONLINE') {
    console.log('⚠️  Already connecting or connected');
    return;
  }

  // Reset manual disconnect flag - user is manually connecting
  isManualDisconnect = false;

  liveStatus = 'CONNECTING';
  broadcast();

  try {
    console.log(`🔗 Connecting to @${USERNAME}'s TikTok Live...`);

    tiktok = new WebcastPushConnection(USERNAME, {
      enableExtendedGiftInfo: true,
      processInitialData: false,        // Skip old messages
      fetchRoomInfoOnConnect: true,     // Get room data on connect
      requestPollingIntervalMs: 1000    // Faster updates (1 second)
      // signServerUrl is configured globally via SignConfig
    });

    /* ── IMPROVED: Gift event handler with combo tracking ── */
    tiktok.on('gift', data => {
      trackEvent('gift');
      recordActivity();
      io.emit('giftStream', data);  // Echo raw event to the UI

      const userId = data.userId || data.uniqueId || 'unknown';
      const key = `${userId}_${data.giftId}`;

      /* Single-path gift counting logic - prevents double counting */
      if (data.giftType === 1) {
        // Streak-capable gifts (roses, etc.)
        if (data.repeatEnd) {
          // Combo finished - this is the ONLY place we count combo gifts
          console.log(`✅ Combo ended: ${data.giftName} x${data.repeatCount}`);

          // Check if we have a pending combo tracker
          if (giftComboTracker.has(key)) {
            const tracker = giftComboTracker.get(key);

            // Only count if not already counted (prevents race condition)
            if (!tracker.counted) {
              // Mark as counted FIRST to prevent timeout from also counting
              tracker.counted = true;

              // Clear the timeout
              clearTimeout(tracker.timeout);

              // Count the gifts
              processGiftCount(data, data.repeatCount);

              // Clean up tracker
              giftComboTracker.delete(key);
            } else {
              // Already counted by timeout - just clean up
              console.log(`⚠️  Combo already counted by timeout for ${data.giftName}`);
              clearTimeout(tracker.timeout);
              giftComboTracker.delete(key);
            }
          } else {
            // No tracker found - might be first event with repeatEnd or very fast combo
            // Count it directly
            console.log(`💫 Direct combo completion (no tracker): ${data.giftName} x${data.repeatCount}`);
            processGiftCount(data, data.repeatCount);
          }
        } else {
          // Combo in progress - track it with timeout fallback
          console.log(`🔄 Combo in progress: ${data.giftName} x${data.repeatCount}`);
          trackGiftCombo(userId, data.giftId, data);
        }
      } else {
        // Non-streak gifts (giftType !== 1) - count immediately
        const delta = data.repeatCount || 1;
        console.log(`💎 Non-combo gift: ${data.giftName} x${delta}`);
        processGiftCount(data, delta);
      }
    });

    /* ── ENHANCED: Connection state event listeners with auto-reconnect ── */
    /* ── Connection Events - NO AUTO-RECONNECT ── */
    tiktok.on('connected', () => {
      trackEvent('connected');
      console.log('✅ Successfully connected to TikTok Live');
      liveStatus = 'ONLINE';
      recordActivity();
      startHealthMonitoring();
      broadcast();
    });

    tiktok.on('disconnected', () => {
      trackEvent('disconnected');
      console.log('⚠️  Disconnected from TikTok Live');
      logError('CONNECTION', 'Disconnected from TikTok Live - Manual reconnection required');
      diagnostics.totalErrors++;

      // Stop health monitoring
      stopHealthMonitoring();

      // Clear all pending combo timeouts
      giftComboTracker.forEach((combo) => {
        clearTimeout(combo.timeout);
      });
      giftComboTracker.clear();

      // Set status to OFFLINE and wait for user to reconnect
      liveStatus = 'OFFLINE';
      broadcast();
      console.log('ℹ️  Please click Connect to reconnect when stream is live');
    });

    tiktok.on('error', (err) => {
      trackEvent('error');
      const errorMsg = err.message || err.toString();
      console.error('❌ TikTok connection error:', errorMsg);

      // Log additional error details for debugging
      if (err.statusCode) console.error(`   Status Code: ${err.statusCode}`);
      if (err.info) console.error(`   Info:`, err.info);

      logError('CONNECTION', 'Connection error - Manual reconnection required', errorMsg);
      diagnostics.totalErrors++;

      // Set status to OFFLINE and wait for user to reconnect
      liveStatus = 'OFFLINE';
      broadcast();
      console.log('ℹ️  Connection error - Please click Connect to try again');
    });

    tiktok.on('streamEnd', async () => {
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

      // Disconnect the session
      if (tiktok) {
        try {
          await tiktok.disconnect();
        } catch (err) {
          console.error('Error during stream end disconnect:', err.message);
        }
        tiktok = null;
      }

      liveStatus = 'OFFLINE';
      broadcast();
      console.log('ℹ️  Stream offline - Click Connect when stream is live again');
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

    /* ── Fetch full gift catalogue after successful connect ── */
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

    // Log additional error details for debugging sign server issues
    if (err.statusCode) console.error(`   Status Code: ${err.statusCode}`);
    if (err.info) console.error(`   Error Info:`, JSON.stringify(err.info, null, 2));
    if (err.stack) console.error(`   Stack:`, err.stack.split('\n').slice(0, 3).join('\n'));

    logError('CONNECTION', 'Initial connection failed - Manual retry required', errorMsg);
    liveStatus = 'OFFLINE';
    console.log('ℹ️  Connection failed - Please click Connect to try again');
  }
  broadcast();
}

async function disconnectTikTok() {
  console.log('🔌 Manual disconnect requested...');

  // Mark as manual disconnect
  isManualDisconnect = true;

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
  initCounters(false);  // Pass false to reset all counters to zero
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
    count: errorLog.length
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
