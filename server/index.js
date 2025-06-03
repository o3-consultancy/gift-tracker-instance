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

if (!USERNAME) {
  console.error('TIKTOK_USERNAME missing'); process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── config & state ────────────────── */
const cfgPath = path.resolve('config/config.json');
await fs.ensureFile(cfgPath);
let cfg = await fs.readJson(cfgPath).catch(() => ({ target: 10_000 }));

const groupsPath = path.resolve('config/groups.json');
await fs.ensureFile(groupsPath);
let groups = await fs.readJson(groupsPath).catch(() => ({}));

let counters = {};
let liveStatus = 'OFFLINE';
let viewers = 0;
let uniques = new Set();
let totalGifts = 0;
let totalDiamonds = 0;

function initCounters() {
  counters = {};
  for (const g in groups) counters[g] = { count: 0, diamonds: 0 };
}
initCounters();

/* ── TikTok connector ──────────────── */
const tiktok = new WebcastPushConnection(USERNAME, {
  enableExtendedGiftInfo: true,
  signServerUrl: 'https://sign.furetto.dev/api/sign'
});
async function connect() {
  try {
    const state = await tiktok.connect();
    liveStatus = 'ONLINE';
    console.log('✓ Connected to room', state.roomId);
    broadcast();
  } catch (e) {
    console.error('Connect error – retry in 30 s', e.message);
    setTimeout(connect, 30_000);
  }
}
await connect();

const giftCatalog =
  (await tiktok.fetchAvailableGifts().catch(() => []))
    .map(g => ({
      id: g.id,
      name: g.name,
      diamondCost: g.diamondCost,
      iconUrl: g.image?.url_list?.[0] || null
    }));

/* events */
tiktok.on('streamEnd', () => { liveStatus = 'OFFLINE'; broadcast(); });
tiktok.on('viewer', d => viewers = d.viewerCount);
tiktok.on('member', d => { uniques.add(d.userId); io.emit('member', d); });

tiktok.on('gift', d => {
  io.emit('giftStream', d);

  const delta = d.repeat_end ? d.repeat_count : 1;
  totalGifts += delta;
  totalDiamonds += d.diamondCount * delta;

  const gid = Object.keys(groups).find(k =>
    (groups[k].giftIds || []).includes(d.giftId));
  if (gid) {
    counters[gid].count += delta;
    counters[gid].diamonds += d.diamondCount * delta;
  }
  broadcast();
});

/* ── Express & Socket.IO setup ─────── */
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

/* 1) PUBLIC overlay assets (no auth) --------------------- */
const pub = path.join(__dirname, '..', 'public');
app.use('/overlay.html', express.static(path.join(pub, 'overlay.html')));
app.use('/overlay.js', express.static(path.join(pub, 'overlay.js')));
app.use('/styles.css', express.static(path.join(pub, 'styles.css')));

/* 2) Everything else requires login --------------------- */
app.use(basicAuth({ users: { admin: DASH_PASSWORD }, challenge: true }));

app.use(express.static(pub));
app.get('/', (_, res) => res.sendFile(path.join(pub, 'index.html')));

/* ── APIs (auth protected) ─────────────────────────────── */
app.get('/api/state', (_, res) => res.json(buildPayload()));

app.post('/api/groups', async (req, res) => {
  groups = req.body || {};
  await fs.writeJson(groupsPath, groups, { spaces: 2 });
  initCounters();
  broadcast();
  res.json({ ok: true });
});

app.post('/api/target', async (req, res) => {
  cfg.target = Number(req.body?.target) || cfg.target;
  await fs.writeJson(cfgPath, cfg, { spaces: 2 });
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

app.post('/api/reset', (_, res) => {
  initCounters();
  uniques = new Set();
  viewers = 0;
  totalGifts = totalDiamonds = 0;
  broadcast();
  res.json({ ok: true });
});

/* ── Socket.IO emit on connect ─────── */
io.on('connection', s => {
  s.emit('giftCatalog', giftCatalog);
  s.emit('update', buildPayload());
});

/* ── helpers ───────────────────────── */
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

/* ── start server ──────────────────── */
http.listen(PORT, () =>
  console.log(`Dashboard → http://localhost:${PORT}  (admin / ${DASH_PASSWORD})`));
