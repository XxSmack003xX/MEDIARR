'use strict';
/*
 * MEDIARR music library (v2.7) — powers the stand-alone music player at /music.
 *
 *  - Scans every configured music folder recursively (any depth, symlink-loop safe),
 *    reading tags with music-tags.js. Rescans are incremental: only new or changed
 *    files are read again. Tracks in a folder that has gone missing (an unmounted
 *    share) are kept until the folder comes back.
 *  - Groups tracks into albums three ways:
 *      smart   "Keep albums together": each folder of songs is one album (Disc 1/CD2
 *              sub-folders are joined); folders that hold many different albums
 *              fall back to the album tags.
 *      folder  every folder is an album, whatever the tags say.
 *      tags    classic tag grouping (album + album artist).
 *  - Serves cover art (folder images or embedded pictures, resized and cached with
 *    ffmpeg when available) and audio: files the browser can play are sent as-is with
 *    byte ranges; anything else is transcoded on the fly with ffmpeg.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const tagsLib = require('./music-tags.js');
const metaLib = require('./music-meta.js');

const AUDIO_EXT = new Set(['mp3', 'mp2', 'mpga', 'flac', 'ogg', 'oga', 'opus', 'spx', 'm4a', 'm4b', 'm4p', 'aac', 'adts', 'wav', 'wave', 'aif', 'aiff', 'aifc',
  'wma', 'ape', 'wv', 'mpc', 'mp+', 'mpp', 'tta', 'dsf', 'dff', 'mka', 'weba', 'caf', 'ac3', 'eac3', 'dts', 'amr', 'awb', 'au', 'snd', 'shn', 'tak', 'ra', '3ga']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const ART_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'artwork', 'thumb', 'art', 'scan'];
const SKIP_DIRS = new Set(['@eadir', '#recycle', '@recycle', '$recycle.bin', 'system volume information', 'lost+found', '#snapshot', '.appledouble', '.trash', '.trashes', '@tmp', '.@__thumb']);
const CORE_EXT = new Set(['mp3', 'm4a', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aac']);
const DISC_DIR = /^(?:cd|dis[ck])\s*[-_.#]?\s*(\d{1,2})\b/i;
const DISC_SUFFIX = /[\s\-–_]*[\(\[{]?\s*(?:cd|dis[ck])\s*[-_.#]?\s*(\d{1,2})\s*[\)\]}]?\s*$/i;
const FEAT = /\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x|&|and)\s+.*$|\s*[,;\/]\s+.*$/i;
const ART_SIZES = [96, 200, 300, 600, 1000];
const MODES = ['smart', 'folder', 'tags'];
const MIME = {
  mp3: 'audio/mpeg', mp2: 'audio/mpeg', mpga: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', spx: 'audio/ogg',
  m4a: 'audio/mp4', m4b: 'audio/mp4', m4p: 'audio/mp4', '3ga': 'audio/mp4', aac: 'audio/aac', adts: 'audio/aac', wav: 'audio/wav', wave: 'audio/wav',
  aif: 'audio/aiff', aiff: 'audio/aiff', aifc: 'audio/aiff', wma: 'audio/x-ms-wma', mka: 'audio/x-matroska', weba: 'audio/webm', caf: 'audio/x-caf',
  ac3: 'audio/ac3', eac3: 'audio/eac3', amr: 'audio/amr', au: 'audio/basic', snd: 'audio/basic'
};
const LOSSLESS = new Set(['flac', 'alac', 'pcm', 'pcm_f32', 'wavpack', 'ape', 'tta', 'tak', 'shorten', 'mlp', 'truehd']);

const sha = (s, n) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n || 16);
function norm (s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function sortKey (s) { return norm(s).replace(/^(the|a|an) /, ''); }
const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
function primaryArtist (a) { return norm(String(a || '').replace(FEAT, '')); }
function majority (values) {
  const counts = new Map(); let best = '', bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const k = norm(v); const c = (counts.get(k) || { n: 0, v });
    c.n++; counts.set(k, c);
    if (c.n > bestN) { bestN = c.n; best = c.v; }
  }
  return { value: best, n: bestN, distinct: counts.size };
}
function yearOf (v) { const m = /(?:^|\D)((?:1[5-9]|20)\d\d)(?:\D|$)/.exec(String(v || '')); return m ? Number(m[1]) : 0; }
function limiter (n) {
  let active = 0; const q = [];
  const next = () => {
    if (active >= n || !q.length) return;
    active++; const { fn, res, rej } = q.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); });
  };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

/* Folder and file name heuristics for files with missing tags */
function cleanFolderTitle (name, artist) {
  let s = String(name || '');
  s = s.replace(/[\[\({](?:flac|mp3|aac|alac|ogg|opus|wav|m4a|v0|v2|vbr|cbr|web(?:-?dl)?|cd(?:rip)?|vinyl|lossless|hi-?res|\d{2,3}\s*k(?:bps)?|\d{3}|(?:16|24|32)\s*-?\s*bit[^\]\)}]*|\d{2}(?:\.\d)?\s*[-\/]\s*\d{2,3}(?:\.\d)?\s*(?:k(?:hz)?)?)[\]\)}]/gi, ' ');
  s = s.replace(/\s*[\[\(]((?:1[5-9]|20)\d\d)[\]\)]\s*/g, ' ').replace(/^((?:1[5-9]|20)\d\d)\s*[-–.]\s+/, '');
  if (artist) {
    const i = s.indexOf(' - ');
    if (i > 0 && norm(s.slice(0, i)) === norm(artist)) s = s.slice(i + 3);
  }
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–_.]+|[\s\-–_.]+$/g, '').trim() || String(name || '');
}
function parseFileName (base) {
  let s = String(base).replace(/_/g, ' ').trim(), track = 0, disc = 0, artist = '';
  let m = /^(\d)[-.](\d{1,3})(?:[\s.\-)]+)(.+)$/.exec(s);
  if (m) { disc = +m[1]; track = +m[2]; s = m[3]; }
  else if ((m = /^(\d{1,3})(?:\s*[.\-)]\s*|\s+)(.+)$/.exec(s))) { track = +m[1]; s = m[2]; }
  s = s.replace(/^[-\s.]+/, '');
  if ((m = /^(.+?)\s+[-–]\s+(.+)$/.exec(s))) { artist = m[1].trim(); s = m[2]; }
  return { title: s.trim() || String(base), track, disc, artist };
}
function discParent (relDir) {
  const parts = relDir ? relDir.split('/') : [];
  const base = parts[parts.length - 1] || '';
  let m;
  if (parts.length > 1 && (m = DISC_DIR.exec(base))) return { key: parts.slice(0, -1).join('/'), disc: Number(m[1]) };
  if (base && (m = DISC_SUFFIX.exec(base)) && m.index > 0) return { key: parts.slice(0, -1).concat(base.slice(0, m.index).replace(/[\s\-–_]+$/, '')).join('/'), disc: Number(m[1]) };
  return { key: relDir, disc: 0 };
}

function createMusicLibrary (opts) {
  const store = opts.store;
  const log = opts.log || (() => {});
  const ffmpeg = () => (typeof opts.ffmpeg === 'function' ? opts.ffmpeg() : opts.ffmpeg) || null;
  const ffprobe = () => (typeof opts.ffprobe === 'function' ? opts.ffprobe() : opts.ffprobe) || null;
  const artDir = path.join(opts.dataDir, 'cache', 'music-art');

  let tracks = new Map();   // id -> track
  let dirArt = new Map();   // absolute dir -> absolute image path
  let gen = 0;              // bumps whenever the library changes
  let loaded = false;
  const indexes = new Map(); // mode -> index
  const artMap = new Map();  // artKey -> source
  let scanState = { running: false, phase: '', found: 0, done: 0, total: 0, startedAt: 0 };
  let lastScan = null;
  let scanTimer = null, intervalTimer = null, pendingScan = null;
  let encoders = null;
  const meta = opts.meta || null;   // online metadata (music-meta.js), optional
  const metaOn = () => !!(meta && meta.config().enabled);

  function folders () {
    const c = opts.getConfig() || {};
    return (Array.isArray(c.folders) ? c.folders : []).map(f => String(f || '').trim()).filter(f => f && path.isAbsolute(f)).map(f => path.resolve(f));
  }

  /* ---------- persistence ---------- */
  function load () {
    if (loaded) return;
    loaded = true;
    try {
      for (const row of store.music.allTracks()) {
        let d; try { d = JSON.parse(row.data); } catch (_) { continue; }
        tracks.set(row.id, Object.assign(d, { id: row.id, path: row.path, root: row.root, size: row.size, mtime: row.mtime, added: row.added_at }));
      }
      const da = store.kv.get('music.dirArt', {});
      dirArt = new Map(Object.entries(da || {}));
      lastScan = store.kv.get('music.lastScan', null);
    } catch (e) { log('[music] could not load the library: ' + e.message); }
    gen = Date.now();
  }
  function rowOf (t) {
    const { id, path: p, root, size, mtime, added } = t;
    const data = Object.assign({}, t); delete data.id; delete data.path; delete data.root; delete data.size; delete data.mtime; delete data.added;
    return { id, path: p, root, size, mtime, added_at: added, data };
  }

  /* ---------- scanning ---------- */
  async function walk (roots, onAudio) {
    const visited = new Set();
    const result = { roots: {}, images: new Map() };
    for (const root of roots) {
      const info = { path: root, state: 'ok', files: 0, message: '' };
      result.roots[root] = info;
      let st;
      try { st = await fsp.stat(root); } catch (e) { info.state = 'missing'; info.message = e.code === 'EACCES' ? 'MEDIARR doesn’t have permission to read this folder' : 'Folder not found. In Docker, mount it into the container first.'; continue; }
      if (!st.isDirectory()) { info.state = 'missing'; info.message = 'This is a file, not a folder'; continue; }
      // Symlinked folders are walked last, so files are recorded under their real
      // location and a link back into the library (or a loop) adds nothing.
      const stack = [{ dir: root, depth: 0 }], linked = [];
      let readable = false;
      while (stack.length || linked.length) {
        const { dir, depth } = stack.length ? stack.pop() : linked.shift();
        let real; try { real = await fsp.realpath(dir); } catch (_) { continue; }
        if (visited.has(real)) continue;
        visited.add(real);
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
        catch (e) { if (dir === root) { info.state = 'error'; info.message = e.code === 'EACCES' ? 'MEDIARR doesn’t have permission to read this folder' : e.message; } continue; }
        if (dir === root) readable = true;
        const imgs = [];
        for (const ent of entries) {
          const name = ent.name;
          if (name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())) continue;
          const full = path.join(dir, name);
          let isDir = ent.isDirectory(), isFile = ent.isFile();
          const link = ent.isSymbolicLink();
          if (link) { try { const s2 = await fsp.stat(full); isDir = s2.isDirectory(); isFile = s2.isFile(); } catch (_) { continue; } }
          if (isDir) { if (depth < 40) (link ? linked : stack).push({ dir: full, depth: depth + 1 }); continue; }
          if (!isFile) continue;
          const ext = (name.split('.').pop() || '').toLowerCase();
          if (AUDIO_EXT.has(ext) && name.includes('.')) { info.files++; onAudio(full, root); }
          else if (IMAGE_EXT.has(ext)) imgs.push(name);
        }
        if (imgs.length) result.images.set(dir, pickArt(dir, imgs));
      }
      if (readable && !info.files && [...tracks.values()].some(t => t.root === root)) {
        info.state = 'empty'; info.message = 'The folder is empty. If it’s a network share or mounted drive, it may not be connected.';
      }
    }
    return result;
  }
  function pickArt (dir, imgs) {
    const scored = imgs.map(n => {
      const b = n.toLowerCase().replace(/\.[^.]+$/, '');
      let s = ART_NAMES.indexOf(b); if (s < 0 && /cover|front|folder/.test(b)) s = 20; if (s < 0) s = /back|cd|disc|inlay|inside|booklet/.test(b) ? 90 : 50;
      return { n, s };
    }).sort((a, b) => a.s - b.s || cmp(a.n, b.n));
    return path.join(dir, scored[0].n);
  }
  function buildTrack (file, root, st, info, firstScan) {
    const tg = info.tags || {};
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const fn = parseFileName(base);
    const relDir = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean).join('/');
    const [trackNo, trackTotal] = tagsLib.pairOf(tg.track);
    const [discNo, discTotal] = tagsLib.pairOf(tg.disc);
    const dp = discParent(relDir);
    const albumDirName = dp.key ? dp.key.split('/').pop() : '';
    const parentName = dp.key && dp.key.includes('/') ? dp.key.split('/').slice(-2, -1)[0] : '';
    const prev = tracks.get(sha(file));
    return {
      id: sha(file), path: file, root, size: st.size, mtime: Math.round(st.mtimeMs),
      added: prev ? prev.added : (firstScan ? Math.min(Date.now(), Math.round(st.mtimeMs)) : Date.now()),
      relDir, file: path.basename(file),
      title: tg.title || fn.title,
      artist: tg.artist || (!tg.title && fn.artist) || '',
      albumArtist: tg.albumartist || '',
      album: tg.album || '',
      genre: tg.genre || '',
      year: yearOf(tg.year) || yearOf(tg.origyear) || 0,
      trackNo: trackNo || (!tg.track ? fn.track : 0), trackTotal: trackTotal || tagsLib.intOf(tg.tracktotal),
      discNo: discNo || fn.disc || dp.disc || 0, discTotal: discTotal || tagsLib.intOf(tg.disctotal),
      comp: /^(1|true|yes)$/i.test(String(tg.compilation || '')),
      folderAlbum: albumDirName ? cleanFolderTitle(albumDirName, tg.albumartist || tg.artist || parentName) : '',
      folderArtist: parentName,
      folderYear: yearOf(albumDirName),
      duration: Math.round((info.duration || 0) * 1000) / 1000,
      codec: info.codec || '', container: (path.extname(file).slice(1) || '').toLowerCase(),
      bitrate: info.bitrate || 0, sampleRate: info.sampleRate || 0, channels: info.channels || 0, bits: info.bits || 0,
      art: info.art || null,
      ok: !!info.ok || (!ffprobe() && CORE_EXT.has((path.extname(file).slice(1) || '').toLowerCase()) && !info.error && st.size > 1024)
    };
  }

  async function scan (o) {
    o = o || {};
    load();
    if (scanState.running) return { started: false, running: true };
    const roots = folders();
    scanState = { running: true, phase: 'Looking for music files', found: 0, done: 0, total: 0, startedAt: Date.now(), full: !!o.full };
    const startedAt = Date.now();
    const result = { at: startedAt, took: 0, added: 0, updated: 0, removed: 0, failed: 0, unchanged: 0, failedFiles: [], roots: [], reason: o.reason || 'manual' };
    try {
      const found = [];
      const w = await walk(roots, (file, root) => { found.push({ file, root }); scanState.found = found.length; });
      const firstScan = tracks.size === 0;
      scanState.phase = 'Checking files';
      const seen = new Set(), toRead = [];
      const statLimit = limiter(16);
      await Promise.all(found.map(f => statLimit(async () => {
        let st; try { st = await fsp.stat(f.file); } catch (_) { return; }
        const id = sha(f.file); seen.add(id);
        const old = tracks.get(id);
        if (!o.full && old && old.size === st.size && old.mtime === Math.round(st.mtimeMs) && old.root === f.root) { result.unchanged++; return; }
        toRead.push({ f, st, old });
      })));
      scanState.phase = 'Reading tags'; scanState.total = toRead.length; scanState.done = 0;
      const readLimit = limiter(4), batch = [];
      const flush = () => { if (batch.length) { store.music.upsertTracks(batch.splice(0).map(rowOf)); } };
      await Promise.all(toRead.map(x => readLimit(async () => {
        let info;
        try { info = await tagsLib.readTags(x.f.file, { ffprobe: ffprobe() }); } catch (e) { info = { tags: {}, ok: false, error: e.message }; }
        const t = buildTrack(x.f.file, x.f.root, x.st, info, firstScan);
        if (!t.ok) { result.failed++; if (result.failedFiles.length < 25) result.failedFiles.push(x.f.file); }
        if (x.old) result.updated++; else result.added++;
        tracks.set(t.id, t); batch.push(t);
        if (batch.length >= 200) flush();
        scanState.done++;
      })));
      flush();
      // remove what is gone, but never from a folder that is currently missing or empty
      scanState.phase = 'Cleaning up';
      const online = new Set(Object.values(w.roots).filter(r => r.state === 'ok').map(r => r.path));
      const configured = new Set(roots);
      const gone = [];
      for (const t of tracks.values()) {
        if (!configured.has(t.root) || (online.has(t.root) && !seen.has(t.id))) gone.push(t.id);
      }
      for (const id of gone) tracks.delete(id);
      store.music.deleteTracks(gone);
      result.removed = gone.length;
      // folder artwork: keep entries for offline roots
      const nextArt = new Map();
      for (const [d, img] of dirArt) { const r = roots.find(x => d === x || d.startsWith(x + path.sep)); if (r && !online.has(r)) nextArt.set(d, img); }
      for (const [d, img] of w.images) nextArt.set(d, img);
      dirArt = nextArt;
      store.kv.set('music.dirArt', Object.fromEntries(dirArt));
      result.roots = Object.values(w.roots).map(r => ({ path: r.path, state: r.state, files: r.files, message: r.message }));
    } catch (e) {
      result.error = e.message;
      log('[music] scan failed: ' + e.message);
    } finally {
      result.took = Date.now() - startedAt;
      result.tracks = tracks.size;
      lastScan = result;
      try { store.kv.set('music.lastScan', result); } catch (_) {}
      if (result.added || result.updated || result.removed || o.full) { gen = Date.now(); indexes.clear(); artMap.clear(); }
      scanState = { running: false, phase: '', found: 0, done: 0, total: 0, startedAt: 0 };
      if (result.added || result.removed || result.updated) cleanArtCache().catch(() => {});
      log('[music] scan (' + result.reason + ') finished in ' + (result.took / 1000).toFixed(1) + 's: ' + result.tracks + ' tracks, +' + result.added + ' ~' + result.updated + ' -' + result.removed + (result.failed ? ', ' + result.failed + ' unreadable' : ''));
      if (opts.onScanDone) try { opts.onScanDone(result); } catch (_) {}
      if (!result.error) setTimeout(() => queueMeta(false), 1000);
    }
    return { started: true, result };
  }
  function scheduleScan (delayMs, reason) {
    if (!folders().length) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (scanState.running) { pendingScan = reason; return; }
      scan({ reason }).then(() => { if (pendingScan) { const r = pendingScan; pendingScan = null; scheduleScan(5000, r); } }).catch(() => {});
    }, Math.max(0, delayMs || 0));
    if (scanTimer.unref) scanTimer.unref();
  }
  function startSchedule () {
    clearInterval(intervalTimer);
    const c = opts.getConfig() || {};
    const hours = Number(c.scanIntervalHours);
    if (hours > 0) { intervalTimer = setInterval(() => scheduleScan(0, 'schedule'), Math.max(1, hours) * 3600 * 1000); if (intervalTimer.unref) intervalTimer.unref(); }
  }

  /* ---------- album grouping ---------- */
  function playable (t) { return t.ok; }
  function albumKeyFor (t, mode, folderTags) {
    const dp = discParent(t.relDir);
    const dirKey = dp.key ? t.root + '\u0000' + dp.key : '';
    const tagKey = () => 't:' + norm(t.album) + '|' + (t.albumArtist ? norm(t.albumArtist) : t.comp ? 'various artists' : primaryArtist(t.artist));
    if (mode === 'tags') return tagKey();
    if (!dirKey) return t.album ? tagKey() : 'u:' + primaryArtist(t.artist);   // loose files in a music folder's top level
    if (mode === 'folder') return 'd:' + dirKey;
    const set = folderTags.get(dirKey);
    // songs with no album tag stay with their folder, even in a folder of mixed albums
    return (!set || set.size <= 1 || !t.album) ? 'd:' + dirKey : tagKey();
  }
  function buildIndex (mode) {
    load();
    if (!MODES.includes(mode)) mode = 'smart';
    const cached = indexes.get(mode);
    if (cached && cached.gen === gen) return cached;
    const list = [...tracks.values()].filter(playable);
    const folderTags = new Map();
    if (mode === 'smart') {
      for (const t of list) {
        const dp = discParent(t.relDir); if (!dp.key) continue;
        const k = t.root + '\u0000' + dp.key;
        let s = folderTags.get(k); if (!s) folderTags.set(k, s = new Set());
        if (t.album) s.add(norm(t.album));
      }
    }
    const groups = new Map();
    for (const t of list) {
      const k = albumKeyFor(t, mode, folderTags);
      let g = groups.get(k); if (!g) groups.set(k, g = []);
      g.push(t);
    }
    // In smart mode, songs from mixed folders join a folder album with the same tags.
    if (mode === 'smart') {
      const sig = new Map();
      const sigOf = g => { const m = majority(g.map(t => t.album)); const a = majority(g.map(t => t.albumArtist || t.artist)); return m.value ? norm(m.value) + '|' + primaryArtist(a.value) : ''; };
      // An album split over a folder and its sub-folders ("Album/Set 1", "Album/Bonus")
      // with the same tags is one album: fold sub-folders into the nearest matching parent.
      const dirGroups = [...groups.keys()].filter(k => k.startsWith('d:')).sort((a, b) => a.length - b.length);
      const bySigDir = new Map();
      for (const k of dirGroups) {
        const s = sigOf(groups.get(k)); if (!s) continue;
        let parent = k, merged = false;
        while (parent.lastIndexOf('/') > parent.indexOf('\u0000')) {
          parent = parent.slice(0, parent.lastIndexOf('/'));
          const target = bySigDir.get(parent + '\u0001' + s);
          if (target && groups.has(target)) { groups.get(target).push(...groups.get(k)); groups.delete(k); merged = true; break; }
        }
        if (!merged) bySigDir.set(k + '\u0001' + s, k);
      }
      for (const [k, g] of groups) if (k.startsWith('d:')) { const s = sigOf(g); if (s) sig.set(s, k); }
      for (const [k, g] of [...groups]) {
        if (!k.startsWith('t:')) continue;
        const target = sig.get(k.slice(2));
        if (target) { groups.get(target).push(...g); groups.delete(k); }
      }
    }
    const albums = [], albumById = new Map(), albumOfTrack = new Map();
    for (const [key, g] of groups) {
      g.sort((a, b) => (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 9999) - (b.trackNo || 9999) || cmp(a.file, b.file));
      const isDir = key.startsWith('d:');
      const titleM = majority(g.map(t => t.album));
      const aaM = majority(g.map(t => t.albumArtist));
      const prim = majority(g.map(t => primaryArtist(t.artist)));
      const artistDisplay = majority(g.map(t => t.artist));
      let artist;
      if (aaM.value) artist = aaM.value;
      else if (prim.value && prim.n >= Math.ceil(g.length * 0.6)) artist = majority(g.filter(t => primaryArtist(t.artist) === prim.value).map(t => String(t.artist).replace(FEAT, '').trim())).value || artistDisplay.value;
      else if (prim.distinct > 1 || g.some(t => t.comp)) artist = 'Various Artists';
      else artist = (isDir && g[0].folderArtist) || 'Unknown Artist';
      // a folder holding several different albums (strict folder mode) is named after the folder
      const title = ((isDir && titleM.distinct > 1) ? g[0].folderAlbum : titleM.value) || (isDir ? g[0].folderAlbum : '') || 'Unknown Album';
      const y = majority(g.map(t => t.year ? String(t.year) : ''));
      const genre = majority(g.map(t => t.genre)).value;
      const id = sha(mode + ':' + key);
      const codecs = new Set(g.map(t => t.codec));
      const lossless = [...codecs].every(c => LOSSLESS.has(c));
      const hires = lossless && g.some(t => t.bits > 16 || t.sampleRate > 48000);
      const al = {
        id, key, title, artist, artistId: sha('artist:' + norm(artist), 12), year: Number(y.value) || g[0].folderYear || 0, genre,
        tracks: g.map(t => t.id), n: g.length, duration: g.reduce((s, t) => s + (t.duration || 0), 0),
        discs: Math.max(1, ...g.map(t => t.discNo || 1)), comp: artist === 'Various Artists' || g.some(t => t.comp),
        added: Math.max(...g.map(t => t.added || 0)), quality: hires ? 'Hi-Res' : lossless ? 'Lossless' : '',
        art: '', dir: isDir ? key.slice(2).split('\u0000')[1] : ''
      };
      al.art = albumArt(al, g, isDir);
      al.localArt = !!al.art; al.localYear = !!al.year; al.localGenre = !!al.genre;
      applyMeta(al);
      albums.push(al); albumById.set(id, al);
      for (const t of g) albumOfTrack.set(t.id, al);
    }
    albums.sort((a, b) => cmp(sortKey(a.title), sortKey(b.title)) || cmp(a.artist, b.artist));
    // artists (by album artist) and the albums they appear on as a track artist
    const artists = new Map();
    for (const al of albums) {
      let ar = artists.get(al.artistId);
      if (!ar) artists.set(al.artistId, ar = { id: al.artistId, name: al.artist, albums: [], n: 0, art: '' });
      ar.albums.push(al.id); ar.n += al.n;
    }
    const appears = new Map();
    for (const t of list) {
      const al = albumOfTrack.get(t.id);
      const pid = sha('artist:' + primaryArtist(t.artist), 12);
      if (pid !== al.artistId && artists.has(pid)) { let a = appears.get(pid); if (!a) appears.set(pid, a = []); a.push(t.id); }
    }
    for (const ar of artists.values()) {
      const own = ar.albums.map(i => albumById.get(i)).sort((a, b) => (b.year || 0) - (a.year || 0));
      ar.art = (own.find(a => a.art) || {}).art || '';
      const m = metaOn() && meta.get(metaLib.artistKey(ar.name));
      if (m && m.status === 'ok') { ar.meta = m.data; const k = m.art && onlineArt(m); if (k) { ar.art = k; ar.onlineArt = true; } }
    }
    const artistList = [...artists.values()].sort((a, b) => (a.name === 'Various Artists') - (b.name === 'Various Artists') || cmp(sortKey(a.name), sortKey(b.name)));
    const genres = new Map();
    for (const al of albums) {
      if (!al.genre) continue;
      const gid = sha('genre:' + norm(al.genre), 10);
      let g = genres.get(gid); if (!g) genres.set(gid, g = { id: gid, name: al.genre, albums: [], n: 0 });
      g.albums.push(al.id); g.n += al.n;
    }
    const idx = {
      mode, gen, albums, albumById, albumOfTrack, artists, artistList, appears, genres: [...genres.values()].sort((a, b) => cmp(a.name, b.name)),
      tracks: list, sorted: new Map(),
      totalDuration: list.reduce((s, t) => s + (t.duration || 0), 0)
    };
    indexes.set(mode, idx);
    return idx;
  }
  // Online metadata fills what the files don't have (and replaces local art only if the admin prefers online art).
  function applyMeta (al) {
    if (!metaOn()) return;
    const m = meta.get(metaLib.albumKey(al.artist, al.title));
    if (!m || m.status !== 'ok') return;
    const d = m.data || {};
    if (!al.year && d.year) al.year = d.year;
    if (!al.genre && d.genre) al.genre = d.genre;
    al.meta = d;
    if (m.art && (!al.art || meta.config().preferOnlineArt)) { const k = onlineArt(m); if (k) { al.art = k; al.onlineArt = true; } }
  }
  function onlineArt (m) {
    const file = meta.artPath(m); if (!file) return '';
    const key = sha('art:online:' + file + ':' + (m.checked || 0), 20);
    artMap.set(key, { kind: 'file', path: file, sig: file + ':' + m.checked });
    return key;
  }
  function metaJobs () {
    const albums = new Map(), artists = new Map();
    for (const m of ['smart', 'tags']) {
      const idx = buildIndex(m);
      for (const al of idx.albums) {
        const key = metaLib.albumKey(al.artist, al.title);
        if (!albums.has(key)) albums.set(key, { key, title: al.title, artist: al.artist, comp: !!al.comp, haveArt: al.localArt, haveYear: al.localYear, haveGenre: al.localGenre });
      }
      for (const ar of idx.artistList) { const key = metaLib.artistKey(ar.name); if (!artists.has(key)) artists.set(key, { key, name: ar.name }); }
    }
    return { albums: [...albums.values()], artists: [...artists.values()] };
  }
  function queueMeta (mode) {
    if (!meta) return 0;
    try { const j = metaJobs(); return meta.enqueue(j.albums, j.artists, mode || false); } catch (e) { log('[music] online metadata: ' + e.message); return 0; }
  }
  function metaChanged () { gen = Date.now(); indexes.clear(); artMap.clear(); }
  function albumMetaJob (mode, id) {
    const al = buildIndex(mode).albumById.get(String(id)); if (!al) return null;
    return { kind: 'album', key: metaLib.albumKey(al.artist, al.title), title: al.title, artist: al.artist, comp: !!al.comp, haveArt: al.localArt, haveYear: al.localYear, haveGenre: al.localGenre, name: al.artist + ' — ' + al.title };
  }
  function artistMetaJob (mode, id) {
    const ar = buildIndex(mode).artists.get(String(id)); if (!ar) return null;
    return { kind: 'artist', key: metaLib.artistKey(ar.name), name: ar.name };
  }
  function albumArt (al, g, isDir) {
    const dirs = [];
    for (const t of g) { const d = path.dirname(t.path); if (!dirs.includes(d)) dirs.push(d); }
    if (isDir) for (const d of [...dirs]) { const p = path.dirname(d); if (!dirs.includes(p) && p.startsWith(g[0].root)) dirs.push(p); }
    const folderSrc = () => { for (const d of dirs) { const img = dirArt.get(d); if (img) return { kind: 'file', path: img, sig: img }; } return null; };
    const embedSrc = () => { const t = g.find(x => x.art); return t ? { kind: t.art.kind, path: t.path, off: t.art.off, len: t.art.len, mime: t.art.mime, sig: t.path + ':' + t.mtime } : null; };
    // a folder of one album: prefer the folder image; a mixed folder: prefer each album's own picture
    const src = isDir ? (folderSrc() || embedSrc()) : (embedSrc() || (g.length > 1 ? folderSrc() : null));
    if (!src) return '';
    const key = sha('art:' + src.kind + ':' + src.sig, 20);
    artMap.set(key, src);
    return key;
  }

  // what the album/artist page shows about where online details came from
  function metaInfo (m, al) {
    if (!metaOn()) return null;
    if (!m) return { status: 'pending' };
    if (m.status !== 'ok') return { status: m.status };
    const d = m.data || {};
    const links = [];
    if (d.mbid) links.push({ name: 'MusicBrainz', url: 'https://musicbrainz.org/release-group/' + encodeURIComponent(d.mbid) });
    if (d.deezerId) links.push({ name: 'Deezer', url: 'https://www.deezer.com/' + (m.kind === 'artist' ? 'artist/' : 'album/') + encodeURIComponent(d.deezerId) });
    return { status: 'ok', source: m.source, type: d.type || '', secondary: d.secondary || '', year: d.year || 0, genre: d.genre || '',
      art: !!m.art, artSource: d.artSource || (m.kind === 'artist' && m.art ? 'Deezer' : ''), usingArt: !!(al && al.onlineArt), links };
  }

  /* ---------- output shapes ---------- */
  function albumOut (al) {
    return { id: al.id, t: al.title, a: al.artist, ai: al.artistId, y: al.year || 0, g: al.genre || '', n: al.n, d: Math.round(al.duration), dn: al.discs, art: al.art, ad: al.added, c: al.comp ? 1 : 0, q: al.quality };
  }
  function trackOut (t, idx, plays) {
    const al = idx.albumOfTrack.get(t.id) || {};
    const p = plays && plays.get(t.id);
    return {
      id: t.id, t: t.title, a: t.artist || al.artist || '', al: al.title || '', ali: al.id || '', aa: al.artist || '', ai: al.artistId || '',
      n: t.trackNo || 0, dn: t.discNo || 0, d: Math.round((t.duration || 0) * 100) / 100, y: t.year || al.year || 0, g: t.genre || al.genre || '',
      c: t.codec, x: t.container, br: t.bitrate || 0, sr: t.sampleRate || 0, bt: t.bits || 0, ch: t.channels || 0, art: al.art || '',
      pc: p ? p.count : 0, lp: p ? p.last : 0, ad: t.added || 0
    };
  }
  function playsMap (username) {
    const m = new Map();
    if (!username) return m;
    try { for (const r of store.music.playsFor(username)) m.set(r.id, { count: r.count, last: r.last }); } catch (_) {}
    return m;
  }

  /* ---------- queries ---------- */
  function libraryPayload (mode) {
    const idx = buildIndex(mode);
    return {
      gen: idx.gen, mode: idx.mode,
      albums: idx.albums.map(albumOut),
      artists: idx.artistList.map(a => ({ id: a.id, name: a.name, albums: a.albums.length, n: a.n, art: a.art })),
      genres: idx.genres.map(g => ({ id: g.id, name: g.name, albums: g.albums.length, n: g.n })),
      stats: { tracks: idx.tracks.length, albums: idx.albums.length, artists: idx.artistList.length, duration: Math.round(idx.totalDuration) }
    };
  }
  function album (mode, id, username) {
    const idx = buildIndex(mode); const al = idx.albumById.get(String(id));
    if (!al) return null;
    const plays = playsMap(username);
    const m = meta && meta.get(metaLib.albumKey(al.artist, al.title));
    return { album: albumOut(al), tracks: al.tracks.map(tid => trackOut(tracks.get(tid), idx, plays)), folder: al.dir, info: metaInfo(m, al) };
  }
  function artist (mode, id, username) {
    const idx = buildIndex(mode); const ar = idx.artists.get(String(id));
    if (!ar) return null;
    const plays = playsMap(username);
    const albums = ar.albums.map(i => idx.albumById.get(i)).sort((a, b) => (b.year || 0) - (a.year || 0) || cmp(a.title, b.title));
    const own = new Set(ar.albums);
    const songs = [];
    for (const aid of ar.albums) for (const tid of idx.albumById.get(aid).tracks) songs.push(tracks.get(tid));
    const top = songs.filter(t => plays.has(t.id)).sort((a, b) => plays.get(b.id).count - plays.get(a.id).count).slice(0, 10);
    return {
      artist: { id: ar.id, name: ar.name, albums: albums.length, n: ar.n, art: ar.art },
      info: metaInfo(meta && meta.get(metaLib.artistKey(ar.name)), ar),
      albums: albums.map(albumOut),
      top: top.map(t => trackOut(t, idx, plays)),
      appears: (idx.appears.get(ar.id) || []).filter(tid => !own.has((idx.albumOfTrack.get(tid) || {}).id)).slice(0, 200).map(tid => trackOut(tracks.get(tid), idx, plays))
    };
  }
  function genre (mode, id) {
    const idx = buildIndex(mode); const g = idx.genres.find(x => x.id === String(id));
    if (!g) return null;
    return { genre: { id: g.id, name: g.name, n: g.n }, albums: g.albums.map(i => albumOut(idx.albumById.get(i))) };
  }
  const SORTS = {
    title: (a, b) => cmp(sortKey(a.title), sortKey(b.title)),
    artist: (a, b) => cmp(sortKey(a.artist || a._aa), sortKey(b.artist || b._aa)) || cmp(sortKey(a._al), sortKey(b._al)) || (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 0) - (b.trackNo || 0),
    album: (a, b) => cmp(sortKey(a._al), sortKey(b._al)) || (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 0) - (b.trackNo || 0),
    added: (a, b) => (b.added || 0) - (a.added || 0) || cmp(a.path, b.path),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0),
    year: (a, b) => (a.year || 0) - (b.year || 0) || cmp(sortKey(a._al), sortKey(b._al)),
    genre: (a, b) => cmp(a.genre || '', b.genre || '') || cmp(sortKey(a.title), sortKey(b.title))
  };
  function songs (mode, q, username) {
    const idx = buildIndex(mode);
    const plays = playsMap(username);
    let sort = String(q.sort || 'title'); if (!SORTS[sort] && sort !== 'plays') sort = 'title';
    const desc = q.dir === 'desc';
    let list;
    if (sort === 'plays') list = idx.tracks.slice().sort((a, b) => ((plays.get(b.id) || {}).count || 0) - ((plays.get(a.id) || {}).count || 0) || cmp(sortKey(a.title), sortKey(b.title)));
    else {
      list = idx.sorted.get(sort);
      if (!list) {
        for (const t of idx.tracks) { const al = idx.albumOfTrack.get(t.id); t._al = al.title; t._aa = al.artist; }
        list = idx.tracks.slice().sort(SORTS[sort]); idx.sorted.set(sort, list);
      }
    }
    if (q.q) { const words = norm(q.q).split(' ').filter(Boolean); list = list.filter(t => { const h = hay(t, idx); return words.every(w => h.includes(w)); }); }
    if (desc) list = list.slice().reverse();
    const offset = Math.max(0, Number(q.offset) || 0), limit = Math.min(500, Math.max(1, Number(q.limit) || 200));
    return { total: list.length, offset, items: list.slice(offset, offset + limit).map(t => trackOut(t, idx, plays)) };
  }
  function hay (t, idx) {
    if (t._hayGen === idx.gen + idx.mode) return t._hay;
    const al = idx.albumOfTrack.get(t.id) || {};
    t._hay = ' ' + norm([t.title, t.artist, al.title, al.artist, t.genre].join(' ')) + ' ';
    t._hayGen = idx.gen + idx.mode;
    return t._hay;
  }
  function search (mode, qs, username) {
    const idx = buildIndex(mode);
    const q = norm(qs); if (!q) return { artists: [], albums: [], songs: [] };
    const words = q.split(' ');
    const score = (text) => { const h = norm(text); if (!words.every(w => h.includes(w))) return 0; return h === q ? 3 : h.startsWith(q) ? 2 : 1; };
    const ar = idx.artistList.map(a => [a, score(a.name)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => ({ id: x[0].id, name: x[0].name, albums: x[0].albums.length, n: x[0].n, art: x[0].art }));
    const al = idx.albums.map(a => [a, Math.max(score(a.title) * 2, score(a.title + ' ' + a.artist))]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 24).map(x => albumOut(x[0]));
    const plays = playsMap(username);
    const so = [];
    for (const t of idx.tracks) {
      const h = hay(t, idx); if (!words.every(w => h.includes(' ' + w) || h.includes(w))) continue;
      const s = norm(t.title) === q ? 3 : norm(t.title).startsWith(q) ? 2 : 1;
      so.push([t, s]); if (so.length > 2000) break;
    }
    so.sort((a, b) => b[1] - a[1] || cmp(sortKey(a[0].title), sortKey(b[0].title)));
    return { artists: ar, albums: al, songs: so.slice(0, 60).map(x => trackOut(x[0], idx, plays)) };
  }
  function tracksByIds (mode, ids, username) {
    const idx = buildIndex(mode); const plays = playsMap(username);
    return (ids || []).slice(0, 5000).map(id => tracks.get(String(id))).filter(t => t && t.ok).map(t => trackOut(t, idx, plays));
  }
  function shuffled (arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Shuffle a scope. byAlbum keeps each album's songs together and in order.
  function shuffle (mode, q, username) {
    const idx = buildIndex(mode); const plays = playsMap(username);
    let albums = idx.albums, pool = null;
    const scope = String(q.scope || 'all');
    if (scope.startsWith('artist:')) { const ar = idx.artists.get(scope.slice(7)); albums = ar ? ar.albums.map(i => idx.albumById.get(i)) : []; }
    else if (scope.startsWith('genre:')) { const g = idx.genres.find(x => x.id === scope.slice(6)); albums = g ? g.albums.map(i => idx.albumById.get(i)) : []; }
    const limit = Math.min(1000, Math.max(1, Number(q.limit) || 300));
    let out = [];
    if (q.by === 'album') {
      for (const al of shuffled(albums)) { for (const tid of al.tracks) out.push(tracks.get(tid)); if (out.length >= limit) break; }
      out = out.slice(0, 1000);
    } else {
      pool = []; for (const al of albums) for (const tid of al.tracks) pool.push(tracks.get(tid));
      out = shuffled(pool).slice(0, limit);
    }
    return { tracks: out.map(t => trackOut(t, idx, plays)) };
  }
  function home (mode, username) {
    const idx = buildIndex(mode); const plays = playsMap(username);
    const recentAlbums = idx.albums.slice().sort((a, b) => b.added - a.added).slice(0, 18).map(albumOut);
    const playedAlbums = new Map();
    for (const [tid, p] of plays) { const al = idx.albumOfTrack.get(tid); if (!al) continue; const cur = playedAlbums.get(al.id) || 0; if (p.last > cur) playedAlbums.set(al.id, p.last); }
    const recentlyPlayed = [...playedAlbums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([id]) => albumOut(idx.albumById.get(id)));
    const most = [...plays.entries()].filter(([tid]) => tracks.has(tid) && idx.albumOfTrack.has(tid)).sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).slice(0, 12).map(([tid]) => trackOut(tracks.get(tid), idx, plays));
    const unplayed = idx.albums.filter(a => !playedAlbums.has(a.id));
    const pickFrom = unplayed.length >= 6 ? unplayed : idx.albums;
    const discover = shuffled(pickFrom).slice(0, 12).map(albumOut);
    return { recentAlbums, recentlyPlayed, mostPlayed: most, discover, stats: { tracks: idx.tracks.length, albums: idx.albums.length, artists: idx.artistList.length, duration: Math.round(idx.totalDuration) } };
  }
  function smartList (mode, kind, username) {
    const idx = buildIndex(mode); const plays = playsMap(username);
    let list = [];
    if (kind === 'most-played') list = [...plays.entries()].filter(([tid]) => idx.albumOfTrack.has(tid)).sort((a, b) => b[1].count - a[1].count).slice(0, 100).map(([tid]) => tracks.get(tid));
    else if (kind === 'recently-played') list = [...plays.entries()].filter(([tid]) => idx.albumOfTrack.has(tid)).sort((a, b) => b[1].last - a[1].last).slice(0, 100).map(([tid]) => tracks.get(tid));
    else if (kind === 'recently-added') list = idx.tracks.slice().sort((a, b) => (b.added || 0) - (a.added || 0) || cmp(a.path, b.path)).slice(0, 200);
    else return null;
    return { tracks: list.map(t => trackOut(t, idx, plays)) };
  }
  function getTrack (id) { load(); return tracks.get(String(id)) || null; }
  function trackExists (id) { load(); const t = tracks.get(String(id)); return !!(t && t.ok); }

  /* ---------- cover art ---------- */
  const artLimit = limiter(3);
  const artPending = new Map();
  function artSource (key) {
    if (artMap.has(key)) return artMap.get(key);
    for (const m of MODES) { buildIndex(m); if (artMap.has(key)) return artMap.get(key); }
    return null;
  }
  function sniffMime (b) {
    if (!b || b.length < 4) return '';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (b.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    return '';
  }
  async function originalArt (src) {
    if (src.kind === 'file') { const st = await fsp.stat(src.path); if (st.size > 30 * 1024 * 1024) return null; return await fsp.readFile(src.path); }
    if (src.kind === 'range') {
      const fh = await fsp.open(src.path, 'r');
      try { const b = Buffer.alloc(Math.min(src.len, 30 * 1024 * 1024)); const { bytesRead } = await fh.read(b, 0, b.length, src.off); return b.subarray(0, bytesRead); }
      finally { await fh.close(); }
    }
    const pic = await tagsLib.readEmbeddedPicture(src.path);
    if (pic && pic.data && pic.data.length) return pic.data;
    if (ffmpeg()) return await runFfmpeg(['-v', 'error', '-i', src.path, '-map', '0:v:0', '-frames:v', '1', '-c:v', 'copy', '-f', 'image2pipe', 'pipe:1'], null, 20000).catch(() => null);
    return null;
  }
  function runFfmpeg (args, input, timeoutMs) {
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpeg(), args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
      const chunks = []; let n = 0;
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, timeoutMs || 20000);
      p.stdout.on('data', d => { n += d.length; if (n < 40 * 1024 * 1024) chunks.push(d); });
      p.on('error', e => { clearTimeout(t); reject(e); });
      p.on('close', code => { clearTimeout(t); const b = Buffer.concat(chunks); code === 0 && b.length ? resolve(b) : reject(new Error('ffmpeg exited ' + code)); });
      if (input) { p.stdin.on('error', () => {}); p.stdin.end(input); }
    });
  }
  async function artFile (key, size) {
    const src = artSource(key);
    if (!src) return null;
    const ext = size ? 'jpg' : 'img';
    const file = path.join(artDir, key + '-' + (size || 0) + '.' + ext);
    try { await fsp.access(file); return file; } catch (_) {}
    const pk = key + ':' + size;
    if (artPending.has(pk)) return artPending.get(pk);
    const job = artLimit(async () => {
      const orig = await originalArt(src).catch(() => null);
      if (!orig || !sniffMime(orig)) return null;
      let out = orig;
      if (size && ffmpeg()) {
        out = await runFfmpeg(['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-vf', "scale='min(" + size + ",iw)':-2:flags=lanczos", '-pix_fmt', 'yuvj420p', '-q:v', '3', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], orig, 20000).catch(() => orig);
      }
      await fsp.mkdir(artDir, { recursive: true });
      const realFile = (out === orig && size) ? file.replace(/\.jpg$/, '.img') : file;
      const tmp = realFile + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, out); await fsp.rename(tmp, realFile);
      return realFile;
    }).finally(() => artPending.delete(pk));
    artPending.set(pk, job);
    return job;
  }
  async function sendArt (req, res, key, sizeParam) {
    load();
    key = String(key || '');
    if (!/^[a-f0-9]{20}$/.test(key)) { res.writeHead(404); return res.end(); }
    let size = Number(sizeParam) || 0;
    if (size) size = ART_SIZES.find(s => s >= size) || ART_SIZES[ART_SIZES.length - 1];
    if (!ffmpeg()) size = 0;   // can't resize: send the original
    const src = artSource(key);
    if (!src) { res.writeHead(404, { 'Cache-Control': 'private, max-age=300' }); return res.end(); }
    // Originals of folder images and plainly embedded pictures are sent straight from the
    // music folder; only resized copies and pictures that need decoding are cached.
    if (!size && (src.kind === 'file' || src.kind === 'range')) return sendOriginal(req, res, key, src);
    let file = null;
    try { file = await artFile(key, size); } catch (_) {}
    if (!file) { res.writeHead(404, { 'Cache-Control': 'private, max-age=300' }); return res.end(); }
    let st; try { st = await fsp.stat(file); } catch (_) { res.writeHead(404); return res.end(); }
    const etag = '"' + key + '-' + size + '-' + Math.round(st.mtimeMs) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    const fd = await fsp.open(file, 'r'); const head = Buffer.alloc(16); await fd.read(head, 0, 16, 0); await fd.close();
    res.writeHead(200, { 'Content-Type': sniffMime(head) || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'private, max-age=2592000', ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  }
  async function sendOriginal (req, res, key, src) {
    let st; try { st = await fsp.stat(src.kind === 'file' ? src.path : src.path); } catch (_) { res.writeHead(404); return res.end(); }
    const start = src.kind === 'range' ? src.off : 0;
    const len = src.kind === 'range' ? Math.min(src.len, Math.max(0, st.size - src.off)) : st.size;
    if (!len || len > 40 * 1024 * 1024) { res.writeHead(404); return res.end(); }
    const etag = '"' + key + '-o-' + Math.round(st.mtimeMs) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    const fd = await fsp.open(src.path, 'r'); const head = Buffer.alloc(16); await fd.read(head, 0, 16, start); await fd.close();
    const mime = sniffMime(head);
    if (!mime) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': len, 'Cache-Control': 'private, max-age=2592000', ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(src.path, { start, end: start + len - 1 }).on('error', () => res.end()).pipe(res);
  }
  async function cleanArtCache () {
    let names; try { names = await fsp.readdir(artDir); } catch (_) { return; }
    const keep = new Set();
    for (const m of MODES) buildIndex(m);
    for (const k of artMap.keys()) keep.add(k);
    for (const n of names) { const k = n.split('-')[0]; if (!keep.has(k)) await fsp.unlink(path.join(artDir, n)).catch(() => {}); }
  }

  /* ---------- audio ---------- */
  function transcodeTarget () {
    if (!ffmpeg()) return null;
    if (encoders == null) {
      try {
        const r = require('child_process').spawnSync(ffmpeg(), ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 8000 });
        encoders = String(r.stdout || '');
      } catch (_) { encoders = ''; }
    }
    return /libmp3lame/.test(encoders) ? 'mp3' : 'aac';
  }
  function sendFile (req, res, t) {
    let st;
    try { st = fs.statSync(t.path); } catch (_) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"message":"The file is no longer there. Rescan the library."}'); }
    const headers = { 'Content-Type': MIME[t.container] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
    const range = req.headers.range;
    let start = 0, end = st.size - 1, status = 200;
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1] === '' && m[2] !== '') { start = Math.max(0, st.size - Number(m[2])); }
      else { start = m[1] ? parseInt(m[1], 10) : 0; if (m[2]) end = Math.min(parseInt(m[2], 10), st.size - 1); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const rs = fs.createReadStream(t.path, { start, end });
    rs.on('error', () => res.end());
    req.on('close', () => rs.destroy());
    rs.pipe(res);
  }
  function transcode (req, res, t, from) {
    const fmt = transcodeTarget();
    if (!fmt) { res.writeHead(415, { 'Content-Type': 'application/json' }); return res.end('{"message":"This format needs ffmpeg to play in the browser, and ffmpeg isn’t installed on the server."}'); }
    const c = opts.getConfig() || {};
    const kbps = [128, 192, 256, 320].includes(Number(c.transcodeKbps)) ? Number(c.transcodeKbps) : 256;
    const args = ['-v', 'error', '-nostdin'];
    if (from > 0) args.push('-ss', String(from));
    args.push('-i', t.path, '-map', '0:a:0', '-vn', '-sn', '-dn');
    if ((t.channels || 2) > 2) args.push('-ac', '2');
    if (t.sampleRate > 48000 || (t.sampleRate && t.sampleRate < 8000)) args.push('-ar', '48000');
    if (fmt === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', kbps + 'k', '-f', 'mp3', 'pipe:1');
    else args.push('-c:a', 'aac', '-b:a', kbps + 'k', '-f', 'adts', 'pipe:1');
    const p = spawn(ffmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { if (err.length < 2000) err += d; });
    let started = false;
    p.stdout.once('data', () => { started = true; });
    res.writeHead(200, { 'Content-Type': fmt === 'mp3' ? 'audio/mpeg' : 'audio/aac', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-MEDIARR-Transcode': fmt + ' ' + kbps + 'k' });
    if (req.method === 'HEAD') { try { p.kill('SIGKILL'); } catch (_) {} return res.end(); }
    p.stdout.pipe(res);
    const stop = () => { try { p.kill('SIGKILL'); } catch (_) {} };
    req.on('close', stop); res.on('close', stop);
    p.on('close', code => { if (code && !started) log('[music] transcode failed for ' + t.path + ': ' + err.trim().split('\n').pop()); res.end(); });
    p.on('error', () => res.end());
  }
  function stream (req, res, id, q) {
    load();
    const t = tracks.get(String(id));
    if (!t || !t.ok) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"message":"Track not found"}'); }
    if (q.get('tc') === '1') return transcode(req, res, t, Math.max(0, Number(q.get('t')) || 0));
    return sendFile(req, res, t);
  }

  /* ---------- status ---------- */
  function status () {
    load();
    const roots = folders();
    const perRoot = {};
    for (const t of tracks.values()) perRoot[t.root] = (perRoot[t.root] || 0) + 1;
    const last = lastScan || null;
    const rootState = {};
    if (last && Array.isArray(last.roots)) for (const r of last.roots) rootState[r.path] = r;
    const idx = indexes.get('smart');
    return {
      configured: roots.length > 0,
      folders: roots.map(p => ({ path: p, tracks: perRoot[p] || 0, state: (rootState[p] && rootState[p].state) || (last ? 'new' : 'pending'), message: (rootState[p] && rootState[p].message) || '' })),
      tracks: [...tracks.values()].filter(t => t.ok).length,
      albums: idx ? idx.albums.length : null,
      scanning: scanState.running, progress: scanState.running ? Object.assign({}, scanState) : null,
      last: last ? { at: last.at, took: last.took, added: last.added, updated: last.updated, removed: last.removed, failed: last.failed, failedFiles: (last.failedFiles || []).slice(0, 25), error: last.error || '', reason: last.reason } : null,
      gen, ffmpeg: !!ffmpeg(), ffprobe: !!ffprobe(), transcode: transcodeTarget()
    };
  }

  return {
    load, scan, scheduleScan, startSchedule, status, buildIndex, libraryPayload, album, artist, genre, songs, search, tracksByIds, shuffle, home, smartList,
    getTrack, trackExists, sendArt, stream, MODES, queueMeta, metaChanged, albumMetaJob, artistMetaJob,
    get gen () { return gen; },
    isScanning: () => scanState.running
  };
}

module.exports = { createMusicLibrary, AUDIO_EXT, _internal: { parseFileName, cleanFolderTitle, discParent, norm, primaryArtist } };
