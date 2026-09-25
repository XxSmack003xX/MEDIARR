/* MEDIARR — zero-dependency Node server
 * Serves the web app, stores Radarr/Sonarr credentials on disk (config.json),
 * and proxies all API calls so the browser never hits CORS / mixed-content issues.
 *
 * Run:  node server.js     (optionally PORT=xxxx node server.js)
 */
'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const zlib  = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { URL } = require('url');

// Optional: detect ffmpeg/ffprobe once at startup. Used only for transcoding playback (5.1/AC3/DTS → AAC, HEVC/H.265 → H.264).
let FFMPEG = null, FFPROBE = null;
try { const r = spawnSync('ffmpeg', ['-hide_banner', '-version']); if (!r.error && r.status === 0) FFMPEG = 'ffmpeg'; } catch (e) { FFMPEG = null; }
try { const r = spawnSync('ffprobe', ['-hide_banner', '-version']); if (!r.error && r.status === 0) FFPROBE = 'ffprobe'; } catch (e) { FFPROBE = null; }

// Detect a working H.264 hardware encoder by actually test-encoding a tiny clip (safe: only used if it succeeds).
let HWENC = null;
function probeEncoder (rcArgs) {
  try {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=256x144:rate=5:duration=1'].concat(rcArgs, ['-f', 'null', '-']), { timeout: 8000, stdio: 'ignore' });
    return !r.error && r.status === 0;
  } catch (e) { return false; }
}
function detectHwEncoder () {
  if (!FFMPEG) return;
  const candidates = [
    ['h264_nvenc', ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0']],
    ['h264_qsv', ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23', '-pix_fmt', 'nv12']],
    ['h264_videotoolbox', ['-c:v', 'h264_videotoolbox', '-b:v', '2M']]
  ];
  for (const [enc, rc] of candidates) { if (probeEncoder(rc)) { HWENC = enc; break; } }
  if (HWENC) { try { console.log('[mediarr] hardware video encoder detected: ' + HWENC); } catch (e) {} }
}
detectHwEncoder();
const ENC_PRESET = { balanced: 'veryfast', faster: 'superfast', fastest: 'ultrafast', quality: 'fast' };

// HLS transcode sessions (used for iPhone/iPad, which only reliably play transcoded streams via HLS).
const HLS_ROOT = path.join(os.tmpdir(), 'mediarr-hls');
const hlsSessions = new Map();   // sid -> seekable HLS/remux/transcode session
const liveTranscodes = new Map(); // tid -> non-HLS ffmpeg fallback session
try { fs.rmSync(HLS_ROOT, { recursive: true, force: true }); } catch (e) {}
try { fs.mkdirSync(HLS_ROOT, { recursive: true }); } catch (e) {}
function hlsCleanup (sid) {
  const s = hlsSessions.get(sid); if (!s) return;
  try { s.ff.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) {}
  hlsSessions.delete(sid);
}
setInterval(() => { const now = Date.now(); for (const [sid, s] of hlsSessions) { if (now - s.last > 120000) hlsCleanup(sid); } }, 30000).unref();

const PORT        = process.env.PORT || 7575;
const HOST        = process.env.HOST || '0.0.0.0';
const ROOT        = __dirname;
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const APP_VERSION = process.env.MEDIARR_VERSION || appVersionSafe();
const UPDATE_REPO_ENV = String(process.env.MEDIARR_UPDATE_REPO || '').trim();
const UPDATE_API_BASE = String(process.env.MEDIARR_UPDATE_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
// Persistent state can live outside the application directory. This keeps the
// traditional non-Docker layout unchanged, while Docker can mount /data.
const DATA_DIR    = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const PUBLIC_DIR  = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const HEALTH_PATH = path.join(DATA_DIR, 'health.json');
const USERS_PATH  = path.join(DATA_DIR, 'users.json');
const ADDS_PATH   = path.join(DATA_DIR, 'adds.json');
const FAVS_PATH   = path.join(DATA_DIR, 'favorites.json');
const AUTOADD_PATH = path.join(DATA_DIR, 'autoadd.json');
const WATCH_PROGRESS_PATH = path.join(DATA_DIR, 'watch-progress.json');
const CINEMETA    = 'https://v3-cinemeta.strem.io';
const TMDB        = 'https://api.themoviedb.org/3';
const HEALTH_INTERVAL_MS = 60 * 1000;   // background check cadence
const MAX_EVENTS  = 300;                // cap stored outage events
const SESSION_MS  = (Number(process.env.SESSION_HOURS) || 1) * 3600 * 1000;   // login token lifetime (default 1 hour)
const MAX_ADDS_LOG = 3000;

const DEFAULT_CONFIG = {
  radarr: { url: '', apiKey: '', qualityProfileId: '', rootFolderPath: '' },
  sonarr: { url: '', apiKey: '', qualityProfileId: '', rootFolderPath: '' },
  tmdb:   { apiKey: '' },
  plex:   { url: '', token: '', clientId: '' },
  webdav: { source: 'webdav', localPath: '', url: '', username: '', password: '', folder: '', mode: 'redirect', transcode: false, encSpeed: 'balanced', hwAccel: 'auto' },   // source: 'webdav' | 'local'   // encSpeed: balanced|faster|fastest|quality; hwAccel: auto|off
  playback: { autoSelect: true, pathMappings: [] },   // automatic playback + Arr-root -> media-source path mappings
  realtime: { webhookToken: '', setupComplete: false },
  ui:     { loginTheme: 'tron' },  // login background theme: 'tron' | 'earth' | 'rain' | 'random'
  donate: { url: '', label: '' },  // PayPal donate link; when set, a Donate button appears for everyone
  autoAdd: { intervalMinutes: 5, minRuntime: 0 },
  libraryCache: { enabled: true, intervalMinutes: 360 },
  notify: { enabled: false, targets: [], events: { added: true, rss: true, blocked: true, jobs: true, errors: true, serviceDown: true, login: false } },
  sab: { url: '', apiKey: '' },   // SABnzbd — queue + history, visible to every signed-in user
  backup: { onChange: true, everyDays: 7, keep: 20 },   // auto-snapshot of all settings
  shell: { enabled: false, commands: [] },   // admin-defined restart/maintenance commands
  dockerControl: { enabled: false, allowedContainers: ['plex', 'radarr', 'sonarr'] },   // admin-only start/stop/restart/update via Docker Engine API
  update: { repo: '', enabled: true },   // GitHub owner/repo; official images bake this in via MEDIARR_UPDATE_REPO
  rss: { enabled: false, feeds: [], intervalMinutes: 30, addMovies: true, addSeries: true, maxPerRun: 15, minYear: 0 },
  plexBlock: { enabled: false, ips: [], message: 'This device is not permitted to stream. Please contact the server owner.' }   // background library scan; minimum 60 minutes  // minutes between each add; minRuntime = skip titles shorter than this (0 = off)
};
const LOGIN_THEMES = ['tron', 'earth', 'rain', 'random'];

/* ---------- config persistence ---------- */
let _cfgCache = null, _cfgMtime = 0;
function readConfig () {
  try {
    // Cheap mtime check: re-parse only when config.json actually changed.
    const st = fs.statSync(CONFIG_PATH);
    if (_cfgCache && st.mtimeMs === _cfgMtime) return _cfgCache;
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _cfgMtime = st.mtimeMs;
    return (_cfgCache = {
      radarr: Object.assign({}, DEFAULT_CONFIG.radarr, c.radarr),
      sonarr: Object.assign({}, DEFAULT_CONFIG.sonarr, c.sonarr),
      tmdb:   Object.assign({}, DEFAULT_CONFIG.tmdb, c.tmdb),
      plex:   Object.assign({}, DEFAULT_CONFIG.plex, c.plex),
      webdav: Object.assign({}, DEFAULT_CONFIG.webdav, c.webdav),
      playback: Object.assign({}, DEFAULT_CONFIG.playback, c.playback),
      realtime: Object.assign({}, DEFAULT_CONFIG.realtime, c.realtime),
      ui:     Object.assign({}, DEFAULT_CONFIG.ui, c.ui),
      donate: Object.assign({}, DEFAULT_CONFIG.donate, c.donate),
      autoAdd: Object.assign({}, DEFAULT_CONFIG.autoAdd, c.autoAdd),
      libraryCache: Object.assign({}, DEFAULT_CONFIG.libraryCache, c.libraryCache),
      plexBlock: Object.assign({}, DEFAULT_CONFIG.plexBlock, c.plexBlock),
      rss: Object.assign({}, DEFAULT_CONFIG.rss, c.rss),
      shell: Object.assign({}, DEFAULT_CONFIG.shell, c.shell),
      dockerControl: Object.assign({}, DEFAULT_CONFIG.dockerControl, c.dockerControl),
      update: Object.assign({}, DEFAULT_CONFIG.update, c.update),
      notify: Object.assign({}, DEFAULT_CONFIG.notify, c.notify),
      backup: Object.assign({}, DEFAULT_CONFIG.backup, c.backup),
      sab: Object.assign({}, DEFAULT_CONFIG.sab, c.sab)
    });
  } catch (e) {
    // config.json is missing or corrupt — try to rescue it from the newest backup
    if (!_cfgRescueTried && fs.existsSync(CONFIG_PATH)) {
      _cfgRescueTried = true;
      try {
        const rescued = rescueConfigFromBackup();
        if (rescued) { _cfgCache = null; _cfgMtime = 0; return readConfig(); }
      } catch (_) {}
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}
let _cfgRescueTried = false;
// Pull config.json out of the most recent backup that contains one.
function rescueConfigFromBackup () {
  let list = [];
  try { list = fs.readdirSync(BACKUP_DIR).filter(f => /^mediarr-config-.*\.json$/.test(f)).sort().reverse(); } catch (e) { return false; }
  for (const f of list) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
      if (d && d.files && d.files['config.json']) {
        try { fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.corrupt'); } catch (_) {}
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(d.files['config.json'], null, 2));
        console.log('[mediarr] config.json was unreadable — restored from backup ' + f);
        try { logError('config', 'config.json was corrupt and was restored from a backup', f); } catch (_) {}
        return true;
      }
    } catch (_) {}
  }
  return false;
}
function writeConfig (c) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  _cfgCache = null; _cfgMtime = 0;   // force a re-read on the next call
  try { backupOnChange('change'); } catch (e) {}
}
// Never send raw API keys back to the browser.
function sanitize (c) {
  const out = {};
  for (const svc of ['radarr', 'sonarr']) {
    out[svc] = {
      url: c[svc].url,
      hasKey: !!c[svc].apiKey,
      qualityProfileId: c[svc].qualityProfileId,
      rootFolderPath: c[svc].rootFolderPath
    };
  }
  out.tmdb = { hasKey: !!c.tmdb.apiKey };
  out.plex = { url: c.plex.url, hasKey: !!c.plex.token };
  out.webdav = { source: (c.webdav.source === 'local' ? 'local' : 'webdav'), localPath: c.webdav.localPath || '', url: c.webdav.url, username: c.webdav.username, folder: c.webdav.folder, mode: wmode(c.webdav.mode), transcode: !!c.webdav.transcode, ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE, hasAuth: !!(c.webdav.username && c.webdav.password), encSpeed: c.webdav.encSpeed || 'balanced', hwAccel: c.webdav.hwAccel || 'auto', hwEncoder: HWENC || '' };
  out.playback = { autoSelect: !(c.playback && c.playback.autoSelect === false), pathMappings: normalizePathMappings(c.playback && c.playback.pathMappings) };
  out.realtime = { setupComplete: !!(c.realtime && c.realtime.setupComplete) };
  out.ui = { loginTheme: (c.ui && c.ui.loginTheme) || 'tron' };
  out.donate = { url: (c.donate && c.donate.url) || '', label: (c.donate && c.donate.label) || '' };
  out.sab = { url: c.sab.url, hasKey: !!c.sab.apiKey };
  out.backup = { onChange: !(c.backup && c.backup.onChange === false),
                 everyDays: Math.max(0, Number((c.backup && c.backup.everyDays)) || 0),
                 keep: Math.max(1, Number((c.backup && c.backup.keep)) || 20) };
  out.notify = { enabled: !!(c.notify && c.notify.enabled),
                 targets: ((c.notify && c.notify.targets) || []).map(t => ({ id: t.id, kind: t.kind, name: t.name, url: maskUrl(t.url), enabled: t.enabled !== false })),
                 events: Object.assign({}, DEFAULT_CONFIG.notify.events, (c.notify && c.notify.events) || {}) };
  out.shell = { enabled: !!(c.shell && c.shell.enabled),
                commands: ((c.shell && c.shell.commands) || []).map(x => ({ id: x.id, name: x.name, cmd: x.cmd, confirm: x.confirm !== false })) };
  out.dockerControl = { enabled: !!(c.dockerControl && c.dockerControl.enabled),
                        allowedContainers: normalizeDockerAllowed(c.dockerControl && c.dockerControl.allowedContainers) };
  out.update = { enabled: !(c.update && c.update.enabled === false), repo: UPDATE_REPO_ENV || ((c.update && c.update.repo) || '') };
  out.rss = { enabled: !!(c.rss && c.rss.enabled), feeds: (c.rss && Array.isArray(c.rss.feeds)) ? c.rss.feeds : [],
              intervalMinutes: Math.max(10, Number((c.rss && c.rss.intervalMinutes)) || 30),
              addMovies: !(c.rss && c.rss.addMovies === false), addSeries: !(c.rss && c.rss.addSeries === false),
              maxPerRun: Math.max(1, Number((c.rss && c.rss.maxPerRun)) || 15), minYear: Number((c.rss && c.rss.minYear)) || 0 };
  out.plexBlock = { enabled: !!(c.plexBlock && c.plexBlock.enabled),
                    ips: (c.plexBlock && Array.isArray(c.plexBlock.ips)) ? c.plexBlock.ips : [],
                    message: (c.plexBlock && c.plexBlock.message) || '' };
  out.libraryCache = { enabled: !(c.libraryCache && c.libraryCache.enabled === false),
                       intervalMinutes: Math.max(60, Number((c.libraryCache && c.libraryCache.intervalMinutes)) || 360) };
  out.autoAdd = { intervalMinutes: (c.autoAdd && c.autoAdd.intervalMinutes != null) ? Number(c.autoAdd.intervalMinutes) : 5,
                  minRuntime: (c.autoAdd && c.autoAdd.minRuntime != null) ? Number(c.autoAdd.minRuntime) : 0 };
  return out;
}
function normUrl (u) { return (u || '').trim().replace(/\/+$/, ''); }
function normalizePathMappings (raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const x of list.slice(0, 50)) {
    if (!x) continue;
    const service = ['radarr','sonarr','all'].includes(String(x.service || '').toLowerCase()) ? String(x.service).toLowerCase() : 'all';
    const arrRoot = slashMediaPath(x.arrRoot || '').trim();
    if (!arrRoot) continue;
    const targetPrefix = safeSegments(slashMediaPath(x.targetPrefix || '')).join('/');
    out.push({
      id: String(x.id || crypto.randomBytes(5).toString('hex')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || crypto.randomBytes(5).toString('hex'),
      name: String(x.name || '').trim().slice(0, 80),
      service,
      arrRoot,
      targetPrefix,
      enabled: x.enabled !== false
    });
  }
  return out;
}

/* ---------- Plex sign-in (OAuth PIN flow) ---------- */
// A stable client identifier is required across pin creation, authorization and polling.
function ensurePlexClientId () {
  const c = readConfig();
  if (c.plex.clientId && /^[a-f0-9-]{16,}$/i.test(c.plex.clientId)) return c.plex.clientId;
  const id = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  c.plex.clientId = id; writeConfig(c);
  return id;
}
function plexHeaders (clientId, token) {
  const h = {
    'X-Plex-Product': 'MEDIARR',
    'X-Plex-Version': appVersionSafe(),
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Device': 'MEDIARR',
    'X-Plex-Platform': 'Web',
    'Accept': 'application/json'
  };
  if (token) h['X-Plex-Token'] = token;
  return h;
}
function appVersionSafe () { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '1.0'; } catch (e) { return '1.0'; } }

/* ---------- per-user Plex account (watchlist / history / stats) ---------- */
const PLEX_DISCOVER = process.env.PLEX_DISCOVER_URL || 'https://discover.provider.plex.tv';
const PLEX_METADATA = 'https://metadata.provider.plex.tv';
function getUserPlex (username) { const u = findUser(username); return (u && u.plex) || null; }
function setUserPlex (username, plex) {
  const data = readUsers();
  const u = data.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
  if (!u) return false;
  if (plex) {
    const prev = u.plex || {}, next = Object.assign({}, plex);
    if (next.accountId == null) {
      if (prev.accountId != null) next.accountId = prev.accountId;
      else if (next.rootToken && next.token && next.rootToken === next.token && next.id != null) next.accountId = next.id;
    }
    u.plex = next;
  } else delete u.plex;
  writeUsers(data); return true;
}
// Some plex.tv endpoints answer XML no matter what Accept says, so keep the raw text
// and parse attributes when JSON isn't available.
function xmlAttrs (text, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b([^>]*?)\\/?>', 'gi');
  let m;
  while ((m = re.exec(text))) {
    const attrs = {}; const are = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g; let a;
    while ((a = are.exec(m[1]))) attrs[a[1]] = a[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    out.push(attrs);
  }
  return out;
}
async function plexJson (url, token, method) {
  try {
    const up = await upstream(url, { method: method || 'GET', headers: plexHeaders(ensurePlexClientId(), token) });
    const txt = up.body ? up.body.toString('utf8') : '';
    let data = null;
    if (txt && txt.trim()[0] !== '<') { try { data = JSON.parse(txt); } catch (_) {} }
    if (up.status < 200 || up.status >= 300) {
      let msg = '';
      if (data) msg = (data.Error && data.Error.message) || data.message || '';
      if (!msg && txt) msg = txt.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      return { ok: false, status: up.status, message: msg, text: txt };
    }
    return { ok: true, data: data || {}, text: txt };
  } catch (e) { return { ok: false, status: 0, message: e.message, text: '' }; }
}
function plexErr (r, what) {
  return what + ' (HTTP ' + r.status + (r.message ? ': ' + r.message : '') + ')';
}
function plexItemsFrom (data) {
  const mc = (data && data.MediaContainer) || {};
  return mc.Metadata || [];
}
// Plex's watchlist actions key off the last segment of the item GUID
// (e.g. plex://movie/5d776be17a53e9001e732ab9 -> 5d776be17a53e9001e732ab9).
function plexActionKey (m) {
  if (m && m.guid) { const seg = String(m.guid).split('/').filter(Boolean).pop(); if (seg) return seg; }
  return (m && m.ratingKey) || '';
}
// Normalise a Plex item into what the UI needs (with proxied artwork).
function plexCard (m, host) {
  const thumb = m.thumb || m.grandparentThumb || m.parentThumb || '';
  return {
    ratingKey: plexActionKey(m), guid: m.guid || '',
    type: m.type || '', title: m.title || '',
    show: m.grandparentTitle || '',
    season: (m.parentIndex != null ? Number(m.parentIndex) : null),
    episode: (m.index != null && m.type === 'episode' ? Number(m.index) : null),
    year: m.year || (m.originallyAvailableAt ? String(m.originallyAvailableAt).slice(0, 4) : ''),
    summary: (m.summary || '').slice(0, 400),
    rating: m.rating || m.audienceRating || null,
    duration: m.duration || 0,
    viewOffset: Number(m.viewOffset) || 0,
    viewCount: Number(m.viewCount) || 0,
    viewedAt: m.viewedAt ? m.viewedAt * 1000 : null,
    localRatingKey: m.ratingKey || '',
    key: m.key || (m.ratingKey ? '/library/metadata/' + m.ratingKey : ''),
    ids: (typeof mediaGuidIds === 'function') ? mediaGuidIds(m) : { imdbId:'', tmdbId:null, tvdbId:null },
    art: thumb ? ('/api/plex/img?h=' + host + '&p=' + encodeURIComponent(thumb)) : '',
    absArt: /^https?:\/\//i.test(thumb)
  };
}
async function plexWatchlist (username, res) {
  const px = getUserPlex(username);
  if (!px || !px.token) return sendJSON(res, 400, { message: 'Not signed in to Plex' });
  // Plex Discover rejects large container sizes ("Invalid value provided for x-plex-container-size"),
  // so page through in small chunks instead of asking for everything at once.
  const PAGE = 20, MAX_PAGES = 15;
  const items = [];
  let last = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = PLEX_DISCOVER + '/library/sections/watchlist/all'
      + '?includeCollections=1&includeExternalMedia=1&includeAdvanced=1&includeMeta=1'
      + '&X-Plex-Container-Start=' + (page * PAGE) + '&X-Plex-Container-Size=' + PAGE;
    const r = await plexJson(url, px.token);
    if (!r.ok) {
      if (items.length) break;                      // partial results are still useful
      return sendJSON(res, 502, { message: plexErr(r, 'Plex watchlist unavailable') });
    }
    last = r.data;
    const batch = plexItemsFrom(r.data);
    items.push.apply(items, batch);
    const total = Number(((r.data || {}).MediaContainer || {}).totalSize || 0);
    if (batch.length < PAGE || (total && items.length >= total)) break;
  }
  sendJSON(res, 200, { items: items.map(m => plexCard(m, 'meta')), total: Number(((last || {}).MediaContainer || {}).totalSize || items.length) });
}
async function plexWatchlistAction (username, body, add, res) {
  const px = getUserPlex(username);
  if (!px || !px.token) return sendJSON(res, 400, { message: 'Not signed in to Plex' });
  let key = String(body.ratingKey || '').trim();
  if (!key) {
    const q = String(body.title || '').trim();
    if (!q) return sendJSON(res, 400, { message: 'Nothing to add' });
    const isShow = body.type === 'series' || body.type === 'show';
    const enc = encodeURIComponent(q);
    const types = isShow ? 'tv' : 'movies';
    // Shape taken from python-plexapi's searchDiscover(): searchProviders is required,
    // otherwise Discover answers 404 "Missing library search".
    const attempts = [
      PLEX_DISCOVER + '/library/search?query=' + enc + '&limit=10&searchTypes=' + types + '&searchProviders=discover&includeMetadata=1',
      PLEX_DISCOVER + '/library/search?query=' + enc + '&limit=10&searchTypes=movies,tv&searchProviders=discover&includeMetadata=1',
      PLEX_DISCOVER + '/library/search?query=' + enc + '&limit=10&searchTypes=movies,tv&searchProviders=discover,PLEXAVOD&includeMetadata=1'
    ];
    let results = [], lastErr = null;
    for (const url of attempts) {
      const s = await plexJson(url, px.token);
      if (!s.ok) { lastErr = s; continue; }
      const mc = (s.data || {}).MediaContainer || {};
      const groups = [].concat(mc.SearchResults || [], mc.SearchResult || []);
      // Prefer the "external" (Discover) group, then fall back to every group.
      const external = groups.filter(g => g && g.id === 'external');
      for (const g of (external.length ? external : groups)) {
        const hits = g.SearchResult || (g.Metadata ? [g] : []);
        for (const h of hits) if (h.Metadata) results.push(h.Metadata);
      }
      if (!results.length && Array.isArray(mc.Metadata)) results.push.apply(results, mc.Metadata);
      if (results.length) break;
    }
    if (!results.length) {
      if (lastErr) return sendJSON(res, 502, { message: plexErr(lastErr, 'Plex search failed') });
      return sendJSON(res, 404, { message: 'Not found on Plex' });
    }
    const wantType = isShow ? 'show' : 'movie';
    const yr = Number(body.year) || 0;
    const typed = results.filter(m => !m.type || m.type === wantType);
    const pool = typed.length ? typed : results;
    const hit = (yr && pool.find(m => Number(m.year) === yr)) || pool[0];
    key = plexActionKey(hit);
    if (!key) return sendJSON(res, 404, { message: 'Not found on Plex' });
  }
  const act = add ? 'addToWatchlist' : 'removeFromWatchlist';
  const r = await plexJson(PLEX_DISCOVER + '/actions/' + act + '?ratingKey=' + encodeURIComponent(key), px.token, 'PUT');
  if (!r.ok) return sendJSON(res, 502, { message: plexErr(r, 'Plex rejected the request') });
  sendJSON(res, 200, { ok: true, ratingKey: key, watchlisted: add });
}
// Map a Plex.tv account to its local account ID on the server (owner is normally 1).
async function plexServerAccountId (base, token, px) {
  if (px && px.accountId != null) return px.accountId;
  const names = [String((px && px.username) || '').toLowerCase()].filter(Boolean);
  for (const tok of [token, readConfig().plex.token].filter(Boolean)) {
    const r = await plexJson(base + '/accounts', tok);
    if (!r.ok) continue;
    const accounts = (((r.data || {}).MediaContainer || {}).Account) || [];
    let hit = accounts.find(a => names.includes(String(a.name || '').toLowerCase()));
    if (!hit && px && px.id) hit = accounts.find(a => String(a.id) === String(px.id));
    if (hit) return Number(hit.id);
  }
  return null;
}
async function plexHistory (username, limit, res) {
  const px = getUserPlex(username);
  if (!px || !px.token) return sendJSON(res, 400, { message: 'Not signed in to Plex' });
  const cfg = readConfig().plex;
  if (!cfg.url) return sendJSON(res, 400, { message: 'No Plex server is configured' });
  const base = normUrl(cfg.url);

  // Without an accountID the server returns EVERY user's history (obvious when you're the owner),
  // so resolve this user's account on the server and always scope the query to it.
  let acctId = await plexServerAccountId(base, px.token, px);
  if (acctId != null && px.accountId == null) { px.accountId = acctId; setUserPlex(username, px); }

  const q = '?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=' + limit
          + (acctId != null ? '&accountID=' + encodeURIComponent(acctId) : '');
  let r = await plexJson(base + '/status/sessions/history/all' + q, px.token);
  if (!r.ok && cfg.token) r = await plexJson(base + '/status/sessions/history/all' + q, cfg.token);
  if (!r.ok) return sendJSON(res, 502, { message: plexErr(r, 'Couldn’t read history from your Plex server') });
  const items = plexItemsFrom(r.data).map(m => plexCard(m, 'pms'));
  const movies = items.filter(i => i.type === 'movie');
  const eps = items.filter(i => i.type === 'episode');
  const shows = new Set(eps.map(e => e.show).filter(Boolean));
  const stats = {
    total: items.length, movies: movies.length, episodes: eps.length, shows: shows.size,
    firstAt: items.length ? items[items.length - 1].viewedAt : null,
    lastAt: items.length ? items[0].viewedAt : null,
    hours: Math.round(items.reduce((a, i) => a + (i.duration || 0), 0) / 3600000)
  };
  sendJSON(res, 200, { items, stats, scoped: acctId != null, account: (px.username || '') });
}
// Plex artwork can be a server-relative path OR an absolute URL (Discover returns absolute
// URLs on Plex/TMDB CDNs), so handle both — and fall back to the admin token for server art.
const IMG_HOSTS = ['plex.tv', 'plex.direct', 'image.tmdb.org', 'artworks.thetvdb.com', 'thetvdb.com'];
function imgHostAllowed (h) { h = String(h || '').toLowerCase(); return IMG_HOSTS.some(d => h === d || h.endsWith('.' + d)); }
/* Plex Home: an account can hold several profiles — let the user pick which one to use. */
async function plexHomeUsers (token) {
  for (const url of ['https://plex.tv/api/v2/home/users', 'https://plex.tv/api/home/users']) {
    const r = await plexJson(url, token);
    if (!r.ok) continue;
    const d = r.data || {};
    let raw = d.users || d.Users || (d.MediaContainer && d.MediaContainer.User) || [];
    // plex.tv often answers XML here: <home><users><user id uuid title .../></users></home>
    if ((!Array.isArray(raw) || !raw.length) && r.text && r.text.indexOf('<') === 0) raw = xmlAttrs(r.text, 'user');
    const list = (Array.isArray(raw) ? raw : []).map(u => ({
      id: u.id != null ? u.id : u.uuid, uuid: u.uuid || '',
      title: u.title || u.friendlyName || u.username || u.name || 'User',
      username: u.username || '',
      admin: String(u.admin) === '1' || u.admin === true || !!u.homeAdmin,
      restricted: String(u.restricted) === '1' || u.restricted === true,
      protected: String(u.protected) === '1' || u.protected === true,
      thumb: u.thumb || ''
    })).filter(u => u.id != null && u.id !== '');
    if (list.length) return { ok: true, users: list };
  }
  return { ok: false, users: [] };
}
async function plexSwitchHomeUser (token, id, uuid, pin) {
  const q = pin ? ('?pin=' + encodeURIComponent(pin)) : '';
  const ids = [id, uuid].filter(x => x != null && x !== '');
  const urls = [];
  for (const x of ids) {
    urls.push('https://plex.tv/api/home/users/' + encodeURIComponent(x) + '/switch' + q);       // v1 (what plexapi uses)
    urls.push('https://plex.tv/api/v2/home/users/' + encodeURIComponent(x) + '/switch' + q);
  }
  let lastErr = null;
  for (const url of urls) {
    const r = await plexJson(url, token, 'POST');
    if (!r.ok) { if (!lastErr || (r.status && !lastErr.status)) lastErr = r; continue; }
    const d = r.data || {};
    let tok = d.authToken || d.authenticationToken || (d.user && (d.user.authToken || d.user.authenticationToken));
    // XML: <user ... authenticationToken="..."/>
    if (!tok && r.text) {
      const el = xmlAttrs(r.text, 'user')[0] || xmlAttrs(r.text, 'User')[0];
      if (el) tok = el.authenticationToken || el.authToken;
    }
    if (tok) return { ok: true, token: tok };
    lastErr = { status: r.status || 200, message: 'no token in response' };
  }
  return { ok: false, err: lastErr };
}

async function plexImage (username, host, p, res) {
  const px = getUserPlex(username);
  const cfg = readConfig().plex;
  p = String(p || '');
  let target = null;
  const tokens = [];
  if (/^https?:\/\//i.test(p)) {
    let U; try { U = new URL(p); } catch (e) { res.writeHead(400); return res.end(); }
    let pmsHost = ''; try { pmsHost = new URL(normUrl(cfg.url || '')).hostname; } catch (e) {}
    if (!imgHostAllowed(U.hostname) && U.hostname !== pmsHost) { res.writeHead(403); return res.end(); }
    target = U.toString();
    if (px && px.token) tokens.push(px.token);
    if (cfg.token) tokens.push(cfg.token);
  } else {
    if (!p.startsWith('/') || p.indexOf('//') === 0) { res.writeHead(404); return res.end(); }
    const base = host === 'pms' ? normUrl(cfg.url || '') : PLEX_METADATA;
    if (!base) { res.writeHead(404); return res.end(); }
    target = base + p;
    if (px && px.token) tokens.push(px.token);
    if (host === 'pms' && cfg.token) tokens.push(cfg.token);
  }
  if (!tokens.length) { res.writeHead(404); return res.end(); }
  for (const tok of tokens) {
    try {
      const up = await upstream(target, { headers: { 'X-Plex-Token': tok, Accept: 'image/*' } });
      if (up.status < 400) {
        res.writeHead(200, { 'Content-Type': up.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
        return res.end(up.body);
      }
    } catch (e) { /* try the next token */ }
  }
  res.writeHead(404); res.end();
}
function wmode (m) { return m === 'proxy' ? 'proxy' : (m === 'embed' ? 'embed' : 'redirect'); }   // 'direct'/legacy/unknown -> redirect

/* ---------- helpers ---------- */
function readBody (req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

// Make an upstream HTTP(S) request, return { status, headers, body(Buffer) }.
function upstream (targetUrl, { method = 'GET', headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(targetUrl); } catch (e) { return reject(new Error('Invalid URL: ' + targetUrl)); }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      timeout
    };
    const r = lib.request(opts, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', err => reject(err));
    r.on('timeout', () => r.destroy(new Error('Timed out after ' + Math.round(timeout / 1000) + 's')));
    if (body) r.write(body);
    r.end();
  });
}

function sendJSON (res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

/* ---------- realtime events / SSE / arr webhooks ---------- */
const realtimeClients = new Set();
const realtimeEvents = [];
let realtimeSeq = 0;
function ensureWebhookToken () {
  const cfg = readConfig();
  cfg.realtime = Object.assign({}, DEFAULT_CONFIG.realtime, cfg.realtime || {});
  if (/^[a-f0-9]{24,}$/i.test(String(cfg.realtime.webhookToken || ''))) return cfg.realtime.webhookToken;
  cfg.realtime.webhookToken = crypto.randomBytes(18).toString('hex');
  writeConfig(cfg);
  return cfg.realtime.webhookToken;
}
function secureEqual (a, b) {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
}
function realtimePush (kind, data) {
  const ev = { id: ++realtimeSeq, ts: Date.now(), kind: String(kind || 'event'), data: data || {} };
  if (ev.kind !== 'snapshot') {
    realtimeEvents.unshift(ev);
    if (realtimeEvents.length > 120) realtimeEvents.length = 120;
  }
  const msg = 'id: ' + ev.id + '\nevent: mediarr\ndata: ' + JSON.stringify(ev) + '\n\n';
  for (const client of [...realtimeClients]) {
    try { client.res.write(msg); } catch (_) { realtimeClients.delete(client); }
  }
  return ev;
}
function realtimeSnapshot () {
  let cache = {};
  try { cache = readLibCache(); } catch (_) {}
  let transcodes = [];
  try { transcodes = mediarrTranscodeSessions(); } catch (_) {}
  const one = svc => {
    const c = cache[svc] || {};
    return { count: Number(c.count) || (Array.isArray(c.items) ? c.items.length : 0), ts: c.ts || null, ageSeconds: c.ts ? Math.max(0, Math.round((Date.now() - c.ts) / 1000)) : null };
  };
  return {
    now: Date.now(),
    clients: realtimeClients.size,
    services: healthState && healthState.services ? healthState.services : {},
    libraries: { radarr: one('radarr'), sonarr: one('sonarr') },
    transcodes: transcodes.slice(0, 20),
    recent: realtimeEvents.slice(0, 30)
  };
}
function openRealtimeStream (req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const client = { res, username: user.username, joined: Date.now() };
  realtimeClients.add(client);
  res.write('retry: 3000\n');
  res.write('event: snapshot\ndata: ' + JSON.stringify(realtimeSnapshot()) + '\n\n');
  realtimePush('sse.connected', { user: user.username, clients: realtimeClients.size });
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat ' + Date.now() + '\n\n'); } catch (_) {}
  }, 20000);
  if (heartbeat.unref) heartbeat.unref();
  const close = () => {
    clearInterval(heartbeat);
    const existed = realtimeClients.delete(client);
    if (existed) realtimePush('sse.disconnected', { user: user.username, clients: realtimeClients.size });
  };
  req.on('close', close);
  res.on('close', close);
}
function requestBaseUrl (req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT)).split(',')[0].trim();
  return proto + '://' + host;
}
function webhookInfo (req) {
  const token = ensureWebhookToken();
  const base = requestBaseUrl(req);
  return {
    token,
    radarrUrl: base + '/api/webhooks/radarr?token=' + encodeURIComponent(token),
    sonarrUrl: base + '/api/webhooks/sonarr?token=' + encodeURIComponent(token)
  };
}
function setupWizardNeeded () {
  const c = readConfig();
  if (c.realtime && c.realtime.setupComplete) return false;
  return !(c.radarr.url || c.sonarr.url || c.tmdb.apiKey || c.plex.url || c.sab.url || c.webdav.url || c.webdav.localPath);
}
async function handleArrWebhook (svc, req, res, urlObj) {
  const supplied = urlObj.searchParams.get('token') || req.headers['x-mediarr-webhook-token'] || '';
  const expected = ensureWebhookToken();
  if (!secureEqual(supplied, expected)) return sendJSON(res, 401, { ok: false, message: 'Invalid webhook token' });
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
  const eventType = String(body.eventType || body.eventtype || body.type || 'Unknown');
  const item = svc === 'sonarr' ? (body.series || null) : (body.movie || null);
  const title = String((item && item.title) || (body.episode && body.episode.title) || '').slice(0, 200);
  if (item && item.id) {
    try { upsertLibCacheItem(svc, item); } catch (_) {}
  }
  liveIdx[svc] = { ts: 0, ids: null };
  if (!/^test$/i.test(eventType)) scheduleLibraryReconcile(svc, 250);
  realtimePush('arr.webhook', {
    service: svc, eventType, title,
    itemId: item && item.id ? item.id : null,
    downloaded: !!body.isUpgrade,
    source: 'webhook'
  });
  return sendJSON(res, 200, { ok: true, service: svc, eventType, receivedAt: Date.now() });
}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
function serveStatic (res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // App HTML/JS changes between MEDIARR releases. Do not let a browser keep an
    // old v150.js in memory/disk after an in-app update, otherwise new controls
    // (such as Unified Detail playback) can appear to be missing until a hard refresh.
    if (ext === '.html' || ext === '.js') headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(data);
  });
}

// Serve a vendored asset (Bootstrap). If it's already cached in /public, serve that (works fully
// offline). Otherwise fetch it once from the CDN, cache it to /public for next time, and serve it.
async function serveVendor (res, name, url) {
  const cachePath = path.join(PUBLIC_DIR, name);
  const ctype = name.endsWith('.css') ? 'text/css' : 'text/javascript';
  try {
    if (fs.existsSync(cachePath)) {
      const buf = fs.readFileSync(cachePath);
      res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    }
  } catch (e) {}
  try {
    let up = await upstream(url, { headers: { 'Accept': '*/*', 'User-Agent': 'mediarr' } });
    let hops = 0;
    while (up.status >= 300 && up.status < 400 && up.headers.location && hops++ < 3) {
      up = await upstream(up.headers.location, { headers: { 'Accept': '*/*', 'User-Agent': 'mediarr' } });
    }
    if (up.status !== 200) throw new Error('CDN returned HTTP ' + up.status);
    try { fs.writeFileSync(cachePath, up.body); } catch (e) {}   // cache for offline next time
    res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': up.body.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(up.body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    return res.end('Could not load ' + name + ': ' + e.message + '. The mobile UI needs internet on first load to cache Bootstrap, or you can drop the file into /public manually.');
  }
}
// Cached like the config: currentUser() runs on every authenticated request.
let _usrCache = null, _usrMtime = 0;
function readUsers () {
  try {
    const st = fs.statSync(USERS_PATH);
    if (_usrCache && st.mtimeMs === _usrMtime) return _usrCache;
    const d = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    _usrMtime = st.mtimeMs;
    return (_usrCache = d);
  } catch (e) { return { users: [] }; }
}
function writeUsers (u) { fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2)); _usrCache = null; _usrMtime = 0; try { backupOnChange('users'); } catch (e) {} }
/* ---------- error log ----------
   Somewhere to record the things that used to fail silently, so problems are visible
   in the admin panel instead of needing a hunt. */
const ERRLOG_PATH = path.join(DATA_DIR, 'errors.json');
let errLog = null, errDirty = false;
function readErrLog () {
  if (errLog) return errLog;
  try { errLog = JSON.parse(fs.readFileSync(ERRLOG_PATH, 'utf8')); } catch (e) { errLog = { events: [] }; }
  if (!errLog.events) errLog.events = [];
  return errLog;
}
function logError (where, message, detail) {
  const l = readErrLog();
  const msg = String(message == null ? '' : (message.message || message)).slice(0, 400);
  const top = l.events[0];
  // collapse repeats instead of flooding the log
  if (top && top.where === where && top.message === msg && (Date.now() - top.last) < 300000) {
    top.count++; top.last = Date.now(); errDirty = true; return;
  }
  l.events.unshift({
    ts: Date.now(), last: Date.now(), count: 1, where: String(where).slice(0, 80), message: msg,
    detail: detail ? String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''
  });
  if (l.events.length > 300) l.events.length = 300;
  errDirty = true;
  if (!/^notify:|^login$/.test(where)) { try { notify('errors', '⚠ ' + where, msg, 'bad'); } catch (e) {} }
}
setInterval(() => { if (errDirty) { errDirty = false; try { fs.writeFileSync(ERRLOG_PATH, JSON.stringify(readErrLog())); } catch (e) {} } }, 5000).unref?.();
process.on('uncaughtException', e => { try { logError('uncaught', e && e.message, e && e.stack); } catch (_) {} });
process.on('unhandledRejection', e => { try { logError('unhandled-promise', e && (e.message || e), e && e.stack); } catch (_) {} });

/* ---------- login rate limiting ----------
   The server is reachable from the internet, so failed passwords are throttled per
   IP and per username, with a lockout that grows as attempts continue. */
const loginFails = new Map();          // key -> { count, first, until }
const LOGIN_MAX = 5;                   // failures before the first lockout
const LOGIN_WINDOW = 15 * 60000;       // failures older than this are forgotten
function loginKeys (ip, username) { return ['ip:' + ip, 'user:' + String(username || '').toLowerCase()]; }
function loginBlocked (ip, username) {
  const now = Date.now();
  for (const k of loginKeys(ip, username)) {
    const r = loginFails.get(k);
    if (r && r.until > now) return Math.ceil((r.until - now) / 1000);
  }
  return 0;
}
function loginFailed (ip, username) {
  const now = Date.now();
  let lock = 0;
  for (const k of loginKeys(ip, username)) {
    const r = loginFails.get(k) || { count: 0, first: now, until: 0 };
    if (now - r.first > LOGIN_WINDOW && r.until < now) { r.count = 0; r.first = now; }
    r.count++;
    if (r.count >= LOGIN_MAX) {
      // 1 min, 5, 15, 30, then 60 minutes
      const steps = [60, 300, 900, 1800, 3600];
      const idx = Math.min(steps.length - 1, r.count - LOGIN_MAX);
      r.until = now + steps[idx] * 1000;
      lock = Math.max(lock, steps[idx]);
    }
    loginFails.set(k, r);
  }
  if (loginFails.size > 5000) { for (const [k, r] of loginFails) if (r.until < now && now - r.first > LOGIN_WINDOW) loginFails.delete(k); }
  return lock;
}
function loginSucceeded (ip, username) { for (const k of loginKeys(ip, username)) loginFails.delete(k); }

/* Public registration is intentionally conservative: at most five new accounts per IP per hour.
   Plex PIN creation has a separate short-window throttle and each PIN is bound to a random nonce. */
const registrationHits = new Map();
const plexAuthStarts = new Map();
const captchaStarts = new Map();
const captchaChallenges = new Map();
const publicPlexPins = new Map();
const CAPTCHA_TTL = 5 * 60000;
const CAPTCHA_DIGITS = '23456789';
const CAPTCHA_SEGMENTS = {
  '2': ['a','b','g','e','d'], '3': ['a','b','g','c','d'],
  '4': ['f','g','b','c'],     '5': ['a','f','g','c','d'],
  '6': ['a','f','g','e','c','d'], '7': ['a','b','c'],
  '8': ['a','b','c','d','e','f','g'], '9': ['a','b','c','d','f','g']
};
const CAPTCHA_SEG_PATHS = {
  a:'M8 4 L32 4 L35 7 L32 10 L8 10 L5 7 Z',
  b:'M34 9 L37 12 L37 29 L34 32 L31 29 L31 12 Z',
  c:'M34 34 L37 37 L37 54 L34 57 L31 54 L31 37 Z',
  d:'M8 56 L32 56 L35 59 L32 62 L8 62 L5 59 Z',
  e:'M4 34 L7 37 L7 54 L4 57 L1 54 L1 37 Z',
  f:'M4 9 L7 12 L7 29 L4 32 L1 29 L1 12 Z',
  g:'M8 30 L32 30 L35 33 L32 36 L8 36 L5 33 Z'
};
function rateWindow (map, key, windowMs, max) {
  const now = Date.now(), cur = (map.get(key) || []).filter(t => now - t < windowMs);
  map.set(key, cur);
  if (cur.length < max) return 0;
  return Math.max(1, Math.ceil((windowMs - (now - cur[0])) / 1000));
}
function rateRecord (map, key, windowMs) {
  const now = Date.now(), cur = (map.get(key) || []).filter(t => now - t < windowMs);
  cur.push(now); map.set(key, cur);
  if (map.size > 5000) for (const [k,v] of map) if (!v.length || now - v[v.length - 1] > windowMs) map.delete(k);
}
function registrationWait (ip) { return rateWindow(registrationHits, 'ip:' + ip, 60 * 60000, 5); }
function registrationRecord (ip) { rateRecord(registrationHits, 'ip:' + ip, 60 * 60000); }
function plexAuthWait (ip) { return rateWindow(plexAuthStarts, 'ip:' + ip, 15 * 60000, 12); }
function plexAuthRecord (ip) { rateRecord(plexAuthStarts, 'ip:' + ip, 15 * 60000); }
function captchaWait (ip) { return rateWindow(captchaStarts, 'ip:' + ip, 15 * 60000, 30); }
function captchaRecord (ip) { rateRecord(captchaStarts, 'ip:' + ip, 15 * 60000); }
function pruneCaptchas () {
  const cut = Date.now() - CAPTCHA_TTL;
  for (const [id,v] of captchaChallenges) if (!v || v.createdAt < cut) captchaChallenges.delete(id);
  if (captchaChallenges.size > 2000) {
    const old = Array.from(captchaChallenges.entries()).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    for (let i=0;i<old.length-1500;i++) captchaChallenges.delete(old[i][0]);
  }
}
function captchaHash (id, answer) {
  return crypto.createHash('sha256').update(String(id) + ':' + String(answer || '').trim()).digest();
}
function captchaSvg (answer) {
  const W=300,H=92, parts=[
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">',
    '<rect width="100%" height="100%" rx="12" fill="#111827"/>'
  ];
  for (let i=0;i<18;i++) {
    const x1=crypto.randomInt(0,W),y1=crypto.randomInt(0,H),x2=crypto.randomInt(0,W),y2=crypto.randomInt(0,H);
    const op=(0.08+crypto.randomInt(0,18)/100).toFixed(2);
    parts.push('<path d="M'+x1+' '+y1+' L'+x2+' '+y2+'" stroke="#9ca3af" stroke-opacity="'+op+'" stroke-width="'+crypto.randomInt(1,3)+'"/>');
  }
  for (let i=0;i<answer.length;i++) {
    const digit=answer[i], x=20+i*54+crypto.randomInt(-3,4), y=12+crypto.randomInt(-3,4), rot=crypto.randomInt(-9,10);
    const segs=CAPTCHA_SEGMENTS[digit]||[];
    parts.push('<g transform="translate('+x+' '+y+') rotate('+rot+' 19 33)" fill="#e5e7eb">');
    for (const s of segs) parts.push('<path d="'+CAPTCHA_SEG_PATHS[s]+'"/>');
    parts.push('</g>');
  }
  for (let i=0;i<16;i++) {
    parts.push('<circle cx="'+crypto.randomInt(4,W-4)+'" cy="'+crypto.randomInt(4,H-4)+'" r="'+crypto.randomInt(1,4)+'" fill="#f59e0b" fill-opacity="'+(0.12+crypto.randomInt(0,20)/100).toFixed(2)+'"/>');
  }
  parts.push('</svg>');
  return 'data:image/svg+xml;base64,' + Buffer.from(parts.join('')).toString('base64');
}
function createCaptcha (ip) {
  pruneCaptchas();
  let answer=''; for (let i=0;i<5;i++) answer += CAPTCHA_DIGITS[crypto.randomInt(0,CAPTCHA_DIGITS.length)];
  const id=crypto.randomBytes(18).toString('hex');
  captchaChallenges.set(id,{ hash: captchaHash(id,answer), ip:String(ip||''), createdAt:Date.now() });
  captchaRecord(ip);
  return { id, image: captchaSvg(answer), expiresIn: Math.floor(CAPTCHA_TTL/1000) };
}
function verifyCaptcha (ip, id, answer) {
  pruneCaptchas();
  id=String(id||''); const c=captchaChallenges.get(id);
  if (!c) return false;
  captchaChallenges.delete(id); // every attempt is one-time, successful or not
  if (c.ip !== String(ip||'') || Date.now()-c.createdAt > CAPTCHA_TTL) return false;
  const got=captchaHash(id,String(answer||'').replace(/\s+/g,''));
  return got.length===c.hash.length && crypto.timingSafeEqual(got,c.hash);
}
function prunePublicPlexPins () {
  const cut = Date.now() - 10 * 60000;
  for (const [id,v] of publicPlexPins) if (!v || v.createdAt < cut) publicPlexPins.delete(id);
}

function loginLockouts () {
  const now = Date.now(), out = [];
  for (const [k, r] of loginFails) {
    if (r.until <= now && r.count < LOGIN_MAX) continue;
    out.push({ key: k, attempts: r.count, lockedForSeconds: r.until > now ? Math.ceil((r.until - now) / 1000) : 0, since: r.first });
  }
  return out.sort((a, b) => b.attempts - a.attempts).slice(0, 50);
}

/* ---------- SABnzbd (read-only queue + history for every signed-in user) ---------- */
async function sabCall (mode, extra, override) {
  const cfg = override || readConfig().sab;
  if (!cfg.url || !cfg.apiKey) return { ok: false, message: 'SABnzbd is not configured' };
  const base = normUrl(cfg.url);
  const qs = '/api?mode=' + encodeURIComponent(mode) + '&output=json&apikey=' + encodeURIComponent(cfg.apiKey) + (extra || '');
  try {
    const up = await upstream(base + qs, { headers: { Accept: 'application/json' }, timeout: 20000 });
    if (up.status === 401 || up.status === 403) return { ok: false, message: 'SABnzbd rejected the API key' };
    if (up.status >= 400) return { ok: false, message: 'SABnzbd returned HTTP ' + up.status };
    let d = null;
    try { d = JSON.parse(up.body.toString('utf8')); } catch (e) { return { ok: false, message: 'SABnzbd did not return JSON — check the URL' }; }
    if (d && d.status === false && d.error) return { ok: false, message: String(d.error) };
    return { ok: true, data: d };
  } catch (e) {
    const m = String(e.message || e);
    if (/ECONNREFUSED/.test(m)) return { ok: false, message: 'Connection refused — is SABnzbd running at that address?' };
    if (/ENOTFOUND|EAI_AGAIN/.test(m)) return { ok: false, message: 'Host not found — check the URL' };
    if (/timed out|ETIMEDOUT/i.test(m)) return { ok: false, message: 'Timed out reaching SABnzbd' };
    return { ok: false, message: m };
  }
}
// Trim SABnzbd's payload down to what the UI shows — and never echo the API key back.
function sabSlim (q, h) {
  const out = { configured: true, paused: false, speed: '0 B/s', speedBps: 0, sizeLeft: '', timeLeft: '', diskFreeGB: null, queue: [], history: [], historyTotal: 0 };
  if (q && q.queue) {
    const Q = q.queue;
    out.paused = !!Q.paused;
    out.speedBps = Number(Q.kbpersec) ? Math.round(Number(Q.kbpersec) * 1024) : 0;
    out.speed = Q.speed ? String(Q.speed) + 'B/s' : '0 B/s';
    out.sizeLeft = Q.sizeleft || '';
    out.timeLeft = Q.timeleft || '';
    out.diskFreeGB = Q.diskspace1 != null ? Number(Q.diskspace1) : null;
    out.queue = (Q.slots || []).slice(0, 100).map(x => ({
      id: x.nzo_id, name: x.filename || x.nzbname || '',
      status: x.status || '', percent: Number(x.percentage) || 0,
      sizeMB: Number(x.mb) || 0, leftMB: Number(x.mbleft) || 0,
      timeLeft: x.timeleft || '', category: x.cat || ''
    }));
  }
  if (h && h.history) {
    out.history = (h.history.slots || []).slice(0, 100).map(x => ({
      id: x.nzo_id, name: x.name || '', status: x.status || '',
      sizeBytes: Number(x.bytes) || 0, completed: Number(x.completed) || 0,
      category: x.category || '', downloadTimeSec: Number(x.download_time) || 0,
      failMessage: x.fail_message || ''
    }));
    out.historyTotal = Number(h.history.noofslots) || out.history.length;
  }
  return out;
}

/* ---------- configuration backups ----------
   Everything that isn't regenerable gets snapshotted: settings, users, favorites,
   activity, RSS state, blocklist. Caches are deliberately excluded. */
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_FILES = ['config.json', 'users.json', 'favorites.json', 'adds.json', 'rss.json', 'blocked.json', 'autoadd.json', 'watch-progress.json'];
const BACKUP_VERSION = 1;
let backupTimer = null, backupDebounce = null, lastBackupHash = '';
function ensureBackupDir () { try { fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 }); } catch (e) {} }
function buildBackup (reason) {
  const files = {};
  for (const name of BACKUP_FILES) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
      files[name] = JSON.parse(raw);
    } catch (e) { /* missing file is fine — it just isn't in this snapshot */ }
  }
  return { app: 'mediarr-config-backup', version: BACKUP_VERSION, createdAt: new Date().toISOString(), reason: reason || 'manual', host: os.hostname(), files };
}
function backupStamp (d) {
  const p2 = n => String(n).padStart(2, '0');
  return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}
function pruneBackups (keep) {
  try {
    const list = fs.readdirSync(BACKUP_DIR).filter(f => /^mediarr-config-.*\.json$/.test(f)).sort();
    const extra = list.length - Math.max(1, keep || 20);
    for (let i = 0; i < extra; i++) { try { fs.unlinkSync(path.join(BACKUP_DIR, list[i])); } catch (e) {} }
  } catch (e) {}
}
function createBackup (reason) {
  ensureBackupDir();
  const data = buildBackup(reason);
  const body = JSON.stringify(data, null, 2);
  // skip if nothing actually changed since the last snapshot
  const hash = crypto.createHash('sha1').update(JSON.stringify(data.files)).digest('hex');
  if (reason !== 'manual' && hash === lastBackupHash) return { ok: true, skipped: true };
  lastBackupHash = hash;
  const name = 'mediarr-config-' + backupStamp(new Date()) + '-' + reason + '.json';
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, name), body, { mode: 0o600 });
    pruneBackups(readConfig().backup.keep);
    return { ok: true, name, bytes: Buffer.byteLength(body) };
  } catch (e) { logError('backup', e.message, name); return { ok: false, message: e.message }; }
}
// Called after any settings/user write; debounced so a burst of saves makes one snapshot.
function backupOnChange (reason) {
  try {
    if (!readConfig().backup.onChange) return;
  } catch (e) { return; }
  if (backupDebounce) clearTimeout(backupDebounce);
  backupDebounce = setTimeout(() => { createBackup(reason || 'change'); }, 8000);
  if (backupDebounce.unref) backupDebounce.unref();
}
function listBackups () {
  ensureBackupDir();
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => /^mediarr-config-.*\.json$/.test(f))
      .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, bytes: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at);
  } catch (e) { return []; }
}
function scheduleBackups () {
  if (backupTimer) clearTimeout(backupTimer);
  const cfg = readConfig().backup;
  const days = Number(cfg.everyDays) || 0;
  if (days <= 0) return;                    // 0 = scheduled backups off
  const period = days * 86400000;
  const newest = listBackups().find(b => /-(scheduled|manual|change)\.json$/.test(b.name));
  const due = newest ? Math.max(60000, (newest.at + period) - Date.now()) : 60000;
  // setTimeout caps out around 24.8 days, so clamp and re-arm if the period is longer
  const delay = Math.min(due, 2147483000);
  backupTimer = setTimeout(() => {
    if (Date.now() >= (newest ? newest.at + period : 0)) createBackup('scheduled');
    scheduleBackups();
  }, delay);
  if (backupTimer.unref) backupTimer.unref();
}
/* Restore: writes the files back, keeping a safety snapshot of what was there first. */
function restoreBackup (data, opts) {
  if (!data || data.app !== 'mediarr-config-backup' || !data.files) return { ok: false, message: 'That is not a MEDIARR configuration backup' };
  const only = (opts && opts.only) || null;      // e.g. ['config.json']
  const before = createBackup('pre-restore');
  const done = [], failed = [];
  for (const name of BACKUP_FILES) {
    if (!data.files[name]) continue;
    if (only && !only.includes(name)) continue;
    try {
      fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data.files[name], null, 2));
      done.push(name);
    } catch (e) { failed.push(name + ': ' + e.message); }
  }
  // drop every cache so nothing stale survives the restore
  _cfgCache = null; _cfgMtime = 0; _usrCache = null; _usrMtime = 0; _addsCache = null; _addsMtime = 0;
  libCache = null; rssState = null; blockLog = null; errLog = null;
  try { sessions.clear(); } catch (e) {}      // old sessions won't match restored users
  return { ok: failed.length === 0, restored: done, failed, safetyCopy: before.name || null };
}

/* ---------- notifications ----------
   One small dispatcher that speaks each service's own webhook format. Tokens/URLs are
   stored server-side and masked in the API so they never leak back to the browser. */
function maskUrl (u) {
  const s = String(u || '');
  if (!s) return '';
  if (s.length <= 24) return s.slice(0, 6) + '…';
  return s.slice(0, 18) + '…' + s.slice(-6);
}
const NOTIFY_KINDS = ['discord', 'slack', 'telegram', 'ntfy', 'gotify', 'pushover', 'pushbullet', 'webhook', 'email'];
function notifyPayload (kind, target, ev) {
  const title = ev.title || 'MEDIARR';
  const body = ev.message || '';
  const text = title + (body ? '\n' + body : '');
  const colorMap = { good: 0x4ade80, warn: 0xe8b04b, bad: 0xf4607a, info: 0x35c5f0 };
  switch (kind) {
    case 'discord':
      return { url: target.url, method: 'POST', json: { username: 'MEDIARR', embeds: [{ title, description: body.slice(0, 3800), color: colorMap[ev.level || 'info'] || colorMap.info, timestamp: new Date().toISOString() }] } };
    case 'slack':
      return { url: target.url, method: 'POST', json: { text: '*' + title + '*' + (body ? '\n' + body : '') } };
    case 'telegram': {
      // url holds "botToken:chatId" or a full api url
      let botToken = target.url, chatId = target.extra || '';
      if (target.url.includes('|')) { const p2 = target.url.split('|'); botToken = p2[0]; chatId = p2[1]; }
      return { url: 'https://api.telegram.org/bot' + botToken + '/sendMessage', method: 'POST',
               json: { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true } };
    }
    case 'ntfy':
      return { url: target.url, method: 'POST', body: body || title,
               headers: { Title: title.slice(0, 200), Priority: ev.level === 'bad' ? '4' : ev.level === 'warn' ? '4' : '3', Tags: ev.level === 'bad' ? 'rotating_light' : ev.level === 'good' ? 'white_check_mark' : 'information_source' } };
    case 'gotify':
      return { url: target.url, method: 'POST', json: { title, message: body || title, priority: ev.level === 'bad' ? 8 : 4 } };
    case 'pushover':
      return { url: 'https://api.pushover.net/1/messages.json', method: 'POST',
               form: { token: (target.url || '').split('|')[0], user: (target.url || '').split('|')[1] || target.extra || '', title, message: body || title, priority: ev.level === 'bad' ? 1 : 0 } };
    case 'pushbullet':
      return { url: 'https://api.pushbullet.com/v2/pushes', method: 'POST',
               headers: { 'Access-Token': target.url }, json: { type: 'note', title, body: body || title } };
    case 'webhook':
    default:
      return { url: target.url, method: 'POST', json: { app: 'mediarr', event: ev.event || '', level: ev.level || 'info', title, message: body, ts: Date.now() } };
  }
}
async function sendNotification (target, ev) {
  const spec = notifyPayload(target.kind, target, ev);
  if (!spec || !spec.url) return { ok: false, message: 'no url' };
  let body = null;
  const headers = Object.assign({ 'User-Agent': 'MEDIARR/1.0' }, spec.headers || {});
  if (spec.json) { body = Buffer.from(JSON.stringify(spec.json)); headers['Content-Type'] = 'application/json'; }
  else if (spec.form) { body = Buffer.from(new URLSearchParams(spec.form).toString()); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (spec.body) { body = Buffer.from(String(spec.body)); headers['Content-Type'] = 'text/plain; charset=utf-8'; }
  if (body) headers['Content-Length'] = body.length;
  try {
    const up = await upstream(spec.url, { method: spec.method || 'POST', headers, body, timeout: 15000 });
    if (up.status >= 400) return { ok: false, message: 'HTTP ' + up.status + ' ' + up.body.toString('utf8').slice(0, 120) };
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}
const notifyRecent = new Map();
function notify (event, title, message, level) {
  try {
    const cfg = readConfig().notify;
    if (!cfg.enabled) return;
    if (cfg.events && cfg.events[event] === false) return;
    const targets = (cfg.targets || []).filter(t => t.enabled !== false && t.url);
    if (!targets.length) return;
    // don't repeat the same alert within 5 minutes
    const key = event + '|' + title;
    if (Date.now() - (notifyRecent.get(key) || 0) < 300000) return;
    notifyRecent.set(key, Date.now());
    if (notifyRecent.size > 300) { const cut = Date.now() - 900000; for (const [k, t] of notifyRecent) if (t < cut) notifyRecent.delete(k); }
    const ev = { event, title, message, level: level || 'info' };
    for (const t of targets) {
      sendNotification(t, ev).then(r => { if (!r.ok) logError('notify:' + t.kind, r.message, t.name || ''); }).catch(() => {});
    }
  } catch (e) {}
}

function findUser (username) { return readUsers().users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase()); }
function userApproved (u) { return !!u && u.approved !== false; }
function findUsersByPlexAccountId (id) {
  const key = String(id == null ? '' : id);
  if (!key) return [];
  return readUsers().users.filter(u => u.plex && (
    (u.plex.accountId != null && String(u.plex.accountId) === key) ||
    (u.plex.accountId == null && u.plex.id != null && String(u.plex.id) === key)
  ));
}
async function resolvePlexAccountMatch (plexId) {
  let matches = findUsersByPlexAccountId(plexId);
  if (matches.length || !plexId) return matches;
  // Older users may have switched to a Plex Home profile before accountId existed.
  // Resolve the stored root token once so the stable account can be recovered safely.
  const data = readUsers(); let changed = false;
  for (const u of data.users) {
    const px = u.plex || {}, root = px.rootToken || '';
    if (!root) continue;
    try {
      const acct = await plexJson('https://plex.tv/api/v2/user', root);
      const id = acct.ok && acct.data && acct.data.id != null ? String(acct.data.id) : '';
      if (!id) continue;
      if (String(px.accountId || '') !== id) { px.accountId = acct.data.id; u.plex = px; changed = true; }
    } catch (_) {}
  }
  if (changed) writeUsers(data);
  return findUsersByPlexAccountId(plexId);
}
function pendingRegistrations () {
  return readUsers().users.filter(u => !userApproved(u)).sort((a,b)=>(a.requestedAt||a.createdAt||0)-(b.requestedAt||b.createdAt||0));
}
function registrationUsername (raw) {
  const u = String(raw || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(u)) return '';
  return u;
}
function uniquePlexUsername (info) {
  const data = readUsers(), taken = new Set(data.users.map(u => String(u.username || '').toLowerCase()));
  let base = String((info && (info.username || info.title)) || '').trim()
    .replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '').replace(/^[-_.]+|[-_.]+$/g, '');
  if (base.length < 3) base = 'plex_user';
  base = base.slice(0, 32);
  if (!taken.has(base.toLowerCase())) return base;
  const suffix = String((info && info.id) || crypto.randomBytes(3).toString('hex')).replace(/[^A-Za-z0-9]/g, '').slice(-8) || 'user';
  let candidate = (base.slice(0, Math.max(3, 39 - suffix.length)) + '_' + suffix).slice(0, 40);
  let n = 2;
  while (taken.has(candidate.toLowerCase())) candidate = (base.slice(0, 34) + '_' + suffix.slice(-3) + n++).slice(0, 40);
  return candidate;
}
function announceRegistration (u) {
  const method = u.registrationMethod === 'plex' ? 'Plex' : 'username/password';
  try { notify('registration', '👤 New MEDIARR access request', u.username + ' registered with ' + method + ' and is waiting for approval.', 'info'); } catch (_) {}
  try { realtimePush('registration.pending', { username: u.username, method, requestedAt: u.requestedAt || u.createdAt || Date.now() }); } catch (_) {}
}

/* ---------- per-user theme + personal API key ---------- */
const THEME_VARS = ['bg', 'bg2', 'panel', 'panel2', 'line', 'txt', 'muted', 'gold', 'gold-dim', 'radarr', 'sonarr', 'green', 'red'];
function cleanColor (v) {
  v = String(v == null ? '' : v).trim();
  if (!v) return '';
  if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v) || /^#[0-9a-f]{8}$/i.test(v)) return v;
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(v)) return v;
  if (/^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+\s*)?\)$/i.test(v)) return v;
  return '';
}
function sanitizeTheme (t) {
  const out = { base: (t && t.base === 'light') ? 'light' : 'dark', modes: { dark: {}, light: {} } };
  const src = (t && t.modes) || {};
  for (const mode of ['dark', 'light']) {
    const m = src[mode] || {};
    for (const k of THEME_VARS) { const c = cleanColor(m[k]); if (c) out.modes[mode][k] = c; }
  }
  // migrate the older single-palette shape into whichever base it was saved under
  if (t && t.vars && !t.modes) {
    for (const k of THEME_VARS) { const c = cleanColor(t.vars[k]); if (c) out.modes[out.base][k] = c; }
  }
  return out;
}
function userTheme (username) { const u = findUser(username); return (u && u.theme) ? sanitizeTheme(u.theme) : { base: 'dark', modes: { dark: {}, light: {} } }; }
function setUserField (username, field, value) {
  const data = readUsers();
  const u = data.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
  if (!u) return false;
  if (value == null) delete u[field]; else u[field] = value;
  writeUsers(data); return true;
}
function newApiKey () { return 'mk_' + crypto.randomBytes(24).toString('hex'); }
function findUserByApiKey (key) {
  key = String(key || '').trim();
  if (!key || key.length < 8) return null;
  return readUsers().users.find(u => userApproved(u) && u.apiKey && crypto.timingSafeEqual(
    Buffer.from(String(u.apiKey).padEnd(80, '\0').slice(0, 80)),
    Buffer.from(key.padEnd(80, '\0').slice(0, 80)))) || null;
}
function apiKeyFromReq (req, u) {
  return String(req.headers['x-api-key'] || u.searchParams.get('api_key') || '').trim();
}
function hashPassword (password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword (password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(h), b = Buffer.from(String(hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sessions = new Map();   // token -> { username, expires }
function parseCookies (req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser (req) {
  const tok = parseCookies(req).mediarr_session;
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s || s.expires < Date.now()) { if (s) sessions.delete(tok); return null; }
  const u = findUser(s.username);
  if (!u || !userApproved(u)) { sessions.delete(tok); return null; }
  return u;
}
/* Someone actively watching or downloading shouldn't be logged out mid-stream, so any
   media activity pushes their session out another full hour (and refreshes the cookie). */
function keepSessionAlive (req, res, why) {
  const tok = parseCookies(req).mediarr_session;
  if (!tok) return false;
  const s = sessions.get(tok);
  if (!s) return false;
  const now = Date.now();
  if (s.expires < now) return false;
  s.expires = now + SESSION_MS;
  s.lastActivity = now;
  s.activity = why || 'media';
  sessions.set(tok, s);
  // Refresh the browser cookie too, but not on every byte-range request.
  if (res && !res.headersSent && (now - (s.cookieRefreshed || 0) > 60000)) {
    s.cookieRefreshed = now;
    try {
      const secure = isSecureRequest(req) ? ' Secure;' : '';
      res.setHeader('Set-Cookie', `mediarr_session=${tok}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`);
    } catch (e) {}
  }
  return true;
}
// Who is currently streaming or downloading through MEDIARR (last 2 minutes of activity).
const activeMedia = new Map();   // username -> { what, path, at }
function markMediaActivity (user, what, rel) {
  if (!user) return;
  activeMedia.set(user.username, { what, path: rel || '', at: Date.now() });
  if (activeMedia.size > 200) { const cut = Date.now() - 600000; for (const [k, v] of activeMedia) if (v.at < cut) activeMedia.delete(k); }
}
function activeMediaList (windowMs) {
  const cut = Date.now() - (windowMs || 120000);
  const out = [];
  for (const [username, v] of activeMedia) if (v.at >= cut) out.push({ username, what: v.what, path: v.path, secondsAgo: Math.round((Date.now() - v.at) / 1000) });
  return out;
}
// Is this request effectively HTTPS? Behind Caddy/nginx the TLS terminates at the proxy,
// which tells us via X-Forwarded-Proto. SECURE_COOKIES=1 forces it on regardless.
function isSecureRequest (req) {
  if (process.env.SECURE_COOKIES === '1') return true;
  const xfp = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (xfp) return xfp === 'https';
  return !!(req.socket && req.socket.encrypted);
}
function createSession (req, res, username) {
  const tok = crypto.randomBytes(32).toString('hex');
  sessions.set(tok, { username, expires: Date.now() + SESSION_MS });
  const secure = isSecureRequest(req) ? ' Secure;' : '';   // only over HTTPS, so local HTTP still works
  res.setHeader('Set-Cookie', `mediarr_session=${tok}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS/1000)}`);
}
function clearSession (req, res) {
  const tok = parseCookies(req).mediarr_session;
  if (tok) sessions.delete(tok);
  const secure = isSecureRequest(req) ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `mediarr_session=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`);
}
function publicUser (u, withCounts) {
  const o = {
    username: u.username, role: u.role, dailyLimit: u.dailyLimit, createdAt: u.createdAt,
    approved: userApproved(u), registrationMethod: u.registrationMethod || 'local',
    requestedAt: u.requestedAt || null, approvedAt: u.approvedAt || null,
    hasPassword: !!u.hash, plexUsername: (u.plex && u.plex.username) || ''
  };
  if (withCounts) o.addedToday = addsTodayCount(u.username);
  return o;
}

/* ---------- add log (what each user added) ---------- */
// Up to 3,000 entries — cached so the per-request daily-limit check isn't a full re-parse.
let _addsCache = null, _addsMtime = 0;
function readAdds () {
  try {
    const st = fs.statSync(ADDS_PATH);
    if (_addsCache && st.mtimeMs === _addsMtime) return _addsCache;
    const d = JSON.parse(fs.readFileSync(ADDS_PATH, 'utf8'));
    _addsMtime = st.mtimeMs;
    return (_addsCache = d);
  } catch (e) { return { adds: [] }; }
}
function writeAdds (a) { fs.writeFileSync(ADDS_PATH, JSON.stringify(a, null, 2)); _addsCache = a; try { _addsMtime = fs.statSync(ADDS_PATH).mtimeMs; } catch (e) { _addsMtime = 0; } }
function logAdd (entry) {
  const a = readAdds(); a.adds.unshift(entry); if (a.adds.length > MAX_ADDS_LOG) a.adds.length = MAX_ADDS_LOG; writeAdds(a);
  try { realtimePush('activity', { service: entry.service || '', type: entry.type || '', title: entry.title || '', username: entry.username || '' }); } catch (_) {}
}

/* ---------- favorite TV shows (per user) ---------- */
function readFavs () { try { return JSON.parse(fs.readFileSync(FAVS_PATH, 'utf8')); } catch (e) { return { users: {} }; } }
function writeFavs (f) { fs.writeFileSync(FAVS_PATH, JSON.stringify(f, null, 2)); }
function favKey (it) {
  if (it.imdbId) return 'imdb:' + String(it.imdbId).toLowerCase();
  if (it.tvdbId) return 'tvdb:' + it.tvdbId;
  if (it.tmdbId) return 'tmdb:' + it.tmdbId;
  return 'name:' + String(it.title || '').trim().toLowerCase();
}
function userFavs (username) { const f = readFavs(); return (f.users && f.users[username]) || []; }
function normTitle (s) { return String(s || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

// Server-side JSON GET against Radarr/Sonarr (returns null instead of throwing).
async function arrJson (svc, subPath) {
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return null;
  try {
    const up = await upstream(normUrl(cfg.url) + subPath, { headers: { 'X-Api-Key': cfg.apiKey, 'Accept': 'application/json' } });
    if (up.status >= 400) return null;
    return JSON.parse(up.body.toString('utf8'));
  } catch (e) { return null; }
}
async function tmdbJson (subPath) {
  const key = readConfig().tmdb.apiKey;
  if (!key) return null;
  try {
    const sep = subPath.includes('?') ? '&' : '?';
    const up = await upstream(TMDB + subPath + sep + 'api_key=' + encodeURIComponent(key), { headers: { Accept: 'application/json' } });
    if (up.status >= 400) return null;
    return JSON.parse(up.body.toString('utf8'));
  } catch (e) { return null; }
}

/* Watched-episode index from Plex, cached briefly (one pass over TV sections). */
let _plexWatched = { ts: 0, set: null, shows: null };
async function plexWatchedIndex () {
  const now = Date.now();
  if (_plexWatched.set && (now - _plexWatched.ts) < 60000) return _plexWatched;
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return { ts: now, set: new Set(), shows: new Map() };
  const base = normUrl(cfg.url), headers = { 'X-Plex-Token': cfg.token, Accept: 'application/json' };
  const set = new Set(), shows = new Map();
  try {
    const list = await upstream(base + '/library/sections', { headers });
    let dirs = [];
    try { dirs = (JSON.parse(list.body.toString('utf8')).MediaContainer || {}).Directory || []; } catch (e) {}
    for (const d of dirs.filter(x => x.type === 'show')) {
      try {
        const ep = await upstream(base + '/library/sections/' + encodeURIComponent(d.key) + '/all?type=4', { headers });
        let metas = [];
        try { metas = (JSON.parse(ep.body.toString('utf8')).MediaContainer || {}).Metadata || []; } catch (e) {}
        for (const m of metas) {
          if (!(m.viewCount > 0)) continue;
          const show = normTitle(m.grandparentTitle), s = Number(m.parentIndex), e = Number(m.index);
          if (!show || !Number.isFinite(s) || !Number.isFinite(e)) continue;
          set.add(show + '|' + s + '|' + e);
          const cur = shows.get(show);
          if (!cur || s > cur.season || (s === cur.season && e > cur.episode)) shows.set(show, { season: s, episode: e });
        }
      } catch (e) { /* skip a section that fails */ }
    }
  } catch (e) { /* Plex unreachable — return what we have */ }
  _plexWatched = { ts: now, set, shows };
  return _plexWatched;
}

/* Next upcoming episode for each of a user's favorite shows. */
async function favoritesUpcoming (username, res) {
  const favs = userFavs(username);
  if (!favs.length) return sendJSON(res, 200, { items: [], favorites: 0 });
  const seriesRes = await arrListAll('sonarr', '/api/v3/series');
  const series = seriesRes.ok ? seriesRes.items : [];
  const watched = await plexWatchedIndex();
  const now = Date.now();
  const items = [];
  for (const f of favs) {
    let next = null, prev = null, poster = f.poster || '';
    const match = series.find(s =>
      (f.tvdbId && s.tvdbId === Number(f.tvdbId)) ||
      (f.imdbId && s.imdbId && String(s.imdbId).toLowerCase() === String(f.imdbId).toLowerCase()) ||
      normTitle(s.title) === normTitle(f.title));
    if (match) {
      const eps = (await arrJson('sonarr', '/api/v3/episode?seriesId=' + match.id)) || [];
      const dated = eps.filter(e => e.airDateUtc && e.seasonNumber > 0);
      const future = dated.filter(e => new Date(e.airDateUtc).getTime() > now).sort((a, b) => new Date(a.airDateUtc) - new Date(b.airDateUtc));
      const past = dated.filter(e => new Date(e.airDateUtc).getTime() <= now).sort((a, b) => new Date(b.airDateUtc) - new Date(a.airDateUtc));
      if (future[0]) next = { season: future[0].seasonNumber, episode: future[0].episodeNumber, name: future[0].title || '', airDate: future[0].airDateUtc };
      if (past[0])   prev = { season: past[0].seasonNumber, episode: past[0].episodeNumber, name: past[0].title || '', airDate: past[0].airDateUtc };
    } else if (f.tmdbId) {
      const tv = await tmdbJson('/tv/' + f.tmdbId);
      if (tv) {
        if (tv.next_episode_to_air) next = { season: tv.next_episode_to_air.season_number, episode: tv.next_episode_to_air.episode_number, name: tv.next_episode_to_air.name || '', airDate: tv.next_episode_to_air.air_date };
        if (tv.last_episode_to_air) prev = { season: tv.last_episode_to_air.season_number, episode: tv.last_episode_to_air.episode_number, name: tv.last_episode_to_air.name || '', airDate: tv.last_episode_to_air.air_date };
      }
    }
    const key = normTitle(f.title);
    const seenPrev = !!(prev && watched.set.has(key + '|' + prev.season + '|' + prev.episode));
    items.push({ key: f.key, title: f.title, poster, tvdbId: f.tvdbId || null, imdbId: f.imdbId || '', tmdbId: f.tmdbId || null,
      next, prev, watchedPrev: seenPrev, inSonarr: !!match });
  }
  items.sort((a, b) => {
    if (a.next && b.next) return new Date(a.next.airDate) - new Date(b.next.airDate);
    if (a.next) return -1; if (b.next) return 1;
    return String(a.title).localeCompare(String(b.title));
  });
  sendJSON(res, 200, { items, favorites: favs.length });
}

/* ---------- personalized user home ---------- */
const homeRecCache = new Map();
function homePosterFromArr (it) {
  const p = it && Array.isArray(it.images) && it.images[0];
  return p ? (p.remoteUrl || p.url || '') : '';
}
function homePlexWebUrl (machineIdentifier, key) {
  if (!machineIdentifier || !key) return '';
  return 'https://app.plex.tv/desktop/#!/server/' + encodeURIComponent(machineIdentifier)
    + '/details?key=' + encodeURIComponent(key);
}
async function homePlexMachineIdentifier () {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return '';
  try {
    const r = await plexJson(normUrl(cfg.url) + '/identity', cfg.token);
    return r.ok ? String((((r.data || {}).MediaContainer || {}).machineIdentifier) || '') : '';
  } catch (_) { return ''; }
}
async function homePlexHistory (username, limit) {
  const px = getUserPlex(username);
  const cfg = readConfig().plex;
  if (!px || !px.token) return { linked: false, configured: !!cfg.url, items: [] };
  if (!cfg.url) return { linked: true, configured: false, items: [] };
  const base = normUrl(cfg.url);
  let acctId = await plexServerAccountId(base, px.token, px);
  if (acctId != null && px.accountId == null) { px.accountId = acctId; setUserPlex(username, px); }
  const q = '?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=' + Math.max(1, Math.min(50, limit || 16))
    + (acctId != null ? '&accountID=' + encodeURIComponent(acctId) : '');
  let r = await plexJson(base + '/status/sessions/history/all' + q, px.token);
  // Admin-token fallback is allowed only when we know the exact Plex account id.
  if (!r.ok && cfg.token && acctId != null) r = await plexJson(base + '/status/sessions/history/all' + q, cfg.token);
  if (!r.ok) return { linked: true, configured: true, items: [], error: r.message || ('HTTP ' + r.status) };
  const machine = await homePlexMachineIdentifier();
  const items = plexItemsFrom(r.data).map(m => {
    const x = plexCard(m, 'pms');
    x.webUrl = homePlexWebUrl(machine, x.key);
    return x;
  });
  return { linked: true, configured: true, account: px.username || username, items };
}
async function homePlexContinue (username, limit) {
  const px = getUserPlex(username);
  const cfg = readConfig().plex;
  if (!px || !px.token) return { linked: false, configured: !!cfg.url, items: [] };
  if (!cfg.url) return { linked: true, configured: false, items: [] };
  const base = normUrl(cfg.url), size = Math.max(1, Math.min(30, limit || 16));
  const attempts = [
    base + '/hubs/home/continueWatching?X-Plex-Container-Start=0&X-Plex-Container-Size=' + size + '&includeMeta=1',
    base + '/hubs?count=' + size + '&onlyTransient=1'
  ];
  let raw = [];
  for (const url of attempts) {
    const r = await plexJson(url, px.token);
    if (!r.ok) continue;
    const mc = (r.data || {}).MediaContainer || {};
    if (Array.isArray(mc.Metadata)) raw = mc.Metadata;
    if (!raw.length && Array.isArray(mc.Hub)) {
      const hub = mc.Hub.find(h => /continue/i.test(String(h.title || h.identifier || h.type || '')));
      if (hub && Array.isArray(hub.Metadata)) raw = hub.Metadata;
    }
    if (raw.length) break;
  }
  const machine = await homePlexMachineIdentifier();
  const items = raw.slice(0, size).map(m => {
    const x = plexCard(m, 'pms');
    const dur = Number(x.duration) || 0, off = Number(x.viewOffset) || 0;
    x.progressPct = dur ? Math.max(0, Math.min(100, Math.round(off / dur * 100))) : 0;
    x.webUrl = homePlexWebUrl(machine, x.key);
    return x;
  });
  return { linked: true, configured: true, account: px.username || username, items };
}
async function homePlexWatchlist (username, limit) {
  const px = getUserPlex(username);
  if (!px || !px.token) return { linked: false, items: [] };
  const size = Math.max(1, Math.min(30, limit || 16));
  const url = PLEX_DISCOVER + '/library/sections/watchlist/all?includeCollections=1&includeExternalMedia=1&includeAdvanced=1&includeMeta=1'
    + '&X-Plex-Container-Start=0&X-Plex-Container-Size=' + size;
  try {
    const r = await upstream(url, { headers: plexHeaders(ensurePlexClientId(), px.token), timeout: 8000 });
    if (r.status < 200 || r.status >= 300) return { linked: true, items: [], error: 'HTTP ' + r.status };
    const data = JSON.parse(r.body.toString('utf8') || '{}');
    const raw = plexItemsFrom(data);
    return { linked: true, items: raw.slice(0, size).map(m => plexCard(m, 'meta')) };
  } catch (e) { return { linked: true, items: [], error: e.message }; }
}
async function homeUpcoming (username) {
  const favs = userFavs(username);
  if (!favs.length) return [];
  const seriesRes = await arrListAll('sonarr', '/api/v3/series');
  const series = seriesRes.ok ? seriesRes.items : [];
  const now = Date.now(), out = [];
  for (const f of favs.slice(0, 40)) {
    let next = null, match = series.find(x =>
      (f.tvdbId && Number(x.tvdbId) === Number(f.tvdbId)) ||
      (f.imdbId && x.imdbId && String(x.imdbId).toLowerCase() === String(f.imdbId).toLowerCase()) ||
      normTitle(x.title) === normTitle(f.title));
    if (match) {
      const eps = (await arrJson('sonarr', '/api/v3/episode?seriesId=' + match.id)) || [];
      const future = eps.filter(e => Number(e.seasonNumber) > 0 && e.airDateUtc && new Date(e.airDateUtc).getTime() > now)
        .sort((a,b) => new Date(a.airDateUtc) - new Date(b.airDateUtc));
      if (future[0]) next = {
        season: Number(future[0].seasonNumber), episode: Number(future[0].episodeNumber),
        name: future[0].title || '', airDate: future[0].airDateUtc
      };
    } else if (f.tmdbId) {
      const tv = await tmdbJson('/tv/' + f.tmdbId);
      if (tv && tv.next_episode_to_air) next = {
        season: tv.next_episode_to_air.season_number, episode: tv.next_episode_to_air.episode_number,
        name: tv.next_episode_to_air.name || '', airDate: tv.next_episode_to_air.air_date
      };
    }
    if (next) out.push({
      type: 'series', service: 'sonarr',
      title: f.title, poster: f.poster || '', imdbId: f.imdbId || '', tmdbId: f.tmdbId || null,
      tvdbId: f.tvdbId || null, next, inSonarr: !!match
    });
  }
  out.sort((a,b) => new Date(a.next.airDate) - new Date(b.next.airDate));
  return out.slice(0, 16);
}
function homeRequests (username, limit) {
  const cache = readLibCache();
  const rows = readAdds().adds.filter(e =>
    e.username === username && (e.service === 'radarr' || e.service === 'sonarr') &&
    (e.type === 'movie' || e.type === 'series'));
  const seen = new Set(), out = [];
  for (const e of rows) {
    const svc = e.service === 'sonarr' ? 'sonarr' : 'radarr';
    const k = svc + '|' + normTitle(e.title) + '|' + String(e.year || '');
    if (seen.has(k)) continue; seen.add(k);
    const items = cache[svc] && Array.isArray(cache[svc].items) ? cache[svc].items : [];
    const hit = items.find(x => normTitle(x.title) === normTitle(e.title) && (!e.year || !x.year || String(x.year) === String(e.year)));
    let ready = false;
    if (hit) {
      ready = svc === 'radarr' ? !!hit.hasFile
        : !!(hit.statistics && Number(hit.statistics.episodeFileCount) > 0);
    }
    out.push({
      ts: e.ts, type: svc === 'sonarr' ? 'series' : 'movie', service: svc, title: e.title || '', year: e.year || '',
      inLibrary: !!hit, ready, status: ready ? 'Available' : hit ? 'In library' : 'Requested',
      arrId: hit && hit.id || null, imdbId: hit && hit.imdbId || '',
      tmdbId: hit && hit.tmdbId || null, tvdbId: hit && hit.tvdbId || null,
      poster: homePosterFromArr(hit)
    });
    if (out.length >= (limit || 16)) break;
  }
  return out;
}
function homeRecentlyAvailable (limit) {
  const c = readLibCache(), all = [];
  for (const svc of ['radarr','sonarr']) {
    const items = c[svc] && Array.isArray(c[svc].items) ? c[svc].items : [];
    for (const x of items) {
      const ready = svc === 'radarr' ? !!x.hasFile
        : !!(x.statistics && Number(x.statistics.episodeFileCount) > 0);
      if (!ready) continue;
      all.push({
        type: svc === 'radarr' ? 'movie' : 'series', service: svc, arrId: x.id,
        title: x.title || '', year: x.year || '', imdbId: x.imdbId || '',
        tmdbId: x.tmdbId || null, tvdbId: x.tvdbId || null, added: x.added || '',
        poster: homePosterFromArr(x),
        progress: svc === 'sonarr' && x.statistics ? {
          downloaded: Number(x.statistics.episodeFileCount) || 0,
          total: Number(x.statistics.episodeCount) || 0
        } : null
      });
    }
  }
  all.sort((a,b) => {
    const at = a.added ? new Date(a.added).getTime() : 0, bt = b.added ? new Date(b.added).getTime() : 0;
    if (bt !== at) return bt - at;
    return String(a.title).localeCompare(String(b.title));
  });
  return all.slice(0, limit || 16);
}
async function homeRecommendations (username, history, favorites) {
  const cfg = readConfig();
  if (!cfg.tmdb.apiKey) return [];
  const cacheKey = username + '|' + (history[0] && (history[0].show || history[0].title) || '') + '|' + favorites.map(x=>x.key).slice(0,5).join(',');
  const old = homeRecCache.get(cacheKey);
  if (old && Date.now() - old.ts < 10 * 60000) return old.items;
  const seeds = [];
  for (const f of favorites) if (f.tmdbId) seeds.push({ type:'tv', id:Number(f.tmdbId), title:f.title });
  for (const h of history.slice(0, 8)) {
    const type = h.type === 'episode' || h.type === 'show' ? 'tv' : 'movie';
    const ids = h.ids || {};
    if (ids.tmdbId) seeds.push({ type, id:Number(ids.tmdbId), title:h.show || h.title });
    else seeds.push({ type, title:h.show || h.title, year:h.year || '' });
  }
  const seenSeeds = new Set(), unique = seeds.filter(x => {
    const k = x.type + '|' + (x.id || normTitle(x.title)); if (seenSeeds.has(k)) return false; seenSeeds.add(k); return true;
  }).slice(0, 2);
  const out = [], seen = new Set();
  for (const seed of unique) {
    let id = seed.id;
    if (!id && seed.title) {
      const d = await tmdbJson('/search/' + (seed.type === 'tv' ? 'tv' : 'movie') + '?query=' + encodeURIComponent(seed.title));
      const hits = d && d.results || [];
      const hit = (seed.year && hits.find(x => String((x.release_date || x.first_air_date || '')).slice(0,4) === String(seed.year))) || hits[0];
      id = hit && hit.id;
    }
    if (!id) continue;
    let d = await tmdbJson('/' + seed.type + '/' + id + '/recommendations?page=1');
    let rows = d && d.results || [];
    if (!rows.length) { d = await tmdbJson('/' + seed.type + '/' + id + '/similar?page=1'); rows = d && d.results || []; }
    for (const r of rows) {
      if (!r.poster_path) continue;
      const k = seed.type + ':' + r.id; if (seen.has(k)) continue; seen.add(k);
      out.push({
        type: seed.type === 'tv' ? 'series' : 'movie', tmdbId: r.id,
        title: r.title || r.name || '', year: String(r.release_date || r.first_air_date || '').slice(0,4),
        poster: 'https://image.tmdb.org/t/p/w342' + r.poster_path,
        overview: String(r.overview || '').slice(0, 300)
      });
      if (out.length >= 16) break;
    }
    if (out.length >= 16) break;
  }
  homeRecCache.set(cacheKey, { ts: Date.now(), items: out });
  if (homeRecCache.size > 100) for (const [k,v] of homeRecCache) if (Date.now() - v.ts > 3600000) homeRecCache.delete(k);
  return out;
}
async function homeDiscover () {
  if (!readConfig().tmdb.apiKey) return [];
  const [mv,tv] = await Promise.all([
    tmdbJson('/movie/now_playing?page=1'),
    tmdbJson('/tv/on_the_air?page=1')
  ]);
  const movies = ((mv && mv.results) || []).filter(x=>x.poster_path).slice(0,8).map(x=>({
    type:'movie',tmdbId:x.id,title:x.title||'',year:String(x.release_date||'').slice(0,4),
    poster:'https://image.tmdb.org/t/p/w342'+x.poster_path
  }));
  const shows = ((tv && tv.results) || []).filter(x=>x.poster_path).slice(0,8).map(x=>({
    type:'series',tmdbId:x.id,title:x.name||'',year:String(x.first_air_date||'').slice(0,4),
    poster:'https://image.tmdb.org/t/p/w342'+x.poster_path
  }));
  const out=[]; for(let i=0;i<Math.max(movies.length,shows.length);i++){ if(movies[i])out.push(movies[i]); if(shows[i])out.push(shows[i]); }
  return out.slice(0,16);
}
let _watchCache = null, _watchMtime = 0;
function readWatchProgress () {
  try {
    const st = fs.statSync(WATCH_PROGRESS_PATH);
    if (_watchCache && st.mtimeMs === _watchMtime) return _watchCache;
    const d = JSON.parse(fs.readFileSync(WATCH_PROGRESS_PATH, 'utf8'));
    _watchMtime = st.mtimeMs;
    return (_watchCache = d && d.users ? d : { version: 1, users: {} });
  } catch (_) { return (_watchCache = { version: 1, users: {} }); }
}
function writeWatchProgress (d) {
  try {
    const tmp = WATCH_PROGRESS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, WATCH_PROGRESS_PATH);
    _watchCache = d;
    try { _watchMtime = fs.statSync(WATCH_PROGRESS_PATH).mtimeMs; } catch (_) { _watchMtime = Date.now(); }
  } catch (e) { logError('watch-progress', e.message, 'write'); }
}
function watchKey (rel) { return crypto.createHash('sha1').update(safeSegments(rel).join('/').toLowerCase()).digest('hex'); }
function watchProgressForPath (username, rel) {
  const u = readWatchProgress().users[String(username || '').toLowerCase()] || {};
  return u[watchKey(rel)] || null;
}
function saveWatchProgress (username, body) {
  const rel = safeSegments(body.path || '').join('/');
  if (!rel) return null;
  const d = readWatchProgress(), uk = String(username || '').toLowerCase();
  const bucket = d.users[uk] || (d.users[uk] = {});
  const key = watchKey(rel), prev = bucket[key] || {};
  const duration = Math.max(0, Number(body.duration) || Number(prev.duration) || 0);
  const position = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, Number(body.position) || 0));
  const pct = duration > 0 ? Math.max(0, Math.min(100, Math.round(position / duration * 1000) / 10)) : 0;
  const completed = !!body.ended || (duration > 0 && pct >= 95);
  const m = body.meta || {};
  const rec = {
    path: rel,
    title: String(m.title || body.title || prev.title || rel.split('/').pop() || 'Media').slice(0, 300),
    show: String(m.show || prev.show || '').slice(0, 300),
    type: ['movie','episode'].includes(String(m.type)) ? String(m.type) : (prev.type || 'movie'),
    season: m.season != null ? Number(m.season) : (prev.season != null ? prev.season : null),
    episode: m.episode != null ? Number(m.episode) : (prev.episode != null ? prev.episode : null),
    year: m.year || prev.year || '',
    poster: String(m.poster || prev.poster || '').slice(0, 1000),
    imdbId: String(m.imdbId || prev.imdbId || '').slice(0, 40),
    tmdbId: m.tmdbId || prev.tmdbId || null,
    tvdbId: m.tvdbId || prev.tvdbId || null,
    position, duration, progressPct: pct, completed, updatedAt: Date.now()
  };
  // Starting a completed title from near the beginning makes it resumable again.
  if (prev.completed && duration > 0 && pct < 80 && !body.ended) rec.completed = false;
  bucket[key] = rec;
  const keys = Object.keys(bucket).sort((a,b)=>(bucket[b].updatedAt||0)-(bucket[a].updatedAt||0));
  for (const k of keys.slice(250)) delete bucket[k];
  writeWatchProgress(d);
  return rec;
}
function watchContinueForUser (username, limit) {
  const bucket = readWatchProgress().users[String(username || '').toLowerCase()] || {};
  return Object.values(bucket)
    .filter(x => !x.completed && Number(x.duration) > 0 && Number(x.position) >= 10 && Number(x.progressPct) < 95)
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))
    .slice(0, Math.max(1, Math.min(50, limit || 18)))
    .map(x => Object.assign({ source: 'mediarr' }, x));
}
function playbackPlanFromProbe (rel, info) {
  if (!info) return { mode:'direct', decision:'Unknown', reason:'probe-failed' };
  const ext = path.extname(String(rel || '')).slice(1).toLowerCase();
  const v = String(info.video || '').toLowerCase(), a = String(info.audio || '').toLowerCase(), pix = String(info.pix || '').toLowerCase();
  const tenBit = /10|12/.test(pix), mp4ish = ['mp4','m4v','mov'].includes(ext), webm = ext === 'webm';
  const directVideo = !tenBit && ((mp4ish && ['h264','av1'].includes(v)) || (webm && ['vp8','vp9','av1'].includes(v)));
  const directAudio = (mp4ish && ['aac','mp3'].includes(a)) || (webm && ['opus','vorbis'].includes(a));
  const direct = directVideo && directAudio, hlsCopyVideo = !tenBit && v === 'h264', hlsCopyAudio = ['aac','mp3'].includes(a);
  if (direct) return { mode:'direct', decision:'Direct play', reason:'browser-compatible', video:v, audio:a, pixelFormat:pix, container:ext||info.format||'', duration:info.duration||0 };
  if (hlsCopyVideo && hlsCopyAudio) return { mode:'hls', decision:'Remux', reason:'container', forceVideo:false, transcodeAudio:false, video:v, audio:a, pixelFormat:pix, container:ext||info.format||'', duration:info.duration||0 };
  if (hlsCopyVideo) return { mode:'hls', decision:'Audio transcode', reason:'audio', forceVideo:false, transcodeAudio:true, video:v, audio:a, pixelFormat:pix, container:ext||info.format||'', duration:info.duration||0 };
  return { mode:'hls', decision:'Video transcode', reason:tenBit?'pixel-format':'video', forceVideo:true, transcodeAudio:!hlsCopyAudio, video:v, audio:a, pixelFormat:pix, container:ext||info.format||'', duration:info.duration||0 };
}
function ffprobeCodecsPromise (input) { return new Promise(resolve => ffprobeCodecs(input, resolve)); }
async function playbackDiagnostics (rel) {
  const cfg = readConfig().webdav || {}, clean = safeSegments(rel).join('/');
  const exists = await mediaRelativeExists(clean);
  const source = isLocalSource() ? 'local' : 'webdav';
  const displayPath = source === 'local' ? (localTarget(clean) || clean) : [cfg.folder || '', clean].filter(Boolean).join('/');
  let plan = { mode:'direct', decision:'Direct play', reason:'probe-unavailable', ffmpeg:!!FFMPEG, ffprobe:!!FFPROBE };
  if (exists && FFPROBE) {
    const input = mediaInput(cfg, clean);
    if (input) {
      const info = await ffprobeCodecsPromise(input);
      plan = Object.assign(playbackPlanFromProbe(clean, info), { ffmpeg:!!FFMPEG, ffprobe:!!FFPROBE });
    }
  }
  return { ok:true, source, sourceLabel:source==='local'?'Local folder':'WebDAV', path:clean, displayPath, exists, plan };
}
async function pathMappingTest (body) {
  const service = body.service === 'sonarr' ? 'sonarr' : 'radarr';
  const arrPath = slashMediaPath(body.arrPath || '');
  if (!arrPath) throw new Error('Enter a full Radarr/Sonarr file path');
  const bits = arrPath.split('/').filter(Boolean), fileName = bits.pop() || '', itemPath = bits.join('/');
  const root = slashMediaPath((readConfig()[service] && readConfig()[service].rootFolderPath) || '');
  const relative = root ? stripMediaRoot(arrPath, root).split('/').slice(1).join('/') || fileName : fileName;
  const candidates = playbackCandidateDetails(arrPath, relative, itemPath, root, service).slice(0, 10);
  let selected = null;
  for (const x of candidates) {
    x.exists = await mediaRelativeExists(x.path);
    if (!selected && x.exists) selected = x;
  }
  return {
    ok:true, service, arrPath, source:isLocalSource()?'local':'webdav',
    sourceRoot:isLocalSource()?(readConfig().webdav.localPath||''):(readConfig().webdav.folder||'/'),
    selected:selected ? selected.path : '',
    candidates
  };
}

async function userHomeData (me) {
  const favorites = userFavs(me.username).slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,20).map(x => Object.assign({}, x, { type: 'series', service: 'sonarr' }));
  const [history, cont, watchlist, upcoming, discover] = await Promise.all([
    homePlexHistory(me.username, 18).catch(e=>({linked:!!getUserPlex(me.username),configured:!!readConfig().plex.url,items:[],error:e.message})),
    homePlexContinue(me.username, 18).catch(e=>({linked:!!getUserPlex(me.username),configured:!!readConfig().plex.url,items:[],error:e.message})),
    homePlexWatchlist(me.username, 18).catch(e=>({linked:!!getUserPlex(me.username),items:[],error:e.message})),
    homeUpcoming(me.username).catch(()=>[]),
    homeDiscover().catch(()=>[])
  ]);
  const recs = await homeRecommendations(me.username, history.items || [], favorites).catch(()=>[]);
  return {
    ok:true, generatedAt:Date.now(),
    user:{ username:me.username, role:me.role, dailyLimit:me.dailyLimit||0, addedToday:me.addedToday||addsTodayCount(me.username) },
    plex:{
      linked:!!(history.linked || cont.linked || watchlist.linked),
      configured:!!readConfig().plex.url,
      account:history.account || cont.account || '',
      continueWatching:cont.items || [], recentlyWatched:history.items || [], watchlist:watchlist.items || [],
      errors:[history.error,cont.error,watchlist.error].filter(Boolean)
    },
    favorites, upcoming,
    continueWatching: watchContinueForUser(me.username,18),
    requests:homeRequests(me.username,18),
    recentlyAvailable:homeRecentlyAvailable(18),
    recommendations:recs,
    discover
  };
}

function startOfToday () { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
// Count only limit-relevant actions (adds + downloads) toward the daily limit — never plays.
function addsTodayCount (username) { const t = startOfToday(); return readAdds().adds.filter(e => e.username === username && e.ts >= t && e.type !== 'play').length; }

// Best-effort client IP. Behind Caddy/nginx the real client is in X-Forwarded-For (first hop);
// otherwise fall back to the socket address. Strips the IPv4-in-IPv6 "::ffff:" prefix.
function clientIp (req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  let ip = xff || (req.socket && req.socket.remoteAddress) || '';
  if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7);
  return ip;
}
// A single media play triggers many range/segment requests, so throttle to one log entry
// per user+file per 60s (re-watching later logs a fresh play, which is fine for monitoring).
const recentPlays = new Map();
function logPlayOnce (user, rel, req) {
  if (!user) return;
  const key = user.username + '|' + rel, now = Date.now();
  if (now - (recentPlays.get(key) || 0) < 60000) return;
  recentPlays.set(key, now);
  if (recentPlays.size > 500) { for (const [k, t] of recentPlays) if (now - t > 120000) recentPlays.delete(k); }
  logAdd({ ts: now, username: user.username, role: user.role, service: 'webdav', type: 'play', title: (rel || '').split('/').pop(), year: '', ip: clientIp(req) });
}

/* ---------- arr connection test (uses typed creds, falls back to stored) ---------- */
async function testService (svc, url, key) {
  const stored = readConfig()[svc];
  const base = normUrl(url || stored.url);
  const apiKey = key || stored.apiKey;
  if (!base || !apiKey) throw new Error('Missing URL or API key');
  const headers = { 'X-Api-Key': apiKey };

  const status  = await upstream(base + '/api/v3/system/status', { headers });
  if (status.status === 401) throw new Error('Unauthorized — check the API key');
  if (status.status >= 400)  throw new Error('Server returned HTTP ' + status.status);
  const sys = JSON.parse(status.body.toString() || '{}');

  const prof = await upstream(base + '/api/v3/qualityprofile', { headers });
  const fold = await upstream(base + '/api/v3/rootfolder', { headers });
  const profiles = JSON.parse(prof.body.toString() || '[]');
  const folders  = JSON.parse(fold.body.toString() || '[]');

  return {
    name: sys.instanceName || sys.appName || svc,
    version: sys.version || '',
    profiles: profiles.map(p => ({ id: p.id, name: p.name })),
    folders:  folders.map(f => ({ path: f.path, freeSpace: f.freeSpace || 0 }))
  };
}

async function testTmdb (key) {
  const stored = readConfig().tmdb;
  const useKey = key || stored.apiKey;
  if (!useKey) throw new Error('Missing API key');
  const r = await upstream(TMDB + '/configuration?api_key=' + encodeURIComponent(useKey));
  if (r.status === 401) throw new Error('Invalid TMDB API key');
  if (r.status >= 400)  throw new Error('TMDB returned HTTP ' + r.status);
  return { name: 'TMDB', version: '' };
}

async function testPlex (url, token) {
  const stored = readConfig().plex;
  const base = normUrl(url || stored.url);
  const tok = token || stored.token;
  if (!base || !tok) throw new Error('Missing URL or token');
  const r = await upstream(base + '/identity', { headers: { 'X-Plex-Token': tok, 'Accept': 'application/json' } });
  if (r.status === 401) throw new Error('Unauthorized — check the Plex token');
  if (r.status >= 400)  throw new Error('Plex returned HTTP ' + r.status);
  let mc = {};
  try { mc = (JSON.parse(r.body.toString() || '{}').MediaContainer) || {}; } catch (e) {}
  return { name: 'Plex', version: mc.version || '' };
}

// Privacy: only first 4 chars of the username, and never expose IP / addresses.
function maskUser (name) {
  const n = String(name || '').trim();
  if (!n) return 'User';
  return n.slice(0, 4) + (n.length > 4 ? '…' : '');
}
// Admin-only technical detail: is Plex transcoding, and at what bitrate/quality.
function sessionTech (s) {
  const media = (s.Media && s.Media[0]) || {};
  const part = (media.Part && media.Part[0]) || {};
  const ts = s.TranscodeSession || part.TranscodeSession || null;
  const dec = (part.decision || media.decision || '').toLowerCase();
  const vDec = (ts && ts.videoDecision) || '';
  const aDec = (ts && ts.audioDecision) || '';
  let mode = 'Direct play';
  if (ts) {
    if (vDec === 'transcode') mode = 'Transcode';
    else if (aDec === 'transcode') mode = 'Direct stream (audio only)';
    else mode = 'Direct stream';
  } else if (dec === 'transcode') mode = 'Transcode';
  else if (dec === 'copy' || dec === 'directstream') mode = 'Direct stream';
  const kbps = Number(media.bitrate) || 0;                       // source bitrate
  const outKbps = ts ? (Number(ts.bitrate) || 0) : kbps;         // what's actually going out
  const t = {
    mode,
    videoDecision: vDec || (dec || 'directplay'),
    audioDecision: aDec || '',
    container: media.container || part.container || '',
    videoCodec: media.videoCodec || '',
    audioCodec: media.audioCodec || '',
    audioChannels: media.audioChannels || null,
    resolution: media.videoResolution ? String(media.videoResolution).toUpperCase() : '',
    width: media.width || null, height: media.height || null,
    sourceBitrateKbps: kbps,
    streamBitrateKbps: outKbps,
    throttled: ts ? !!ts.throttled : false,
    speed: ts && ts.speed != null ? Number(ts.speed) : null,     // <1 means the server can't keep up
    hwTranscode: ts ? !!(ts.transcodeHwEncoding || ts.transcodeHwDecoding) : false,
    progressPct: ts && ts.progress != null ? Math.round(Number(ts.progress)) : null
  };
  if (ts) {
    t.transcodeTo = [ts.videoCodec, ts.audioCodec].filter(Boolean).join(' / ');
    if (ts.width && ts.height) t.transcodeSize = ts.width + 'x' + ts.height;
  }
  return t;
}
function sanitizeSession (s) {
  const player = s.Player || {};
  const user = s.User || {};
  const out = {
    type: s.type,
    user: maskUser(user.title || (user.id != null ? 'id' + user.id : '')),
    state: player.state || '',
    device: player.product || player.title || player.platform || '',   // NOT player.address
    progress: (s.duration ? Math.min(100, Math.max(0, Math.round((Number(s.viewOffset || 0) / Number(s.duration)) * 100))) : null)
  };
  if (s.type === 'episode') {
    out.show = s.grandparentTitle || '';
    out.season = (s.parentIndex != null ? s.parentIndex : null);
    out.episode = (s.index != null ? s.index : null);
    out.episodeTitle = s.title || '';
  } else if (s.type === 'movie') {
    out.title = s.title || '';
    out.year = s.year || '';
  } else {
    out.title = s.title || s.grandparentTitle || '';
    out.subtitle = s.parentTitle || s.grandparentTitle || '';
  }
  return out;
}
/* ---------- Plex stream blocking by IP ---------- */
// Rules accept a plain IP (1.2.3.4), a wildcard (1.2.3.*), or CIDR (1.2.3.0/24).
function ipToInt (ip) {
  const p = String(ip).trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const seg of p) { const v = Number(seg); if (!Number.isInteger(v) || v < 0 || v > 255) return null; n = (n * 256) + v; }
  return n;
}
function ipMatches (ip, rule) {
  ip = String(ip || '').trim(); rule = String(rule || '').trim();
  if (!ip || !rule) return false;
  if (rule.includes('/')) {
    const [net, bitsRaw] = rule.split('/');
    const bits = Number(bitsRaw);
    const a = ipToInt(ip), b = ipToInt(net);
    if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xFFFFFFFF : (~((1 << (32 - bits)) - 1)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  if (rule.includes('*')) {
    const re = new RegExp('^' + rule.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return re.test(ip);
  }
  return ip.toLowerCase() === rule.toLowerCase();
}
function blockedRuleFor (ip) {
  const cfg = readConfig().plexBlock;
  if (!cfg.enabled || !Array.isArray(cfg.ips)) return null;
  for (const rule of cfg.ips) if (ipMatches(ip, rule)) return rule;
  return null;
}
// Ask Plex to end a session, showing the custom message on the client.
async function plexTerminate (sessionId, reason) {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token || !sessionId) return { ok: false, message: 'missing session or Plex config' };
  const url = normUrl(cfg.url) + '/status/sessions/terminate?sessionId=' + encodeURIComponent(sessionId)
            + '&reason=' + encodeURIComponent(String(reason || '').slice(0, 300));
  try {
    const up = await upstream(url, { headers: { 'X-Plex-Token': cfg.token, Accept: 'application/json' }, timeout: 20000 });
    if (up.status >= 400) return { ok: false, message: 'Plex HTTP ' + up.status };
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}
const BLOCK_LOG_PATH = path.join(DATA_DIR, 'blocked.json');
let blockLog = null;
function readBlockLog () { if (blockLog) return blockLog; try { blockLog = JSON.parse(fs.readFileSync(BLOCK_LOG_PATH, 'utf8')); } catch (e) { blockLog = { events: [] }; } return blockLog; }
function logBlock (ev) { const b = readBlockLog(); b.events.unshift(ev); if (b.events.length > 500) b.events.length = 500; try { fs.writeFileSync(BLOCK_LOG_PATH, JSON.stringify(b)); } catch (e) {} }
// Watch active sessions and end any coming from a blocked address.
let blockRecent = new Map();
async function enforcePlexBlocks () {
  const cfg = readConfig();
  if (!cfg.plexBlock.enabled || !cfg.plex.url || !cfg.plex.token) return { checked: 0, ended: 0 };
  let mc = {};
  try {
    const up = await upstream(normUrl(cfg.plex.url) + '/status/sessions', { headers: { 'X-Plex-Token': cfg.plex.token, Accept: 'application/json' }, timeout: 20000 });
    if (up.status >= 400) return { checked: 0, ended: 0, error: 'Plex HTTP ' + up.status };
    mc = (JSON.parse(up.body.toString('utf8') || '{}').MediaContainer) || {};
  } catch (e) { logError('plex:sessions', e.message, 'while checking for blocked streams'); return { checked: 0, ended: 0, error: e.message }; }
  const list = mc.Metadata || [];
  let ended = 0;
  for (const s of list) {
    const player = s.Player || {};
    const ip = player.address || player.remotePublicAddress || '';
    const rule = blockedRuleFor(ip);
    if (!rule) continue;
    const sid = (s.Session && s.Session.id) || player.machineIdentifier || s.sessionKey;
    if (!sid) continue;
    const key = String(sid);
    if (Date.now() - (blockRecent.get(key) || 0) < 20000) continue;   // don't spam the same session
    blockRecent.set(key, Date.now());
    const r = await plexTerminate(sid, cfg.plexBlock.message);
    const user = (s.User && s.User.title) || '';
    // full detail of what was attempted, so the log is useful after the fact
    const pad = n => String(n).padStart(2, '0');
    const item = s.type === 'episode'
      ? ((s.grandparentTitle || '') + (s.parentIndex != null && s.index != null ? ' — S' + pad(s.parentIndex) + 'E' + pad(s.index) : '') + (s.title ? ' · ' + s.title : ''))
      : ((s.title || '') + (s.year ? ' (' + s.year + ')' : ''));
    const deviceBits = [player.product, player.title, player.platform].filter(Boolean);
    const device = [...new Set(deviceBits)].join(' · ');
    logBlock({
      ts: Date.now(), ip, rule,
      user: user || 'unknown',
      userId: (s.User && s.User.id) || null,
      device: device || 'unknown device',
      platform: player.platform || '',
      player: player.title || '',
      product: player.product || '',
      item: item || '(unknown)',
      type: s.type || '',
      library: s.librarySectionTitle || '',
      remote: !!player.remotePublicAddress && player.remotePublicAddress !== player.address,
      publicIp: player.remotePublicAddress || '',
      ok: r.ok, error: r.ok ? '' : (r.message || '')
    });
    if (r.ok) { ended++; notify('blocked', '⛔ Stream blocked', (user || 'unknown') + ' from ' + ip + ' — ' + (s.grandparentTitle || s.title || ''), 'warn'); }
  }
  if (blockRecent.size > 200) { const now = Date.now(); for (const [k, t] of blockRecent) if (now - t > 120000) blockRecent.delete(k); }
  return { checked: list.length, ended };
}
setInterval(() => { enforcePlexBlocks().catch(() => {}); }, 15000).unref?.();
// Drop expired login tokens so the sessions map can't grow without bound on a long-running server.
setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of sessions) if (!s || s.expires < now) sessions.delete(tok);
  for (const [k, t] of recentPlays) if (now - t > 300000) recentPlays.delete(k);
  for (const [k, t] of blockRecent) if (now - t > 300000) blockRecent.delete(k);
}, 300000).unref?.();

async function plexSessions (withTech) {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return { configured: false, count: 0, sessions: [] };
  try {
    const up = await upstream(normUrl(cfg.url) + '/status/sessions', { headers: { 'X-Plex-Token': cfg.token, 'Accept': 'application/json' } });
    if (up.status >= 400) return { configured: true, error: 'Plex HTTP ' + up.status, count: 0, sessions: [] };
    let mc = {};
    try { mc = (JSON.parse(up.body.toString() || '{}').MediaContainer) || {}; } catch (e) {}
    const sessions = (mc.Metadata || []).map(m => {
      const o = sanitizeSession(m);
      if (withTech) o.tech = sessionTech(m);        // admins only
      return o;
    });
    return { configured: true, count: sessions.length, sessions };
  } catch (e) {
    return { configured: true, error: e.message, count: 0, sessions: [] };
  }
}

/* ---------- health monitoring (background) ---------- */
let healthState = (function () {
  try { return JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8')); }
  catch (e) { return { services: {}, events: [] }; }
})();
function saveHealth () { try { fs.writeFileSync(HEALTH_PATH, JSON.stringify(healthState, null, 2)); } catch (e) {} }

function monitoredTargets () {
  const c = readConfig(); const t = [];
  if (c.plex.url && c.plex.token)     t.push({ name: 'plex',   url: normUrl(c.plex.url) + '/identity',          headers: { 'X-Plex-Token': c.plex.token, 'Accept': 'application/json' } });
  if (c.radarr.url && c.radarr.apiKey) t.push({ name: 'radarr', url: normUrl(c.radarr.url) + '/api/v3/system/status', headers: { 'X-Api-Key': c.radarr.apiKey } });
  if (c.sonarr.url && c.sonarr.apiKey) t.push({ name: 'sonarr', url: normUrl(c.sonarr.url) + '/api/v3/system/status', headers: { 'X-Api-Key': c.sonarr.apiKey } });
  return t;
}
function recordStatus (name, up, meta) {
  const now = Date.now();
  const prev = healthState.services[name] || null;
  const prevUp = prev ? prev.up : null;
  if (prevUp !== up) {
    if (up === false) {
      healthState.events.unshift({ service: name, downAt: now, upAt: null });
      if (healthState.events.length > MAX_EVENTS) healthState.events.length = MAX_EVENTS;
      notify('serviceDown', '🔴 ' + name + ' is down', meta.error || 'Not responding', 'bad');
    } else if (up === true && prevUp === false) {
      const ev = healthState.events.find(e => e.service === name && e.upAt === null);
      if (ev) { ev.upAt = now; ev.durationMs = now - ev.downAt; }
      const mins = ev && ev.durationMs ? Math.round(ev.durationMs / 60000) : 0;
      notify('serviceDown', '🟢 ' + name + ' is back', mins ? ('Was down for about ' + (mins < 1 ? 'a minute' : mins + ' minutes')) : 'Recovered', 'good');
    }
  }
  healthState.services[name] = {
    up,
    since: (prevUp === up && prev) ? prev.since : now,
    lastChecked: now,
    version: meta.version || (prev && prev.version) || '',
    responseMs: meta.responseMs,
    error: meta.error || ''
  };
  saveHealth();
  try { realtimePush('health', { service: name, status: healthState.services[name] }); } catch (_) {}
}
async function checkOne (t) {
  const start = Date.now();
  let up = false, version = '', error = '';
  try {
    const r = await upstream(t.url, { headers: t.headers });
    if (r.status >= 200 && r.status < 400) {
      up = true;
      try { const j = JSON.parse(r.body.toString() || '{}'); version = j.version || (j.MediaContainer || {}).version || ''; } catch (e) {}
    } else { error = 'HTTP ' + r.status; }
  } catch (e) { error = e.message; }
  recordStatus(t.name, up, { version, responseMs: Date.now() - start, error });
}
async function runAllChecks () {
  const targets = monitoredTargets();
  // drop state for services no longer configured
  for (const k of Object.keys(healthState.services)) if (!targets.find(t => t.name === k)) delete healthState.services[k];
  await Promise.all(targets.map(checkOne));
}

/* ---------- proxy a request to an arr server or cinemeta ---------- */
async function proxyArr (svc, subPath, req, res) {
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return sendJSON(res, 400, { message: svc + ' is not configured yet' });
  const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : null;

  // An "add" is a POST to the movie/series collection endpoint.
  const cleanPath = subPath.split('?')[0];
  const isAdd = req.method === 'POST' &&
    ((svc === 'radarr' && cleanPath === '/api/v3/movie') || (svc === 'sonarr' && cleanPath === '/api/v3/series'));

  const user = currentUser(req);
  // Regular users may only read (GET) and add (POST to the collection). No edits, monitor changes, commands, or deletes.
  if (user && user.role !== 'admin' && req.method !== 'GET' && !isAdd) {
    return sendJSON(res, 403, { message: 'Editing library options and monitoring is restricted to admins.' });
  }
  if (isAdd && user && user.role !== 'admin' && user.dailyLimit > 0) {
    const used = addsTodayCount(user.username);
    if (used >= user.dailyLimit) {
      return sendJSON(res, 429, { message: `Daily add limit reached (${used}/${user.dailyLimit}). Ask an admin to raise it or try again tomorrow.` });
    }
  }

  const target = normUrl(cfg.url) + subPath;
  try {
    const up = await upstream(target, {
      method: req.method,
      headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' },
      body
    });
    // log + count only successful adds
    if (isAdd && up.status >= 200 && up.status < 300 && user) {
      let title = '', year = '', createdItem = null;
      try { const b = JSON.parse(body || '{}'); title = b.title || ''; year = b.year || ''; } catch (e) {}
      try { createdItem = JSON.parse(up.body.toString('utf8') || '{}'); } catch (e) {}
      logAdd({ ts: Date.now(), username: user.username, role: user.role, service: svc, type: svc === 'radarr' ? 'movie' : 'series', title, year, ip: clientIp(req) });
      notify('added', (svc === 'radarr' ? '🎬 ' : '📺 ') + title + (year ? ' (' + year + ')' : ''), 'Added to ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' by ' + user.username, 'good');
      if (createdItem && createdItem.id) upsertLibCacheItem(svc, createdItem);
      if (svc === 'sonarr') scheduleLibraryReconcile('sonarr', 1500);
      liveIdx[svc] = { ts: 0, ids: null };
      realtimePush('arr.added', { service: svc, title, year, user: user.username, id: createdItem && createdItem.id || null });   // force a fresh "already added?" check next time
    }
    res.writeHead(up.status, { 'Content-Type': up.headers['content-type'] || 'application/json' });
    res.end(up.body);
  } catch (e) {
    sendJSON(res, 502, { message: 'Could not reach ' + svc + ': ' + e.message });
  }
}
async function proxyCinemeta (subPath, res) {
  try {
    const up = await upstream(CINEMETA + subPath, { headers: { 'Accept': 'application/json' } });
    res.writeHead(up.status, { 'Content-Type': 'application/json' });
    res.end(up.body);
  } catch (e) {
    sendJSON(res, 502, { message: 'Cinemeta error: ' + e.message });
  }
}
async function proxyTmdb (subPath, res) {
  const key = readConfig().tmdb.apiKey;
  if (!key) return sendJSON(res, 400, { message: 'TMDB is not configured yet' });
  const sep = subPath.includes('?') ? '&' : '?';
  const target = TMDB + subPath + sep + 'api_key=' + encodeURIComponent(key);
  try {
    const up = await upstream(target, { headers: { 'Accept': 'application/json' } });
    res.writeHead(up.status, { 'Content-Type': 'application/json' });
    res.end(up.body);
  } catch (e) {
    sendJSON(res, 502, { message: 'TMDB error: ' + e.message });
  }
}
async function plexScan (res) {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return sendJSON(res, 400, { message: 'Plex is not configured yet' });
  const base = normUrl(cfg.url);
  const headers = { 'X-Plex-Token': cfg.token, 'Accept': 'application/json' };
  try {
    const list = await upstream(base + '/library/sections', { headers });
    if (list.status === 401) return sendJSON(res, 502, { message: 'Unauthorized — check the Plex token' });
    if (list.status >= 400) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + list.status });
    let dirs = [];
    try { dirs = (JSON.parse(list.body.toString('utf8')).MediaContainer || {}).Directory || []; } catch (e) {}
    if (!dirs.length) return sendJSON(res, 200, { scanned: 0, sections: [], message: 'No Plex libraries found to scan.' });
    const sections = [];
    for (const d of dirs) {
      try { await upstream(base + '/library/sections/' + encodeURIComponent(d.key) + '/refresh', { headers }); sections.push(d.title || ('Section ' + d.key)); }
      catch (e) { /* skip a single failed section, keep going */ }
    }
    return sendJSON(res, 200, { scanned: sections.length, sections });
  } catch (e) {
    return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message });
  }
}

async function proxyPlex (subPath, res) {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return sendJSON(res, 400, { message: 'Plex is not configured yet' });
  const target = normUrl(cfg.url) + subPath;
  try {
    const up = await upstream(target, { headers: { 'X-Plex-Token': cfg.token, 'Accept': 'application/json' } });
    res.writeHead(up.status, { 'Content-Type': up.headers['content-type'] || 'application/json' });
    res.end(up.body);
  } catch (e) {
    sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message });
  }
}

/* ---------- WebDAV (browse a folder, download files against the daily limit) ---------- */
const VIDEO_EXT = ['mkv','mp4','avi','mov','m4v','wmv','flv','webm','mpg','mpeg','ts','m2ts','vob','ogv','3gp','divx','mts','m2v','mpv','rmvb','rm','asf','f4v','mxf','iso','m4p','ogm','dv','amv','svq','qt','yuv','mp2','mpe','3g2'];
/* ---------- local folder source (alternative to WebDAV) ---------- */
function isLocalSource () { const c = readConfig().webdav; return c.source === 'local' && !!c.localPath; }
// Resolve a browse path inside the configured folder — never above it.
function localTarget (rel) {
  const cfg = readConfig().webdav;
  const root = path.resolve(cfg.localPath || '');
  if (!root) return null;
  const segs = safeSegments(cfg.folder).concat(safeSegments(rel));
  const full = path.resolve(root, segs.join(path.sep));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) return null;   // escape attempt
  return full;
}
function localList (rel, res) {
  const dir = localTarget(rel);
  if (!dir) return sendJSON(res, 400, { message: 'Local folder is not configured' });
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) {
    if (e.code === 'ENOENT') return sendJSON(res, 502, { message: 'Folder not found: ' + dir });
    if (e.code === 'EACCES') return sendJSON(res, 502, { message: 'Permission denied reading ' + dir + ' — check the folder is readable by the MEDIARR user' });
    logError('downloads', e.message, 'reading ' + dir);
    return sendJSON(res, 502, { message: 'Could not read folder: ' + e.message });
  }
  const folders = [], files = [];
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith('.')) continue;
    try {
      // follow symlinks so linked folders/files behave like real ones
      let isDir = ent.isDirectory(), isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        const st2 = fs.statSync(path.join(dir, name));
        isDir = st2.isDirectory(); isFile = st2.isFile();
      }
      if (isDir) { folders.push({ name }); continue; }
      if (!isFile) continue;
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!VIDEO_EXT.includes(ext)) continue;          // same as WebDAV: only list playable videos
      const st = fs.statSync(path.join(dir, name));
      files.push({ name, size: st.size });
    } catch (e) { /* skip unreadable entries */ }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  sendJSON(res, 200, { path: safeSegments(rel).join('/'), folders, files });
}
function localSendFile (rel, req, res, asAttachment) {
  const file = localTarget(rel);
  if (!file) { res.writeHead(400); return res.end('Bad path'); }
  let st;
  try { st = fs.statSync(file); } catch (e) { res.writeHead(404); return res.end('Not found'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('Not found'); }
  const name = path.basename(file);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const type = VIDEO_MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  if (asAttachment) headers['Content-Disposition'] = 'attachment; filename="' + name.replace(/[\r\n"]/g, '') + '"';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      const rs = fs.createReadStream(file, { start, end });
      rs.on('error', () => res.end()); return rs.pipe(res);
    }
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const rs = fs.createReadStream(file);
  rs.on('error', () => res.end());
  rs.pipe(res);
}

// What ffmpeg/ffprobe should read: a local file path, or an authenticated WebDAV URL.
function mediaInput (cfg, rel) {
  if (isLocalSource()) return localTarget(rel);
  try {
    const du = new URL(webdavTarget(cfg, rel));
    if (cfg.username) { du.username = encodeURIComponent(cfg.username); du.password = encodeURIComponent(cfg.password || ''); }
    return du.toString();
  } catch (e) { return null; }
}
function webdavAuthHeader (cfg) { return 'Basic ' + Buffer.from((cfg.username || '') + ':' + (cfg.password || '')).toString('base64'); }
function encodePath (p) { return p.split('/').map(s => encodeURIComponent(s)).join('/'); }
// turn a user-supplied relative path into safe segments (no traversal)
function safeSegments (rel) {
  return String(rel || '').split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..');
}
function webdavTarget (cfg, rel) {
  const base = normUrl(cfg.url);
  const folderSegs = safeSegments(cfg.folder);
  const relSegs = safeSegments(rel);
  const all = folderSegs.concat(relSegs);
  return base + (all.length ? '/' + encodePath(all.join('/')) : '/');
}
function parsePropfind (xml) {
  const out = [];
  const blocks = xml.match(/<(?:\w+:)?response[\s>][\s\S]*?<\/(?:\w+:)?response>/gi) || [];
  for (const b of blocks) {
    const hrefM = b.match(/<(?:\w+:)?href[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/i);
    if (!hrefM) continue;
    let href = hrefM[1].trim();
    let pathname = href;
    try { pathname = new URL(href, 'http://x').pathname; } catch (e) {}
    let decoded; try { decoded = decodeURIComponent(pathname); } catch (e) { decoded = pathname; }
    const isDir = /<(?:\w+:)?collection\b/i.test(b);
    const name = decoded.replace(/\/+$/, '').split('/').pop() || '';
    const lenM = b.match(/<(?:\w+:)?getcontentlength[^>]*>(\d+)<\/(?:\w+:)?getcontentlength>/i);
    const ctM  = b.match(/<(?:\w+:)?getcontenttype[^>]*>([\s\S]*?)<\/(?:\w+:)?getcontenttype>/i);
    out.push({ name, isDir, path: decoded.replace(/\/+$/, ''), size: lenM ? Number(lenM[1]) : 0, ctype: ctM ? ctM[1].trim() : '' });
  }
  return out;
}
async function webdavList (rel, res) {
  if (isLocalSource()) return localList(rel, res);
  const cfg = readConfig().webdav;
  if (!cfg.url || !cfg.username) return sendJSON(res, 400, { message: 'WebDAV is not configured yet' });
  const target = webdavTarget(cfg, rel);
  try {
    const up = await upstream(target.endsWith('/') ? target : target + '/', {
      method: 'PROPFIND',
      headers: { Authorization: webdavAuthHeader(cfg), Depth: '1', 'Content-Type': 'application/xml', Accept: 'application/xml' }
    });
    if (up.status === 401) return sendJSON(res, 502, { message: 'WebDAV unauthorized — check username/password' });
    if (up.status === 404) return sendJSON(res, 502, { message: 'Folder not found on the WebDAV server' });
    if (up.status >= 400)  return sendJSON(res, 502, { message: 'WebDAV returned HTTP ' + up.status });
    let entries = parsePropfind(up.body.toString('utf8'));
    // drop the folder itself (the depth-0 self entry) — it's the one whose name matches the last requested segment or is empty
    const reqSegs = safeSegments(readConfig().webdav.folder).concat(safeSegments(rel));
    const selfName = reqSegs.length ? reqSegs[reqSegs.length - 1] : '';
    let seenSelf = false;
    entries = entries.filter(e => { if (!seenSelf && (e.name === selfName || e.name === '')) { seenSelf = true; return false; } return true; });
    const folders = entries.filter(e => e.isDir).map(e => ({ name: e.name }));
    const isVideo = e => VIDEO_EXT.includes((e.name.split('.').pop() || '').toLowerCase()) || /^video\//i.test(e.ctype);
    const files = entries.filter(e => !e.isDir && isVideo(e)).map(e => ({ name: e.name, size: e.size }));
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return sendJSON(res, 200, { path: safeSegments(rel).join('/'), folders, files });
  } catch (e) {
    return sendJSON(res, 502, { message: 'Could not reach WebDAV: ' + e.message });
  }
}
// stream a file from WebDAV to the browser as a download
function webdavDownload (rel, res, user, isHead, req) {
  if (isLocalSource()) {
    const f = localTarget(rel);
    if (!f) { res.writeHead(400); return res.end('Bad path'); }
    if (user) {
      try {
        const st = fs.statSync(f);
        logAdd({ ts: Date.now(), username: user.username, role: user.role, service: 'webdav', type: 'download', title: path.basename(f), year: '', ip: clientIp(req) });
      } catch (e) {}
    }
    return localSendFile(rel, req, res, true);
  }
  const cfg = readConfig().webdav;
  if (!cfg.url || !cfg.username) { res.writeHead(400); return res.end('WebDAV is not configured'); }
  const segs = safeSegments(rel);
  if (!segs.length) { res.writeHead(400); return res.end('No file specified'); }
  // enforce per-user daily limit (admins / dailyLimit 0 are unlimited)
  if (user && user.role !== 'admin' && user.dailyLimit > 0) {
    const used = addsTodayCount(user.username);
    if (used >= user.dailyLimit) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: `Daily limit reached (${used}/${user.dailyLimit}). Ask an admin to raise it or try again tomorrow.` })); }
  }
  const filename = segs[segs.length - 1];
  if (isHead) { res.writeHead(200); return res.end(); }   // preflight: quota ok
  const mode = wmode(cfg.mode);

  // REDIRECT / EMBED: count it, then send the browser straight to the WebDAV server (MEDIARR never relays the bytes).
  if (mode !== 'proxy') {
    let loc;
    try {
      const du = new URL(webdavTarget(cfg, rel));
      if (mode === 'embed' && cfg.username) { du.username = encodeURIComponent(cfg.username); du.password = encodeURIComponent(cfg.password || ''); }
      // mode 'redirect': no credentials in the URL — the browser authenticates to WebDAV itself (native login prompt, cached per session)
      loc = du.toString();
    } catch (e) { res.writeHead(400); return res.end('Bad path'); }
    if (user) logAdd({ ts: Date.now(), username: user.username, role: user.role, service: 'webdav', type: 'download', title: filename, year: '', ip: clientIp(req) });
    res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store' });
    return res.end();
  }

  // PROXY mode: stream the file through MEDIARR.
  const target = webdavTarget(cfg, rel);
  let u; try { u = new URL(target); } catch (e) { res.writeHead(400); return res.end('Bad path'); }
  const lib = u.protocol === 'https:' ? https : http;
  const rq = lib.request({ method: 'GET', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers: { Authorization: webdavAuthHeader(cfg) }, timeout: 30000 }, up => {
    if (up.statusCode >= 400) { up.resume(); res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: 'WebDAV returned HTTP ' + up.statusCode })); }
    // count this download against the user's daily total
    if (user) logAdd({ ts: Date.now(), username: user.username, role: user.role, service: 'webdav', type: 'download', title: filename, year: '', ip: clientIp(req) });
    const h = { 'Content-Type': up.headers['content-type'] || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + filename.replace(/[\r\n"]/g, '') + '"' };
    if (up.headers['content-length']) h['Content-Length'] = up.headers['content-length'];
    res.writeHead(200, h);
    up.pipe(res);
  });
  rq.on('error', err => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'WebDAV error: ' + err.message })); } else { res.end(); } });
  rq.on('timeout', () => rq.destroy(new Error('Connection timed out')));
  rq.end();
}
const VIDEO_MIME = { mp4:'video/mp4', m4v:'video/mp4', webm:'video/webm', ogv:'video/ogg', mov:'video/quicktime', mkv:'video/x-matroska', avi:'video/x-msvideo', ts:'video/mp2t', m2ts:'video/mp2t', mpg:'video/mpeg', mpeg:'video/mpeg', wmv:'video/x-ms-wmv', flv:'video/x-flv', '3gp':'video/3gpp' };
// Stream a video for in-browser playback. Always proxies (so the <video> element is authenticated)
// and forwards Range requests so seeking works. Does NOT count against the daily limit (it's a preview, not a kept download).
function webdavStream (rel, req, res) {
  const cfg = readConfig().webdav;
  const local = isLocalSource();
  if (!local && (!cfg.url || !cfg.username)) { res.writeHead(400); return res.end('WebDAV is not configured'); }
  const segs = safeSegments(rel);
  if (!segs.length) { res.writeHead(400); return res.end('No file specified'); }
  const name = segs[segs.length - 1];
  if (!req.headers.range || /^bytes=0-/.test(req.headers.range)) logPlayOnce(currentUser(req), rel, req);   // log at playback start, not every seek
  let q = {}; try { q = new URL(req.url, 'http://x').searchParams; } catch (e) { q = new URLSearchParams(); }
  const aidx = q.get('aidx');
  const wantTranscode = (q.get('transcode') === '1') || (q.get('vc') === '1') || (aidx != null && aidx !== '') || cfg.transcode;
  if (wantTranscode && FFMPEG) return webdavTranscode(cfg, rel, name, { ac: q.get('ac'), vc: q.get('vc'), aidx }, req, res);
  if (local) return localSendFile(rel, req, res, false);   // direct play straight off disk (range-seekable)
  let u; try { u = new URL(webdavTarget(cfg, rel)); } catch (e) { res.writeHead(400); return res.end('Bad path'); }
  const lib = u.protocol === 'https:' ? https : http;
  const headers = { Authorization: webdavAuthHeader(cfg) };
  if (req.headers.range) headers.Range = req.headers.range;   // forward range for seeking
  const rq = lib.request({ method: 'GET', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers, timeout: 30000 }, up => {
    if (up.statusCode >= 400) { up.resume(); res.writeHead(up.statusCode === 404 ? 404 : 502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: 'WebDAV returned HTTP ' + up.statusCode })); }
    const ext = (name.split('.').pop() || '').toLowerCase();
    const h = {
      'Content-Type': up.headers['content-type'] || VIDEO_MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': up.headers['accept-ranges'] || 'bytes',
      'Cache-Control': 'no-store'
    };
    if (up.headers['content-length']) h['Content-Length'] = up.headers['content-length'];
    if (up.headers['content-range'])  h['Content-Range']  = up.headers['content-range'];
    res.writeHead(up.statusCode, h);   // 200 (full) or 206 (partial)
    up.pipe(res);
  });
  rq.on('error', err => { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'WebDAV error: ' + err.message })); } else { res.end(); } });
  rq.on('timeout', () => rq.destroy(new Error('Connection timed out')));
  req.on('close', () => rq.destroy());   // stop pulling from WebDAV if the player disconnects
  rq.end();
}
// Transcode on the fly so incompatible files play in the browser. Probes the source first and re-encodes
// only what the browser can't handle: video → H.264 (HEVC/H.265, MPEG-2, VC-1, 10-bit Hi10P, …) and/or
// audio → AAC (AC3/E-AC3/DTS/TrueHD, multichannel). Compatible streams are copied to save CPU.
// opts: { ac:'2' downmix audio to stereo, vc:'1' force video re-encode }. Live transcode — seeking is limited.
const VIDEO_OK = ['h264', 'vp8', 'vp9', 'av1'];
const AUDIO_OK = ['aac', 'mp3'];
function ffprobeCodecs (inputUrl, cb) {
  if (!FFPROBE) return cb(null);
  let fp; try { fp = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,pix_fmt', '-of', 'json', inputUrl]); } catch (e) { return cb(null); }
  let out = ''; const t = setTimeout(() => { try { fp.kill('SIGKILL'); } catch (e) {} }, 12000);
  fp.stdout.on('data', d => { out += d; }); fp.stderr.on('data', () => {});
  fp.on('error', () => { clearTimeout(t); cb(null); });
  fp.on('close', () => {
    clearTimeout(t);
    try {
      const j = JSON.parse(out); const streams = j.streams || [];
      const v = streams.find(s => s.codec_type === 'video') || {};
      const a = streams.find(s => s.codec_type === 'audio') || {};
      const dur = j.format && parseFloat(j.format.duration);
      cb({ video: (v.codec_name || '').toLowerCase(), pix: (v.pix_fmt || '').toLowerCase(), audio: (a.codec_name || '').toLowerCase(), format: ((j.format && j.format.format_name) || '').toLowerCase(), duration: (dur && isFinite(dur)) ? dur : 0 });
    } catch (e) { cb(null); }
  });
}

// Automatic playback selection. This is deliberately conservative: direct play is chosen only
// for combinations that are broadly browser-friendly. Everything else uses HLS, where compatible
// H.264/AAC can be remuxed without quality loss and incompatible tracks are transcoded as needed.
function browserPlaybackPlan (rel, res) {
  const cfg = readConfig().webdav;
  if (!FFMPEG || !FFPROBE) return sendJSON(res, 200, { mode: 'direct', reason: 'probe-unavailable', ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE });
  let inputUrl = mediaInput(cfg, rel);
  if (!inputUrl) return sendJSON(res, 400, { message: 'Bad path' });
  ffprobeCodecs(inputUrl, info => {
    if (!info) return sendJSON(res, 200, { mode: 'direct', reason: 'probe-failed', ffmpeg: true, ffprobe: true });
    const ext = path.extname(String(rel || '')).slice(1).toLowerCase();
    const v = String(info.video || '').toLowerCase();
    const a = String(info.audio || '').toLowerCase();
    const pix = String(info.pix || '').toLowerCase();
    const tenBit = /10|12/.test(pix);
    const mp4ish = ['mp4', 'm4v', 'mov'].includes(ext);
    const webm = ext === 'webm';
    const directVideo = !tenBit && ((mp4ish && ['h264', 'av1'].includes(v)) || (webm && ['vp8', 'vp9', 'av1'].includes(v)));
    const directAudio = (mp4ish && ['aac', 'mp3'].includes(a)) || (webm && ['opus', 'vorbis'].includes(a));
    const direct = !!(directVideo && directAudio);
    const hlsCopyVideo = !tenBit && v === 'h264';
    const hlsCopyAudio = ['aac', 'mp3'].includes(a);
    let mode = 'direct', decision = 'Direct play', reason = 'browser-compatible';
    if (!direct) {
      mode = 'hls';
      if (hlsCopyVideo && hlsCopyAudio) { decision = 'Remux'; reason = 'container'; }
      else if (hlsCopyVideo) { decision = 'Audio transcode'; reason = 'audio'; }
      else { decision = 'Video transcode'; reason = tenBit ? 'pixel-format' : 'video'; }
    }
    return sendJSON(res, 200, {
      mode, decision, reason, forceVideo: mode === 'hls' && !hlsCopyVideo,
      transcodeAudio: mode === 'hls' && !hlsCopyAudio,
      video: v, audio: a, pixelFormat: pix, container: ext || info.format || '', duration: info.duration || 0,
      ffmpeg: true, ffprobe: true
    });
  });
}
// Video encoder args for a quality preset. 'orig' = source resolution, visually-lossless CRF; lower tiers cap resolution.
const SEG_TIME = 6;
function qualityVideoArgs (q) {
  const cfg = readConfig().webdav;
  const cap = q === '480' ? 854 : q === '720' ? 1280 : q === '1080' ? 1920 : 0;
  const scale = cap ? ['-vf', "scale='min(" + cap + ",iw)':-2"] : [];
  const kf = ['-force_key_frames', 'expr:gte(t,n_forced*' + SEG_TIME + ')', '-g', '144', '-sc_threshold', '0'];
  const hw = cfg.hwAccel !== 'off' ? HWENC : null;
  if (hw === 'h264_nvenc') {
    const cq = q === '480' ? '26' : q === '720' ? '24' : q === '1080' ? '23' : '21';
    return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', cq, '-b:v', '0', '-pix_fmt', 'yuv420p', '-profile:v', 'high'].concat(kf, scale);
  }
  if (hw === 'h264_qsv') {
    const gq = q === '480' ? '26' : q === '720' ? '24' : q === '1080' ? '23' : '21';
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', gq, '-pix_fmt', 'nv12', '-profile:v', 'high'].concat(kf, scale);
  }
  if (hw === 'h264_videotoolbox') {
    const br = q === '480' ? '2500k' : q === '720' ? '4500k' : q === '1080' ? '8000k' : '12000k';
    return ['-c:v', 'h264_videotoolbox', '-b:v', br, '-profile:v', 'high', '-pix_fmt', 'yuv420p'].concat(kf, scale);
  }
  // software (libx264) — speed preset chosen by the admin
  const crf = q === '480' ? '24' : q === '720' ? '22' : q === '1080' ? '20' : '18';
  const preset = ENC_PRESET[cfg.encSpeed] || 'veryfast';
  return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1'].concat(kf, scale);
}
function webdavTranscode (cfg, rel, name, opts, req, res) {
  opts = opts || {};
  let inputUrl = mediaInput(cfg, rel);
  try { if (!inputUrl) throw new Error('bad path'); }
  catch (e) { res.writeHead(400); return res.end('Bad path'); }

  ffprobeCodecs(inputUrl, info => {
    const forceVideo = opts.vc === '1';
    const forceStereo = opts.ac === '2';
    // Decide video: re-encode if forced, if probe says an unsupported codec, if 10/12-bit, or (probe failed) leave as copy to stay cheap.
    let doVideo;
    if (forceVideo) doVideo = true;
    else if (!info || !info.video) doVideo = false;                     // unknown → copy (cheap); user can force if it won't play
    else { const tenBit = /10|12/.test(info.pix); doVideo = !VIDEO_OK.includes(info.video) || tenBit; }
    // Decide audio: re-encode if forced stereo, if probe says non-AAC/MP3, or (probe failed) re-encode to AAC to be safe.
    let doAudio;
    const aidx = (opts.aidx != null && opts.aidx !== '') ? Math.max(0, parseInt(opts.aidx, 10) || 0) : null;
    if (forceStereo) doAudio = true;
    else if (aidx != null) doAudio = true;                              // a specific track was chosen → encode it to AAC
    else if (!info || !info.audio) doAudio = true;                      // unknown → AAC (the usual reason people transcode)
    else doAudio = !AUDIO_OK.includes(info.audio);

    const args = ['-hide_banner', '-loglevel', 'error', '-i', inputUrl, '-map', '0:v:0?', '-map', '0:a:' + (aidx != null ? aidx : 0) + '?'];
    if (doVideo) args.push('-c:v', 'libx264', '-preset', (ENC_PRESET[cfg.encSpeed] || 'veryfast'), '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0');
    else args.push('-c:v', 'copy');
    if (doAudio) { args.push('-c:a', 'aac', '-b:a', forceStereo ? '256k' : '448k'); if (forceStereo) args.push('-ac', '2'); }
    else args.push('-c:a', 'copy');
    args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');

    let ff;
    try { ff = spawn(FFMPEG, args); } catch (e) { if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Could not start ffmpeg: ' + e.message })); } return; }
    const tid = crypto.randomBytes(7).toString('hex');
    const who = currentUser(req);
    liveTranscodes.set(tid, {
      id: tid, ff, createdAt: Date.now(), last: Date.now(), user: (who && who.username) || '',
      title: path.basename(String(rel || '')), source: isLocalSource() ? 'local' : 'webdav',
      srcVideo: (info && info.video) || '', srcAudio: (info && info.audio) || '',
      copyVideo: !doVideo, copyAudio: !doAudio, quality: 'original', encoder: doVideo ? 'libx264' : 'copy'
    });
    const clearLive = () => liveTranscodes.delete(tid);
    let started = false, errBuf = '';
    ff.stderr.on('data', d => { errBuf += d.toString(); if (errBuf.length > 4000) errBuf = errBuf.slice(-4000); });
    ff.stdout.once('data', chunk => { started = true; res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }); res.write(chunk); ff.stdout.pipe(res); });
    ff.on('error', e => { clearLive(); if (!started && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'ffmpeg error: ' + e.message })); } else { try { res.end(); } catch (_) {} } });
    ff.on('close', code => { clearLive(); if (!started && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Transcode failed: ' + (errBuf.split('\n').filter(Boolean).pop() || ('ffmpeg exited ' + code)) })); } else { try { res.end(); } catch (_) {} } });
    const kill = () => { clearLive(); try { ff.kill('SIGKILL'); } catch (e) {} };
    req.on('close', kill); res.on('close', kill);
  });
}
// --- Seekable HLS transcode ---
// Builds a full VOD playlist up front (so the player can seek anywhere) and transcodes on demand:
// segments are produced linearly, and when the player seeks to a segment that isn't ready yet, the
// encoder is restarted at that point (-ss) with timestamps preserved (-copyts) so the timeline stays aligned.
function segName (k) { return 'seg' + String(k).padStart(5, '0') + '.ts'; }
function hlsSpawn (sess, k) {
  if (sess.ff) { try { sess.ff.kill('SIGKILL'); } catch (e) {} sess.ff = null; }
  const a = ['-hide_banner', '-loglevel', 'error'];
  if (k > 0) a.push('-copyts', '-start_at_zero', '-ss', String(k * SEG_TIME));
  a.push('-i', sess.inputUrl, '-map', '0:v:0?', '-map', '0:a:' + (sess.aidx != null ? sess.aidx : 0) + '?');
  if (sess.copyVideo) {
    // Straight copy — the container changes (MKV -> MPEG-TS segments) but the video is untouched.
    a.push('-c:v', 'copy');
    if (String(sess.srcVideo).toLowerCase() === 'h264') a.push('-bsf:v', 'h264_mp4toannexb');
  } else {
    a.push.apply(a, qualityVideoArgs(sess.q));
  }
  if (sess.copyAudio) a.push('-c:a', 'copy');
  else { a.push('-c:a', 'aac', '-b:a', sess.ac === '2' ? '256k' : '448k'); if (sess.ac === '2') a.push('-ac', '2'); }
  a.push('-f', 'hls', '-hls_time', String(SEG_TIME), '-hls_list_size', '0', '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_type', 'mpegts', '-start_number', String(k),
    '-hls_segment_filename', path.join(sess.dir, 'seg%05d.ts'), path.join(sess.dir, '_ff.m3u8'));
  let ff; try { ff = spawn(FFMPEG, a); } catch (e) { sess.ff = null; sess.ffDone = true; sess.lastErr = e.message; return; }
  sess.ff = ff; sess.startSeg = k; sess.ffDone = false; sess.lastRestart = Date.now();
  ff.stderr.on('data', d => { sess.lastErr = (d.toString().split('\n').filter(Boolean).pop() || sess.lastErr); });
  ff.on('close', () => { if (sess.ff === ff) { sess.ffDone = true; } });
  ff.on('error', () => { if (sess.ff === ff) { sess.ffDone = true; } });
}
function hlsLastContig (sess) { let k = sess.startSeg; while (fs.existsSync(path.join(sess.dir, segName(k + 1)))) k++; return k; }
function hlsSegReady (sess, k) { return fs.existsSync(path.join(sess.dir, segName(k))); }   // temp_file flag → file appears only when finalized
function webdavHlsStart (rel, opts, res, req, user) {
  const cfg = readConfig().webdav;
  if (!isLocalSource() && (!cfg.url || !cfg.username)) return sendJSON(res, 400, { message: 'No download source is configured' });
  if (!FFMPEG) return sendJSON(res, 400, { message: 'ffmpeg is not available on the server' });
  const segs = safeSegments(rel); if (!segs.length) return sendJSON(res, 400, { message: 'No file specified' });
  logPlayOnce(user, rel, req);
  let inputUrl = mediaInput(cfg, rel);
  try { if (!inputUrl) throw new Error('bad path'); }
  catch (e) { return sendJSON(res, 400, { message: 'Bad path' }); }
  opts = opts || {};
  ffprobeCodecs(inputUrl, info => {
    const duration = (info && info.duration) ? info.duration : 0;
    if (!duration) return sendJSON(res, 502, { message: 'Could not read media duration' });
    const aidx = (opts.aidx != null && opts.aidx !== '') ? Math.max(0, parseInt(opts.aidx, 10) || 0) : null;
    const q = ['orig', '1080', '720', '480'].includes(opts.q) ? opts.q : 'orig';
    const nSegs = Math.max(1, Math.ceil(duration / SEG_TIME));
    const sid = crypto.randomBytes(9).toString('hex');
    const dir = path.join(HLS_ROOT, sid);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return sendJSON(res, 502, { message: 'Could not create temp dir' }); }
    // hand-write the full VOD playlist so the player has the whole timeline immediately
    let pl = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:' + SEG_TIME + '\n#EXT-X-MEDIA-SEQUENCE:0\n';
    for (let i = 0; i < nSegs; i++) { const d = (i === nSegs - 1) ? (duration - (nSegs - 1) * SEG_TIME) : SEG_TIME; pl += '#EXTINF:' + (d > 0 ? d.toFixed(3) : SEG_TIME.toFixed(3)) + ',\n' + segName(i) + '\n'; }
    pl += '#EXT-X-ENDLIST\n';
    try { fs.writeFileSync(path.join(dir, 'index.m3u8'), pl); } catch (e) { return sendJSON(res, 502, { message: 'Could not write playlist' }); }
    // If the video stream is already browser-friendly and no resize was asked for, we can
    // remux (stream-copy) instead of re-encoding — near-zero CPU and it starts almost instantly.
    const vcForced = String(opts.vc) === '1';
    const tenBit = !!(info && /10|12/.test(String(info.pix || '')));
    // MPEG-TS HLS remux is intentionally limited to 8-bit H.264. VP8/VP9/AV1 may direct-play
    // in some browsers but are not safe to stream-copy into MPEG-TS segments.
    const canCopyVideo = !vcForced && q === 'orig' && info && !tenBit && String(info.video || '').toLowerCase() === 'h264';
    const audioOk = info && AUDIO_OK.includes(String(info.audio || '').toLowerCase());
    const canCopyAudio = audioOk && opts.ac !== '2' && aidx == null;
    const sess = { dir, inputUrl, aidx, ac: opts.ac, q, duration, nSegs, ff: null, startSeg: 0, ffDone: false, last: Date.now(), createdAt: Date.now(), lastErr: '',
                   user: (user && user.username) || '', title: path.basename(String(rel || '')), source: isLocalSource() ? 'local' : 'webdav',
                   copyVideo: !!canCopyVideo, copyAudio: !!canCopyAudio, srcVideo: (info && info.video) || '', srcAudio: (info && info.audio) || '', srcPix: (info && info.pix) || '' };
    hlsSessions.set(sid, sess);
    hlsSpawn(sess, 0);
    const t0 = Date.now();
    const check = () => {
      if (!hlsSessions.has(sid)) return;
      if (hlsSegReady(sess, 0) || fs.existsSync(path.join(dir, segName(0)))) return sendJSON(res, 200, { sid, duration, segTime: SEG_TIME, quality: q,
        mode: sess.copyVideo ? (sess.copyAudio ? 'remux' : 'remux-audio') : 'transcode', video: sess.srcVideo, audio: sess.srcAudio });
      if (sess.ffDone && !fs.existsSync(path.join(dir, segName(0)))) { const e = sess.lastErr || 'ffmpeg exited before producing output'; hlsCleanup(sid); return sendJSON(res, 502, { message: 'Transcode failed: ' + e }); }
      if (Date.now() - t0 > 25000) { hlsCleanup(sid); return sendJSON(res, 504, { message: 'Transcode did not start in time' }); }
      setTimeout(check, 200);
    };
    setTimeout(check, 250);
  });
}
function webdavHlsFile (sid, file, res) {
  const sess = hlsSessions.get(sid);
  if (!sess) { res.writeHead(404); return res.end('session expired'); }
  if (!/^[A-Za-z0-9_.-]+$/.test(file) || file.indexOf('..') !== -1) { res.writeHead(400); return res.end('bad'); }
  sess.last = Date.now();
  const serve = () => fs.readFile(path.join(sess.dir, file), (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
  if (file.endsWith('.m3u8')) return serve();
  const m = file.match(/^seg(\d+)\.ts$/); if (!m) { res.writeHead(404); return res.end('not found'); }
  const k = parseInt(m[1], 10);
  if (hlsSegReady(sess, k)) return serve();
  // not ready: make sure an encoder is producing this segment (restart on a seek)
  const alive = sess.ff && !sess.ffDone;
  const contig = alive ? hlsLastContig(sess) : -1;
  const needRestart = !alive || k < sess.startSeg || (k - contig) > 10;
  if (needRestart && (Date.now() - (sess.lastRestart || 0) > 1200 || k < sess.startSeg)) hlsSpawn(sess, k);
  const t0 = Date.now();
  const wait = () => {
    if (!hlsSessions.has(sid)) { res.writeHead(404); return res.end('gone'); }
    if (hlsSegReady(sess, k)) return serve();
    if (sess.ffDone && !fs.existsSync(path.join(sess.dir, segName(k)))) { res.writeHead(404); return res.end('segment unavailable'); }
    if (Date.now() - t0 > 30000) { res.writeHead(504); return res.end('segment timeout'); }
    setTimeout(wait, 200);
  };
  wait();
}
function webdavHlsStop (sid, res) { hlsCleanup(sid); res.writeHead(204); res.end(); }

function transcodeModeOf (s) {
  if (s.copyVideo && s.copyAudio) return 'Remux';
  if (s.copyVideo && !s.copyAudio) return 'Audio transcode';
  return 'Video transcode';
}
function mediarrTranscodeSessions () {
  const now = Date.now();
  const hwAllowed = readConfig().webdav.hwAccel !== 'off' && !!HWENC;
  const hls = [];
  for (const [sid, s] of hlsSessions) {
    let progressPct = null;
    try { progressPct = s.nSegs ? Math.max(0, Math.min(100, Math.round(((hlsLastContig(s) + 1) / s.nSegs) * 100))) : null; } catch (_) {}
    hls.push({
      id: sid, kind: 'hls', user: s.user || '', title: s.title || 'Media', source: s.source || '',
      mode: transcodeModeOf(s), video: s.srcVideo || '', audio: s.srcAudio || '', quality: s.q || 'orig',
      encoder: s.copyVideo ? 'copy' : (hwAllowed ? HWENC : 'libx264'), hardware: !s.copyVideo && hwAllowed,
      active: !!(s.ff && !s.ffDone), progressPct, duration: Number(s.duration) || 0,
      ageSeconds: Math.max(0, Math.round((now - (s.createdAt || s.last || now)) / 1000)),
      idleSeconds: Math.max(0, Math.round((now - (s.last || now)) / 1000))
    });
  }
  for (const [tid, s] of liveTranscodes) {
    hls.push({
      id: tid, kind: 'stream', user: s.user || '', title: s.title || 'Media', source: s.source || '',
      mode: transcodeModeOf(s), video: s.srcVideo || '', audio: s.srcAudio || '', quality: s.quality || 'original',
      encoder: s.encoder || (s.copyVideo ? 'copy' : 'libx264'), hardware: false, active: true, progressPct: null,
      ageSeconds: Math.max(0, Math.round((now - (s.createdAt || now)) / 1000)), idleSeconds: 0
    });
  }
  return hls.sort((a, b) => b.ageSeconds - a.ageSeconds);
}
async function transcodeDashboard () {
  const plex = await plexSessions(true);
  const mediarr = mediarrTranscodeSessions();
  const plexTranscoding = (plex.sessions || []).filter(s => s.tech && /transcode|direct stream/i.test(s.tech.mode || '')).length;
  return {
    now: Date.now(), autoSelect: !(readConfig().playback && readConfig().playback.autoSelect === false),
    ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE, hwEncoder: HWENC || '', mediarr,
    plex: { configured: !!plex.configured, error: plex.error || '', count: plex.count || 0, transcoding: plexTranscoding, sessions: plex.sessions || [] },
    counts: { mediarr: mediarr.length, plex: plex.count || 0, plexTranscoding }
  };
}
// List the audio + (text) subtitle tracks in a file so the player can offer track selection.
const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'dvb_teletext'];
function webdavTracks (rel, res) {
  const cfg = readConfig().webdav;
  if (!isLocalSource() && (!cfg.url || !cfg.username)) return sendJSON(res, 400, { message: 'No download source is configured' });
  if (!FFPROBE) return sendJSON(res, 200, { audio: [], subs: [] });
  const segs = safeSegments(rel); if (!segs.length) return sendJSON(res, 400, { message: 'No file specified' });
  let inputUrl = mediaInput(cfg, rel);
  try { if (!inputUrl) throw new Error('bad path'); }
  catch (e) { return sendJSON(res, 400, { message: 'Bad path' }); }
  let fp; try { fp = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,channels:stream_tags=language,title', '-of', 'json', inputUrl]); }
  catch (e) { return sendJSON(res, 200, { audio: [], subs: [] }); }
  let out = ''; const t = setTimeout(() => { try { fp.kill('SIGKILL'); } catch (e) {} }, 12000);
  fp.stdout.on('data', d => { out += d; }); fp.stderr.on('data', () => {});
  fp.on('error', () => { clearTimeout(t); sendJSON(res, 200, { audio: [], subs: [] }); });
  fp.on('close', () => {
    clearTimeout(t);
    let streams = []; try { streams = (JSON.parse(out).streams) || []; } catch (e) {}
    const audio = [], subs = []; let ai = 0, si = 0;
    for (const s of streams) {
      const tags = s.tags || {};
      const lang = tags.language || tags.LANGUAGE || '';
      const title = tags.title || tags.TITLE || '';
      if (s.codec_type === 'audio') audio.push({ i: ai++, codec: s.codec_name || '', channels: s.channels || 0, lang, title });
      else if (s.codec_type === 'subtitle') subs.push({ i: si++, codec: s.codec_name || '', lang, title, text: TEXT_SUBS.includes((s.codec_name || '').toLowerCase()) });
    }
    sendJSON(res, 200, { audio, subs });
  });
}
// Extract one text subtitle track to WebVTT so the player can show it as a <track>.
function webdavSubtitle (rel, sidx, res) {
  const cfg = readConfig().webdav;
  if (!isLocalSource() && (!cfg.url || !cfg.username)) { res.writeHead(400); return res.end('No download source configured'); }
  if (!FFMPEG) { res.writeHead(400); return res.end('ffmpeg unavailable'); }
  const segs = safeSegments(rel); if (!segs.length) { res.writeHead(400); return res.end('No file'); }
  const n = parseInt(sidx, 10); if (isNaN(n) || n < 0) { res.writeHead(400); return res.end('Bad subtitle index'); }
  let inputUrl = mediaInput(cfg, rel);
  try { if (!inputUrl) throw new Error('bad path'); }
  catch (e) { res.writeHead(400); return res.end('Bad path'); }
  let ff; try { ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', inputUrl, '-map', '0:s:' + n, '-f', 'webvtt', 'pipe:1']); }
  catch (e) { res.writeHead(502); return res.end('ffmpeg failed'); }
  let started = false;
  ff.stderr.on('data', () => {});
  ff.stdout.once('data', chunk => { started = true; res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' }); res.write(chunk); ff.stdout.pipe(res); });
  ff.on('error', () => { if (!started && !res.headersSent) { res.writeHead(502); res.end('ffmpeg error'); } });
  ff.on('close', () => { if (!started && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Could not extract subtitle'); } else { try { res.end(); } catch (_) {} } });
  res.on('close', () => { try { ff.kill('SIGKILL'); } catch (e) {} });
}
async function testWebdav (url, username, password, folder, source, localPath) {
  if (source === 'local') {
    const root = path.resolve(localPath || '');
    if (!root) throw new Error('Enter a folder path');
    let st; try { st = fs.statSync(root); } catch (e) {
      if (e.code === 'ENOENT') throw new Error('Folder does not exist: ' + root);
      if (e.code === 'EACCES') throw new Error('Permission denied — MEDIARR can\'t read ' + root);
      throw new Error(e.message);
    }
    if (!st.isDirectory()) throw new Error('That path is not a folder');
    const segs = safeSegments(folder);
    const dir = segs.length ? path.resolve(root, segs.join(path.sep)) : root;
    if (dir !== root && !dir.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) throw new Error('Subfolder escapes the configured folder');
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { throw new Error('Could not read ' + dir + ': ' + e.message); }
    const vids = entries.filter(e => e.isFile() && VIDEO_EXT.includes((e.name.split('.').pop() || '').toLowerCase())).length;
    return { name: 'Local folder', videos: vids, folders: entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).length };
  }
  const base = normUrl(url);
  if (!base || !username) throw new Error('Missing URL or username');
  const cfg = { url: base, username, password: password || readConfig().webdav.password, folder };
  const target = webdavTarget(cfg, '');
  const up = await upstream(target.endsWith('/') ? target : target + '/', {
    method: 'PROPFIND',
    headers: { Authorization: webdavAuthHeader(cfg), Depth: '1', 'Content-Type': 'application/xml', Accept: 'application/xml' }
  });
  if (up.status === 401) throw new Error('Unauthorized — check username/password');
  if (up.status === 404) throw new Error('Folder not found on the server');
  if (up.status >= 400)  throw new Error('Server returned HTTP ' + up.status);
  const entries = parsePropfind(up.body.toString('utf8'));
  const vids = entries.filter(e => !e.isDir && (VIDEO_EXT.includes((e.name.split('.').pop() || '').toLowerCase()))).length;
  return { name: 'WebDAV', videos: vids, folders: entries.filter(e => e.isDir).length };
}

/* ---------- auto add queue (server-side, survives page reloads) ---------- */
async function arrPost (svc, subPath, bodyObj) {
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return { ok: false, message: svc + ' is not configured' };
  try {
    const body = Buffer.from(JSON.stringify(bodyObj));
    const up = await upstream(normUrl(cfg.url) + subPath, { method: 'POST', headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json', 'Content-Length': body.length }, body });
    if (up.status >= 400) {
      let msg = 'HTTP ' + up.status;
      try { const j = JSON.parse(up.body.toString('utf8')); if (Array.isArray(j) && j[0] && j[0].errorMessage) msg = j[0].errorMessage; else if (j.message) msg = j.message; } catch (e) {}
      return { ok: false, status: up.status, message: msg };
    }
    let data = null; try { data = JSON.parse(up.body.toString('utf8')); } catch (e) {}
    return { ok: true, data };
  } catch (e) { return { ok: false, message: e.message }; }
}
let autoJob = null, autoTimer = null;
function readAutoJob () { try { return JSON.parse(fs.readFileSync(AUTOADD_PATH, 'utf8')); } catch (e) { return null; } }
function saveAutoJob () { try { if (autoJob) fs.writeFileSync(AUTOADD_PATH, JSON.stringify(autoJob)); else fs.rmSync(AUTOADD_PATH, { force: true }); } catch (e) {} }
function autoStatus () {
  if (!autoJob) return { running: false, job: null };
  const j = autoJob;
  return { running: j.status === 'running', job: {
    label: j.label, status: j.status, total: j.items.length, index: j.index,
    added: j.added, skipped: j.skipped, failed: j.failed, tooShort: j.tooShort || 0, minRuntime: j.minRuntime || 0,
    intervalMinutes: j.intervalMinutes, startedAt: j.startedAt, nextAt: j.nextAt || null,
    user: j.username, log: j.log.slice(-40)
  } };
}
function autoLog (icon, title, msg) { autoJob.log.push({ ts: Date.now(), icon, title, msg }); if (autoJob.log.length > 300) autoJob.log.splice(0, autoJob.log.length - 300); }
function autoFinish (status) {
  if (!autoJob) return;
  autoJob.status = status; autoJob.nextAt = null;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  saveAutoJob();
}
async function autoStep () {
  if (!autoJob || autoJob.status !== 'running') return;
  if (autoJob.index >= autoJob.items.length) return autoFinish('done');
  const it = autoJob.items[autoJob.index++];
  const isMovie = it.kind !== 'series';
  const svc = isMovie ? 'radarr' : 'sonarr';
  const cfg = readConfig()[svc];
  try {
    if (!cfg.url || !cfg.apiKey) { autoJob.failed++; autoLog('⚠', it.title, svc + ' not configured'); }
    else if (autoJob.role !== 'admin' && autoJob.dailyLimit > 0 && addsTodayCount(autoJob.username) >= autoJob.dailyLimit) {
      autoLog('⏹', it.title, 'daily add limit reached — stopping'); autoFinish('stopped'); saveAutoJob(); return;
    } else {
      // Use the same tolerant lookup the rest of the app uses, so this works on any *arr version.
      const term = addTerm(svc, { imdbId: it.imdbId, tmdbId: it.tmdbId, tvdbId: it.tvdbId, title: it.title });
      const look = term ? await arrLookup(svc, term) : { ok: false };
      if (!look.ok) {
        autoJob.failed++;
        const i = (look.info || {});
        autoLog('⚠', it.title, 'lookup failed' + (i.status ? ' (HTTP ' + i.status + ')' : i.error ? ' (' + i.error + ')' : ''));
      } else {
        const list = look.items;
        let obj = null;
        if (it.imdbId) obj = list.find(f => String(f.imdbId || '').toLowerCase() === String(it.imdbId).toLowerCase());
        if (!obj && it.tmdbId) obj = list.find(f => String(f.tmdbId) === String(it.tmdbId));
        if (!obj && it.tvdbId) obj = list.find(f => String(f.tvdbId) === String(it.tvdbId));
        if (!obj) obj = list[0] || null;
        if (!obj) { autoJob.failed++; autoLog('⚠', it.title, 'not found'); }
        else if (obj.id) { autoJob.skipped++; autoLog('•', it.title, 'already in library'); }
        else {
          // runtime gate: Radarr gives a movie's length, Sonarr an episode's; fall back to TMDB.
          let runtime = Number(obj.runtime) || 0;
          const minRt = Number(autoJob.minRuntime) || 0;
          if (minRt > 0 && !runtime) {
            const id = it.tmdbId || obj.tmdbId;
            if (id) {
              const d = await tmdbJson((isMovie ? '/movie/' : '/tv/') + id);
              if (d) runtime = isMovie ? (Number(d.runtime) || 0) : (Array.isArray(d.episode_run_time) && d.episode_run_time.length ? Number(d.episode_run_time[0]) || 0 : 0);
            }
          }
          if (minRt > 0 && runtime > 0 && runtime < minRt) {
            autoJob.tooShort = (autoJob.tooShort || 0) + 1;
            autoLog('⏱', it.title, runtime + ' min — under the ' + minRt + ' min minimum');
          } else if (!cfg.rootFolderPath) {
            autoJob.failed++; autoLog('⚠', it.title, 'no root folder set for ' + svc);
          } else {
            const body = isMovie
              ? Object.assign({}, obj, { qualityProfileId: Number(cfg.qualityProfileId) || 1, rootFolderPath: cfg.rootFolderPath, monitored: true, minimumAvailability: 'released', addOptions: { searchForMovie: true } })
              : Object.assign({}, obj, { qualityProfileId: Number(cfg.qualityProfileId) || 1, rootFolderPath: cfg.rootFolderPath, monitored: true, seasonFolder: true, addOptions: { monitor: 'all', searchForMissingEpisodes: true } });
            const r = await arrCreate(svc, body);
            if (r.ok) {
              autoJob.added++; autoLog('✓', it.title, 'added' + (runtime ? ' · ' + runtime + ' min' : ''));
              if (it.tmdbId) rememberExt(isMovie ? 'movie' : 'series', it.tmdbId, obj.imdbId || '', obj.tvdbId || null);
              liveIdx[svc] = { ts: 0, ids: null };
              logAdd({ ts: Date.now(), username: autoJob.username, role: autoJob.role, service: svc, type: isMovie ? 'movie' : 'series', title: it.title || obj.title, year: obj.year || '', ip: autoJob.ip || '' });
              notify('added', (isMovie ? '🎬 ' : '📺 ') + (obj.title || it.title) + (obj.year ? ' (' + obj.year + ')' : ''), 'Auto added to ' + (isMovie ? 'Radarr' : 'Sonarr'), 'good');
            } else { autoJob.failed++; autoLog('⚠', it.title, r.message || 'add failed'); }
          }
        }
      }
    }
  } catch (e) { autoJob.failed++; autoLog('⚠', it.title, e.message || 'error'); }

  if (autoJob.index >= autoJob.items.length) {
    notify('jobs', '✅ Auto add finished', autoJob.label + ' — ' + autoJob.added + ' added, ' + autoJob.skipped + ' already there' + (autoJob.failed ? ', ' + autoJob.failed + ' failed' : ''), 'good');
    autoFinish('done'); return;
  }
  const delay = Math.max(0, autoJob.intervalMinutes * 60000);
  autoJob.nextAt = Date.now() + delay;
  saveAutoJob();
  autoTimer = setTimeout(autoStep, delay);
}
// Resume an interrupted job after a restart.
(function resumeAutoJob () {
  const j = readAutoJob();
  if (j && j.status === 'running' && j.index < j.items.length) {
    autoJob = j;
    const wait = Math.max(3000, (j.nextAt || 0) - Date.now());
    autoTimer = setTimeout(autoStep, wait);
    try { console.log('[mediarr] resuming auto-add: ' + j.index + '/' + j.items.length); } catch (e) {}
  } else if (j) { autoJob = j; }
})();

/* ---------- public API (per-user key) ---------- */
async function apiV1 (sub, req, res, u, me) {
  const method = req.method;
  if (sub === '/ping' && method === 'GET') {
    return sendJSON(res, 200, { ok: true, user: me.username, role: me.role, dailyLimit: me.dailyLimit || 0, addedToday: addsTodayCount(me.username) });
  }
  if (sub === '/search' && method === 'GET') {
    const q = (u.searchParams.get('q') || u.searchParams.get('query') || '').trim();
    if (!q) return sendJSON(res, 400, { error: 'Missing q' });
    const type = (u.searchParams.get('type') || 'all').toLowerCase();
    const limit = Math.min(50, Number(u.searchParams.get('limit')) || 20);
    if (!readConfig().tmdb.apiKey) return sendJSON(res, 400, { error: 'TMDB is not configured on this server' });
    const want = type === 'movie' ? ['movie'] : (type === 'series' || type === 'tv') ? ['tv'] : ['movie', 'tv'];
    const out = [];
    for (const t of want) {
      const d = await tmdbJson('/search/' + t + '?query=' + encodeURIComponent(q) + '&include_adult=false');
      for (const r of ((d && d.results) || [])) {
        out.push({
          type: t === 'tv' ? 'series' : 'movie',
          title: r.title || r.name || '',
          year: (r.release_date || r.first_air_date || '').slice(0, 4),
          tmdbId: r.id, overview: (r.overview || '').slice(0, 500),
          poster: r.poster_path ? ('https://image.tmdb.org/t/p/w500' + r.poster_path) : '',
          rating: r.vote_average || null
        });
      }
    }
    out.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return sendJSON(res, 200, { query: q, count: Math.min(out.length, limit), results: out.slice(0, limit) });
  }
  if (sub === '/library' && method === 'GET') {
    const type = (u.searchParams.get('type') || 'all').toLowerCase();
    const out = {};
    if (type !== 'series' && type !== 'tv') {
      const mr = await arrListAll('radarr', '/api/v3/movie'); const m = mr.ok ? mr.items : [];
      out.movies = (m || []).map(x => ({ title: x.title, year: x.year, tmdbId: x.tmdbId, imdbId: x.imdbId || '', hasFile: !!x.hasFile }));
    }
    if (type !== 'movie') {
      const sr = await arrListAll('sonarr', '/api/v3/series'); const s = sr.ok ? sr.items : [];
      out.series = (s || []).map(x => ({ title: x.title, year: x.year, tvdbId: x.tvdbId, imdbId: x.imdbId || '' }));
    }
    return sendJSON(res, 200, out);
  }
  if (sub === '/activity' && method === 'GET') {
    const windowMs = Math.min(3600000, Math.max(10000, (Number(u.searchParams.get('window')) || 120) * 1000));
    const mine = me.role !== 'admin';
    let media = activeMediaList(windowMs);
    if (mine) media = media.filter(a => a.username === me.username);   // non-admins only see themselves
    const out = {
      now: new Date().toISOString(),
      windowSeconds: Math.round(windowMs / 1000),
      scope: mine ? 'self' : 'all',
      media,                                   // who is streaming / downloading through MEDIARR
      counts: {
        streaming: media.filter(a => a.what === 'streaming' || a.what === 'playing').length,
        downloading: media.filter(a => a.what === 'downloading').length
      }
    };
    // Live Plex sessions (admins only — it covers every user on the server)
    if (!mine && u.searchParams.get('plex') !== '0') {
      try {
        const px = await plexSessions(true);   // admin-only branch already
        out.plex = { count: px.count || 0, sessions: px.sessions || [] };
      } catch (e) { out.plex = { count: 0, sessions: [], error: 'Plex unavailable' }; }
    }
    // Background jobs, so a script can tell whether the server is busy
    if (!mine) {
      const auto = autoStatus(), miss = missStatus();
      out.jobs = {
        autoAdd: auto.job ? { status: auto.job.status, index: auto.job.index, total: auto.job.total, label: auto.job.label } : null,
        missingEpisodes: miss.job ? { status: miss.job.status, index: miss.job.index, total: miss.job.total } : null,
        libraryScan: libCacheStatus().scanning
      };
    }
    return sendJSON(res, 200, out);
  }
  if (sub === '/sessions' && method === 'GET') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
    const now = Date.now();
    const list = [];
    for (const [, sess] of sessions) {
      if (!sess || sess.expires < now) continue;
      list.push({
        username: sess.username,
        expiresInSeconds: Math.max(0, Math.round((sess.expires - now) / 1000)),
        lastActivity: sess.lastActivity ? new Date(sess.lastActivity).toISOString() : null,
        activity: sess.activity || null
      });
    }
    list.sort((a, b) => b.expiresInSeconds - a.expiresInSeconds);
    return sendJSON(res, 200, { count: list.length, sessions: list });
  }
  if (sub === '/add' && method === 'POST') {
    let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
    const r = await addToArr(b, me, req);
    return sendJSON(res, r.status, r.body.ok ? r.body : { error: r.body.message });
  }
  sendJSON(res, 404, { error: 'Unknown endpoint. Try /api/v1/ping, /search, /library, /add, /activity or /sessions' });
}

// Raw fetch that reports exactly what happened — the basis of the admin diagnostics.
async function arrRaw (svc, subPath, timeoutMs) {
  const cfg = readConfig()[svc];
  const t0 = Date.now();
  try {
    const up = await upstream(normUrl(cfg.url) + subPath, { headers: { 'X-Api-Key': cfg.apiKey, Accept: 'application/json' }, timeout: timeoutMs || 90000 });
    const text = up.body ? up.body.toString('utf8') : '';
    const out = { path: subPath, status: up.status, ms: Date.now() - t0, bytes: up.body ? up.body.length : 0,
                  type: (up.headers['content-type'] || '').split(';')[0] };
    if (up.status >= 400) { out.snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180); return out; }
    try { out.json = JSON.parse(text); } catch (e) { out.parseError = e.message; out.snippet = text.slice(0, 180); }
    return out;
  } catch (e) { return { path: subPath, status: 0, ms: Date.now() - t0, error: e.message }; }
}
function libPaths (svc) {
  const n = svc === 'radarr' ? 'movie' : 'series';
  return ['/api/v3/' + n, '/api/v3/' + n + '?page=1&pageSize=1000', '/api/v1/' + n, '/api/' + n];
}

// Radarr/Sonarr have returned plain arrays historically, but newer builds may answer a paged
// object ({page,pageSize,totalRecords,records:[...]}). Accept either, and page through if needed.
function unwrapArrList (d) {
  if (Array.isArray(d)) return { items: d, paged: false };
  if (d && typeof d === 'object') {
    for (const k of ['records', 'items', 'results', 'data', 'movies', 'series']) {
      if (Array.isArray(d[k])) return { items: d[k], paged: true, total: Number(d.totalRecords || d.total || d[k].length) };
    }
  }
  return { items: null, paged: false };
}
function describeShape (d) {
  if (d == null) return 'null / empty body';
  if (Array.isArray(d)) return 'array(' + d.length + ')';
  if (typeof d === 'object') return 'object with keys: ' + Object.keys(d).slice(0, 8).join(', ');
  return typeof d;
}
async function arrListAll (svc, basePath) {
  let first = null, usedPath = basePath, lastInfo = null;
  for (const cand of libPaths(svc)) {
    const raw = await arrRaw(svc, cand);
    lastInfo = raw;
    if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
      const probe = unwrapArrList(raw.json);
      if (probe.items) { first = raw.json; usedPath = cand; break; }
    }
  }
  const u1 = unwrapArrList(first);
  if (!u1.items) return { ok: false, shape: describeShape(first), info: lastInfo };
  basePath = usedPath;
  if (!u1.paged) return { ok: true, items: u1.items };
  // paged response — pull the rest
  const all = u1.items.slice();
  const total = u1.total || all.length;
  const size = all.length || 100;
  for (let page = 2; all.length < total && page <= 200; page++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const d = await arrJson(svc, basePath + sep + 'page=' + page + '&pageSize=' + size);
    const u = unwrapArrList(d);
    if (!u.items || !u.items.length) break;
    all.push.apply(all, u.items);
  }
  return { ok: true, items: all, paged: true };
}

// Probe a service live and report exactly what came back — used by the admin diagnostics.
async function arrProbe (svc) {
  const cfg = readConfig()[svc];
  const out = { service: svc, configured: !!(cfg.url && cfg.apiKey), url: cfg.url || '', hasKey: !!cfg.apiKey };
  if (!cfg.url) { out.ok = false; out.message = 'No URL set in Settings'; return out; }
  if (!cfg.apiKey) { out.ok = false; out.message = 'No API key saved in Settings'; return out; }
  try {
    const st = await upstream(normUrl(cfg.url) + '/api/v3/system/status', { headers: { 'X-Api-Key': cfg.apiKey, Accept: 'application/json' } });
    out.status = st.status;
    if (st.status === 401 || st.status === 403) { out.ok = false; out.message = 'Rejected the API key (HTTP ' + st.status + ') — re-copy it from ' + svc + ' → Settings → General → Security'; return out; }
    if (st.status >= 400) { out.ok = false; out.message = 'HTTP ' + st.status + ' from ' + svc + ' — check the URL (include the port, and any base path)'; return out; }
    let info = {}; try { info = JSON.parse(st.body.toString('utf8')); } catch (e) {}
    out.version = info.version || ''; out.instance = info.instanceName || '';
    // Try each candidate list endpoint and record precisely what each one did.
    out.attempts = [];
    let good = null;
    for (const cand of libPaths(svc)) {
      const raw = await arrRaw(svc, cand);
      const a = { path: cand, status: raw.status, ms: raw.ms, bytes: raw.bytes || 0, type: raw.type || '' };
      if (raw.error) a.result = 'network error: ' + raw.error;
      else if (raw.status >= 400) a.result = 'HTTP ' + raw.status + (raw.snippet ? ' — ' + raw.snippet : '');
      else if (raw.parseError) a.result = 'not JSON (' + raw.type + ') — ' + (raw.snippet || raw.parseError);
      else {
        const un = unwrapArrList(raw.json);
        if (un.items) { a.result = un.items.length + ' items' + (un.paged ? ' (paged, total ' + (un.total || '?') + ')' : ''); if (!good) good = { path: cand, un }; }
        else a.result = 'unexpected shape → ' + describeShape(raw.json);
      }
      out.attempts.push(a);
      if (good) break;
    }
    if (!good) {
      out.ok = false;
      const first = out.attempts[0] || {};
      out.message = 'Connected, but no library endpoint worked. ' + (first.result || '');
      return out;
    }
    const r = await arrListAll(svc, good.path);
    out.ok = true; out.count = r.ok ? r.items.length : good.un.items.length; out.paged = !!(r.paged || good.un.paged); out.endpoint = good.path;
    out.message = out.count ? (out.count + ' items visible via ' + good.path + (out.paged ? ' (paged)' : '')) : 'Connected, but the library is empty — has anything been added to ' + svc + ' yet?';
    return out;
  } catch (e) {
    out.ok = false;
    const m = String(e.message || e);
    out.message = /ECONNREFUSED/.test(m) ? 'Connection refused — is ' + svc + ' running at that address?'
      : /ENOTFOUND|EAI_AGAIN/.test(m) ? 'Host not found — check the URL'
      : /ETIMEDOUT|timeout/i.test(m) ? 'Timed out — wrong port, or blocked by a firewall'
      : /certificate|SSL|TLS/i.test(m) ? 'TLS error — try http:// instead of https://'
      : m;
    return out;
  }
}

// Fire a Radarr/Sonarr command on whichever API route exists.
async function arrCommand (svc, cmd) {
  let last = null;
  for (const base of ['/api/v3/command', '/api/v1/command', '/api/command']) {
    const r = await arrPost(svc, base, cmd);
    if (r.ok) return { ok: true, data: r.data };
    last = r;
    if (r.status && r.status !== 404) break;
    if (!r.status) break;
  }
  return { ok: false, message: (last && last.message) || 'Command failed' };
}
async function waitForCommand (svc, id, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 120000);
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    let done = false;
    for (const base of ['/api/v3/command/', '/api/v1/command/', '/api/command/']) {
      const raw = await arrRaw(svc, base + id, 20000);
      if (raw.status >= 200 && raw.status < 300 && raw.json) {
        const st = String(raw.json.status || '').toLowerCase();
        if (st === 'completed' || st === 'failed' || st === 'aborted') return st;
        done = true; break;
      }
    }
    if (!done) return 'unknown';
  }
  return 'timeout';
}
// Episodes that are monitored, already aired, and have no file.
function missingFrom (episodes) {
  const now = Date.now();
  return (episodes || []).filter(e =>
    e.monitored && !e.hasFile && Number(e.seasonNumber) > 0 &&
    e.airDateUtc && new Date(e.airDateUtc).getTime() <= now);
}

/* Background job: rescan each series, work out what's actually missing, then search for it. */
/* Fast pass: ask Sonarr directly which episodes are already known to be missing.
   One paged call covers the whole library, instead of rescanning every series. */
async function fastMissingScan () {
  const out = new Map();          // seriesId -> { id, title, count }
  let page = 1, pages = 1, seen = 0;
  while (page <= pages && page <= 40) {
    let got = null;
    for (const base of ['/api/v3/wanted/missing', '/api/v1/wanted/missing', '/api/wanted/missing']) {
      const raw = await arrRaw('sonarr', base + '?page=' + page + '&pageSize=200&sortKey=airDateUtc&monitored=true&includeSeries=true', 45000);
      if (raw.status >= 200 && raw.status < 300 && raw.json) { got = raw.json; break; }
    }
    if (!got) return { ok: false };
    const recs = got.records || got.Records || (Array.isArray(got) ? got : []);
    pages = got.totalRecords ? Math.ceil(Number(got.totalRecords) / 200) : 1;
    for (const e of recs) {
      if (!e || e.hasFile) continue;
      if (Number(e.seasonNumber) === 0) continue;                 // ignore specials
      const sid = e.seriesId || (e.series && e.series.id);
      if (!sid) continue;
      const title = (e.series && e.series.title) || ('Series ' + sid);
      const cur = out.get(sid) || { id: sid, title, count: 0 };
      cur.count++; out.set(sid, cur);
      seen++;
    }
    if (!recs.length) break;
    page++;
  }
  return { ok: true, series: [...out.values()], episodes: seen };
}
// Fallback when wanted/missing isn't available: compare each series' own counts.
function statsMissingScan (seriesList) {
  const out = [];
  for (const s of seriesList) {
    const st = s.statistics || {};
    const ec = Number(st.episodeCount) || 0, efc = Number(st.episodeFileCount) || 0;
    if (ec > 0 && efc < ec) out.push({ id: s.id, title: s.title, count: ec - efc });
  }
  return out;
}

let missJob = null, missTimer = null;
function missStatus () {
  if (!missJob) return { running: false, job: null };
  const j = missJob;
  return { running: j.status === 'running' || j.status === 'scanning', job: {
    status: j.status, phase: j.phase || '', total: j.total, index: j.index, series: j.seriesName,
    scanned: j.scanned || 0, candidates: j.candidates || 0, knownMissing: j.knownMissing || 0,
    missing: j.missing, searched: j.searched, failed: j.failed,
    startedAt: j.startedAt, log: j.log.slice(-40)
  } };
}
function missLog (icon, title, msg) { missJob.log.push({ ts: Date.now(), icon, title, msg }); if (missJob.log.length > 300) missJob.log.splice(0, missJob.log.length - 300); }
async function missStep () {
  if (!missJob || missJob.status !== 'running') return;
  if (missJob.index >= missJob.list.length) { missJob.status = 'done'; missJob.seriesName = ''; return; }
  const s = missJob.list[missJob.index++];
  missJob.seriesName = s.title;
  try {
    // 1) rescan so Sonarr's view of what's on disk is current
    const rescan = await arrCommand('sonarr', { name: 'RescanSeries', seriesId: s.id });
    if (rescan.ok && rescan.data && rescan.data.id) await waitForCommand('sonarr', rescan.data.id, 60000);

    // 2) re-read episodes and work out what's genuinely missing
    const eps = await seriesEpisodes(s.id);
    const missing = missingFrom(eps.items);
    if (!missing.length) { missLog('•', s.title, 'nothing missing'); }
    else {
      missJob.missing += missing.length;
      // 3) search only for those episodes
      const r = await arrCommand('sonarr', { name: 'EpisodeSearch', episodeIds: missing.map(e => e.id) });
      if (r.ok) { missJob.searched += missing.length; missLog('🔍', s.title, missing.length + ' missing episode' + (missing.length === 1 ? '' : 's') + ' — search queued'); }
      else { missJob.failed++; missLog('⚠', s.title, r.message || 'search failed'); }
    }
  } catch (e) { missJob.failed++; missLog('⚠', s.title, e.message || 'error'); }
  if (missJob.index >= missJob.list.length) {
    missJob.status = 'done'; missJob.seriesName = '';
    notify('jobs', '✅ Missing-episode search finished', missJob.searched + ' searches queued across ' + missJob.total + ' show(s)', 'good');
    return;
  }
  missTimer = setTimeout(missStep, Math.max(0, missJob.gapMs));
}


/* ---------- manual release search / grab ----------
   Radarr and Sonarr expose live indexer results through /release. Response shapes
   have changed across versions, so MEDIARR normalizes the fields the UI needs and
   keeps the raw download URL/token server-side. */
const releaseRouteHint = { radarr: '', sonarr: '' };
function releaseRoutes (svc) {
  const hinted = releaseRouteHint[svc];
  const all = svc === 'sonarr'
    ? ['/api/v3/release', '/api/v5/release', '/api/release']
    : ['/api/v3/release', '/api/release'];
  return hinted ? [hinted].concat(all.filter(x => x !== hinted)) : all;
}
function releaseValue (r, key, fallback) {
  const inner = r && r.release && typeof r.release === 'object' ? r.release : null;
  if (r && r[key] != null) return r[key];
  if (inner && inner[key] != null) return inner[key];
  return fallback;
}
function normalizeRelease (r, i) {
  const inner = r && r.release && typeof r.release === 'object' ? r.release : {};
  const parsed = r && r.parsedInfo && typeof r.parsedInfo === 'object' ? r.parsedInfo : {};
  const decision = r && r.decision && typeof r.decision === 'object' ? r.decision : {};
  // Sonarr v5 moved quality under parsedInfo and rejection data under decision,
  // while Radarr/Sonarr v3 expose most fields at the top level. Accept both.
  const q0 = (r && r.quality) || inner.quality || parsed.quality || {};
  const q1 = q0.quality || q0;
  const langs = releaseValue(r, 'languages', releaseValue(r, 'language', []));
  const custom = releaseValue(r, 'customFormats', []);
  const directRejected = releaseValue(r, 'rejected', null);
  const rejected = directRejected == null ? !!decision.rejected : !!directRejected;
  const rejections = releaseValue(r, 'rejections', decision.rejections || []);
  const seeders = Number(releaseValue(r, 'seeders', 0)) || 0;
  const leechers = Number(releaseValue(r, 'leechers', releaseValue(r, 'peers', 0))) || 0;
  const ageHours = Number(releaseValue(r, 'ageHours', NaN));
  const ageDays = Number(releaseValue(r, 'age', NaN));
  const guid = String(releaseValue(r, 'guid', '') || '');
  const indexerId = Number(releaseValue(r, 'indexerId', 0)) || 0;
  return {
    id: i,
    title: String(releaseValue(r, 'title', '') || ''),
    guid,
    indexerId,
    indexer: String(releaseValue(r, 'indexer', '') || ''),
    protocol: String(releaseValue(r, 'protocol', releaseValue(r, 'downloadProtocol', '')) || ''),
    size: Number(releaseValue(r, 'size', 0)) || 0,
    quality: String((q1 && (q1.name || q1.source)) || ''),
    qualityWeight: Number((r && r.qualityWeight) || (q1 && q1.weight) || 0) || 0,
    customFormatScore: Number(releaseValue(r, 'customFormatScore', 0)) || 0,
    customFormats: Array.isArray(custom) ? custom.map(x => x && (x.name || x.formatName || x)).filter(Boolean).slice(0, 12) : [],
    languages: Array.isArray(langs) ? langs.map(x => x && (x.name || x)).filter(Boolean).slice(0, 8) : (langs ? [String(langs)] : []),
    ageHours: Number.isFinite(ageHours) ? ageHours : (Number.isFinite(ageDays) ? ageDays * 24 : null),
    seeders, leechers,
    rejected,
    rejections: Array.isArray(rejections) ? rejections.map(x => String(x && (x.message || x.reason || x) || '')).filter(Boolean).slice(0, 12) : [],
    // A manual grab is identified by the cached GUID/indexer pair. Rejected
    // releases remain intentionally grabbable after the UI confirmation.
    downloadAllowed: !!(guid && indexerId)
  };
}
async function manualReleaseSearch (svc, params) {
  const cfg = readConfig()[svc];
  if (!cfg || !cfg.url || !cfg.apiKey) return { ok: false, status: 400, message: (svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' is not configured' };
  const allowed = {};
  for (const k of ['movieId', 'episodeId', 'seriesId', 'seasonNumber']) {
    if (params[k] != null && params[k] !== '') {
      const n = Number(params[k]);
      if (Number.isFinite(n) && n >= 0) allowed[k] = n;
    }
  }
  if (svc === 'radarr' && !allowed.movieId) return { ok: false, status: 400, message: 'Missing Radarr movie id' };
  if (svc === 'sonarr' && !allowed.episodeId && !(allowed.seriesId && allowed.seasonNumber != null)) {
    return { ok: false, status: 400, message: 'Choose a Sonarr episode or season' };
  }
  const qs = new URLSearchParams(); Object.keys(allowed).forEach(k => qs.set(k, String(allowed[k])));
  let last = null;
  for (const base of releaseRoutes(svc)) {
    const raw = await arrRaw(svc, base + '?' + qs.toString(), 120000);
    last = raw;
    if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
      const un = unwrapArrList(raw.json);
      const items = un.items || (Array.isArray(raw.json) ? raw.json : null);
      if (items) {
        releaseRouteHint[svc] = base;
        const normalized = items.map(normalizeRelease).filter(x => x.title || x.guid);
        return { ok: true, path: base, items: normalized };
      }
    }
    if (raw.status && raw.status !== 404) break;
  }
  const why = last && (last.error || (last.status ? ('HTTP ' + last.status + (last.snippet ? ' — ' + last.snippet : '')) : 'no response'));
  return { ok: false, status: (last && last.status) || 502, message: 'Release search failed' + (why ? ': ' + why : '') };
}
async function manualReleaseGrab (svc, body) {
  const guid = String(body.guid || '').trim();
  const indexerId = Number(body.indexerId) || 0;
  if (!guid || !indexerId) return { ok: false, status: 400, message: 'Missing release GUID or indexer id' };
  // Only these two cache identifiers are forwarded. Arbitrary URLs or release-push
  // payloads are intentionally not accepted from the browser.
  let last = null;
  for (const base of releaseRoutes(svc)) {
    const r = await arrPost(svc, base, { guid, indexerId });
    last = r;
    if (r.ok) { releaseRouteHint[svc] = base; return { ok: true, data: r.data }; }
    if (r.status && r.status !== 404) break;
    if (!r.status) break;
  }
  return { ok: false, status: (last && last.status) || 502, message: (last && last.message) || 'Could not grab release' };
}

/* ---------- adding (server-side, version tolerant) ---------- */
// Try every known lookup route until one answers with usable results.
async function arrLookup (svc, term) {
  const n = svc === 'radarr' ? 'movie' : 'series';
  const paths = ['/api/v3/' + n + '/lookup', '/api/v1/' + n + '/lookup', '/api/' + n + '/lookup'];
  let last = null;
  for (const base of paths) {
    const raw = await arrRaw(svc, base + '?term=' + term, 30000);
    last = raw;
    if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
      const un = unwrapArrList(raw.json);
      if (un.items) return { ok: true, items: un.items, path: base };
      if (raw.json && typeof raw.json === 'object' && raw.json.title) return { ok: true, items: [raw.json], path: base };
    }
  }
  return { ok: false, info: last };
}
async function arrCreate (svc, body) {
  const n = svc === 'radarr' ? 'movie' : 'series';
  const paths = ['/api/v3/' + n, '/api/v1/' + n, '/api/' + n];
  let last = null;
  for (const base of paths) {
    const r = await arrPost(svc, base, body);
    if (r.ok) return { ok: true, path: base, data: r.data };
    last = r;
    // 404 means "wrong route" — keep trying. Anything else is a real error, so stop and report it.
    if (r.status && r.status !== 404) break;
    if (!r.status) break;   // network/transport failure
  }
  return { ok: false, message: (last && last.message) || 'Add failed' };
}
// Build the *arr lookup term from whatever id we have.
function addTerm (svc, b) {
  if (b.imdbId) return 'imdb:' + encodeURIComponent(b.imdbId);
  if (svc === 'radarr' && b.tmdbId) return 'tmdb:' + encodeURIComponent(b.tmdbId);
  if (svc === 'sonarr' && b.tvdbId) return 'tvdb:' + encodeURIComponent(b.tvdbId);
  if (b.title) return encodeURIComponent(b.title);
  return '';
}
// One place that adds a movie/series. Returns a plain, honest result for the UI.
async function addToArr (b, me, req, opts) {
  const quiet = !!(opts && opts.quiet);
  const t = String(b.type || 'movie').toLowerCase();
  const isMovie = t !== 'series' && t !== 'tv' && t !== 'show';
  const svc = isMovie ? 'radarr' : 'sonarr';
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return { status: 400, body: { ok: false, message: (isMovie ? 'Radarr' : 'Sonarr') + ' is not configured in Settings' } };
  if (me && me.role !== 'admin' && me.dailyLimit > 0 && addsTodayCount(me.username) >= me.dailyLimit) {
    return { status: 429, body: { ok: false, message: 'Daily add limit reached (' + me.dailyLimit + ')' } };
  }
  // Sonarr matches best on imdb/tvdb — resolve from TMDB when we only have a tmdb id.
  if (!isMovie && !b.imdbId && !b.tvdbId && b.tmdbId) {
    const ext = await tmdbJson('/tv/' + b.tmdbId + '/external_ids');
    if (ext) { b = Object.assign({}, b, { imdbId: ext.imdb_id || '', tvdbId: ext.tvdb_id || null }); }
  }
  const term = addTerm(svc, b);
  if (!term) return { status: 400, body: { ok: false, message: 'Nothing to look up — no id or title supplied' } };

  const look = await arrLookup(svc, term);
  if (!look.ok) {
    const i = look.info || {};
    const why = i.error ? i.error : i.status ? ('HTTP ' + i.status + (i.snippet ? ' — ' + i.snippet : '')) : 'no response';
    logError(svc + ':lookup', why, 'term=' + term);
    return { status: 502, body: { ok: false, message: (isMovie ? 'Radarr' : 'Sonarr') + ' lookup failed (' + why + ')' } };
  }
  const list = look.items;
  if (!list.length) return { status: 404, body: { ok: false, message: 'No match found in ' + (isMovie ? 'Radarr' : 'Sonarr') } };
  let hit = null;
  if (b.imdbId) hit = list.find(x => String(x.imdbId || '').toLowerCase() === String(b.imdbId).toLowerCase());
  if (!hit && b.tmdbId) hit = list.find(x => String(x.tmdbId) === String(b.tmdbId));
  if (!hit && b.tvdbId) hit = list.find(x => String(x.tvdbId) === String(b.tvdbId));
  if (!hit) hit = list[0];
  if (hit.id) {
    if (b.tmdbId) rememberExt(isMovie ? 'movie' : 'series', b.tmdbId, hit.imdbId || b.imdbId || '', hit.tvdbId || b.tvdbId || null);
    return { status: 200, body: { ok: true, added: false, alreadyInLibrary: true, id: hit.id, title: hit.title, message: 'Already in your library' } };
  }
  const body = isMovie
    ? Object.assign({}, hit, {
        qualityProfileId: Number(b.qualityProfileId || cfg.qualityProfileId) || 1,
        rootFolderPath: b.rootFolderPath || cfg.rootFolderPath,
        monitored: b.monitored !== false,
        minimumAvailability: b.minimumAvailability || 'released',
        addOptions: { searchForMovie: b.search !== false }
      })
    : Object.assign({}, hit, {
        qualityProfileId: Number(b.qualityProfileId || cfg.qualityProfileId) || 1,
        rootFolderPath: b.rootFolderPath || cfg.rootFolderPath,
        monitored: b.monitored !== false, seasonFolder: true,
        addOptions: { monitor: b.monitor || 'all', searchForMissingEpisodes: b.search !== false }
      });
  if (!body.rootFolderPath) return { status: 400, body: { ok: false, message: 'No root folder set for ' + svc + ' — pick one in Settings' } };
  const created = await arrCreate(svc, body);
  if (!created.ok) { logError(svc + ':add', created.message, 'title=' + (hit.title || b.title || '')); return { status: 502, body: { ok: false, message: created.message } }; }
  if (created.data && created.data.id) upsertLibCacheItem(svc, created.data);
  if (svc === 'sonarr') scheduleLibraryReconcile('sonarr', 1500);
  liveIdx[svc] = { ts: 0, ids: null };
  realtimePush('arr.added', { service: svc, title: (created.data && created.data.title) || hit.title || b.title || '', user: me && me.username || '', id: created.data && created.data.id || null });
  if (me) logAdd({ ts: Date.now(), username: me.username, role: me.role, service: svc, type: isMovie ? 'movie' : 'series', title: hit.title, year: hit.year || '', ip: clientIp(req) });
  if (!quiet) notify('added', (isMovie ? '🎬 ' : '📺 ') + hit.title + (hit.year ? ' (' + hit.year + ')' : ''),
    'Added to ' + (isMovie ? 'Radarr' : 'Sonarr') + (me ? ' by ' + me.username : ''), 'good');
  if (b.tmdbId) rememberExt(isMovie ? 'movie' : 'series', b.tmdbId, hit.imdbId || b.imdbId || '', hit.tvdbId || b.tvdbId || null);
  const madeId = created.data && created.data.id;
  return { status: 201, body: { ok: true, added: true, id: madeId || null, title: (created.data && created.data.title) || hit.title, year: hit.year || '', service: svc, message: 'Added to ' + (isMovie ? 'Radarr' : 'Sonarr') } };
}

// Season / episode monitoring, routed through the server so it works on any Sonarr version.
async function episodeMonitor (episodeIds, monitored) {
  const body = { episodeIds: episodeIds.map(Number).filter(Boolean), monitored: !!monitored };
  if (!body.episodeIds.length) return { ok: true, skipped: true };
  let last = null;
  for (const base of ['/api/v3/episode/monitor', '/api/v1/episode/monitor', '/api/episode/monitor']) {
    const r = await arrPut('sonarr', base, body);
    if (r.ok) return { ok: true };
    last = r;
    if (r.status && r.status !== 404) break;
    if (!r.status) break;
  }
  return { ok: false, message: (last && last.message) || 'Could not update episode monitoring' };
}
async function seasonMonitor (seriesId, seasonNumber, monitored) {
  const got = await arrItem('sonarr', seriesId);
  if (!got.ok) return { ok: false, message: 'Could not read the series from Sonarr' };
  const series = got.item;
  (series.seasons || []).forEach(s => { if (Number(s.seasonNumber) === Number(seasonNumber)) s.monitored = !!monitored; });
  if (!series.path) return { ok: false, message: 'This series has no path set in Sonarr' };
  let last = null;
  for (const c of [got.base + seriesId, '/api/v3/series/' + seriesId, '/api/v1/series/' + seriesId, '/api/series/' + seriesId]) {
    const r = await arrPut('sonarr', c, series);
    if (r.ok) return { ok: true, series: r.data || series };
    last = r;
    if (r.status && r.status !== 404) break;
    if (!r.status) break;
  }
  return { ok: false, message: (last && last.message) || 'Could not update the season' };
}
// Episodes for a series, any API version.
async function seriesEpisodes (seriesId) {
  for (const base of ['/api/v3/episode?seriesId=', '/api/v1/episode?seriesId=', '/api/episode?seriesId=']) {
    const raw = await arrRaw('sonarr', base + seriesId, 30000);
    if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
      const un = unwrapArrList(raw.json);
      if (un.items) return { ok: true, items: un.items };
    }
  }
  return { ok: false, items: [] };
}

async function arrPut (svc, subPath, bodyObj) {
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return { ok: false, message: svc + ' is not configured' };
  try {
    const body = Buffer.from(JSON.stringify(bodyObj));
    const up = await upstream(normUrl(cfg.url) + subPath, { method: 'PUT', headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json', 'Content-Length': body.length }, body, timeout: 60000 });
    const txt = up.body ? up.body.toString('utf8') : '';
    if (up.status >= 400) {
      let msg = 'HTTP ' + up.status;
      try { const j = JSON.parse(txt); if (Array.isArray(j) && j[0]) msg = j[0].errorMessage || j[0].message || msg; else if (j.message) msg = j.message; } catch (e) {}
      return { ok: false, status: up.status, message: msg };
    }
    let data = null; try { data = JSON.parse(txt); } catch (e) {}
    return { ok: true, data };
  } catch (e) { return { ok: false, message: e.message }; }
}
// Fetch one item by id, trying each API route.
async function arrItem (svc, id) {
  const n = svc === 'radarr' ? 'movie' : 'series';
  for (const base of ['/api/v3/' + n + '/', '/api/v1/' + n + '/', '/api/' + n + '/']) {
    const raw = await arrRaw(svc, base + id, 30000);
    if (raw.status >= 200 && raw.status < 300 && raw.json && typeof raw.json === 'object' && (raw.json.id || raw.json.title)) {
      return { ok: true, item: raw.json, base };
    }
  }
  return { ok: false };
}
/* Update an existing movie/series. Radarr & Sonarr key the location off `path`, not
   `rootFolderPath` — changing only the latter is what produces "path is not updated". */
// Details of the file Radarr has on disk (path, codecs, audio, size, languages, quality).
async function movieFileInfo (movieId) {
  const got = await arrItem('radarr', movieId);
  if (!got.ok) return { ok: false, message: 'Could not read the movie from Radarr' };
  const mv = got.item;
  let f = mv.movieFile || null;
  if (!f && mv.hasFile) {
    for (const base of ['/api/v3/moviefile?movieId=', '/api/v1/moviefile?movieId=', '/api/moviefile?movieId=']) {
      const raw = await arrRaw('radarr', base + movieId, 30000);
      if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
        const un = unwrapArrList(raw.json);
        if (un.items && un.items.length) { f = un.items[0]; break; }
      }
    }
  }
  const langNames = x => {
    const l = [];
    if (Array.isArray(x)) for (const v of x) { if (v) l.push(v.name || v); }
    else if (x) l.push(x.name || x);
    return [...new Set(l.filter(v => typeof v === 'string' && v))];
  };
  const out = {
    ok: true,
    hasFile: !!(mv.hasFile || f),
    path: mv.path || '',
    rootFolderPath: mv.rootFolderPath || '',
    monitored: !!mv.monitored,
    sizeOnDisk: Number(mv.sizeOnDisk) || (f ? Number(f.size) || 0 : 0)
  };
  if (f) {
    const mi = f.mediaInfo || {};
    out.file = {
      relativePath: f.relativePath || '',
      fullPath: f.path || '',
      size: Number(f.size) || 0,
      dateAdded: f.dateAdded || '',
      quality: (f.quality && f.quality.quality && f.quality.quality.name) || '',
      releaseGroup: f.releaseGroup || '',
      edition: f.edition || '',
      languages: langNames(f.languages || f.language),
      video: {
        codec: mi.videoCodec || '',
        dynamicRange: mi.videoDynamicRange || mi.videoDynamicRangeType || '',
        bitDepth: mi.videoBitDepth || null,
        bitrate: Number(mi.videoBitrate) || 0,
        fps: mi.videoFps || null,
        resolution: mi.resolution || ((mi.width && mi.height) ? (mi.width + 'x' + mi.height) : ''),
        scanType: mi.scanType || ''
      },
      audio: {
        codec: mi.audioCodec || '',
        channels: mi.audioChannels || null,
        bitrate: Number(mi.audioBitrate) || 0,
        languages: String(mi.audioLanguages || '').split('/').map(x => x.trim()).filter(Boolean),
        streams: mi.audioStreamCount || null
      },
      subtitles: String(mi.subtitles || '').split('/').map(x => x.trim()).filter(Boolean),
      runtime: mi.runTime || ''
    };
  }
  return out;
}


/* ---------- unified media detail ---------- */
function mediaTitleKey (v) {
  return String(v || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function mediaGuidIds (m) {
  const out = { imdbId: '', tmdbId: null, tvdbId: null };
  const vals = [];
  if (m && m.guid) vals.push(m.guid);
  for (const g of (m && Array.isArray(m.Guid) ? m.Guid : [])) if (g && g.id) vals.push(g.id);
  for (const raw of vals) {
    const x = String(raw || '');
    let z = x.match(/imdb:\/\/(tt\d+)/i); if (z) out.imdbId = z[1];
    z = x.match(/tmdb:\/\/(\d+)/i); if (z) out.tmdbId = Number(z[1]);
    z = x.match(/tvdb:\/\/(\d+)/i); if (z) out.tvdbId = Number(z[1]);
  }
  return out;
}
async function findArrMediaForDetail (svc, q) {
  const cfg = readConfig()[svc];
  const configured = !!(cfg.url && cfg.apiKey);
  if (!configured) return { configured: false, inLibrary: false, item: null };

  let imdbId = String(q.imdbId || '').trim();
  let tmdbId = q.tmdbId ? Number(q.tmdbId) : null;
  let tvdbId = q.tvdbId ? Number(q.tvdbId) : null;
  if (svc === 'sonarr' && tmdbId && !imdbId && !tvdbId) {
    try {
      const ext = await resolveExt('series', tmdbId);
      imdbId = ext.imdbId || '';
      tvdbId = ext.tvdbId ? Number(ext.tvdbId) : null;
    } catch (_) {}
  }

  const titleKey = mediaTitleKey(q.title);
  const year = Number(q.year) || 0;
  const matches = x => {
    if (!x) return false;
    if (q.arrId && Number(x.id) === Number(q.arrId)) return true;
    if (imdbId && x.imdbId && String(x.imdbId).toLowerCase() === imdbId.toLowerCase()) return true;
    if (svc === 'radarr' && tmdbId && String(x.tmdbId || '') === String(tmdbId)) return true;
    if (svc === 'sonarr' && tvdbId && String(x.tvdbId || '') === String(tvdbId)) return true;
    if (titleKey && mediaTitleKey(x.title) === titleKey && (!year || !x.year || Number(x.year) === year)) return true;
    return false;
  };

  let slim = null;
  const cached = readLibCache()[svc];
  if (cached && Array.isArray(cached.items)) slim = cached.items.find(matches) || null;
  let raw = null;
  if (q.arrId) {
    const got = await arrItem(svc, Number(q.arrId));
    if (got.ok) raw = got.item;
  } else if (slim && slim.id) {
    const got = await arrItem(svc, Number(slim.id));
    if (got.ok) raw = got.item;
  }
  if (!raw) {
    const all = await arrListAll(svc, svc === 'radarr' ? '/api/v3/movie' : '/api/v3/series');
    if (all.ok) raw = all.items.find(matches) || null;
  }
  return { configured, inLibrary: !!raw, item: raw, imdbId, tmdbId, tvdbId };
}
async function sonarrFileSummary (seriesId) {
  const eps = await seriesEpisodes(seriesId);
  const items = eps.items || [];
  const now = Date.now();
  const aired = items.filter(e => e.airDateUtc && new Date(e.airDateUtc).getTime() <= now);
  const future = items.filter(e => Number(e.seasonNumber) > 0 && e.airDateUtc && new Date(e.airDateUtc).getTime() > now).sort((a,b)=>new Date(a.airDateUtc)-new Date(b.airDateUtc));
  const real = items.filter(e => Number(e.seasonNumber) > 0);
  const seasons = new Map();
  for (const e of real) {
    const sn = Number(e.seasonNumber) || 0;
    const cur = seasons.get(sn) || { seasonNumber: sn, episodes: 0, downloaded: 0, monitored: 0, missing: 0 };
    cur.episodes++;
    if (e.hasFile) cur.downloaded++;
    if (e.monitored) cur.monitored++;
    if (e.monitored && !e.hasFile && e.airDateUtc && new Date(e.airDateUtc).getTime() <= now) cur.missing++;
    seasons.set(sn, cur);
  }

  let files = [];
  for (const base of ['/api/v3/episodefile?seriesId=', '/api/v1/episodefile?seriesId=', '/api/episodefile?seriesId=']) {
    const raw = await arrRaw('sonarr', base + seriesId, 30000);
    if (raw.status >= 200 && raw.status < 300 && raw.json !== undefined) {
      const un = unwrapArrList(raw.json);
      if (un.items) { files = un.items; break; }
    }
  }
  const uniq = a => [...new Set(a.filter(Boolean).map(String))];
  const quality = [], video = [], audio = [], dynamicRange = [], subtitles = [], languages = [];
  let size = 0;
  for (const f of files) {
    size += Number(f.size) || 0;
    const mi = f.mediaInfo || {};
    quality.push(f.quality && f.quality.quality && f.quality.quality.name);
    video.push(mi.videoCodec);
    audio.push(mi.audioCodec);
    dynamicRange.push(mi.videoDynamicRange || mi.videoDynamicRangeType);
    String(mi.subtitles || '').split('/').map(x=>x.trim()).filter(Boolean).forEach(x=>subtitles.push(x));
    for (const l of (Array.isArray(f.languages) ? f.languages : [])) languages.push(l && (l.name || l));
  }
  const epsByFile = new Map();
  for (const e of real) {
    const fid = Number(e.episodeFileId) || 0;
    if (!fid) continue;
    const list = epsByFile.get(fid) || [];
    list.push({
      seasonNumber: Number(e.seasonNumber) || 0,
      episodeNumber: Number(e.episodeNumber) || 0,
      title: e.title || ''
    });
    epsByFile.set(fid, list);
  }
  const playable = files.map(f => {
    const fe = (epsByFile.get(Number(f.id) || 0) || []).sort((a,b)=>a.seasonNumber-b.seasonNumber || a.episodeNumber-b.episodeNumber);
    return {
      id: Number(f.id) || null,
      relativePath: f.relativePath || '',
      fullPath: f.path || '',
      size: Number(f.size) || 0,
      seasonNumber: Number(f.seasonNumber) || (fe[0] && fe[0].seasonNumber) || 0,
      episodes: fe
    };
  }).sort((a,b)=>a.seasonNumber-b.seasonNumber || ((a.episodes[0]&&a.episodes[0].episodeNumber)||0)-((b.episodes[0]&&b.episodes[0].episodeNumber)||0));
  return {
    episodes: {
      total: real.length,
      downloaded: real.filter(e=>e.hasFile).length,
      monitored: real.filter(e=>e.monitored).length,
      missing: aired.filter(e=>Number(e.seasonNumber)>0 && e.monitored && !e.hasFile).length,
      unaired: future.length,
      next: future[0] ? {
        seasonNumber: future[0].seasonNumber, episodeNumber: future[0].episodeNumber,
        title: future[0].title || '', airDateUtc: future[0].airDateUtc
      } : null,
      items: real.map(e => ({
        id: Number(e.id) || null,
        seasonNumber: Number(e.seasonNumber) || 0,
        episodeNumber: Number(e.episodeNumber) || 0,
        title: e.title || '',
        overview: String(e.overview || '').slice(0, 1000),
        airDateUtc: e.airDateUtc || '',
        monitored: !!e.monitored,
        hasFile: !!e.hasFile,
        episodeFileId: Number(e.episodeFileId) || null
      })).sort((a,b)=>a.seasonNumber-b.seasonNumber || a.episodeNumber-b.episodeNumber)
    },
    seasons: [...seasons.values()].sort((a,b)=>a.seasonNumber-b.seasonNumber),
    files: {
      count: files.length, size,
      qualities: uniq(quality), videoCodecs: uniq(video), audioCodecs: uniq(audio),
      dynamicRanges: uniq(dynamicRange), subtitles: uniq(subtitles), languages: uniq(languages),
      playable
    }
  };
}
function mediaSourceConfigured () {
  const cfg = readConfig().webdav || {};
  if (cfg.source === 'local') return !!cfg.localPath;
  return !!(cfg.url && cfg.username);
}
function slashMediaPath (v) { return String(v || '').replace(/\\/g, '/').replace(/\/+$/g, ''); }
function stripMediaRoot (full, root) {
  const f = slashMediaPath(full), r = slashMediaPath(root);
  if (!f || !r) return '';
  const fl = f.toLowerCase(), rl = r.toLowerCase();
  if (fl === rl) return '';
  if (!fl.startsWith(rl + '/')) return '';
  return f.slice(r.length + 1);
}
function pathStartsRoot (full, root) {
  const f = slashMediaPath(full), r = slashMediaPath(root);
  if (!f || !r) return '';
  const fl = f.toLowerCase(), rl = r.toLowerCase();
  if (fl === rl) return '';
  if (!fl.startsWith(rl + '/')) return '';
  return f.slice(r.length + 1);
}
function mappedPlaybackCandidates (fullPath, service) {
  const rules = normalizePathMappings(readConfig().playback && readConfig().playback.pathMappings);
  const out = [];
  for (const m of rules) {
    if (!m.enabled || (m.service !== 'all' && m.service !== service)) continue;
    const rest = pathStartsRoot(fullPath, m.arrRoot);
    if (!rest) continue;
    const rel = [m.targetPrefix, rest].filter(Boolean).join('/');
    out.push({ path: safeSegments(rel).join('/'), kind: 'mapping', mapping: m.name || (m.arrRoot + ' → ' + (m.targetPrefix || '/')), mappingId: m.id });
  }
  return out;
}
function playbackCandidateDetails (fullPath, relativePath, itemPath, rootFolderPath, service) {
  const out = [], seen = new Set();
  const add = (v, kind, mapping, mappingId) => {
    const clean = safeSegments(slashMediaPath(v)).join('/');
    if (!clean || seen.has(clean)) return;
    const ext = (clean.split('.').pop() || '').toLowerCase();
    if (!VIDEO_EXT.includes(ext)) return;
    seen.add(clean); out.push({ path: clean, kind: kind || 'automatic', mapping: mapping || '', mappingId: mappingId || '' });
  };
  for (const x of mappedPlaybackCandidates(fullPath, service)) add(x.path, x.kind, x.mapping, x.mappingId);

  add(stripMediaRoot(fullPath, rootFolderPath), 'arr-root-relative');
  const itemRel = stripMediaRoot(itemPath, rootFolderPath);
  if (itemRel && relativePath) add(itemRel + '/' + slashMediaPath(relativePath), 'item-relative');

  const itemFolder = slashMediaPath(itemPath).split('/').filter(Boolean).pop() || '';
  if (itemFolder && relativePath) add(itemFolder + '/' + slashMediaPath(relativePath), 'folder-relative');

  const rootName = slashMediaPath(rootFolderPath).split('/').filter(Boolean).pop() || '';
  if (rootName && itemRel && relativePath) add(rootName + '/' + itemRel + '/' + slashMediaPath(relativePath), 'parent-root');

  add(fullPath, 'absolute-as-relative');
  add(relativePath, 'file-relative');
  return out;
}
function playbackPathCandidates (fullPath, relativePath, itemPath, rootFolderPath, service) {
  return playbackCandidateDetails(fullPath, relativePath, itemPath, rootFolderPath, service).map(x=>x.path);
}
function mediaFileName (v, fallback) {
  const p = slashMediaPath(v), bits = p.split('/').filter(Boolean);
  return bits.pop() || fallback || 'Media';
}
function localPlayablePath (candidates) {
  for (const rel of candidates) {
    const file = localTarget(rel);
    if (!file) continue;
    try {
      const st = fs.statSync(file);
      if (st.isFile()) return rel;
    } catch (_) {}
  }
  return '';
}
function episodePlayLabel (x) {
  const eps = Array.isArray(x.episodes) ? x.episodes : [];
  if (!eps.length) return x.seasonNumber ? ('Season ' + x.seasonNumber) : 'Episode';
  const first = eps[0], last = eps[eps.length - 1];
  const pad = n => String(Number(n) || 0).padStart(2, '0');
  const code = eps.length > 1
    ? ('S' + pad(first.seasonNumber) + 'E' + pad(first.episodeNumber) + '-E' + pad(last.episodeNumber))
    : ('S' + pad(first.seasonNumber) + 'E' + pad(first.episodeNumber));
  const title = eps.length === 1 && first.title ? (' · ' + first.title) : '';
  return code + title;
}
function localCandidateExists (rel) {
  const file = localTarget(rel);
  if (!file) return false;
  try { return fs.statSync(file).isFile(); } catch (_) { return false; }
}
async function mediaRelativeExists (rel) {
  if (isLocalSource()) return localCandidateExists(rel);
  const cfg = readConfig().webdav || {};
  if (!cfg.url || !cfg.username) return false;
  try {
    const up = await upstream(webdavTarget(cfg, rel), {
      method: 'PROPFIND',
      headers: { Authorization: webdavAuthHeader(cfg), Depth: '0', 'Content-Type': 'application/xml', Accept: 'application/xml' },
      timeout: 12000
    });
    return up.status >= 200 && up.status < 300;
  } catch (_) { return false; }
}
function watchMetaForItem (type, base, arr, tmdb, plex, x) {
  const ep = Array.isArray(x.episodes) && x.episodes.length ? x.episodes[0] : null;
  const poster = (tmdb && tmdb.poster) || (plex && plex.art) || '';
  return {
    type: type === 'series' ? 'episode' : 'movie',
    title: type === 'series' ? ((ep && ep.title) || x.label || arr.title || base.title || '') : (arr.title || base.title || x.label || ''),
    show: type === 'series' ? (arr.title || base.title || '') : '',
    season: ep ? ep.seasonNumber : null,
    episode: ep ? ep.episodeNumber : null,
    year: arr.year || base.year || '',
    poster,
    imdbId: base.imdbId || '',
    tmdbId: base.tmdbId || null,
    tvdbId: base.tvdbId || null
  };
}
async function resolveUnifiedPlayback (type, service, found, media, tv, base, arr, tmdb, plex, me) {
  const cfg = readConfig().webdav || {};
  const source = cfg.source === 'local' ? 'local' : 'webdav';
  const configured = mediaSourceConfigured();
  const result = {
    configured, source, sourceLabel: source === 'local' ? 'Local folder' : 'WebDAV',
    sourceRoot: source === 'local' ? (cfg.localPath || '') : (cfg.folder || '/'),
    available: false, items: [], mappings: normalizePathMappings(readConfig().playback && readConfig().playback.pathMappings),
    resolverVersion: 2
  };
  if (!configured || !found || !found.inLibrary || !found.item) return result;

  const itemPath = found.item.path || '', root = found.item.rootFolderPath || '';
  const inputs = [];
  if (type === 'movie' && media && media.hasFile && media.file) {
    inputs.push({
      fileId: media.file.id || null,
      relativePath: media.file.relativePath || '',
      fullPath: media.file.fullPath || '',
      name: mediaFileName(media.file.fullPath || media.file.relativePath, found.item.title || 'Movie'),
      label: found.item.title || 'Movie',
      episodes: []
    });
  } else if (type === 'series' && tv && tv.files && Array.isArray(tv.files.playable)) {
    for (const f of tv.files.playable) inputs.push({
      fileId: f.id || null,
      relativePath: f.relativePath || '', fullPath: f.fullPath || '',
      name: mediaFileName(f.fullPath || f.relativePath, 'Episode'),
      label: episodePlayLabel(f), seasonNumber: f.seasonNumber || 0, episodes: f.episodes || []
    });
  }

  for (const x of inputs) {
    const candidates = playbackCandidateDetails(x.fullPath, x.relativePath, itemPath, root, service);
    let chosen = null, verified = false;
    if (source === 'local') {
      for (const cand of candidates) {
        cand.exists = localCandidateExists(cand.path);
        if (!chosen && cand.exists) { chosen = cand; verified = true; }
      }
    } else {
      // WebDAV verification is intentionally deferred so a TV detail page does not
      // issue one network PROPFIND per episode. The diagnostics/test endpoints verify on demand.
      chosen = candidates[0] || null;
      for (const cand of candidates) cand.exists = null;
    }
    if (!chosen) continue;
    const meta = watchMetaForItem(type, base, arr, tmdb, plex, x);
    const progress = me ? watchProgressForPath(me.username, chosen.path) : null;
    result.items.push({
      fileId: x.fileId || null,
      path: chosen.path,
      name: x.name || chosen.path.split('/').pop(),
      label: x.label || x.name || chosen.path.split('/').pop(),
      seasonNumber: x.seasonNumber || 0,
      episodes: x.episodes || [],
      meta,
      progress: progress ? { position: progress.position, duration: progress.duration, progressPct: progress.progressPct, updatedAt: progress.updatedAt } : null,
      resolver: {
        arrPath: x.fullPath || '',
        arrRoot: root,
        selected: chosen.path,
        selectedKind: chosen.kind,
        mapping: chosen.mapping || '',
        verified,
        candidates
      }
    });
  }
  result.available = result.items.length > 0;
  return result;
}
async function plexMediaAvailability (q) {
  const cfg = readConfig().plex;
  if (!cfg.url || !cfg.token) return { configured: false, available: false };
  const title = String(q.title || '').trim();
  if (!title) return { configured: true, available: false };
  const base = normUrl(cfg.url);
  let results = [];
  const attempts = [
    base + '/search?query=' + encodeURIComponent(title),
    base + '/hubs/search?query=' + encodeURIComponent(title) + '&limit=30&includeCollections=0&includeExternalMedia=0'
  ];
  for (const url of attempts) {
    const r = await plexJson(url, cfg.token);
    if (!r.ok) continue;
    const mc = (r.data || {}).MediaContainer || {};
    if (Array.isArray(mc.Metadata)) results.push.apply(results, mc.Metadata);
    for (const h of (mc.Hub || [])) if (Array.isArray(h.Metadata)) results.push.apply(results, h.Metadata);
    if (results.length) break;
  }
  const want = q.type === 'series' ? 'show' : 'movie';
  const titleKey = mediaTitleKey(title), year = Number(q.year) || 0;
  const score = m => {
    let n = 0; const ids = mediaGuidIds(m);
    if (q.imdbId && ids.imdbId && String(q.imdbId).toLowerCase() === ids.imdbId.toLowerCase()) n += 100;
    if (q.tmdbId && ids.tmdbId && String(q.tmdbId) === String(ids.tmdbId)) n += 100;
    if (q.tvdbId && ids.tvdbId && String(q.tvdbId) === String(ids.tvdbId)) n += 100;
    if (!m.type || m.type === want) n += 20;
    if (mediaTitleKey(m.title) === titleKey) n += 30;
    if (year && Number(m.year) === year) n += 10;
    return n;
  };
  results = results.filter(m => !m.type || m.type === want);
  results.sort((a,b)=>score(b)-score(a));
  const hit = results[0];
  if (!hit || score(hit) < 30) return { configured: true, available: false };

  let machineIdentifier = '';
  try {
    const ident = await plexJson(base + '/identity', cfg.token);
    machineIdentifier = String((((ident.data || {}).MediaContainer || {}).machineIdentifier) || '');
  } catch (_) {}
  const key = hit.key || (hit.ratingKey ? '/library/metadata/' + hit.ratingKey : '');
  const webUrl = machineIdentifier && key
    ? 'https://app.plex.tv/desktop/#!/server/' + encodeURIComponent(machineIdentifier) + '/details?key=' + encodeURIComponent(key)
    : '';
  const thumb = hit.thumb || '';
  return {
    configured: true, available: true,
    ratingKey: hit.ratingKey || '', key, title: hit.title || title, year: hit.year || '',
    type: hit.type || want, viewCount: Number(hit.viewCount) || 0, viewOffset: Number(hit.viewOffset) || 0,
    duration: Number(hit.duration) || 0, webUrl,
    art: thumb ? ('/api/plex/img?h=pms&p=' + encodeURIComponent(thumb)) : '',
    ids: mediaGuidIds(hit)
  };
}
async function unifiedMediaDetail (q, me) {
  const type = q.type === 'series' || q.type === 'tv' || q.type === 'show' ? 'series' : 'movie';
  const svc = type === 'movie' ? 'radarr' : 'sonarr';
  const base = {
    type, service: svc, title: String(q.title || '').slice(0, 300), year: Number(q.year) || null,
    imdbId: String(q.imdbId || '').trim(), tmdbId: q.tmdbId ? Number(q.tmdbId) : null, tvdbId: q.tvdbId ? Number(q.tvdbId) : null
  };

  const found = await findArrMediaForDetail(svc, Object.assign({}, base, { arrId: Number(q.arrId) || null }));
  if (!base.imdbId && found.imdbId) base.imdbId = found.imdbId;
  if (!base.tmdbId && found.tmdbId) base.tmdbId = found.tmdbId;
  if (!base.tvdbId && found.tvdbId) base.tvdbId = found.tvdbId;

  const arr = {
    configured: found.configured, inLibrary: found.inLibrary, id: found.item && found.item.id || null,
    monitored: !!(found.item && found.item.monitored), title: found.item && found.item.title || base.title,
    year: found.item && found.item.year || base.year,
    rootFolderPath: found.item && found.item.rootFolderPath || '',
    path: found.item && found.item.path || '',
    qualityProfileId: found.item && found.item.qualityProfileId || null,
    status: found.item && found.item.status || '',
    minimumAvailability: found.item && found.item.minimumAvailability || '',
    seriesType: found.item && found.item.seriesType || ''
  };

  let media = null, tv = null;
  if (found.inLibrary && found.item) {
    if (type === 'movie') media = await movieFileInfo(found.item.id);
    else tv = await sonarrFileSummary(found.item.id);
  }

  let tmdb = null;
  if (readConfig().tmdb.apiKey) {
    try {
      let id = base.tmdbId;
      if (!id && base.imdbId) {
        const find = await tmdbJson('/find/' + encodeURIComponent(base.imdbId) + '?external_source=imdb_id');
        const list = type === 'movie' ? (find && find.movie_results) : (find && find.tv_results);
        if (list && list.length) id = list[0].id;
      }
      if (id) {
        const d = await tmdbJson('/' + (type === 'movie' ? 'movie/' : 'tv/') + id);
        if (d) {
          base.tmdbId = Number(id);
          tmdb = {
            id: Number(id), status: d.status || '', tagline: d.tagline || '',
            originalLanguage: d.original_language || '',
            runtime: type === 'movie' ? (Number(d.runtime) || null) : ((d.episode_run_time || [])[0] || null),
            genres: (d.genres || []).map(x=>x.name).filter(Boolean),
            networks: (d.networks || []).map(x=>x.name).filter(Boolean),
            voteAverage: Number(d.vote_average) || null,
            poster: d.poster_path ? ('https://image.tmdb.org/t/p/w342' + d.poster_path) : ''
          };
        }
      }
    } catch (_) {}
  }
  const plex = await plexMediaAvailability(Object.assign({}, base, { type }));
  const playback = await resolveUnifiedPlayback(type, svc, found, media, tv, base, arr, tmdb, plex, me);
  return { ok: true, type, service: svc, identity: base, arr, media, tv, tmdb, plex, playback, generatedAt: Date.now() };
}

async function updateArrItem (b, me) {
  const isMovie = String(b.svc || 'radarr') !== 'sonarr';
  const svc = isMovie ? 'radarr' : 'sonarr';
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) return { status: 400, body: { ok: false, message: (isMovie ? 'Radarr' : 'Sonarr') + ' is not configured' } };
  const id = Number(b.id);
  if (!id) return { status: 400, body: { ok: false, message: 'Missing item id' } };

  const got = await arrItem(svc, id);
  if (!got.ok) return { status: 502, body: { ok: false, message: 'Could not read the existing item from ' + svc } };
  const item = got.item;

  const next = Object.assign({}, item);
  if (b.qualityProfileId != null) next.qualityProfileId = Number(b.qualityProfileId) || item.qualityProfileId;
  if (b.monitored != null) next.monitored = !!b.monitored;
  if (isMovie && b.minimumAvailability) next.minimumAvailability = b.minimumAvailability;
  if (!isMovie && b.seriesType) next.seriesType = b.seriesType;

  // Moving to a different root folder: rebuild `path` from the existing folder name.
  if (b.rootFolderPath && b.rootFolderPath !== item.rootFolderPath) {
    const oldPath = String(item.path || '');
    const sep = oldPath.includes('\\') && !oldPath.includes('/') ? '\\' : '/';
    const folderName = oldPath ? oldPath.split(/[\\/]/).filter(Boolean).pop() : (item.folderName || item.title || '');
    const root = String(b.rootFolderPath).replace(/[\\/]+$/, '');
    next.rootFolderPath = b.rootFolderPath;
    next.path = root + sep + folderName;
  }
  if (!next.path) return { status: 400, body: { ok: false, message: 'This item has no path set in ' + svc + ' — fix it there first' } };

  const move = b.moveFiles ? 'true' : 'false';
  const n = isMovie ? 'movie' : 'series';
  const candidates = [got.base + id, '/api/v3/' + n + '/' + id, '/api/v1/' + n + '/' + id, '/api/' + n + '/' + id];
  let last = null;
  for (const c of candidates) {
    const r = await arrPut(svc, c + '?moveFiles=' + move, next);
    if (r.ok) {
      liveIdx[svc] = { ts: 0, ids: null };
      return { status: 200, body: { ok: true, item: r.data || next, message: 'Updated' } };
    }
    last = r;
    if (r.status && r.status !== 404) break;   // a real error — report it rather than trying more routes
    if (!r.status) break;
  }
  logError(svc + ':update', (last && last.message) || 'update failed', 'id=' + id);
  return { status: 502, body: { ok: false, message: (last && last.message) || 'Update failed' } };
}

/* TMDB ids don't exist in Sonarr (it keys on tvdb/imdb), so resolve and cache the mapping
   — otherwise a show added from a TMDB card looks "not added" the next time it renders. */
const EXTMAP_PATH = path.join(DATA_DIR, 'tmdb-map.json');
let extMap = null;
function readExtMap () { if (extMap) return extMap; try { extMap = JSON.parse(fs.readFileSync(EXTMAP_PATH, 'utf8')); } catch (e) { extMap = {}; } return extMap; }
function writeExtMap () { try { fs.writeFileSync(EXTMAP_PATH, JSON.stringify(extMap)); } catch (e) {} }
let _extDirty = false;
function rememberExt (type, tmdbId, imdbId, tvdbId) {
  if (!tmdbId) return;
  const m = readExtMap(), k = type + ':' + tmdbId;
  const prev = m[k] || {};
  const next = { imdbId: imdbId || prev.imdbId || '', tvdbId: tvdbId || prev.tvdbId || null, ts: Date.now() };
  if (prev.imdbId === next.imdbId && String(prev.tvdbId) === String(next.tvdbId)) return;   // no change
  m[k] = next;
  _extDirty = true;   // flushed on a timer so bulk learning isn't one disk write per item
}
setInterval(() => { if (_extDirty) { _extDirty = false; writeExtMap(); } }, 3000).unref?.();
async function resolveExt (type, tmdbId) {
  const m = readExtMap(), k = type + ':' + tmdbId;
  if (m[k]) return m[k];
  const path2 = (type === 'series' ? '/tv/' : '/movie/') + tmdbId + '/external_ids';
  const d = await tmdbJson(path2);
  const rec = { imdbId: (d && d.imdb_id) || '', tvdbId: (d && d.tvdb_id) || null, ts: Date.now() };
  m[k] = rec; writeExtMap();
  return rec;
}
// Answer "is each of these already in the library?" for a batch of TMDB ids.
async function libraryCheck (items) {
  const rIds = await liveLibraryIds('radarr');
  const sIds = await liveLibraryIds('sonarr');
  const rTmdb = new Set(rIds.tmdb || []), rImdb = new Set(rIds.imdb || []);
  const sImdb = new Set(sIds.imdb || []), sTvdb = new Set(sIds.tvdb || []);
  const sTmdb = new Set(sIds.tmdb || []);
  const out = {};
  const need = [];

  // First pass: answer everything we can without touching TMDB.
  for (const it of items.slice(0, 200)) {
    const type = (it.type === 'series' || it.type === 'tv') ? 'series' : 'movie';
    const key = type + ':' + it.tmdbId;
    if (!it.tmdbId) { out[key] = false; continue; }
    const tmdbStr = String(it.tmdbId);
    if (type === 'movie' && rTmdb.has(tmdbStr)) { out[key] = true; continue; }
    if (type === 'series' && sTmdb.has(tmdbStr)) { out[key] = true; continue; }
    const cached = readExtMap()[type + ':' + it.tmdbId];
    if (cached) {
      out[key] = type === 'movie'
        ? !!(cached.imdbId && rImdb.has(cached.imdbId))
        : !!((cached.imdbId && sImdb.has(cached.imdbId)) || (cached.tvdbId && sTvdb.has(String(cached.tvdbId))));
      continue;
    }
    need.push({ type, tmdbId: it.tmdbId, key });
  }

  // Second pass: resolve the unknowns in parallel batches instead of one at a time.
  const BATCH = 8;
  for (let i = 0; i < need.length; i += BATCH) {
    const slice = need.slice(i, i + BATCH);
    const exts = await Promise.all(slice.map(n => resolveExt(n.type, n.tmdbId).catch(() => ({}))));
    slice.forEach((n, idx) => {
      const ext = exts[idx] || {};
      out[n.key] = n.type === 'movie'
        ? !!(ext.imdbId && rImdb.has(ext.imdbId))
        : !!((ext.imdbId && sImdb.has(ext.imdbId)) || (ext.tvdbId && sTvdb.has(String(ext.tvdbId))));
    });
  }
  return out;
}

/* Learn tmdb→imdb/tvdb straight from the *arr libraries: most items already carry both ids,
   so this removes the need for a TMDB lookup for anything you already own. */
function warmExtMapFromLibrary (items, type) {
  let learned = 0;
  for (const x of items || []) {
    if (!x || !x.tmdbId) continue;
    const k = type + ':' + x.tmdbId;
    const m = readExtMap();
    if (m[k] && m[k].imdbId) continue;
    rememberExt(type, x.tmdbId, x.imdbId || '', x.tvdbId || null);
    learned++;
  }
  return learned;
}

/* Live "already added?" index — queried straight from Radarr/Sonarr with a short TTL so
   search results reflect reality, while the disk cache above keeps the browsers fast. */
const LIVE_IDS_TTL = 60000;
const SONARR_LIVE_IDS_TTL = 15000;
let liveIdx = { radarr: { ts: 0, ids: null }, sonarr: { ts: 0, ids: null } };
async function liveLibraryIds (svc, force) {
  const cur = liveIdx[svc];
  const cfg = readConfig()[svc];
  const empty = { imdb: [], tmdb: [], tvdb: [], file: [], ts: Date.now(), configured: false, live: false };
  if (!cfg.url || !cfg.apiKey) return empty;
  const ttl = svc === 'sonarr' ? SONARR_LIVE_IDS_TTL : LIVE_IDS_TTL;
  if (!force && cur.ids && (Date.now() - cur.ts) < ttl) {
    return Object.assign({}, cur.ids, { ageSeconds: Math.round((Date.now() - cur.ts) / 1000), live: false });
  }
  const r = await arrListAll(svc, svc === 'radarr' ? '/api/v3/movie' : '/api/v3/series');
  if (!r.ok) {
    if (cur.ids) return Object.assign({}, cur.ids, { stale: true, live: false });
    return Object.assign({}, empty, { configured: true, error: 'could not read ' + svc });
  }
  const ids = { imdb: [], tmdb: [], tvdb: [], file: [], configured: true };
  for (const x of r.items) {
    if (x.imdbId) ids.imdb.push(x.imdbId);
    if (x.tmdbId) ids.tmdb.push(String(x.tmdbId));
    if (x.tvdbId) ids.tvdb.push(String(x.tvdbId));
    // remember the id mapping so "is this added?" rarely needs a TMDB round-trip
    if (x.tmdbId && (x.imdbId || x.tvdbId)) rememberExt(svc === 'radarr' ? 'movie' : 'series', x.tmdbId, x.imdbId || '', x.tvdbId || null);
    const done = svc === 'radarr' ? !!x.hasFile : !!(x.statistics && x.statistics.episodeCount && x.statistics.episodeFileCount >= x.statistics.episodeCount);
    if (done && x.imdbId) ids.file.push(x.imdbId);
  }
  ids.count = r.items.length;
  liveIdx[svc] = { ts: Date.now(), ids };
  return Object.assign({}, ids, { ts: Date.now(), ageSeconds: 0, live: true });
}

/* ---------- Docker container controls ----------
   The Docker socket is effectively host-root access. Keep this feature opt-in,
   admin-only, and constrained to an explicit container/service allow-list.
   Requests never accept a Docker API path or arbitrary command from the browser. */
function normalizeDockerAllowed (raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,;]+/);
  const seen = new Set(), out = [];
  for (const x of list) {
    const name = String(x || '').trim().replace(/^\/+/, '');
    if (!name || name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(name);
    if (out.length >= 50) break;
  }
  return out;
}
function dockerRawRequest (method, apiPath, timeoutMs, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    let payload = null;
    if (body != null) payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const headers = Object.assign({ Host: 'localhost', Accept: 'application/json' }, extraHeaders || {});
    headers['Content-Length'] = payload ? payload.length : 0;
    if (payload && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (text.length < 2 * 1024 * 1024) text += chunk; });
      res.on('end', () => {
        let data = null;
        if (text.trim()) { try { data = JSON.parse(text); } catch (_) { data = text; } }
        resolve({ status: res.statusCode || 0, data, body: text, headers: res.headers });
      });
    });
    req.setTimeout(timeoutMs || 15000, () => req.destroy(new Error('Docker API timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
let _dockerApiVersion = null;
async function dockerApiVersion () {
  if (_dockerApiVersion) return _dockerApiVersion;
  const r = await dockerRawRequest('GET', '/version', 5000);
  if (r.status < 200 || r.status >= 300 || !r.data || !r.data.ApiVersion) {
    const m = r.data && r.data.message ? r.data.message : ('HTTP ' + r.status);
    throw new Error('Docker API unavailable: ' + m);
  }
  _dockerApiVersion = String(r.data.ApiVersion);
  return _dockerApiVersion;
}
async function dockerApi (method, apiPath, timeoutMs, body, extraHeaders) {
  const version = await dockerApiVersion();
  const r = await dockerRawRequest(method, '/v' + version + apiPath, timeoutMs, body, extraHeaders);
  if (r.status >= 200 && r.status < 300) return r;
  // Docker returns 304 for a start/stop that would not change state; treat it as harmless.
  if (r.status === 304) return r;
  const msg = r.data && r.data.message ? r.data.message : (r.body || ('HTTP ' + r.status));
  const e = new Error(msg); e.statusCode = r.status; throw e;
}
function dockerAliases (c) {
  const out = [];
  for (const n of (c.Names || [])) { const x = String(n || '').replace(/^\/+/, ''); if (x) out.push(x); }
  const svc = c.Labels && c.Labels['com.docker.compose.service'];
  if (svc) out.push(String(svc));
  return [...new Set(out)];
}
function dockerIsSelf (c) {
  const host = String(os.hostname() || '').toLowerCase();
  return !!(host && c && c.Id && String(c.Id).toLowerCase().startsWith(host));
}
function dockerImageCanUpdate (image) {
  const x = String(image || '').trim();
  return !!x && !/^sha256:/i.test(x) && !/@sha256:/i.test(x);
}
function dockerImagePullSpec (image) {
  const x = String(image || '').trim();
  if (!dockerImageCanUpdate(x)) throw new Error('This container uses an immutable image digest/ID and cannot be updated from this panel');
  const slash = x.lastIndexOf('/'), colon = x.lastIndexOf(':');
  const tagged = colon > slash;
  const fromImage = tagged ? x.slice(0, colon) : x;
  const tag = tagged ? x.slice(colon + 1) : 'latest';
  if (!fromImage || !tag) throw new Error('Could not determine the container image tag');
  return { fromImage, tag, ref: fromImage + ':' + tag };
}
// Container recreation and replace-with-rollback are shared with update-helper.js.
const dockerRecreate = require('./docker-recreate');
let _dockerShared = null;
function dockerShared () {
  if (!_dockerShared) _dockerShared = dockerRecreate.makeDocker(async (method, apiPath, body, timeoutMs) => {
    const version = await dockerApiVersion();
    return dockerRawRequest(method, '/v' + version + apiPath, timeoutMs || 30000, body);
  });
  return _dockerShared;
}
async function dockerInspectContainer (id) {
  return (await dockerApi('GET', '/containers/' + encodeURIComponent(id) + '/json', 10000)).data || {};
}
async function dockerInspectImage (ref) {
  return (await dockerApi('GET', '/images/' + encodeURIComponent(ref) + '/json', 10000)).data || {};
}
async function dockerPullConfiguredImage (image) {
  const spec = dockerImagePullSpec(image), version = await dockerApiVersion();
  const r = await dockerRawRequest('POST',
    '/v' + version + '/images/create?fromImage=' + encodeURIComponent(spec.fromImage) + '&tag=' + encodeURIComponent(spec.tag),
    15 * 60 * 1000);
  if (r.status < 200 || r.status >= 300) throw new Error((r.data && r.data.message) || ('Docker image pull failed (HTTP ' + r.status + ')'));
  const errLine = String(r.body || '').split(/\r?\n/).filter(Boolean).map(x => { try { return JSON.parse(x); } catch (_) { return null; } }).find(x => x && (x.error || x.errorDetail));
  if (errLine) throw new Error(errLine.error || (errLine.errorDetail && errLine.errorDetail.message) || 'Docker image pull failed');
  const img = await dockerInspectImage(spec.ref);
  if (!img.Id) throw new Error('Docker pulled the image but did not return an image ID');
  return { ref: spec.ref, id: String(img.Id) };
}
const _dockerUpdating = new Set();
async function dockerUpdateAllowedContainer (target) {
  const lock = String(target && (target.fullId || target.name) || '');
  if (!lock) throw new Error('Container could not be identified');
  if (_dockerUpdating.has(lock)) throw new Error('An update is already running for this container');
  _dockerUpdating.add(lock);
  try {
    const old = await dockerInspectContainer(target.fullId);
    const name = String(old.Name || target.name || '').replace(/^\/+/, '');
    const imageRef = String(old.Config && old.Config.Image || target.image || '').trim();
    const oldImageId = String(old.Image || '').trim();
    const wasRunning = !!(old.State && old.State.Running);
    if (!name || !imageRef || !oldImageId) throw new Error('Could not capture the current container configuration for rollback');
    const pulled = await dockerPullConfiguredImage(imageRef);
    if (pulled.id === oldImageId) return { updated: false, message: 'Image is already current', image: pulled.ref, imageId: pulled.id, containerId: target.fullId };
    // The original is renamed and stopped (not deleted) until the replacement is proven
    // healthy with every mount intact; on any failure it is restored untouched.
    const r = await dockerShared().replaceContainer({
      id: target.fullId, image: pulled.ref, readySeconds: 90, envFromImage: true,
      log: m => console.log('[docker-update] ' + name + ': ' + m)
    });
    if (r.ok) {
      return { updated: true, message: 'Container updated successfully' + (r.warning ? ' — ' + r.warning : ''),
               image: pulled.ref, previousImageId: oldImageId, imageId: pulled.id, containerId: r.id, wasRunning };
    }
    if (r.rolledBack) throw new Error('Update failed; previous container was restored: ' + r.reason);
    throw new Error('Update failed and rollback also failed: ' + r.reason + (r.recovery ? ' · recover with: ' + r.recovery : ''));
  } finally {
    _dockerUpdating.delete(lock);
  }
}
async function dockerAllowedContainers () {
  const cfg = readConfig().dockerControl || DEFAULT_CONFIG.dockerControl;
  const allowed = normalizeDockerAllowed(cfg.allowedContainers);
  const wanted = new Set(allowed.map(x => x.toLowerCase()));
  const r = await dockerApi('GET', '/containers/json?all=1', 8000);
  const all = Array.isArray(r.data) ? r.data : [];
  return all.filter(c => dockerAliases(c).some(a => wanted.has(String(a).toLowerCase()))).map(c => {
    const aliases = dockerAliases(c);
    return {
      id: String(c.Id || '').slice(0, 12),
      fullId: String(c.Id || ''),
      name: aliases[0] || String(c.Id || '').slice(0, 12),
      service: (c.Labels && c.Labels['com.docker.compose.service']) || '',
      image: c.Image || '', state: c.State || '', status: c.Status || '',
      allowedAs: aliases.find(a => wanted.has(String(a).toLowerCase())) || '',
      self: dockerIsSelf(c),
      updatable: !dockerIsSelf(c) && dockerImageCanUpdate(c.Image || '')
    };
  }).sort((a,b) => a.name.localeCompare(b.name));
}
async function dockerControlStatus () {
  const cfg = readConfig().dockerControl || DEFAULT_CONFIG.dockerControl;
  const allowedContainers = normalizeDockerAllowed(cfg.allowedContainers);
  const base = { enabled: !!cfg.enabled, socketPath: DOCKER_SOCKET,
    socketPresent: fs.existsSync(DOCKER_SOCKET), allowedContainers, containers: [] };
  if (!base.enabled) { base.message = 'Docker controls are disabled'; return base; }
  if (!base.socketPresent) { base.message = 'Docker socket is not mounted at ' + DOCKER_SOCKET; return base; }
  try {
    const version = await dockerApiVersion();
    base.apiVersion = version;
    base.containers = await dockerAllowedContainers();
    base.available = true;
    if (!base.containers.length) base.message = 'Docker connected, but no allowed containers were found';
  } catch (e) {
    base.available = false; base.message = e.message;
  }
  return base;
}


/* ---------- GitHub release / self-update ----------
   GitHub Releases are the update source. Official release images bake the source
   repository into MEDIARR_UPDATE_REPO. Source/local builds can set it in Admin.
   Docker self-update is performed by a short-lived helper container because a
   process cannot safely remove and replace the container it is running inside. */
let _updateReleaseCache = { key: '', at: 0, value: null };
function normalizeUpdateRepo (raw) {
  const x = String(raw || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(x) ? x : '';
}
function updateRepo () { return normalizeUpdateRepo(UPDATE_REPO_ENV || ((readConfig().update || {}).repo)); }
function cleanVersion (v) { return String(v || '').trim().replace(/^v/i, '').split('+')[0]; }
function versionParts (v) {
  const m = cleanVersion(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ''] : null;
}
function compareVersions (a, b) {
  const A = versionParts(a), B = versionParts(b); if (!A || !B) return String(a).localeCompare(String(b));
  for (let i=0;i<3;i++) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  if (A[3] === B[3]) return 0; if (!A[3]) return 1; if (!B[3]) return -1;
  return A[3].localeCompare(B[3], undefined, { numeric: true, sensitivity: 'base' });
}
async function githubLatestRelease (force) {
  const repo = updateRepo();
  if (!repo) throw new Error('No GitHub update repository is configured');
  const key = repo.toLowerCase();
  if (!force && _updateReleaseCache.key === key && _updateReleaseCache.value && Date.now() - _updateReleaseCache.at < 5 * 60 * 1000) return _updateReleaseCache.value;
  const url = UPDATE_API_BASE + '/repos/' + repo + '/releases/latest';
  const r = await upstream(url, { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'MEDIARR/' + APP_VERSION, 'X-GitHub-Api-Version': '2022-11-28' }, timeout: 15000 });
  if (r.status === 404) throw new Error('No published GitHub Release was found for ' + repo);
  if (r.status >= 400) throw new Error('GitHub returned HTTP ' + r.status);
  let d = null; try { d = JSON.parse(r.body.toString('utf8')); } catch (_) { throw new Error('GitHub returned an invalid release response'); }
  const version = cleanVersion(d.tag_name || d.name || '');
  if (!versionParts(version)) throw new Error('Latest GitHub release does not use a semantic version tag such as v1.3.0');
  const assets = Array.isArray(d.assets) ? d.assets.map(a => ({ name: a.name || '', url: a.browser_download_url || '', bytes: Number(a.size)||0 })).filter(a => a.url) : [];
  const value = { repo, version, tag: d.tag_name || ('v' + version), name: d.name || d.tag_name || version, notes: String(d.body || '').slice(0, 20000), publishedAt: d.published_at || '', url: d.html_url || ('https://github.com/' + repo + '/releases/latest'), assets, image: 'ghcr.io/' + repo.toLowerCase() + ':' + version };
  _updateReleaseCache = { key, at: Date.now(), value }; return value;
}
async function dockerSelfInspect () {
  if (!fs.existsSync(DOCKER_SOCKET)) return null;
  const host = String(os.hostname() || '').trim(); if (!host) return null;
  try { return (await dockerApi('GET', '/containers/' + encodeURIComponent(host) + '/json', 8000)).data || null; } catch (_) { return null; }
}
function dockerSocketHostSource (inspect) {
  const mounts = (inspect && inspect.Mounts) || [];
  const m = mounts.find(x => String(x.Destination || '') === DOCKER_SOCKET);
  return m && m.Source ? String(m.Source) : '';
}
async function updateStatus (force) {
  const cfg = readConfig().update || DEFAULT_CONFIG.update;
  const repo = updateRepo();
  const self = await dockerSelfInspect();
  const socketSource = dockerSocketHostSource(self);
  const base = { currentVersion: APP_VERSION, repo, enabled: cfg.enabled !== false, updateAvailable: false,
    docker: !!self, currentImage: self && self.Config ? self.Config.Image || '' : '', canAutoUpdate: false,
    autoUpdateReason: '', sourceLockedByImage: !!UPDATE_REPO_ENV };
  if (!base.enabled) { base.message = 'Update checks are disabled'; return base; }
  if (!repo) { base.message = 'Set the GitHub repository (owner/repository) to enable update checks'; return base; }
  try {
    const latest = await githubLatestRelease(!!force); base.latest = latest;
    base.updateAvailable = compareVersions(APP_VERSION, latest.version) < 0;
    if (!self) base.autoUpdateReason = 'Automatic install is available only when MEDIARR itself runs in Docker';
    else if (!socketSource) base.autoUpdateReason = 'The Docker socket is not a host bind mount MEDIARR can pass to the updater';
    else { base.canAutoUpdate = true; base.autoUpdateReason = ''; }
    return base;
  } catch (e) { base.message = e.message; return base; }
}
async function pullDockerImage (image) {
  const i = String(image || ''); const at = i.lastIndexOf(':');
  if (!/^ghcr\.io\//i.test(i) || at <= 'ghcr.io/'.length) throw new Error('Refusing to pull a non-GHCR update image');
  const from = i.slice(0, at), tag = i.slice(at + 1);
  const v = await dockerApiVersion();
  const r = await dockerRawRequest('POST', '/v' + v + '/images/create?fromImage=' + encodeURIComponent(from) + '&tag=' + encodeURIComponent(tag), 10 * 60 * 1000);
  if (r.status < 200 || r.status >= 300) throw new Error((r.data && r.data.message) || ('Docker image pull failed (HTTP ' + r.status + ')'));
  const errLine = String(r.body || '').split(/\r?\n/).filter(Boolean).map(x => { try { return JSON.parse(x); } catch (_) { return null; } }).find(x => x && (x.error || x.errorDetail));
  if (errLine) throw new Error(errLine.error || (errLine.errorDetail && errLine.errorDetail.message) || 'Docker image pull failed');
  return true;
}
async function launchUpdateHelper (targetImage, release) {
  const self = await dockerSelfInspect(); if (!self) throw new Error('MEDIARR is not running in a Docker container visible through this socket');
  const socketSource = dockerSocketHostSource(self); if (!socketSource) throw new Error('Could not identify the host Docker socket mount');
  const selfId = self.Id, helperName = 'mediarr-updater-' + Date.now();
  const body = {
    Image: (self.Config && self.Config.Image) || '',
    Cmd: ['node', '/app/update-helper.js'],
    Env: [
      'DOCKER_SOCKET=' + DOCKER_SOCKET,
      'MEDIARR_UPDATE_SELF_ID=' + selfId,
      'MEDIARR_UPDATE_TARGET_IMAGE=' + targetImage,
      'MEDIARR_UPDATE_TARGET_VERSION=' + cleanVersion(release.version || ''),
      'MEDIARR_UPDATE_OLD_VERSION=' + APP_VERSION
    ],
    HostConfig: { AutoRemove: true, Binds: [socketSource + ':' + DOCKER_SOCKET], RestartPolicy: { Name: 'no' } }
  };
  if (!body.Image) throw new Error('Could not determine the current MEDIARR Docker image');
  const v = await dockerApiVersion();
  const created = await dockerRawRequest('POST', '/v' + v + '/containers/create?name=' + encodeURIComponent(helperName), 15000, body);
  if (created.status < 200 || created.status >= 300 || !created.data || !created.data.Id) throw new Error((created.data && created.data.message) || 'Could not create update helper');
  const started = await dockerRawRequest('POST', '/v' + v + '/containers/' + encodeURIComponent(created.data.Id) + '/start', 15000);
  if (![204,304].includes(started.status)) throw new Error((started.data && started.data.message) || 'Could not start update helper');
  return { helper: String(created.data.Id).slice(0,12), targetImage };
}

/* ---------- system info & admin-defined commands ----------
   Deliberately conservative: commands are stored server-side by an admin and run by id.
   The API never accepts a command string from a request, so this can't become a remote shell. */
function systemInfo () {
  const plat = os.platform();
  const info = {
    platform: plat,
    prettyPlatform: plat === 'linux' ? 'Linux' : plat === 'darwin' ? 'macOS' : plat === 'win32' ? 'Windows' : plat,
    arch: os.arch(), release: os.release(), hostname: os.hostname(),
    node: process.version, uptimeSeconds: Math.round(os.uptime()),
    cpus: (os.cpus() || []).length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
    freeMemMB: Math.round(os.freemem() / 1048576),
    pid: process.pid,
    canRunCommands: plat !== 'win32' || true
  };
  if (plat === 'linux') {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8');
      const get = k => { const m = new RegExp('^' + k + '="?([^"\n]*)"?', 'm').exec(rel); return m ? m[1] : ''; };
      info.distro = get('PRETTY_NAME') || get('NAME');
      info.distroId = get('ID');
    } catch (e) {}
    // container hints — useful because systemctl often isn't available inside one
    try {
      if (fs.existsSync('/run/systemd/container')) info.container = fs.readFileSync('/run/systemd/container', 'utf8').trim();
      else if (fs.existsSync('/.dockerenv')) info.container = 'docker';
      else {
        const cg = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (/docker|lxc|kubepods/i.test(cg)) info.container = /lxc/i.test(cg) ? 'lxc' : 'docker';
      }
    } catch (e) {}
    info.hasSystemd = fs.existsSync('/run/systemd/system');
  }
  if (typeof process.getuid === 'function') {
    info.uid = process.getuid();
    info.runningAsRoot = process.getuid() === 0;
    try { info.user = os.userInfo().username; } catch (e) {}
  }
  return info;
}
// Can we sudo without being prompted for a password?
function sudoCheck () {
  if (os.platform() === 'win32') return { available: false, passwordless: false, reason: 'not applicable on Windows' };
  try {
    const which = spawnSync('sh', ['-c', 'command -v sudo'], { timeout: 4000 });
    if (!which.stdout || !String(which.stdout).trim()) return { available: false, passwordless: false, reason: 'sudo is not installed' };
  } catch (e) { return { available: false, passwordless: false, reason: 'could not check for sudo' }; }
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { available: true, passwordless: true, reason: 'already running as root — sudo not needed' };
  }
  try {
    const r = spawnSync('sudo', ['-n', 'true'], { timeout: 5000 });
    if (r.status === 0) return { available: true, passwordless: true, reason: 'passwordless sudo works' };
    return { available: true, passwordless: false, reason: 'sudo needs a password — MEDIARR can\'t supply one' };
  } catch (e) { return { available: true, passwordless: false, reason: 'sudo check failed' }; }
}
// Does this command look like it needs elevated rights?
function commandNeedsRoot (cmd) {
  const c = String(cmd || '');
  if (/^\s*sudo\b/.test(c)) return { needsRoot: true, why: 'starts with sudo' };
  if (/\bsystemctl\s+(restart|start|stop|reload|enable|disable)\b/.test(c)) return { needsRoot: true, why: 'systemctl service control' };
  if (/\bservice\s+\S+\s+(restart|start|stop)\b/.test(c)) return { needsRoot: true, why: 'service control' };
  if (/\b(apt|apt-get|dnf|yum|pacman)\b/.test(c)) return { needsRoot: true, why: 'package manager' };
  if (/\b(reboot|shutdown|poweroff)\b/.test(c)) return { needsRoot: true, why: 'system power command' };
  if (/\bmount\b|\bumount\b/.test(c)) return { needsRoot: true, why: 'mount command' };
  if (/^\s*(docker|podman)\b/.test(c)) return { needsRoot: false, why: 'docker — needs group membership rather than sudo' };
  return { needsRoot: false, why: '' };
}
const SHELL_LOG = [];
function runSavedCommand (entry, me, cb) {
  const started = Date.now();
  const child = spawn('/bin/sh', ['-c', entry.cmd], {
    cwd: ROOT,
    env: Object.assign({}, process.env),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '', err = '', capped = false;
  const CAP = 64 * 1024;
  const grab = (buf, which) => {
    const t = buf.toString('utf8');
    if (which === 'o') { if (out.length < CAP) out += t; else capped = true; }
    else { if (err.length < CAP) err += t; else capped = true; }
  };
  child.stdout.on('data', b => grab(b, 'o'));
  child.stderr.on('data', b => grab(b, 'e'));
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 120000);
  let done = false;
  const finish = (code, signal) => {
    if (done) return; done = true;
    clearTimeout(timer);
    const rec = {
      ts: started, ms: Date.now() - started, name: entry.name, cmd: entry.cmd,
      user: me ? me.username : '', code: code == null ? null : code, signal: signal || null,
      out: (out + (err ? (out ? '\n' : '') + err : '')).slice(0, CAP) + (capped ? '\n…output truncated…' : '')
    };
    SHELL_LOG.unshift(rec); if (SHELL_LOG.length > 50) SHELL_LOG.length = 50;
    cb(rec);
  };
  child.on('error', e => finish(null, 'spawn failed: ' + e.message));
  child.on('close', (code, signal) => finish(code, signal));
}

/* ---------- RSS release feeds ---------- */
const RSS_PATH = path.join(DATA_DIR, 'rss.json');
let rssState = null, rssTimer = null, rssRunning = false;
function readRss () {
  if (rssState) return rssState;
  try { rssState = JSON.parse(fs.readFileSync(RSS_PATH, 'utf8')); }
  catch (e) { rssState = { seen: {}, log: [], lastRun: 0 }; }
  if (!rssState.seen) rssState.seen = {};
  if (!rssState.log) rssState.log = [];
  return rssState;
}
function writeRss () { try { fs.writeFileSync(RSS_PATH, JSON.stringify(rssState)); } catch (e) {} }
function rssLog (icon, title, msg, extra) {
  const st = readRss();
  st.log.unshift(Object.assign({ ts: Date.now(), icon, title: title || '', msg: msg || '' }, extra || {}));
  if (st.log.length > 400) st.log.length = 400;
}
function decodeEnt (t) {
  return String(t || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .trim();
}
function tagText (block, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(block);
  return m ? decodeEnt(m[1]) : '';
}
// Pull items out of an RSS or Atom feed.
function parseFeed (xml) {
  const items = [];
  const blocks = String(xml).match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = tagText(b, 'title');
    if (!title) continue;
    let guid = tagText(b, 'guid') || tagText(b, 'id') || tagText(b, 'link');
    if (!guid) {
      const l = /<link[^>]*href=["']([^"']+)["']/i.exec(b);
      guid = l ? l[1] : title;
    }
    items.push({ title, guid, date: tagText(b, 'pubDate') || tagText(b, 'updated') || tagText(b, 'published') || '' });
  }
  return items;
}
const RSS_JUNK = /\b(1080p|2160p|720p|480p|4k|uhd|hdr|hdr10|dolby|vision|dv|bluray|blu-ray|bdrip|brrip|web-?dl|web-?rip|webrip|hdtv|dvdrip|remux|x264|x265|h\.?264|h\.?265|hevc|avc|xvid|aac|ac3|eac3|dts|dtshd|truehd|atmos|ddp?5?\.?1|flac|mp3|10bit|8bit|proper|repack|extended|unrated|directors?\.?cut|imax|limited|internal|multi|dual|subbed|dubbed|complete|season|episode)\b/i;
/* Turn a scene release name into something we can look up.
   "The.Movie.Name.2021.1080p.BluRay.x264-GRP" -> { kind:'movie', title:'The Movie Name', year:'2021' }
   "Show.Name.S02E05.1080p.WEB-DL"             -> { kind:'series', title:'Show Name' }        */
function parseRelease (raw) {
  let name = String(raw || '').trim();
  if (!name) return null;
  name = name.replace(/^\[[^\]]*\]\s*/, '');            // leading [tag]
  name = name.replace(/\s*\((?:download|nzb|torrent)\)\s*$/i, '');
  const dotted = name.replace(/[_]+/g, '.').replace(/\s+/g, '.');

  // TV: SxxExx, Sxx, or a daily date
  let m = /^(.+?)\.S(\d{1,2})(?:E\d{1,3})?(?:[.\-]|$)/i.exec(dotted);
  if (m) return { kind: 'series', title: cleanTitle(m[1]), year: '' };
  m = /^(.+?)\.(\d{4})\.(\d{2})\.(\d{2})(?:[.\-]|$)/.exec(dotted);
  if (m) return { kind: 'series', title: cleanTitle(m[1]), year: '' };
  m = /^(.+?)\.Season[.\s]?(\d{1,2})(?:[.\-]|$)/i.exec(dotted);
  if (m) return { kind: 'series', title: cleanTitle(m[1]), year: '' };

  // Movie: title followed by a 4-digit year
  m = /^(.+?)\.((?:19|20)\d{2})(?:[.\-]|$)/.exec(dotted);
  if (m) return { kind: 'movie', title: cleanTitle(m[1]), year: m[2] };

  // No year — take everything before the first quality/source token
  const parts = dotted.split('.');
  const cut = parts.findIndex(p => RSS_JUNK.test(p));
  const head = (cut > 0 ? parts.slice(0, cut) : parts).join('.');
  const t = cleanTitle(head);
  return t && t.length > 1 ? { kind: 'movie', title: t, year: '' } : null;
}
function cleanTitle (s) {
  return String(s || '').replace(/\./g, ' ').replace(/\s+/g, ' ')
    .replace(/[\-–—:]+$/, '').trim();
}
// Decompress a response body if the server gzipped it.
function maybeGunzip (headers, buf) {
  const enc = String((headers && headers['content-encoding']) || '').toLowerCase();
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
    if (enc === 'br' && zlib.brotliDecompressSync) return zlib.brotliDecompressSync(buf);
  } catch (e) { /* fall through to the raw bytes */ }
  return buf;
}
/* Feed hosts are fussy: many are behind a CDN, redirect http->https or /feed -> /feed/,
   gzip the response, and reject unknown user agents. Handle all of that. */
async function fetchFeed (url) {
  const headers = {
    // a browser-ish UA — plain "MEDIARR" gets refused by some CDNs
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9',
    Connection: 'close'
  };
  let target = url, hops = 0;
  try {
    while (hops < 5) {
      const up = await upstream(target, { headers, timeout: 30000 });
      if (up.status >= 300 && up.status < 400 && up.headers.location) {
        try { target = new URL(up.headers.location, target).toString(); } catch (e) { return { ok: false, message: 'bad redirect from the feed' }; }
        hops++; continue;
      }
      if (up.status === 403 || up.status === 503) {
        return { ok: false, message: 'HTTP ' + up.status + ' — the site is blocking automated requests (bot protection). Try the feed URL in a browser to confirm it loads.' };
      }
      if (up.status === 404) return { ok: false, message: 'HTTP 404 — feed not found at that URL (try adding or removing a trailing slash)' };
      if (up.status >= 400) return { ok: false, message: 'HTTP ' + up.status };
      const text = maybeGunzip(up.headers, up.body).toString('utf8');
      if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) {
        const ct = String(up.headers['content-type'] || '').split(';')[0];
        return { ok: false, message: 'that URL did not return a feed' + (ct ? ' (got ' + ct + ')' : '') + ' — check it ends in /feed/ or /rss' };
      }
      const items = parseFeed(text);
      if (!items.length) return { ok: false, message: 'feed loaded but contained no items' };
      return { ok: true, items };
    }
    return { ok: false, message: 'too many redirects' };
  } catch (e) {
    const m = String(e.message || e);
    if (/ENOTFOUND|EAI_AGAIN/.test(m)) return { ok: false, message: 'could not resolve that hostname — check the URL or your DNS' };
    if (/ECONNREFUSED/.test(m)) return { ok: false, message: 'connection refused' };
    if (/timed out|ETIMEDOUT/i.test(m)) return { ok: false, message: 'timed out — the feed host did not respond' };
    if (/certificate|SSL|TLS/i.test(m)) return { ok: false, message: 'TLS/certificate error reaching the feed' };
    return { ok: false, message: m };
  }
}
function rssStatus () {
  const st = readRss(), cfg = readConfig().rss;
  return {
    enabled: !!cfg.enabled, running: rssRunning, feeds: cfg.feeds || [],
    intervalMinutes: cfg.intervalMinutes, addMovies: cfg.addMovies, addSeries: cfg.addSeries,
    maxPerRun: cfg.maxPerRun, minYear: cfg.minYear,
    lastRun: st.lastRun || 0, seenCount: Object.keys(st.seen).length,
    log: st.log.slice(0, 60)
  };
}
/* Poll each feed, work out what's new, and add anything we don't already have.
   TV releases add the whole series (Sonarr then grabs the seasons it's monitoring). */
async function runRssCheck (manual) {
  if (rssRunning) return { skipped: true };
  const cfg = readConfig().rss;
  if (!cfg.enabled && !manual) return { skipped: true };
  if (!cfg.feeds || !cfg.feeds.length) return { skipped: true, message: 'no feeds configured' };
  rssRunning = true;
  const st = readRss();
  let added = 0, have = 0, failed = 0, newItems = 0, feedErrors = 0;
  try {
    for (const url of cfg.feeds) {
      const f = await fetchFeed(url);
      if (!f.ok) { feedErrors++; rssLog('⚠', url, 'feed error: ' + f.message); logError('rss', f.message, url); continue; }
      let handled = 0;
      for (const item of f.items) {
        const key = String(item.guid || item.title).slice(0, 300);
        if (st.seen[key]) continue;                       // already processed this release
        st.seen[key] = Date.now();
        newItems++;
        if (added + have >= cfg.maxPerRun) continue;      // still mark as seen, just don't act this run
        const rel = parseRelease(item.title);
        if (!rel || !rel.title) { rssLog('•', item.title, 'could not read a title from this release'); continue; }
        if (rel.kind === 'movie' && !cfg.addMovies) continue;
        if (rel.kind === 'series' && !cfg.addSeries) continue;
        if (rel.kind === 'movie' && cfg.minYear && rel.year && Number(rel.year) < cfg.minYear) { rssLog('•', rel.title, 'older than ' + cfg.minYear); continue; }
        try {
          const r = await addToArr({ type: rel.kind, title: rel.title, year: rel.year || undefined, search: true }, null, null, { quiet: true });
          const b = r.body || {};
          if (b.ok && b.added) { added++; handled++; notify('rss', (rel.kind === 'series' ? '📺 ' : '🎬 ') + (b.title || rel.title), 'Added automatically from an RSS feed' + (rel.kind === 'series' ? ' (whole show)' : ''), 'good'); rssLog('✓', b.title || rel.title, 'added' + (rel.kind === 'series' ? ' (whole show)' : (rel.year ? ' (' + rel.year + ')' : '')), { kind: rel.kind, release: item.title }); }
          else if (b.alreadyInLibrary) { have++; rssLog('•', b.title || rel.title, 'already in library', { kind: rel.kind }); }
          else { failed++; rssLog('⚠', rel.title, b.message || 'could not add', { kind: rel.kind, release: item.title }); }
        } catch (e) { failed++; rssLog('⚠', rel.title, e.message || 'error'); }
      }
    }
    // keep the seen-list from growing forever (30 days)
    const cut = Date.now() - 30 * 864e5;
    for (const k of Object.keys(st.seen)) if (st.seen[k] < cut) delete st.seen[k];
    st.lastRun = Date.now();
    rssLog('▶', '', 'checked ' + cfg.feeds.length + ' feed(s) · ' + newItems + ' new item(s) · ' + added + ' added, ' + have + ' already there' + (failed ? ', ' + failed + ' failed' : ''));
    writeRss();
  } finally { rssRunning = false; }
  return { added, have, failed, newItems, feedErrors };
}
function scheduleRss () {
  if (rssTimer) clearTimeout(rssTimer);
  const cfg = readConfig().rss;
  if (!cfg.enabled || !(cfg.feeds || []).length) return;
  const mins = Math.max(10, Number(cfg.intervalMinutes) || 30);
  rssTimer = setTimeout(async () => { await runRssCheck(false).catch(() => {}); scheduleRss(); }, mins * 60000);
  if (rssTimer.unref) rssTimer.unref();
}
setTimeout(() => { try { scheduleBackups(); } catch (e) {} }, 8000).unref?.();
setTimeout(() => { const c = readConfig().rss; if (c.enabled && (c.feeds || []).length) runRssCheck(false).then(scheduleRss).catch(scheduleRss); else scheduleRss(); }, 20000).unref?.();

/* ---------- background library scanner (speeds up the Movies / Shows browsers) ---------- */
const LIBCACHE_PATH = path.join(DATA_DIR, 'library-cache.json');
let libCache = null, libScanTimer = null, libScanning = false;
function readLibCache () {
  if (libCache) return libCache;
  try { libCache = JSON.parse(fs.readFileSync(LIBCACHE_PATH, 'utf8')); } catch (e) { libCache = { radarr: null, sonarr: null }; }
  return libCache;
}
function writeLibCache () { try { fs.writeFileSync(LIBCACHE_PATH, JSON.stringify(libCache)); } catch (e) {} }
function slimPoster (images) {
  if (!Array.isArray(images)) return [];
  const p = images.find(i => i.coverType === 'poster') || images[0];
  if (!p) return [];
  return [{ coverType: 'poster', remoteUrl: p.remoteUrl || '', url: p.url || '' }];
}
// Keep only what the library browsers actually render — the raw payload is many MB.
function slimItem (it, svc) {
  const base = {
    id: it.id, title: it.title, sortTitle: it.sortTitle || it.title, year: it.year || '',
    monitored: !!it.monitored, images: slimPoster(it.images), imdbId: it.imdbId || '',
    added: it.added || it.dateAdded || ''
  };
  if (svc === 'radarr') { base.hasFile = !!it.hasFile; base.tmdbId = it.tmdbId || null; base.sizeOnDisk = it.sizeOnDisk || 0; }
  else {
    const st = it.statistics || {};
    base.tvdbId = it.tvdbId || null;
    base.statistics = { episodeCount: st.episodeCount || 0, episodeFileCount: st.episodeFileCount || 0, sizeOnDisk: st.sizeOnDisk || 0 };
  }
  return base;
}
let libScanErr = { radarr: '', sonarr: '' };
const SONARR_LIBRARY_MAX_AGE_MS = 15000;
function upsertLibCacheItem (svc, raw) {
  if (!raw || (!raw.id && !raw.title)) return false;
  const item = slimItem(raw, svc);
  const c = readLibCache();
  const cur = c[svc] && Array.isArray(c[svc].items) ? c[svc].items.slice() : [];
  const match = x => (item.id && Number(x.id) === Number(item.id)) ||
    (item.imdbId && x.imdbId && String(x.imdbId).toLowerCase() === String(item.imdbId).toLowerCase()) ||
    (svc === 'radarr' && item.tmdbId && String(x.tmdbId || '') === String(item.tmdbId)) ||
    (svc === 'sonarr' && item.tvdbId && String(x.tvdbId || '') === String(item.tvdbId));
  const idx = cur.findIndex(match);
  if (idx >= 0) cur[idx] = item; else cur.push(item);
  cur.sort((a, b) => String(a.sortTitle || a.title || '').localeCompare(String(b.sortTitle || b.title || '')));
  c[svc] = { items: cur, ts: Date.now(), count: cur.length };
  writeLibCache();
  return true;
}
function scheduleLibraryReconcile (svc, delayMs) {
  const t = setTimeout(() => { scanLibrary(svc).catch(() => {}); }, Math.max(250, Number(delayMs) || 1500));
  if (t.unref) t.unref();
}
async function scanLibrary (svc) {
  const cfg = readConfig()[svc];
  if (!cfg.url || !cfg.apiKey) { libScanErr[svc] = svc + ' is not configured'; return { ok: false, message: libScanErr[svc] }; }
  const res = await arrListAll(svc, svc === 'radarr' ? '/api/v3/movie' : '/api/v3/series');
  if (!res.ok) {
    const probe = await arrProbe(svc);
    libScanErr[svc] = probe.message || ('Could not read ' + svc);
    logError(svc + ':scan', libScanErr[svc], 'library scan could not read the item list');
    return { ok: false, message: libScanErr[svc] };
  }
  const list = res.items;
  libScanErr[svc] = '';
  const items = list.map(x => slimItem(x, svc)).sort((a, b) => String(a.sortTitle || '').localeCompare(String(b.sortTitle || '')));
  const c = readLibCache();
  c[svc] = { items, ts: Date.now(), count: items.length };
  writeLibCache();
  try { realtimePush('library', { service: svc, count: items.length, reason: 'scan' }); } catch (_) {}
  return { ok: true, count: items.length };
}
async function scanAllLibraries (reason) {
  if (libScanning) return;
  libScanning = true;
  const out = {};
  for (const svc of ['radarr', 'sonarr']) {
    try { out[svc] = await scanLibrary(svc); } catch (e) { out[svc] = { ok: false, message: e.message }; }
  }
  libScanning = false;
  try {
    const bits = ['radarr', 'sonarr'].filter(s => out[s] && out[s].ok).map(s => s + ':' + out[s].count);
    if (bits.length) console.log('[mediarr] library scan (' + (reason || 'scheduled') + ') → ' + bits.join(' '));
  } catch (e) {}
  return out;
}
function scheduleLibScan () {
  if (libScanTimer) clearTimeout(libScanTimer);
  const cfg = readConfig().libraryCache;
  if (!cfg.enabled) return;
  const mins = Math.max(60, Number(cfg.intervalMinutes) || 360);      // hard floor: 60 minutes
  libScanTimer = setTimeout(async () => { await scanAllLibraries('scheduled'); scheduleLibScan(); }, mins * 60000);
  if (libScanTimer.unref) libScanTimer.unref();
}
function libCacheStatus () {
  const c = readLibCache(), cfg = readConfig().libraryCache;
  const mins = Math.max(60, Number(cfg.intervalMinutes) || 360);
  const one = svc => c[svc] ? { count: c[svc].count, ts: c[svc].ts, ageMinutes: Math.round((Date.now() - c[svc].ts) / 60000) } : null;
  return { enabled: !!cfg.enabled, intervalMinutes: mins, scanning: libScanning, radarr: one('radarr'), sonarr: one('sonarr'), errors: libScanErr };
}
// First scan shortly after boot so the browsers are fast straight away.
setTimeout(() => { const cfg = readConfig().libraryCache; if (cfg.enabled) scanAllLibraries('startup').then(scheduleLibScan); else scheduleLibScan(); }, 4000).unref?.();

/* CLI helpers so recovery works even when the app can't start or nobody can log in:
     node server.js --list-backups
     node server.js --restore                (newest backup)
     node server.js --restore <file.json>    (a specific one) */
(function handleCliBackup () {
  const args = process.argv.slice(2);
  const wantList = args.includes('--list-backups');
  const ri = args.indexOf('--restore');
  if (!wantList && ri === -1) return;
  ensureBackupDir();
  if (wantList) {
    const list = listBackups();
    if (!list.length) console.log('No backups found in ' + BACKUP_DIR);
    else {
      console.log('Backups in ' + BACKUP_DIR + ':');
      list.forEach(b => console.log('  ' + b.name + '   ' + (b.bytes / 1024).toFixed(1) + ' KB   ' + new Date(b.at).toLocaleString()));
    }
    process.exit(0);
  }
  let file = args[ri + 1] && !args[ri + 1].startsWith('--') ? args[ri + 1] : '';
  if (!file) {
    const newest = listBackups()[0];
    if (!newest) { console.error('No backups found in ' + BACKUP_DIR); process.exit(1); }
    file = path.join(BACKUP_DIR, newest.name);
  } else if (!path.isAbsolute(file) && !fs.existsSync(file)) {
    const inDir = path.join(BACKUP_DIR, file);
    if (fs.existsSync(inDir)) file = inDir;
  }
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error('Could not read ' + file + ': ' + e.message); process.exit(1); }
  const r = restoreBackup(data);
  if (!r.ok && !r.restored) { console.error('Restore failed: ' + (r.message || r.failed.join('; '))); process.exit(1); }
  console.log('Restored from ' + path.basename(file) + ': ' + r.restored.join(', '));
  if (r.failed.length) console.log('Failed: ' + r.failed.join('; '));
  if (r.safetyCopy) console.log('A copy of the previous state was saved as ' + r.safetyCopy);
  console.log('Start MEDIARR normally now.');
  process.exit(0);
})();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  try {
    // static (login screen is part of the SPA; the APIs below are protected)
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      const ua = (req.headers['user-agent'] || '').toLowerCase();
      const isMobileUA = /android|iphone|ipod|iemobile|blackberry|opera mini|mobile/.test(ua);
      const forceDesktop = /[?&]d=1\b/.test(req.url || '');
      if (isMobileUA && !forceDesktop) { res.writeHead(302, { Location: '/m' }); return res.end(); }
      return serveStatic(res, 'index.html');
    }
    if (req.method === 'GET' && (p === '/m' || p === '/m/' || p === '/mobile' || p === '/mobile.html')) return serveStatic(res, 'mobile.html');
    if (req.method === 'GET' && p === '/bootstrap.min.css') return serveVendor(res, 'bootstrap.min.css', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css');
    if (req.method === 'GET' && p === '/bootstrap.bundle.min.js') return serveVendor(res, 'bootstrap.bundle.min.js', 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js');
    if (req.method === 'GET' && p === '/hls.min.js') return serveVendor(res, 'hls.min.js', 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js');

    // ---- auth (open) ----
    if (p === '/api/setup-needed' && req.method === 'GET') {
      return sendJSON(res, 200, { needed: readUsers().users.length === 0, loginTheme: (readConfig().ui || {}).loginTheme || 'tron' });
    }
    if (p === '/api/setup' && req.method === 'POST') {
      const data = readUsers();
      if (data.users.length) return sendJSON(res, 403, { message: 'Setup already complete' });
      const { username, password } = JSON.parse(await readBody(req) || '{}');
      if (!username || !password) return sendJSON(res, 400, { message: 'Username and password required' });
      const { salt, hash } = hashPassword(password);
      const u = { username: String(username).trim(), role: 'admin', dailyLimit: 0, salt, hash, approved: true, registrationMethod: 'setup', createdAt: Date.now(), approvedAt: Date.now() };
      data.users.push(u); writeUsers(data);
      createSession(req, res, u.username);
      return sendJSON(res, 200, publicUser(u, true));
    }
    if (p === '/api/captcha' && req.method === 'GET') {
      if (!readUsers().users.length) return sendJSON(res, 409, { message: 'The administrator must finish first-run setup first.' });
      const ip=clientIp(req), wait=captchaWait(ip);
      if (wait) { res.setHeader('Retry-After', String(wait)); return sendJSON(res, 429, { message: 'Too many CAPTCHA requests. Try again shortly.' }); }
      res.setHeader('Cache-Control','no-store');
      return sendJSON(res, 200, createCaptcha(ip));
    }
    if (p === '/api/register' && req.method === 'POST') {
      const data = readUsers();
      if (!data.users.length) return sendJSON(res, 409, { message: 'The administrator must finish first-run setup before registrations can be accepted.' });
      const ip = clientIp(req), wait = registrationWait(ip);
      if (wait) { res.setHeader('Retry-After', String(wait)); return sendJSON(res, 429, { message: 'Too many registrations from this address. Try again later.' }); }
      let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
      if (!verifyCaptcha(ip, body.captchaId, body.captchaAnswer)) return sendJSON(res, 400, { captcha: true, message: 'CAPTCHA was incorrect or expired. Please complete a new challenge.' });
      const username = registrationUsername(body.username), password = String(body.password || '');
      if (!username) return sendJSON(res, 400, { message: 'Username must be 3–40 characters using only letters, numbers, dots, dashes, or underscores.' });
      if (password.length < 4 || password.length > 256) return sendJSON(res, 400, { message: 'Password must be 4–256 characters.' });
      if (data.users.some(x => String(x.username || '').toLowerCase() === username.toLowerCase())) return sendJSON(res, 409, { message: 'That username already exists.' });
      const { salt, hash } = hashPassword(password), now = Date.now();
      const account = { username, role: 'user', dailyLimit: 10, salt, hash, approved: false, registrationMethod: 'password', requestedAt: now, createdAt: now };
      data.users.push(account); writeUsers(data); registrationRecord(ip); announceRegistration(account);
      return sendJSON(res, 202, { pending: true, username, message: 'Registration submitted. An administrator must approve your account before you can sign in.' });
    }
    if (p === '/api/auth/plex/pin' && req.method === 'POST') {
      if (!readUsers().users.length) return sendJSON(res, 409, { message: 'The administrator must finish first-run setup first.' });
      const ip = clientIp(req), wait = plexAuthWait(ip);
      if (wait) { res.setHeader('Retry-After', String(wait)); return sendJSON(res, 429, { message: 'Too many Plex sign-in attempts. Try again shortly.' }); }
      let body={}; try { body=JSON.parse((await readBody(req))||'{}'); } catch (_) {}
      const purpose=body.purpose==='register'?'register':'login';
      let captchaVerified=false;
      if (purpose==='register') {
        captchaVerified=verifyCaptcha(ip,body.captchaId,body.captchaAnswer);
        if (!captchaVerified) return sendJSON(res,400,{ captcha:true, message:'CAPTCHA was incorrect or expired. Please complete a new challenge.' });
      }
      const clientId = ensurePlexClientId();
      try {
        const up = await upstream('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: Object.assign({ 'Content-Length': '0' }, plexHeaders(clientId)) });
        if (up.status < 200 || up.status >= 300) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + up.status });
        const j = JSON.parse(up.body.toString('utf8')), nonce = crypto.randomBytes(24).toString('hex');
        prunePublicPlexPins(); plexAuthRecord(ip);
        publicPlexPins.set(String(j.id), { nonce, createdAt: Date.now(), purpose, captchaVerified });
        const authUrl = 'https://app.plex.tv/auth#?clientID=' + encodeURIComponent(clientId) + '&code=' + encodeURIComponent(j.code) + '&context%5Bdevice%5D%5Bproduct%5D=MEDIARR';
        return sendJSON(res, 200, { id: j.id, code: j.code, nonce, authUrl });
      } catch (e) { return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message }); }
    }
    if (p === '/api/auth/plex/check' && req.method === 'GET') {
      const id = String(u.searchParams.get('id') || '').replace(/[^0-9]/g, ''), nonce = String(u.searchParams.get('nonce') || '');
      prunePublicPlexPins();
      const pendingPin = publicPlexPins.get(id);
      if (!id || !/^[a-f0-9]{48}$/i.test(nonce) || !pendingPin || !crypto.timingSafeEqual(Buffer.from(nonce, 'utf8'), Buffer.from(String(pendingPin.nonce), 'utf8')))
        return sendJSON(res, 400, { message: 'That Plex sign-in request is no longer valid. Start again.' });
      const pin = await plexJson('https://plex.tv/api/v2/pins/' + id, '');
      if (!pin.ok) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + pin.status });
      const token = pin.data && pin.data.authToken;
      if (!token) return sendJSON(res, 200, { authorized: false });
      const acct = await plexJson('https://plex.tv/api/v2/user', token);
      if (!acct.ok) { publicPlexPins.delete(id); return sendJSON(res, 502, { message: 'Plex account lookup failed.' }); }
      const info = acct.data || {}, plexId = info.id != null ? String(info.id) : '';
      if (!plexId) { publicPlexPins.delete(id); return sendJSON(res, 502, { message: 'Plex did not return an account identifier.' }); }
      publicPlexPins.delete(id);
      const matches = await resolvePlexAccountMatch(plexId);
      if (matches.length > 1) return sendJSON(res, 409, { message: 'This Plex account is linked to more than one MEDIARR user. Sign in with username/password or ask an administrator to resolve the duplicate.' });
      if (matches.length === 1) {
        const data = readUsers(), account = data.users.find(x => x === matches[0] || String(x.username).toLowerCase() === String(matches[0].username).toLowerCase());
        account.plex = { token, rootToken: token, username: info.username || info.title || '', id: info.id, accountId: info.id, at: Date.now() };
        writeUsers(data);
        if (!userApproved(account)) return sendJSON(res, 202, { authorized: true, pending: true, username: account.username, message: 'Your MEDIARR registration is still waiting for administrator approval.' });
        createSession(req, res, account.username);
        return sendJSON(res, 200, { authorized: true, pending: false, user: publicUser(account, true) });
      }
      if (!pendingPin.captchaVerified || pendingPin.purpose !== 'register') return sendJSON(res, 403, { message: 'No MEDIARR account is linked to this Plex account. Use Request access and complete the CAPTCHA to register.' });
      const ip = clientIp(req), wait = registrationWait(ip);
      if (wait) { res.setHeader('Retry-After', String(wait)); return sendJSON(res, 429, { message: 'Too many registrations from this address. Try again later.' }); }
      const data = readUsers(), now = Date.now(), username = uniquePlexUsername(info);
      const account = {
        username, role: 'user', dailyLimit: 10, approved: false, registrationMethod: 'plex',
        requestedAt: now, createdAt: now,
        plex: { token, rootToken: token, username: info.username || info.title || '', id: info.id, accountId: info.id, at: now }
      };
      data.users.push(account); writeUsers(data); registrationRecord(ip); announceRegistration(account);
      return sendJSON(res, 202, { authorized: true, pending: true, username, message: 'Plex registration submitted. An administrator must approve your account before you can sign in.' });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      let username = '', password = '';
      try { ({ username, password } = JSON.parse(await readBody(req) || '{}')); } catch (e) {}
      const wait = loginBlocked(ip, username);
      if (wait) {
        logError('login', 'locked out after repeated failures', 'ip=' + ip + ' user=' + String(username || '?').slice(0, 40));
        notify('login', '🔒 Login lockout', 'Repeated failed logins for "' + String(username || '?').slice(0, 40) + '" from ' + ip, 'bad');
        res.setHeader('Retry-After', String(wait));
        return sendJSON(res, 429, { message: 'Too many failed attempts. Try again in ' + (wait >= 60 ? Math.ceil(wait / 60) + ' minute' + (wait >= 120 ? 's' : '') : wait + ' seconds') + '.' });
      }
      const u = findUser(username);
      if (!u || !u.hash || !verifyPassword(password, u.salt, u.hash)) {
        const locked = loginFailed(ip, username);
        logError('login', 'failed login', 'ip=' + ip + ' user=' + String(username || '?').slice(0, 40) + (locked ? ' — locked for ' + locked + 's' : ''));
        return sendJSON(res, 401, { message: locked
          ? 'Too many failed attempts. Locked for ' + (locked >= 60 ? Math.ceil(locked / 60) + ' minute' + (locked >= 120 ? 's' : '') : locked + ' seconds') + '.'
          : 'Invalid username or password' });
      }
      loginSucceeded(ip, username);
      if (!userApproved(u)) return sendJSON(res, 403, { pending: true, message: 'Your registration is waiting for administrator approval.' });
      createSession(req, res, u.username);
      return sendJSON(res, 200, publicUser(u, true));
    }
    if (p === '/api/version' && req.method === 'GET') return sendJSON(res, 200, { app: 'MEDIARR', version: APP_VERSION });
    if (p === '/api/logout' && req.method === 'POST') { clearSession(req, res); return sendJSON(res, 200, { ok: true }); }
    if (p === '/api/me' && req.method === 'GET') {
      const u = currentUser(req);
      if (!u) return sendJSON(res, 401, { message: 'Not logged in' });
      return sendJSON(res, 200, publicUser(u, true));
    }

    // Radarr/Sonarr Connect webhooks authenticate with their own generated token.
    if (p === '/api/webhooks/radarr' && req.method === 'POST') return handleArrWebhook('radarr', req, res, u);
    if (p === '/api/webhooks/sonarr' && req.method === 'POST') return handleArrWebhook('sonarr', req, res, u);

    // ---- everything else under /api requires a session ----
    if (p.startsWith('/api/v1/')) {
      const key = apiKeyFromReq(req, u);
      if (!key) return sendJSON(res, 401, { error: 'Missing API key. Send it as an X-API-Key header or ?api_key=' });
      const who = findUserByApiKey(key);
      if (!who) return sendJSON(res, 401, { error: 'Invalid API key' });
      return apiV1(p.slice('/api/v1'.length), req, res, u, who);
    }
    if (p.startsWith('/api/')) {
      const me = currentUser(req);
      if (!me) return sendJSON(res, 401, { message: 'Not logged in' });
      const adminOnly = (p === '/api/config' && req.method === 'POST') || p.startsWith('/api/admin/') || p.startsWith('/api/releases') || (p === '/api/plex/scan' && req.method === 'POST');
      if (adminOnly && me.role !== 'admin') return sendJSON(res, 403, { message: 'Admin only' });

      // ---- realtime dashboard + setup wizard (admin) ----
      if (p === '/api/admin/realtime/stream' && req.method === 'GET') return openRealtimeStream(req, res, me);
      if (p === '/api/admin/realtime/status' && req.method === 'GET') {
        return sendJSON(res, 200, Object.assign(realtimeSnapshot(), { webhooks: webhookInfo(req), setupNeeded: setupWizardNeeded() }));
      }
      if (p === '/api/admin/setup/status' && req.method === 'GET') {
        const cfg = readConfig();
        return sendJSON(res, 200, {
          needed: setupWizardNeeded(),
          complete: !!(cfg.realtime && cfg.realtime.setupComplete),
          configured: {
            radarr: !!(cfg.radarr.url && cfg.radarr.apiKey),
            sonarr: !!(cfg.sonarr.url && cfg.sonarr.apiKey),
            tmdb: !!cfg.tmdb.apiKey
          },
          config: sanitize(cfg),
          webhooks: webhookInfo(req)
        });
      }
      if (p === '/api/admin/setup/skip' && req.method === 'POST') {
        const cfg = readConfig();
        cfg.realtime = Object.assign({}, DEFAULT_CONFIG.realtime, cfg.realtime || {}, { setupComplete: true });
        if (!cfg.realtime.webhookToken) cfg.realtime.webhookToken = ensureWebhookToken();
        writeConfig(cfg);
        realtimePush('setup.completed', { user: me.username, skipped: true });
        return sendJSON(res, 200, { ok: true, webhooks: webhookInfo(req) });
      }
      if (p === '/api/admin/setup/complete' && req.method === 'POST') {
        let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        const cfg = readConfig();
        for (const svc of ['radarr','sonarr']) {
          const v = body[svc] || {};
          if (v.url != null) cfg[svc].url = normUrl(v.url);
          if (v.apiKey) cfg[svc].apiKey = String(v.apiKey).trim();
          if (v.qualityProfileId != null && String(v.qualityProfileId).trim() !== '') cfg[svc].qualityProfileId = v.qualityProfileId;
          if (v.rootFolderPath != null && String(v.rootFolderPath).trim() !== '') cfg[svc].rootFolderPath = String(v.rootFolderPath);
        }
        if (body.tmdb && body.tmdb.apiKey) cfg.tmdb.apiKey = String(body.tmdb.apiKey).trim();
        cfg.realtime = Object.assign({}, DEFAULT_CONFIG.realtime, cfg.realtime || {}, { setupComplete: true });
        if (!cfg.realtime.webhookToken) cfg.realtime.webhookToken = crypto.randomBytes(18).toString('hex');
        writeConfig(cfg);
        liveIdx.radarr = { ts: 0, ids: null }; liveIdx.sonarr = { ts: 0, ids: null };
        setTimeout(() => scanAllLibraries('setup-wizard').catch(() => {}), 100);
        realtimePush('setup.completed', { user: me.username, skipped: false });
        return sendJSON(res, 200, { ok: true, config: sanitize(cfg), webhooks: webhookInfo(req) });
      }

      // ---- Plex: trigger a library scan (admin) ----
      if (p === '/api/plex/scan' && req.method === 'POST') return plexScan(res);

      if (p === '/api/lookup' && req.method === 'GET') {
        const svc = u.searchParams.get('svc') === 'sonarr' ? 'sonarr' : 'radarr';
        const b = { imdbId: u.searchParams.get('imdbId') || '', tmdbId: u.searchParams.get('tmdbId') || '', tvdbId: u.searchParams.get('tvdbId') || '', title: u.searchParams.get('title') || '' };
        const term = addTerm(svc, b);
        if (!term) return sendJSON(res, 400, { items: [], message: 'nothing to look up' });
        const r = await arrLookup(svc, term);
        if (!r.ok) return sendJSON(res, 502, { items: [], message: 'lookup failed' });
        return sendJSON(res, 200, { items: r.items.slice(0, 20) });
      }

      if (p === '/api/library/check' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const items = Array.isArray(b.items) ? b.items : [];
        if (!items.length) return sendJSON(res, 200, { added: {} });
        return sendJSON(res, 200, { added: await libraryCheck(items) });
      }

      // ---- search every missing episode (rescan first, then search) ----
      // ---- SABnzbd queue + history (any signed-in user; read-only) ----
      if (p === '/api/sab' && req.method === 'GET') {
        const cfg = readConfig().sab;
        if (!cfg.url || !cfg.apiKey) return sendJSON(res, 200, { configured: false });
        const limit = Math.min(100, Number(u.searchParams.get('history')) || 30);
        const [q, h] = await Promise.all([ sabCall('queue'), sabCall('history', '&limit=' + limit) ]);
        if (!q.ok && !h.ok) { logError('sabnzbd', q.message || h.message, cfg.url); return sendJSON(res, 200, { configured: true, error: q.message || h.message }); }
        return sendJSON(res, 200, sabSlim(q.ok ? q.data : null, h.ok ? h.data : null));
      }

      // ---- Media Resolver / path mappings / per-user watch progress ----
      if (p === '/api/playback/progress' && req.method === 'GET') {
        const rel = u.searchParams.get('path') || '';
        return sendJSON(res, 200, rel ? { item: watchProgressForPath(me.username, rel) } : { items: watchContinueForUser(me.username, 50) });
      }
      if (p === '/api/playback/progress' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        const item = saveWatchProgress(me.username, b);
        if (!item) return sendJSON(res, 400, { message:'Missing playback path' });
        return sendJSON(res, 200, { ok:true, item });
      }
      if (p === '/api/admin/path-mappings' && req.method === 'GET') {
        const cfg = readConfig();
        return sendJSON(res, 200, {
          rules: normalizePathMappings(cfg.playback && cfg.playback.pathMappings),
          source: cfg.webdav.source === 'local' ? 'local' : 'webdav',
          sourceRoot: cfg.webdav.source === 'local' ? (cfg.webdav.localPath || '') : (cfg.webdav.folder || '/'),
          radarrRoot: cfg.radarr.rootFolderPath || '', sonarrRoot: cfg.sonarr.rootFolderPath || ''
        });
      }
      if (p === '/api/admin/path-mappings' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        const cfg = readConfig();
        cfg.playback = Object.assign({}, DEFAULT_CONFIG.playback, cfg.playback || {});
        cfg.playback.pathMappings = normalizePathMappings(b.rules);
        writeConfig(cfg);
        return sendJSON(res, 200, { ok:true, rules:cfg.playback.pathMappings });
      }
      if (p === '/api/admin/path-mappings/test' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        try { return sendJSON(res, 200, await pathMappingTest(b)); }
        catch (e) { return sendJSON(res, 400, { message:e.message }); }
      }
      if (p === '/api/admin/media/diagnostics' && req.method === 'GET') {
        const rel = u.searchParams.get('path') || '';
        if (!rel) return sendJSON(res, 400, { message:'Missing media path' });
        return sendJSON(res, 200, await playbackDiagnostics(rel));
      }

      // ---- configuration backups ----
      if (p === '/api/admin/backups' && req.method === 'GET') {
        const cfg = readConfig().backup;
        return sendJSON(res, 200, { backups: listBackups(), onChange: cfg.onChange, everyDays: cfg.everyDays, keep: cfg.keep, dir: BACKUP_DIR, includes: BACKUP_FILES });
      }
      if (p === '/api/admin/backups/create' && req.method === 'POST') {
        const r = createBackup('manual');
        return sendJSON(res, r.ok ? 200 : 502, Object.assign(r, { backups: listBackups() }));
      }
      if (p === '/api/admin/backups/download' && req.method === 'GET') {
        const name = path.basename(String(u.searchParams.get('name') || ''));
        if (!/^mediarr-config-.*\.json$/.test(name)) return sendJSON(res, 400, { message: 'Bad backup name' });
        const f = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(f)) return sendJSON(res, 404, { message: 'That backup no longer exists' });
        const body = fs.readFileSync(f);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="' + name + '"', 'Content-Length': body.length });
        return res.end(body);
      }
      if (p === '/api/admin/backups/delete' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const name = path.basename(String(b.name || ''));
        if (!/^mediarr-config-.*\.json$/.test(name)) return sendJSON(res, 400, { message: 'Bad backup name' });
        try { fs.unlinkSync(path.join(BACKUP_DIR, name)); } catch (e) {}
        return sendJSON(res, 200, { ok: true, backups: listBackups() });
      }
      if (p === '/api/admin/backups/restore' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        let data = b.data || null;
        if (!data && b.name) {
          const name = path.basename(String(b.name));
          if (!/^mediarr-config-.*\.json$/.test(name)) return sendJSON(res, 400, { message: 'Bad backup name' });
          try { data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8')); }
          catch (e) { return sendJSON(res, 404, { message: 'Could not read that backup' }); }
        }
        if (!data) return sendJSON(res, 400, { message: 'Nothing to restore' });
        const r = restoreBackup(data, { only: Array.isArray(b.only) && b.only.length ? b.only : null });
        if (!r.ok && !(r.restored || []).length) return sendJSON(res, 400, { ok: false, message: r.message || (r.failed || []).join('; ') });
        notify('errors', '♻ Configuration restored', 'Restored: ' + r.restored.join(', '), 'warn');
        return sendJSON(res, 200, r);
      }

      // ---- notifications ----
      if (p === '/api/admin/notify' && req.method === 'GET') {
        const c = readConfig().notify;
        return sendJSON(res, 200, { enabled: !!c.enabled, events: c.events || {}, kinds: NOTIFY_KINDS,
          targets: (c.targets || []).map(t => ({ id: t.id, kind: t.kind, name: t.name, url: maskUrl(t.url), extra: t.extra ? '••••' : '', enabled: t.enabled !== false })) });
      }
      if (p === '/api/admin/notify' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const cur = readConfig();
        if (b.enabled != null) cur.notify.enabled = !!b.enabled;
        if (b.events) cur.notify.events = Object.assign({}, cur.notify.events, b.events);
        if (Array.isArray(b.targets)) {
          const existing = cur.notify.targets || [];
          cur.notify.targets = b.targets.slice(0, 20).map((t, i) => {
            const prev = existing.find(x => x.id === t.id);
            // a masked url means "unchanged" — keep the stored secret
            const url = (t.url && !String(t.url).includes('…')) ? String(t.url).trim() : (prev ? prev.url : '');
            return { id: String(t.id || ('n' + Date.now() + i)).slice(0, 40),
                     kind: NOTIFY_KINDS.includes(t.kind) ? t.kind : 'webhook',
                     name: String(t.name || t.kind || 'Notification').slice(0, 60),
                     url, extra: (t.extra && !String(t.extra).includes('•')) ? String(t.extra).trim().slice(0, 200) : (prev ? prev.extra : ''),
                     enabled: t.enabled !== false };
          }).filter(t => t.url);
        }
        writeConfig(cur);
        return sendJSON(res, 200, { ok: true, targets: (cur.notify.targets || []).map(t => ({ id: t.id, kind: t.kind, name: t.name, url: maskUrl(t.url), enabled: t.enabled !== false })) });
      }
      if (p === '/api/admin/notify/test' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const cur = readConfig().notify;
        const t = (cur.targets || []).find(x => x.id === String(b.id || ''));
        if (!t) return sendJSON(res, 404, { ok: false, message: 'Save the notification first, then test it' });
        const r = await sendNotification(t, { event: 'test', title: '🔔 MEDIARR test', message: 'If you can read this, notifications are working.', level: 'info' });
        return sendJSON(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { ok: false, message: r.message });
      }

      // ---- error log & login security ----
      if (p === '/api/admin/errors' && req.method === 'GET') {
        const l = readErrLog();
        const q = (u.searchParams.get('q') || '').trim().toLowerCase();
        let list = l.events;
        if (q) list = list.filter(e => ((e.where || '') + ' ' + (e.message || '') + ' ' + (e.detail || '')).toLowerCase().includes(q));
        return sendJSON(res, 200, { events: list.slice(0, 200), total: list.length, all: l.events.length, lockouts: loginLockouts() });
      }
      if (p === '/api/admin/errors' && req.method === 'DELETE') {
        errLog = { events: [] }; errDirty = true;
        try { fs.writeFileSync(ERRLOG_PATH, JSON.stringify(errLog)); } catch (e) {}
        return sendJSON(res, 200, { ok: true });
      }
      if (p === '/api/admin/login-unlock' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        if (b.key) loginFails.delete(String(b.key)); else loginFails.clear();
        return sendJSON(res, 200, { ok: true, lockouts: loginLockouts() });
      }

      // ---- Docker container controls (admin only) ----
      if (p === '/api/admin/docker' && req.method === 'GET') {
        return sendJSON(res, 200, await dockerControlStatus());
      }
      if (p === '/api/admin/docker/config' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const c = readConfig();
        c.dockerControl = Object.assign({}, DEFAULT_CONFIG.dockerControl, c.dockerControl || {});
        if (body.enabled != null) c.dockerControl.enabled = !!body.enabled;
        if (body.allowedContainers != null) c.dockerControl.allowedContainers = normalizeDockerAllowed(body.allowedContainers);
        writeConfig(c);
        _dockerApiVersion = null;
        return sendJSON(res, 200, await dockerControlStatus());
      }
      if (p === '/api/admin/docker/action' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const action = String(body.action || '').toLowerCase();
        const requested = String(body.container || '').trim().replace(/^\/+/, '');
        if (!['start', 'stop', 'restart', 'update'].includes(action)) return sendJSON(res, 400, { message: 'Action must be start, stop, restart, or update' });
        const cfg = readConfig().dockerControl || DEFAULT_CONFIG.dockerControl;
        if (!cfg.enabled) return sendJSON(res, 409, { message: 'Docker controls are disabled' });
        const allowed = normalizeDockerAllowed(cfg.allowedContainers).map(x => x.toLowerCase());
        if (!requested || !allowed.includes(requested.toLowerCase())) return sendJSON(res, 403, { message: 'Container is not on the Docker allow-list' });
        const list = await dockerAllowedContainers();
        const matches = list.filter(c => String(c.allowedAs || '').toLowerCase() === requested.toLowerCase() || String(c.name || '').toLowerCase() === requested.toLowerCase() || String(c.service || '').toLowerCase() === requested.toLowerCase());
        if (!matches.length) return sendJSON(res, 404, { message: 'Allowed container was not found' });
        if (matches.length > 1) return sendJSON(res, 409, { message: 'More than one container matches "' + requested + '". Use unique container names in the allow-list.' });
        const target = matches[0];
        if (target.self) return sendJSON(res, 409, { message: 'MEDIARR cannot be controlled from this panel; use System Update for MEDIARR itself' });
        if (action === 'update') {
          if (!target.updatable) return sendJSON(res, 409, { message: 'This container uses an immutable image digest/ID and cannot be updated from this panel' });
          const result = await dockerUpdateAllowedContainer(target);
          try { logAdd({ ts: Date.now(), type: 'docker', title: 'update ' + target.name + (result.updated ? '' : ' (already current)'), username: me.username, role: me.role, ip: clientIp(req), service: 'docker' }); } catch (_) {}
          const after = await dockerAllowedContainers();
          const current = after.find(c => String(c.allowedAs || '').toLowerCase() === requested.toLowerCase() || String(c.name || '').toLowerCase() === target.name.toLowerCase() || String(c.service || '').toLowerCase() === requested.toLowerCase()) || target;
          return sendJSON(res, 200, { ok: true, action, updated: !!result.updated, message: result.message, image: result.image, previousImageId: result.previousImageId || '', imageId: result.imageId || '', container: current });
        }
        const apiAction = action === 'start' ? '/start' : action === 'stop' ? '/stop?t=10' : '/restart?t=10';
        await dockerApi('POST', '/containers/' + encodeURIComponent(target.fullId) + apiAction, 25000);
        try { logAdd({ ts: Date.now(), type: 'docker', title: action + ' ' + target.name, username: me.username, role: me.role, ip: clientIp(req), service: 'docker' }); } catch (_) {}
        const after = await dockerAllowedContainers();
        const current = after.find(c => c.fullId === target.fullId) || target;
        return sendJSON(res, 200, { ok: true, action, container: current });
      }

      // ---- system update (GitHub Releases + optional Docker self-update) ----
      if (p === '/api/admin/update' && req.method === 'GET') {
        return sendJSON(res, 200, await updateStatus(u.searchParams.get('fresh') === '1'));
      }
      if (p === '/api/admin/update/config' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        const cur = readConfig(); cur.update = Object.assign({}, DEFAULT_CONFIG.update, cur.update || {});
        if (b.enabled != null) cur.update.enabled = !!b.enabled;
        if (!UPDATE_REPO_ENV && b.repo != null) {
          const repo = normalizeUpdateRepo(b.repo);
          if (String(b.repo || '').trim() && !repo) return sendJSON(res, 400, { message: 'Repository must look like owner/repository' });
          cur.update.repo = repo;
        }
        writeConfig(cur); _updateReleaseCache = { key:'', at:0, value:null };
        return sendJSON(res, 200, await updateStatus(true));
      }
      if (p === '/api/admin/update/apply' && req.method === 'POST') {
        const st = await updateStatus(true);
        if (!st.enabled) return sendJSON(res, 409, { message: 'Update checks are disabled' });
        if (!st.latest) return sendJSON(res, 502, { message: st.message || 'Could not resolve the latest release' });
        if (!st.canAutoUpdate) return sendJSON(res, 409, { message: st.autoUpdateReason || 'Automatic Docker update is unavailable' });
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (_) {}
        if (!st.updateAvailable && !b.force) return sendJSON(res, 409, { message: 'MEDIARR is already up to date' });
        const backup = createBackup('pre-update-' + cleanVersion(st.latest.version));
        if (!backup.ok) return sendJSON(res, 502, { message: 'Could not create the pre-update backup: ' + (backup.message || 'unknown error') });
        await pullDockerImage(st.latest.image);
        const helper = await launchUpdateHelper(st.latest.image, st.latest);
        try { logAdd({ ts: Date.now(), type: 'system', title: 'update ' + APP_VERSION + ' → ' + st.latest.version, username: me.username, role: me.role, ip: clientIp(req), service: 'mediarr' }); } catch (_) {}
        return sendJSON(res, 202, { ok: true, message: 'Update helper launched. MEDIARR will restart.', backup: backup.name, targetVersion: st.latest.version, targetImage: st.latest.image, helper: helper.helper });
      }

      // ---- system info & admin commands ----
      if (p === '/api/admin/system' && req.method === 'GET') {
        const cfg = readConfig().shell;
        const cmds = (cfg.commands || []).map(c => Object.assign({ id: c.id, name: c.name, cmd: c.cmd, confirm: c.confirm !== false }, commandNeedsRoot(c.cmd)));
        return sendJSON(res, 200, { system: systemInfo(), sudo: sudoCheck(), enabled: !!cfg.enabled, commands: cmds, history: SHELL_LOG.slice(0, 20) });
      }
      if (p === '/api/admin/shell/commands' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const cur = readConfig();
        if (b.enabled != null) cur.shell.enabled = !!b.enabled;
        if (Array.isArray(b.commands)) {
          cur.shell.commands = b.commands.slice(0, 20).map((c, i) => ({
            id: String(c.id || ('cmd' + Date.now() + i)).slice(0, 40),
            name: String(c.name || 'Command').trim().slice(0, 60),
            cmd: String(c.cmd || '').trim().slice(0, 500),
            confirm: c.confirm !== false
          })).filter(c => c.cmd);
        }
        writeConfig(cur);
        const cmds = cur.shell.commands.map(c => Object.assign({ id: c.id, name: c.name, cmd: c.cmd, confirm: c.confirm }, commandNeedsRoot(c.cmd)));
        return sendJSON(res, 200, { ok: true, enabled: cur.shell.enabled, commands: cmds });
      }
      if (p === '/api/admin/shell/run' && req.method === 'POST') {
        const cfg = readConfig().shell;
        if (!cfg.enabled) return sendJSON(res, 403, { ok: false, message: 'Commands are turned off in Settings' });
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        // Only a saved command can run, addressed by id — never a string from the request.
        const entry = (cfg.commands || []).find(c => c.id === String(b.id || ''));
        if (!entry) return sendJSON(res, 404, { ok: false, message: 'No saved command with that id' });
        return runSavedCommand(entry, me, rec => sendJSON(res, 200, { ok: rec.code === 0, result: rec }));
      }

      // ---- RSS release feeds (admin) ----
      if (p === '/api/admin/rss' && req.method === 'GET') return sendJSON(res, 200, rssStatus());
      if (p === '/api/admin/rss/check' && req.method === 'POST') {
        const r = await runRssCheck(true);
        return sendJSON(res, 200, Object.assign({ ok: true }, r, rssStatus()));
      }
      if (p === '/api/admin/rss/test' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const url = String(b.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return sendJSON(res, 400, { ok: false, message: 'Enter a feed URL starting with http(s)://' });
        const f = await fetchFeed(url);
        if (!f.ok) return sendJSON(res, 502, { ok: false, message: f.message });
        const preview = f.items.slice(0, 8).map(it => {
          const rel = parseRelease(it.title);
          return { release: it.title, parsed: rel ? (rel.kind + ': ' + rel.title + (rel.year ? ' (' + rel.year + ')' : '')) : 'unrecognised' };
        });
        return sendJSON(res, 200, { ok: true, items: f.items.length, preview });
      }
      if (p === '/api/admin/rss/log' && req.method === 'DELETE') {
        const st = readRss(); st.log = []; writeRss();
        return sendJSON(res, 200, { ok: true });
      }

      // ---- Plex stream blocking (admin) ----
      if (p === '/api/admin/plexblock/log' && req.method === 'GET') {
        const all = readBlockLog().events || [];
        const q = (u.searchParams.get('q') || '').trim().toLowerCase();
        const limit = Math.min(500, Number(u.searchParams.get('limit')) || 200);
        const list = q ? all.filter(e => ((e.user || '') + ' ' + (e.ip || '') + ' ' + (e.device || '') + ' ' + (e.item || '') + ' ' + (e.rule || '')).toLowerCase().includes(q)) : all;
        return sendJSON(res, 200, { events: list.slice(0, limit), total: list.length, all: all.length });
      }
      if (p === '/api/admin/plexblock/log' && req.method === 'DELETE') {
        blockLog = { events: [] };
        try { fs.writeFileSync(BLOCK_LOG_PATH, JSON.stringify(blockLog)); } catch (e) {}
        return sendJSON(res, 200, { ok: true, events: [] });
      }
      if (p === '/api/admin/plexblock' && req.method === 'GET') {
        const c = readConfig().plexBlock;
        return sendJSON(res, 200, { enabled: !!c.enabled, ips: c.ips || [], message: c.message || '', events: readBlockLog().events.slice(0, 50) });
      }
      if (p === '/api/admin/plexblock/test' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const r = await enforcePlexBlocks();
        return sendJSON(res, 200, Object.assign({ ok: true }, r, { events: readBlockLog().events.slice(0, 20) }));
      }
      // ---- manual Radarr/Sonarr release search + grab ----
      if (p === '/api/releases' && req.method === 'GET') {
        const svc = u.searchParams.get('svc') === 'sonarr' ? 'sonarr' : 'radarr';
        const r = await manualReleaseSearch(svc, {
          movieId: u.searchParams.get('movieId'), episodeId: u.searchParams.get('episodeId'),
          seriesId: u.searchParams.get('seriesId'), seasonNumber: u.searchParams.get('seasonNumber')
        });
        return sendJSON(res, r.ok ? 200 : (r.status || 502), r.ok ? { ok: true, service: svc, items: r.items } : { ok: false, message: r.message });
      }
      if (p === '/api/releases/grab' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const svc = b.svc === 'sonarr' ? 'sonarr' : 'radarr';
        const r = await manualReleaseGrab(svc, b);
        if (r.ok) notify('added', '⬇ Manual release grabbed', (b.title ? String(b.title).slice(0, 120) : 'Release') + ' sent to ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' by ' + me.username, 'good');
        return sendJSON(res, r.ok ? 200 : (r.status || 502), r.ok ? { ok: true, message: 'Release sent to ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') } : { ok: false, message: r.message });
      }

      if (p === '/api/command' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const svc = b.svc === 'sonarr' ? 'sonarr' : 'radarr';
        if (!b.cmd || !b.cmd.name) return sendJSON(res, 400, { ok: false, message: 'Missing command' });
        const r = await arrCommand(svc, b.cmd);
        return sendJSON(res, r.ok ? 200 : 502, r.ok ? { ok: true, data: r.data } : { ok: false, message: r.message });
      }
      if (p === '/api/tv/missing/status' && req.method === 'GET') return sendJSON(res, 200, missStatus());
      if (p === '/api/tv/missing/stop' && req.method === 'POST') {
        if (missJob && missJob.status === 'running') { missJob.status = 'stopped'; if (missTimer) clearTimeout(missTimer); }
        return sendJSON(res, 200, missStatus());
      }
      if (p === '/api/tv/missing/start' && req.method === 'POST') {
        if (missJob && (missJob.status === 'running' || missJob.status === 'scanning')) return sendJSON(res, 409, { message: 'A missing-episode search is already running' });
        const cfg = readConfig().sonarr;
        if (!cfg.url || !cfg.apiKey) return sendJSON(res, 400, { message: 'Sonarr is not configured' });
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        missJob = { list: [], total: 0, index: 0, missing: 0, searched: 0, failed: 0, log: [],
                    status: 'scanning', phase: 'Scanning your library…', startedAt: Date.now(), seriesName: '',
                    scanned: 0, candidates: 0, knownMissing: 0,
                    gapMs: Math.max(0, Math.min(60000, Number(b.gapSeconds || 3) * 1000)) };
        missLog('▶', '', 'fast scan started');
        // Kick off the quick discovery pass, then work only the shows that need it.
        (async () => {
          try {
            const all = await arrListAll('sonarr', '/api/v3/series');
            const monitored = all.ok ? all.items.filter(x => x.monitored !== false) : [];
            missJob.scanned = monitored.length;
            let cands = [];
            const fast = await fastMissingScan();
            if (fast.ok && fast.series.length) {
              const okIds = new Set(monitored.map(x => Number(x.id)));
              cands = fast.series.filter(x => !okIds.size || okIds.has(Number(x.id)));
              missJob.knownMissing = fast.episodes;
              missLog('✓', '', 'Sonarr reports ' + fast.episodes + ' missing episode(s) across ' + cands.length + ' show(s)');
            } else {
              cands = statsMissingScan(monitored);
              missJob.knownMissing = cands.reduce((a, x) => a + x.count, 0);
              missLog('✓', '', 'narrowed by episode counts → ' + cands.length + ' show(s) look incomplete');
            }
            if (Array.isArray(b.seriesIds) && b.seriesIds.length) cands = cands.filter(x => b.seriesIds.map(Number).includes(Number(x.id)));
            missJob.list = cands; missJob.total = cands.length; missJob.candidates = cands.length;
            if (!cands.length) {
              missJob.status = 'done'; missJob.phase = '';
              missLog('•', '', 'nothing missing — checked ' + monitored.length + ' monitored show(s)');
              return;
            }
            missJob.status = 'running';
            missJob.phase = 'Rescanning and searching ' + cands.length + ' show(s)';
            missLog('▶', '', 'skipping ' + Math.max(0, monitored.length - cands.length) + ' complete show(s) · working ' + cands.length);
            missTimer = setTimeout(missStep, 200);
          } catch (e) {
            missJob.status = 'done'; missJob.phase = ''; missLog('⚠', '', 'scan failed: ' + (e.message || 'error'));
          }
        })();
        return sendJSON(res, 200, missStatus());
      }
      if (p === '/api/tv/season-monitor' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const r = await seasonMonitor(Number(b.seriesId), Number(b.seasonNumber), b.monitored !== false);
        if (!r.ok) return sendJSON(res, 502, { ok: false, message: r.message });
        // keep the episodes in step with the season
        const eps = await seriesEpisodes(Number(b.seriesId));
        const ids = eps.items.filter(e => Number(e.seasonNumber) === Number(b.seasonNumber)).map(e => e.id);
        const em = await episodeMonitor(ids, b.monitored !== false);
        return sendJSON(res, 200, { ok: true, episodes: ids.length, episodesOk: em.ok, message: em.ok ? 'Season updated' : em.message });
      }
      if (p === '/api/tv/episode-monitor' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const r = await episodeMonitor(Array.isArray(b.episodeIds) ? b.episodeIds : [], b.monitored !== false);
        return sendJSON(res, r.ok ? 200 : 502, r.ok ? { ok: true } : { ok: false, message: r.message });
      }
      if (p === '/api/tv/series' && req.method === 'GET') {
        const got = await arrItem('sonarr', Number(u.searchParams.get('seriesId')));
        return sendJSON(res, got.ok ? 200 : 502, got.ok ? { item: got.item } : { item: null, message: 'Could not read the series' });
      }
      if (p === '/api/tv/episodes' && req.method === 'GET') {
        const r = await seriesEpisodes(Number(u.searchParams.get('seriesId')));
        return sendJSON(res, 200, { items: r.items });
      }
      if (p === '/api/media/detail' && req.method === 'GET') {
        const q = {
          type: u.searchParams.get('type') || 'movie',
          arrId: u.searchParams.get('arrId') || '',
          imdbId: u.searchParams.get('imdbId') || '',
          tmdbId: u.searchParams.get('tmdbId') || '',
          tvdbId: u.searchParams.get('tvdbId') || '',
          title: u.searchParams.get('title') || '',
          year: u.searchParams.get('year') || ''
        };
        return sendJSON(res, 200, await unifiedMediaDetail(q, me));
      }
      if (p === '/api/movie/fileinfo' && req.method === 'GET') {
        let id = Number(u.searchParams.get('id')) || 0;
        if (!id) {
          // resolve from an imdb/tmdb id so callers don't need Radarr's internal id
          const imdb = (u.searchParams.get('imdbId') || '').trim();
          const tmdb = (u.searchParams.get('tmdbId') || '').trim();
          if (!imdb && !tmdb) return sendJSON(res, 400, { ok: false, message: 'Missing movie id' });
          const ids = await liveLibraryIds('radarr');
          if ((imdb && !(ids.imdb || []).includes(imdb)) && (tmdb && !(ids.tmdb || []).includes(String(tmdb)))) {
            return sendJSON(res, 200, { ok: true, hasFile: false, inLibrary: false });
          }
          const all = await arrListAll('radarr', '/api/v3/movie');
          if (all.ok) {
            const hit = all.items.find(x => (imdb && String(x.imdbId || '').toLowerCase() === imdb.toLowerCase()) || (tmdb && String(x.tmdbId) === String(tmdb)));
            if (hit) id = hit.id;
          }
          if (!id) return sendJSON(res, 200, { ok: true, hasFile: false, inLibrary: false });
        }
        const info = await movieFileInfo(id);
        if (info.ok) info.inLibrary = true;
        return sendJSON(res, 200, info);
      }
      if (p === '/api/update' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const r = await updateArrItem(b, me);
        return sendJSON(res, r.status, r.body);
      }

      // ---- one place to add a movie / series ----
      if (p === '/api/add' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const r = await addToArr(b, me, req);
        return sendJSON(res, r.status, r.body);
      }

      // ---- live "is it already added?" index (short TTL, used by search) ----
      if (p === '/api/session/keepalive' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        keepSessionAlive(req, res, b.what || 'playing');
        if (b.what) markMediaActivity(me, b.what, b.path || '');
        const tok = parseCookies(req).mediarr_session;
        const s = tok ? sessions.get(tok) : null;
        return sendJSON(res, 200, { ok: true, expiresIn: s ? Math.max(0, Math.round((s.expires - Date.now()) / 1000)) : 0 });
      }
      if (p === '/api/session/activity' && req.method === 'GET') {
        const tok = parseCookies(req).mediarr_session;
        const s = tok ? sessions.get(tok) : null;
        return sendJSON(res, 200, {
          expiresIn: s ? Math.max(0, Math.round((s.expires - Date.now()) / 1000)) : 0,
          lastActivity: s && s.lastActivity ? s.lastActivity : null,
          active: activeMediaList(120000)
        });
      }
      if (p === '/api/library/ids' && req.method === 'GET') {
        const svc = u.searchParams.get('svc') === 'sonarr' ? 'sonarr' : 'radarr';
        const ids = await liveLibraryIds(svc, u.searchParams.get('fresh') === '1');
        return sendJSON(res, 200, ids);
      }

      // ---- cached library (fast Movies / Shows browsers) ----
      if (p === '/api/library/list' && req.method === 'GET') {
        const svc = u.searchParams.get('svc') === 'sonarr' ? 'sonarr' : 'radarr';
        const cfg = readConfig()[svc];
        if (!cfg.url || !cfg.apiKey) return sendJSON(res, 200, { items: [], configured: false });
        const c = readLibCache()[svc];
        const fresh = u.searchParams.get('fresh') === '1';
        const ageMs = c && c.ts ? (Date.now() - c.ts) : Infinity;
        const sonarrCacheStillHot = svc !== 'sonarr' || ageMs < SONARR_LIBRARY_MAX_AGE_MS;
        if (!fresh && c && c.items && sonarrCacheStillHot) {
          return sendJSON(res, 200, { items: c.items, cached: true, ts: c.ts, ageMinutes: Math.round(ageMs / 60000), ageSeconds: Math.round(ageMs / 1000), configured: true });
        }
        const r = await arrListAll(svc, svc === 'radarr' ? '/api/v3/movie' : '/api/v3/series');
        if (!r.ok) return sendJSON(res, 200, { items: [], configured: true, error: 'Could not read ' + svc + ' (' + (r.shape || 'no data') + ')' });
        const items = r.items.map(x => slimItem(x, svc)).sort((a, b) => String(a.sortTitle || '').localeCompare(String(b.sortTitle || '')));
        const cc = readLibCache(); cc[svc] = { items, ts: Date.now(), count: items.length }; writeLibCache();
        return sendJSON(res, 200, { items, cached: false, ts: Date.now(), ageMinutes: 0, configured: true });
      }
      if (p === '/api/library/cached' && req.method === 'GET') {
        const svc = u.searchParams.get('svc') === 'sonarr' ? 'sonarr' : 'radarr';
        const c = readLibCache()[svc];
        if (!c) return sendJSON(res, 200, { items: [], ts: null, cached: false, scanning: libScanning });
        return sendJSON(res, 200, { items: c.items, ts: c.ts, count: c.count, cached: true, ageMinutes: Math.round((Date.now() - c.ts) / 60000), scanning: libScanning });
      }
      if (p === '/api/library/status' && req.method === 'GET') return sendJSON(res, 200, libCacheStatus());
      if (p === '/api/admin/library/diag' && req.method === 'GET') {
        return sendJSON(res, 200, { radarr: await arrProbe('radarr'), sonarr: await arrProbe('sonarr') });
      }
      if (p === '/api/admin/library/scan' && req.method === 'POST') {
        if (libScanning) return sendJSON(res, 200, Object.assign({ started: false, alreadyRunning: true }, libCacheStatus()));
        scanAllLibraries('manual').then(() => scheduleLibScan());
        return sendJSON(res, 200, { started: true });
      }

      // ---- per-user theme + personal API key ----
      if (p === '/api/me/theme' && req.method === 'GET') return sendJSON(res, 200, userTheme(me.username));
      if (p === '/api/me/theme' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const t = sanitizeTheme(b);
        setUserField(me.username, 'theme', t);
        return sendJSON(res, 200, t);
      }
      if (p === '/api/me/theme' && req.method === 'DELETE') { setUserField(me.username, 'theme', null); return sendJSON(res, 200, { base: 'dark', modes: { dark: {}, light: {} } }); }
      if (p === '/api/me/apikey' && req.method === 'GET') {
        const u2 = findUser(me.username);
        return sendJSON(res, 200, { apiKey: (u2 && u2.apiKey) || '' });
      }
      if (p === '/api/me/apikey' && req.method === 'POST') {
        const key = newApiKey(); setUserField(me.username, 'apiKey', key);
        return sendJSON(res, 200, { apiKey: key });
      }
      if (p === '/api/me/apikey' && req.method === 'DELETE') { setUserField(me.username, 'apiKey', null); return sendJSON(res, 200, { apiKey: '' }); }

      // ---- per-user Plex account ----
      if (p === '/api/plex/user/status' && req.method === 'GET') {
        const px = getUserPlex(me.username);
        return sendJSON(res, 200, { linked: !!(px && px.token), username: (px && px.username) || '', serverConfigured: !!readConfig().plex.url });
      }
      if (p === '/api/plex/user/pin' && req.method === 'POST') {
        const clientId = ensurePlexClientId();
        try {
          const up = await upstream('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: Object.assign({ 'Content-Length': '0' }, plexHeaders(clientId)) });
          if (up.status < 200 || up.status >= 300) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + up.status });
          const j = JSON.parse(up.body.toString('utf8'));
          return sendJSON(res, 200, { id: j.id, code: j.code, authUrl: 'https://app.plex.tv/auth#?clientID=' + encodeURIComponent(clientId) + '&code=' + encodeURIComponent(j.code) + '&context%5Bdevice%5D%5Bproduct%5D=MEDIARR' });
        } catch (e) { return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message }); }
      }
      if (p === '/api/plex/user/check' && req.method === 'GET') {
        const id = (u.searchParams.get('id') || '').replace(/[^0-9]/g, '');
        if (!id) return sendJSON(res, 400, { message: 'Missing pin id' });
        const r = await plexJson('https://plex.tv/api/v2/pins/' + id, '');
        if (!r.ok) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + r.status });
        const tok = r.data && r.data.authToken;
        if (!tok) return sendJSON(res, 200, { authorized: false });
        const acct = await plexJson('https://plex.tv/api/v2/user', tok);
        const info = acct.ok ? acct.data : {};
        setUserPlex(me.username, { token: tok, rootToken: tok, username: info.username || info.title || '', id: info.id || null, at: Date.now() });
        const home = await plexHomeUsers(tok);
        return sendJSON(res, 200, { authorized: true, username: info.username || info.title || '',
          homeUsers: home.users, multipleProfiles: home.users.length > 1 });
      }
      if (p === '/api/plex/user/home' && req.method === 'GET') {
        const px = getUserPlex(me.username);
        if (!px || !px.token) return sendJSON(res, 400, { message: 'Not signed in to Plex' });
        const h = await plexHomeUsers(px.token);
        return sendJSON(res, 200, { users: h.users, multiple: h.users.length > 1, current: px.username || '' });
      }
      if (p === '/api/plex/user/home/switch' && req.method === 'POST') {
        const px = getUserPlex(me.username);
        if (!px || !px.token) return sendJSON(res, 400, { message: 'Not signed in to Plex' });
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        if (b.id == null) return sendJSON(res, 400, { message: 'Missing profile id' });
        const base = px.rootToken || px.token;   // always switch from the account-level token
        const sw = await plexSwitchHomeUser(base, b.id, b.uuid || '', b.pin || '');
        if (!sw.ok) {
          const e = sw.err || {};
          const detail = e.message ? (': ' + e.message) : '';
          const hint = (e.status === 401 || e.status === 403) ? ' — the PIN was rejected.' : '';
          return sendJSON(res, 502, { message: 'Could not switch profile (HTTP ' + (e.status || '?') + detail + ')' + hint });
        }
        const acct = await plexJson('https://plex.tv/api/v2/user', sw.token);
        const info = acct.ok ? acct.data : {};
        setUserPlex(me.username, { token: sw.token, rootToken: base, username: info.username || info.title || '', id: info.id || null, at: Date.now() });
        return sendJSON(res, 200, { ok: true, username: info.username || info.title || '' });
      }
      if (p === '/api/plex/user/unlink' && req.method === 'POST') { setUserPlex(me.username, null); return sendJSON(res, 200, { linked: false }); }
      if (p === '/api/plex/watchlist' && req.method === 'GET') return plexWatchlist(me.username, res);
      if (p === '/api/plex/watchlist/add' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        return plexWatchlistAction(me.username, b, true, res);
      }
      if (p === '/api/plex/watchlist/remove' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        return plexWatchlistAction(me.username, b, false, res);
      }
      if (p === '/api/plex/history' && req.method === 'GET') {
        const lim = Math.min(500, Number(u.searchParams.get('limit')) || 200);
        return plexHistory(me.username, lim, res);
      }
      if (p === '/api/plex/img' && req.method === 'GET') return plexImage(me.username, u.searchParams.get('h') || 'pms', u.searchParams.get('p') || '', res);

      // ---- personalized user home ----
      if (p === '/api/home' && req.method === 'GET') return sendJSON(res, 200, await userHomeData(me));

      // ---- favorite TV shows (per user) ----
      if (p === '/api/favorites' && req.method === 'GET') {
        return sendJSON(res, 200, { favorites: userFavs(me.username) });
      }
      if (p === '/api/favorites' && req.method === 'POST') {
        let body = {};
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const item = body.item || {};
        if (!item.title && !item.imdbId && !item.tmdbId && !item.tvdbId) return sendJSON(res, 400, { message: 'Nothing to favorite' });
        const f = readFavs(); if (!f.users) f.users = {};
        const list = f.users[me.username] || [];
        const key = favKey(item);
        const at = list.findIndex(x => x.key === key);
        let favorited;
        if (body.action === 'remove' || (body.action !== 'add' && at >= 0)) {
          if (at >= 0) list.splice(at, 1);
          favorited = false;
        } else {
          if (at < 0) list.push({ key, title: String(item.title || '').slice(0, 200), imdbId: item.imdbId || '', tvdbId: item.tvdbId || null, tmdbId: item.tmdbId || null, poster: String(item.poster || '').slice(0, 500), ts: Date.now() });
          favorited = true;
        }
        f.users[me.username] = list; writeFavs(f);
        return sendJSON(res, 200, { favorited, key, count: list.length });
      }
      if (p === '/api/favorites/upcoming' && req.method === 'GET') return favoritesUpcoming(me.username, res);

      // ---- auto add queue ----
      if (p === '/api/autoadd/status' && req.method === 'GET') return sendJSON(res, 200, autoStatus());
      if (p === '/api/autoadd/stop' && req.method === 'POST') {
        if (!autoJob || autoJob.status !== 'running') return sendJSON(res, 200, autoStatus());
        if (me.role !== 'admin' && autoJob.username !== me.username) return sendJSON(res, 403, { message: 'That job belongs to another user' });
        autoFinish('stopped'); autoLog('⏹', '', 'stopped by ' + me.username); saveAutoJob();
        return sendJSON(res, 200, autoStatus());
      }
      if (p === '/api/autoadd/start' && req.method === 'POST') {
        if (autoJob && autoJob.status === 'running') return sendJSON(res, 409, { message: 'An auto-add job is already running (' + autoJob.index + '/' + autoJob.items.length + ').' });
        let body = {};
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {}
        const raw = Array.isArray(body.items) ? body.items : [];
        const items = raw.slice(0, 2000).map(x => ({
          kind: x.kind === 'series' ? 'series' : 'movie',
          tmdbId: x.tmdbId || null, imdbId: x.imdbId || '', tvdbId: x.tvdbId || null,
          title: String(x.title || '').slice(0, 200)
        })).filter(x => x.tmdbId || x.imdbId || x.tvdbId || x.title);
        if (!items.length) return sendJSON(res, 400, { message: 'Nothing to add' });
        const mins = Number(readConfig().autoAdd.intervalMinutes);
        autoJob = {
          label: String(body.label || 'Auto add').slice(0, 120),
          username: me.username, role: me.role, dailyLimit: me.dailyLimit || 0, ip: clientIp(req),
          items, index: 0, added: 0, skipped: 0, failed: 0, tooShort: 0, log: [],
          intervalMinutes: Number.isFinite(mins) ? mins : 5,
          minRuntime: Number(readConfig().autoAdd.minRuntime) || 0,
          status: 'running', startedAt: Date.now(), nextAt: null
        };
        autoLog('▶', '', 'queued ' + items.length + ' items · one every ' + autoJob.intervalMinutes + ' min' + (autoJob.minRuntime ? ' · skipping under ' + autoJob.minRuntime + ' min' : ''));
        saveAutoJob();
        if (autoTimer) clearTimeout(autoTimer);
        autoTimer = setTimeout(autoStep, 200);
        return sendJSON(res, 200, autoStatus());
      }
      if (p === '/api/plex/watched' && req.method === 'GET') {
        const w = await plexWatchedIndex();
        const shows = {}; for (const [k, v] of w.shows) shows[k] = v;
        return sendJSON(res, 200, { shows, episodes: w.set.size });
      }

      // ---- Plex sign-in (admin): OAuth PIN flow to capture a token + list servers ----
      if (p === '/api/admin/plex/pin' && req.method === 'POST') {
        const clientId = ensurePlexClientId();
        try {
          const up = await upstream('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: Object.assign({ 'Content-Length': '0' }, plexHeaders(clientId)) });
          if (up.status < 200 || up.status >= 300) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + up.status });
          const j = JSON.parse(up.body.toString('utf8'));
          const authUrl = 'https://app.plex.tv/auth#?clientID=' + encodeURIComponent(clientId) + '&code=' + encodeURIComponent(j.code) + '&context%5Bdevice%5D%5Bproduct%5D=MEDIARR';
          return sendJSON(res, 200, { id: j.id, code: j.code, authUrl });
        } catch (e) { return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message }); }
      }
      if (p === '/api/admin/plex/check' && req.method === 'GET') {
        const id = (u.searchParams.get('id') || '').replace(/[^0-9]/g, '');
        if (!id) return sendJSON(res, 400, { message: 'Missing pin id' });
        try {
          const up = await upstream('https://plex.tv/api/v2/pins/' + id, { headers: plexHeaders(ensurePlexClientId()) });
          if (up.status < 200 || up.status >= 300) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + up.status });
          const j = JSON.parse(up.body.toString('utf8'));
          return sendJSON(res, 200, { authorized: !!j.authToken, token: j.authToken || '' });
        } catch (e) { return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message }); }
      }
      if (p === '/api/admin/plex/servers' && req.method === 'POST') {
        let token = '';
        try { token = String((JSON.parse((await readBody(req)) || '{}').token) || '').trim(); } catch (e) {}
        if (!token) return sendJSON(res, 400, { message: 'Missing token' });
        try {
          const up = await upstream('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', { headers: plexHeaders(ensurePlexClientId(), token) });
          if (up.status < 200 || up.status >= 300) return sendJSON(res, 502, { message: 'Plex returned HTTP ' + up.status });
          const arr = JSON.parse(up.body.toString('utf8'));
          const servers = (Array.isArray(arr) ? arr : [])
            .filter(d => String(d.provides || '').split(',').includes('server'))
            .map(d => ({
              name: d.name, product: d.product || 'Plex Media Server', owned: !!d.owned, token: d.accessToken || token,
              connections: (d.connections || []).map(c => ({ uri: c.uri, address: c.address, port: c.port, protocol: c.protocol, local: !!c.local, relay: !!c.relay }))
            }));
          return sendJSON(res, 200, { servers });
        } catch (e) { return sendJSON(res, 502, { message: 'Could not reach Plex: ' + e.message }); }
      }

      // ---- WebDAV: browse a folder and download files (counts against the daily limit) ----
      if (p === '/api/webdav/list' && req.method === 'GET') return webdavList(u.searchParams.get('path') || '', res);
      // Any media activity keeps the session alive for another hour.
      if (p.startsWith('/api/webdav/') || p === '/api/streams') {
        const what = p.includes('/download') ? 'downloading' : p.includes('/hls') || p.includes('/stream') ? 'streaming' : '';
        keepSessionAlive(req, res, what || 'browsing');
        if (what) markMediaActivity(me, what, u.searchParams.get('path') || '');
      }
      if (p === '/api/webdav/stream' && req.method === 'GET') return webdavStream(u.searchParams.get('path') || '', req, res);
      if (p === '/api/webdav/playback-plan' && req.method === 'GET') return browserPlaybackPlan(u.searchParams.get('path') || '', res);
      if (p === '/api/webdav/tracks' && req.method === 'GET') return webdavTracks(u.searchParams.get('path') || '', res);
      if (p === '/api/webdav/subtitle' && req.method === 'GET') return webdavSubtitle(u.searchParams.get('path') || '', u.searchParams.get('sidx'), res);
      if (p === '/api/webdav/hls/start' && req.method === 'GET') return webdavHlsStart(u.searchParams.get('path') || '', { ac: u.searchParams.get('ac'), vc: u.searchParams.get('vc'), aidx: u.searchParams.get('aidx'), q: u.searchParams.get('q') }, res, req, me);
      if (p === '/api/webdav/hls/stop' && req.method === 'GET') return webdavHlsStop(u.searchParams.get('sid') || '', res);
      { const hm = p.match(/^\/api\/webdav\/hls\/([A-Za-z0-9]+)\/([A-Za-z0-9_.-]+)$/); if (hm && req.method === 'GET') return webdavHlsFile(hm[1], hm[2], res); }
      if (p === '/api/webdav/download' && (req.method === 'GET' || req.method === 'HEAD')) return webdavDownload(u.searchParams.get('path') || '', res, me, req.method === 'HEAD', req);

      // ---- admin: playback / transcode dashboard ----
      if (p === '/api/admin/transcodes' && req.method === 'GET') return sendJSON(res, 200, await transcodeDashboard());

      // ---- admin: user management ----
      if (p === '/api/admin/registrations' && req.method === 'GET') {
        const pending = pendingRegistrations().map(u => publicUser(u, true));
        return sendJSON(res, 200, { pending, count: pending.length });
      }
      if (p === '/api/admin/users' && req.method === 'GET') {
        const users = readUsers().users.slice().sort((a,b) => Number(userApproved(a)) - Number(userApproved(b)) || String(a.username).localeCompare(String(b.username)));
        return sendJSON(res, 200, { users: users.map(u => publicUser(u, true)), pending: users.filter(u => !userApproved(u)).length });
      }
      if (p === '/api/admin/users' && req.method === 'POST') {
        const { username, password, role, dailyLimit } = JSON.parse(await readBody(req) || '{}');
        if (!username || !password) return sendJSON(res, 400, { message: 'Username and password required' });
        const data = readUsers();
        if (data.users.find(u => u.username.toLowerCase() === String(username).toLowerCase())) return sendJSON(res, 400, { message: 'That username already exists' });
        const { salt, hash } = hashPassword(password);
        const now = Date.now();
        const u = { username: String(username).trim(), role: role === 'admin' ? 'admin' : 'user', dailyLimit: Number(dailyLimit) >= 0 ? Number(dailyLimit) : 10, salt, hash, approved: true, registrationMethod: 'admin', createdAt: now, approvedAt: now, approvedBy: me.username };
        data.users.push(u); writeUsers(data);
        return sendJSON(res, 200, publicUser(u, true));
      }
      if (p === '/api/admin/users' && req.method === 'PATCH') {
        const { username, dailyLimit, role, password, approved } = JSON.parse(await readBody(req) || '{}');
        const data = readUsers();
        const u = data.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
        if (!u) return sendJSON(res, 404, { message: 'User not found' });
        if (dailyLimit != null && Number(dailyLimit) >= 0) u.dailyLimit = Number(dailyLimit);
        if (role === 'admin' || role === 'user') {
          if (u.role === 'admin' && role === 'user' && data.users.filter(x => x.role === 'admin').length <= 1)
            return sendJSON(res, 400, { message: "Can't demote the last admin" });
          u.role = role;
        }
        if (typeof approved === 'boolean') {
          if (u.role === 'admin' && !approved) return sendJSON(res, 400, { message: 'Admin accounts cannot be placed into pending state' });
          u.approved = approved;
          if (approved) { u.approvedAt = Date.now(); u.approvedBy = me.username; try { realtimePush('registration.approved', { username: u.username, approvedBy: me.username }); } catch (_) {} }
        }
        if (password) { const { salt, hash } = hashPassword(password); u.salt = salt; u.hash = hash; }
        writeUsers(data);
        return sendJSON(res, 200, publicUser(u, true));
      }
      if (p === '/api/admin/users/delete' && req.method === 'POST') {
        const { username } = JSON.parse(await readBody(req) || '{}');
        const data = readUsers();
        const u = data.users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
        if (!u) return sendJSON(res, 404, { message: 'User not found' });
        if (u.role === 'admin' && data.users.filter(x => x.role === 'admin').length <= 1) return sendJSON(res, 400, { message: "Can't remove the last admin" });
        if (u.username === me.username) return sendJSON(res, 400, { message: "You can't remove yourself" });
        data.users = data.users.filter(x => x !== u); writeUsers(data);
        return sendJSON(res, 200, { ok: true });
      }
      if (p === '/api/admin/adds' && req.method === 'GET') {
        const limit = Math.min(1000, Number(u.searchParams.get('limit')) || 200);
        const q = (u.searchParams.get('q') || '').trim().toLowerCase();
        const type = u.searchParams.get('type') || 'all';
        let list = readAdds().adds;
        if (type && type !== 'all') list = list.filter(e => type === 'add' ? (e.type === 'movie' || e.type === 'series') : e.type === type);
        if (q) list = list.filter(e => ((e.title || '') + ' ' + (e.username || '') + ' ' + (e.ip || '') + ' ' + (e.service || '') + ' ' + (e.type || '')).toLowerCase().includes(q));
        return sendJSON(res, 200, { adds: list.slice(0, limit), total: list.length });
      }

      // any logged-in user can change their own password
      if (p === '/api/change-password' && req.method === 'POST') {
        const { currentPassword, newPassword } = JSON.parse(await readBody(req) || '{}');
        if (!me.hash) return sendJSON(res, 400, { message: 'This account uses Plex sign-in and does not have a MEDIARR password.' });
        if (!newPassword || String(newPassword).length < 4) return sendJSON(res, 400, { message: 'New password must be at least 4 characters' });
        if (!verifyPassword(currentPassword, me.salt, me.hash)) return sendJSON(res, 403, { message: 'Current password is incorrect' });
        const data = readUsers();
        const target = data.users.find(x => x.username.toLowerCase() === me.username.toLowerCase());
        const { salt, hash } = hashPassword(newPassword);
        target.salt = salt; target.hash = hash; writeUsers(data);
        return sendJSON(res, 200, { ok: true });
      }
    }

    // config
    if (p === '/api/config' && req.method === 'GET')  return sendJSON(res, 200, sanitize(readConfig()));
    if (p === '/api/config' && req.method === 'POST') {
      const incoming = JSON.parse(await readBody(req) || '{}');
      const cur = readConfig();
      for (const svc of ['radarr', 'sonarr']) {
        const s = incoming[svc]; if (!s) continue;
        if (s.url != null)              cur[svc].url = normUrl(s.url);
        if (s.apiKey)                   cur[svc].apiKey = s.apiKey;        // only overwrite when non-empty
        if (s.qualityProfileId != null) cur[svc].qualityProfileId = s.qualityProfileId;
        if (s.rootFolderPath != null)   cur[svc].rootFolderPath = s.rootFolderPath;
      }
      if (incoming.tmdb && incoming.tmdb.apiKey) cur.tmdb.apiKey = incoming.tmdb.apiKey;
      if (incoming.plex) {
        if (incoming.plex.url != null) cur.plex.url = normUrl(incoming.plex.url);
        if (incoming.plex.token)       cur.plex.token = incoming.plex.token;   // only overwrite when non-empty
      }
      if (incoming.playback) {
        cur.playback = Object.assign({}, DEFAULT_CONFIG.playback, cur.playback || {});
        if (incoming.playback.autoSelect != null) cur.playback.autoSelect = !!incoming.playback.autoSelect;
        if (incoming.playback.pathMappings != null) cur.playback.pathMappings = normalizePathMappings(incoming.playback.pathMappings);
      }
      if (incoming.realtime) {
        cur.realtime = Object.assign({}, DEFAULT_CONFIG.realtime, cur.realtime || {});
        if (incoming.realtime.setupComplete != null) cur.realtime.setupComplete = !!incoming.realtime.setupComplete;
      }
      if (incoming.webdav) {
        if (incoming.webdav.url != null)      cur.webdav.url = normUrl(incoming.webdav.url);
        if (incoming.webdav.username != null) cur.webdav.username = String(incoming.webdav.username).trim();
        if (incoming.webdav.password)         cur.webdav.password = incoming.webdav.password;   // only overwrite when non-empty
        if (incoming.webdav.folder != null)   cur.webdav.folder = String(incoming.webdav.folder).trim();
        if (incoming.webdav.source != null)   cur.webdav.source = (String(incoming.webdav.source) === 'local' ? 'local' : 'webdav');
        if (incoming.webdav.localPath != null) cur.webdav.localPath = String(incoming.webdav.localPath).trim();
        if (incoming.webdav.mode != null)     cur.webdav.mode = wmode(incoming.webdav.mode);
        if (incoming.webdav.transcode != null) cur.webdav.transcode = !!incoming.webdav.transcode;
        if (incoming.webdav.encSpeed != null && ['balanced', 'faster', 'fastest', 'quality'].includes(incoming.webdav.encSpeed)) cur.webdav.encSpeed = incoming.webdav.encSpeed;
        if (incoming.webdav.hwAccel != null && ['auto', 'off'].includes(incoming.webdav.hwAccel)) cur.webdav.hwAccel = incoming.webdav.hwAccel;
      }
      if (incoming.ui && incoming.ui.loginTheme && LOGIN_THEMES.includes(incoming.ui.loginTheme)) {
        cur.ui.loginTheme = incoming.ui.loginTheme;
      }
      if (incoming.donate) {
        if (incoming.donate.url != null) {
          const du = String(incoming.donate.url).trim();
          if (du === '' || /^https?:\/\//i.test(du)) cur.donate.url = du;   // must be an http(s) link (or cleared)
        }
        if (incoming.donate.label != null) cur.donate.label = String(incoming.donate.label).trim().slice(0, 40);
      }
      if (incoming.sab) {
        if (incoming.sab.url != null) cur.sab.url = String(incoming.sab.url).trim();
        if (incoming.sab.apiKey) cur.sab.apiKey = String(incoming.sab.apiKey).trim();   // blank keeps the stored key
      }
      if (incoming.dockerControl) {
        cur.dockerControl = Object.assign({}, DEFAULT_CONFIG.dockerControl, cur.dockerControl || {});
        if (incoming.dockerControl.enabled != null) cur.dockerControl.enabled = !!incoming.dockerControl.enabled;
        if (incoming.dockerControl.allowedContainers != null) cur.dockerControl.allowedContainers = normalizeDockerAllowed(incoming.dockerControl.allowedContainers);
      }
      if (incoming.update) {
        cur.update = Object.assign({}, DEFAULT_CONFIG.update, cur.update || {});
        if (incoming.update.enabled != null) cur.update.enabled = !!incoming.update.enabled;
        if (!UPDATE_REPO_ENV && incoming.update.repo != null) {
          const repo = normalizeUpdateRepo(incoming.update.repo);
          if (String(incoming.update.repo || '').trim() && !repo) return sendJSON(res, 400, { message: 'Update repository must look like owner/repository' });
          cur.update.repo = repo;
        }
      }
      if (incoming.backup) {
        if (incoming.backup.onChange != null) cur.backup.onChange = !!incoming.backup.onChange;
        if (incoming.backup.everyDays != null) { const d = Number(incoming.backup.everyDays); if (Number.isFinite(d)) cur.backup.everyDays = Math.min(365, Math.max(0, Math.round(d))); }
        if (incoming.backup.keep != null) { const k = Number(incoming.backup.keep); if (Number.isFinite(k)) cur.backup.keep = Math.min(200, Math.max(1, Math.round(k))); }
        setTimeout(scheduleBackups, 50);
      }
      if (incoming.rss) {
        if (incoming.rss.enabled != null) cur.rss.enabled = !!incoming.rss.enabled;
        if (incoming.rss.addMovies != null) cur.rss.addMovies = !!incoming.rss.addMovies;
        if (incoming.rss.addSeries != null) cur.rss.addSeries = !!incoming.rss.addSeries;
        if (incoming.rss.intervalMinutes != null) { const m = Number(incoming.rss.intervalMinutes); if (Number.isFinite(m)) cur.rss.intervalMinutes = Math.min(1440, Math.max(10, m)); }
        if (incoming.rss.maxPerRun != null) { const m = Number(incoming.rss.maxPerRun); if (Number.isFinite(m)) cur.rss.maxPerRun = Math.min(200, Math.max(1, m)); }
        if (incoming.rss.minYear != null) { const y = Number(incoming.rss.minYear); if (Number.isFinite(y)) cur.rss.minYear = (y >= 1900 && y <= 2100) ? y : 0; }
        if (incoming.rss.feeds != null) {
          const raw = Array.isArray(incoming.rss.feeds) ? incoming.rss.feeds : String(incoming.rss.feeds).split(/[\s,;]+/);
          cur.rss.feeds = raw.map(x => String(x).trim()).filter(x => /^https?:\/\//i.test(x)).slice(0, 30);
        }
        setTimeout(scheduleRss, 50);
      }
      if (incoming.plexBlock) {
        if (incoming.plexBlock.enabled != null) cur.plexBlock.enabled = !!incoming.plexBlock.enabled;
        if (incoming.plexBlock.message != null) cur.plexBlock.message = String(incoming.plexBlock.message).slice(0, 300);
        if (incoming.plexBlock.ips != null) {
          const raw = Array.isArray(incoming.plexBlock.ips) ? incoming.plexBlock.ips : String(incoming.plexBlock.ips).split(/[\s,;]+/);
          cur.plexBlock.ips = raw.map(x => String(x).trim()).filter(x => x && x.length < 64).slice(0, 500);
        }
      }
      if (incoming.libraryCache) {
        if (incoming.libraryCache.enabled != null) cur.libraryCache.enabled = !!incoming.libraryCache.enabled;
        if (incoming.libraryCache.intervalMinutes != null) {
          const mins = Number(incoming.libraryCache.intervalMinutes);
          if (Number.isFinite(mins)) cur.libraryCache.intervalMinutes = Math.min(10080, Math.max(60, mins));   // never below 60 min
        }
        setTimeout(scheduleLibScan, 50);   // apply the new interval immediately
      }
      if (incoming.autoAdd) {
        if (incoming.autoAdd.intervalMinutes != null) {
          const mins = Number(incoming.autoAdd.intervalMinutes);
          if (Number.isFinite(mins) && mins >= 0 && mins <= 1440) cur.autoAdd.intervalMinutes = mins;
        }
        if (incoming.autoAdd.minRuntime != null) {
          const mr = Number(incoming.autoAdd.minRuntime);
          if (Number.isFinite(mr) && mr >= 0 && mr <= 600) cur.autoAdd.minRuntime = mr;
        }
      }
      writeConfig(cur);
      return sendJSON(res, 200, sanitize(cur));
    }

    // test connection
    if (p === '/api/test' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const { svc, url, key } = body;
      try {
        if (svc === 'tmdb') return sendJSON(res, 200, await testTmdb(key));
        if (svc === 'plex') return sendJSON(res, 200, await testPlex(url, key));
        if (svc === 'sab') {
          const cur = readConfig().sab;
          const probeCfg = { url: url || cur.url, apiKey: body.key || cur.apiKey };
          if (!probeCfg.url) throw new Error('Enter the SABnzbd URL');
          if (!probeCfg.apiKey) throw new Error('Enter the SABnzbd API key');
          const probe = await sabCall('queue', '', probeCfg);
          if (!probe.ok) throw new Error(probe.message);
          const Q = (probe.data && probe.data.queue) || {};
          return sendJSON(res, 200, { name: 'SABnzbd', version: Q.version || '', queued: (Q.slots || []).length, speed: Q.speed ? Q.speed + 'B/s' : '0 B/s' });
        }
        if (svc === 'webdav') return sendJSON(res, 200, await testWebdav(url, body.username, body.password, body.folder, body.source, body.localPath));
        if (['radarr', 'sonarr'].includes(svc)) return sendJSON(res, 200, await testService(svc, url, key));
        return sendJSON(res, 400, { message: 'bad service' });
      } catch (e) {
        const hint = /ECONNREFUSED|timed out|ENOTFOUND|EHOSTUNREACH/.test(e.message) ? ' (is the URL/port correct and the server running?)' : '';
        return sendJSON(res, 502, { message: e.message + hint });
      }
    }

    // health report
    if (p === '/api/health' && req.method === 'GET') {
      if (u.searchParams.get('refresh')) await runAllChecks();
      return sendJSON(res, 200, {
        services: healthState.services,
        events: healthState.events,
        monitored: monitoredTargets().map(t => t.name),
        intervalMs: HEALTH_INTERVAL_MS,
        now: Date.now()
      });
    }

    // plex now-streaming (privacy-trimmed server-side: 4-char user, no IP)
    // Admins additionally get the technical detail: transcode vs direct, bitrate, quality.
    if (p === '/api/streams' && req.method === 'GET') {
      const who = currentUser(req);                 // this route sits outside the authed block
      const isAdmin = !!(who && who.role === 'admin');
      const out = await plexSessions(isAdmin);
      out.admin = isAdmin;
      return sendJSON(res, 200, out);
    }

    // proxies
    if (p.startsWith('/api/radarr/'))   return proxyArr('radarr', p.slice('/api/radarr'.length) + u.search, req, res);
    if (p.startsWith('/api/sonarr/'))   return proxyArr('sonarr', p.slice('/api/sonarr'.length) + u.search, req, res);
    if (p.startsWith('/api/cinemeta/')) return proxyCinemeta(p.slice('/api/cinemeta'.length) + u.search, res);
    if (p.startsWith('/api/tmdb/'))     return proxyTmdb(p.slice('/api/tmdb'.length) + u.search, res);
    if (p.startsWith('/api/plex/'))     return proxyPlex(p.slice('/api/plex'.length) + u.search, res);

    // other static assets under public/
    if (req.method === 'GET') return serveStatic(res, p.replace(/^\//, ''));

    res.writeHead(404); res.end('Not found');
  } catch (e) {
    sendJSON(res, 500, { message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('\n  MEDIARR running →  http://localhost:' + PORT + '\n');
  console.log('  Config stored at:  ' + CONFIG_PATH);
  console.log('  Health log at:     ' + HEALTH_PATH);
  console.log('  Stop with Ctrl+C\n');
  // background health monitoring: first run shortly after boot, then on an interval
  setTimeout(() => { runAllChecks().catch(() => {}); }, 2500);
  setInterval(() => { runAllChecks().catch(() => {}); }, HEALTH_INTERVAL_MS);
  const rt = setInterval(() => { if (realtimeClients.size) realtimePush('snapshot', realtimeSnapshot()); }, 5000);
  if (rt.unref) rt.unref();
});