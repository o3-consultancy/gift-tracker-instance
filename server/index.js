import express from 'express';
import basicAuth from 'express-basic-auth';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { WebcastPushConnection } from 'tiktok-live-connector';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

/* ── env ───────────────────────────── */
const PORT = process.env.PORT || 3000;
const USERNAME = process.env.TIKTOK_USERNAME;
const DASH_PASSWORD = process.env.DASH_PASSWORD || 'changeme';

if (!USERNAME) { console.error('TIKTOK_USERNAME missing'); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── config & saved state ──────────── */
const cfgPath = path.resolve('config/config.json');
await fs.ensureFile(cfgPath);
let cfg = await fs.readJson(cfgPath).catch(() => ({ target: 10_000 }));

const groupsPath = path.resolve('config/groups.json');
await fs.ensureFile(groupsPath);
let groups = await fs.readJson(groupsPath).catch(() => ({}));

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
app.use('/overlay.html', express.static(path.join(pub, 'overlay.html')));
app.use('/overlay.js', express.static(path.join(pub, 'overlay.js')));
app.use('/styles.css', express.static(path.join(pub, 'styles.css')));

app.use(basicAuth({ users: { admin: DASH_PASSWORD }, challenge: true }));
app.use(express.static(pub));
app.get('/', (_, res) => res.sendFile(path.join(pub, 'index.html')));

/* ── API routes ───────────────────────────────────────────────────── */
app.post('/api/connect', async (_, res) => { await connectTikTok(); res.json({ ok: true }); });
app.post('/api/disconnect', async (_, res) => { await disconnectTikTok(); res.json({ ok: true }); });

app.get('/api/state', (_, res) => res.json(buildPayload()));

app.post('/api/groups', async (req, res) => {
  groups = req.body || {};
  await fs.writeJson(groupsPath, groups, { spaces: 2 });
  initCounters();
  broadcast();
  res.json({ ok: true });
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
  cfg.target = Number(req.body?.target) || cfg.target;
  await fs.writeJson(cfgPath, cfg, { spaces: 2 });
  broadcast();
  res.json({ ok: true });
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
http.listen(PORT, () =>
  console.log(`Dashboard → http://localhost:${PORT}  (admin / ${DASH_PASSWORD})`));
