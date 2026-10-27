'use strict';
/*
 * MEDIARR online music metadata (v2.8).
 *
 * Fills in what the music files don't have, without ever changing them:
 *   MusicBrainz         album match, release year, release type, genres
 *   Cover Art Archive   album cover art for the MusicBrainz match (up to 1200 px)
 *   Deezer              cover art and details when MusicBrainz has none, and artist photos
 *
 * Lookups run in the background after each library scan, politely rate limited
 * (MusicBrainz: one request a second). Results are kept in mediarr.db; downloaded
 * pictures are kept in DATA_DIR/cache/music-meta and served by MEDIARR itself.
 * Albums and artists that couldn't be matched are retried after a while, not on
 * every scan. Only artist and album names are sent to these services.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MB = (process.env.MEDIARR_MB_URL || 'https://musicbrainz.org').replace(/\/+$/, '');
const CAA = (process.env.MEDIARR_CAA_URL || 'https://coverartarchive.org').replace(/\/+$/, '');
const DEEZER = (process.env.MEDIARR_DEEZER_URL || 'https://api.deezer.com').replace(/\/+$/, '');
const DAY = 86400000;
const RETRY_NONE = 30 * DAY;    // no match: look again after a month (new releases get added)
const RETRY_ERROR = 1 * DAY;    // service unreachable: try again tomorrow
const MAX_IMAGE = 15 * 1024 * 1024;
const SKIP_TITLES = new Set(['unknown album', 'untitled', 'unknown', 'no album', 'various']);
const SKIP_ARTISTS = new Set(['unknown artist', 'various artists', 'various', 'va', 'unknown', 'soundtrack', 'artist']);

const sha = (s, n) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, n || 16);
function norm (s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// "OK Computer (Collector's Edition) [2017 Remaster]" → "ok computer"
const EDITION = /\s*[\(\[{][^\)\]}]*\b(?:edition|deluxe|remaster(?:ed)?|expanded|anniversary|bonus|version|reissue|special|limited|explicit|clean|mono|stereo|disc\s*\d|cd\s*\d|live|ep|single|\d{4})\b[^\)\]}]*[\)\]}]\s*/gi;
function albumCore (t) {
  return norm(String(t || '').replace(EDITION, ' ').replace(/\s+-\s+(?:single|ep)\s*$/i, ''));
}
function artistCore (a) { return norm(String(a || '').replace(/^the\s+/i, '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')); }
function lev (a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function similar (a, b) { if (!a || !b) return 0; if (a === b) return 1; return 1 - lev(a, b) / Math.max(a.length, b.length); }
function albumKey (artist, title) { return 'al:' + sha(artistCore(artist) + '|' + albumCore(title), 20); }
function artistKey (name) { return 'ar:' + sha(artistCore(name), 20); }
const yearOf = d => { const m = /^(\d{4})/.exec(String(d || '')); return m ? Number(m[1]) : 0; };
function sniffImage (b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function createMetaFetcher (opts) {
  const store = opts.store;
  const log = opts.log || (() => {});
  const http = opts.upstream;
  const userAgent = 'MEDIARR/' + (opts.version || '0') + ' ( https://github.com/XxSmack003xX/MEDIARR )';
  const dir = path.join(opts.dataDir, 'cache', 'music-meta');
  const cfg = () => Object.assign({ enabled: true, musicbrainz: true, deezer: true, preferOnlineArt: false }, (opts.getConfig() || {}));

  let records = null;               // key -> record
  const queue = []; const queued = new Set();
  let running = false, stopFlag = false;
  const stats = { done: 0, matched: 0, startedAt: 0, lastError: '', lastErrorAt: 0, current: '' };
  let changed = 0, changeTimer = null;
  const lastCall = { mb: 0, dz: 0, caa: 0 };
  const gap = { mb: 1100, dz: 250, caa: 500 };

  function load () {
    if (records) return records;
    records = new Map();
    try { for (const r of store.musicMeta.all()) records.set(r.key, r); } catch (e) { log('[music] could not load online metadata: ' + e.message); }
    return records;
  }
  function get (key) { return load().get(key) || null; }
  function save (rec) {
    rec.checked = Date.now();
    load().set(rec.key, rec);
    try { store.musicMeta.put(rec); } catch (e) { log('[music] could not save online metadata: ' + e.message); }
    changed++;
    clearTimeout(changeTimer);
    // let the library index pick up new art/years in batches, not after every album
    changeTimer = setTimeout(flushChanges, changed >= 25 ? 0 : 4000);
  }
  function flushChanges () { if (!changed) return; changed = 0; if (opts.onChange) try { opts.onChange(); } catch (_) {} }

  /* ---------- HTTP ---------- */
  async function pace (lane) {
    const wait = lastCall[lane] + gap[lane] - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall[lane] = Date.now();
  }
  async function getUrl (url, lane, accept) {
    let u = url;
    for (let hop = 0; hop < 5; hop++) {
      await pace(lane);
      const r = await http(u, { headers: { 'User-Agent': userAgent, Accept: accept || 'application/json' }, timeout: 20000 });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        const next = new URL(r.headers.location, u);
        if (!/^https?:$/.test(next.protocol)) throw new Error('bad redirect');
        u = next.toString(); lane = 'caa'; continue;
      }
      if (r.status === 503 || r.status === 429) { const e = new Error(lane === 'mb' ? 'MusicBrainz is busy (rate limited)' : 'Too many requests'); e.retry = true; throw e; }
      return r;
    }
    throw new Error('too many redirects');
  }
  async function getJson (url, lane) {
    const r = await getUrl(url, lane);
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) throw new Error((lane === 'mb' ? 'MusicBrainz' : 'Deezer') + ' answered HTTP ' + r.status);
    try { return JSON.parse(r.body.toString('utf8')); } catch (_) { throw new Error('unreadable answer from ' + (lane === 'mb' ? 'MusicBrainz' : 'Deezer')); }
  }
  async function downloadImage (url, lane, name) {
    const r = await getUrl(url, lane, 'image/*');
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300 || !r.body || r.body.length > MAX_IMAGE) return null;
    const ext = sniffImage(r.body); if (!ext) return null;
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, name + '.' + ext);
    const tmp = file + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, r.body); await fsp.rename(tmp, file);
    return path.basename(file);
  }

  /* ---------- matching ---------- */
  function scoreAlbum (wantTitle, wantArtist, title, artist, isComp) {
    const t = Math.max(similar(albumCore(wantTitle), albumCore(title)), similar(norm(wantTitle), norm(title)));
    const a = isComp ? (/various/i.test(artist) ? 1 : 0.7) : similar(artistCore(wantArtist), artistCore(artist));
    return { t, a, ok: t >= 0.88 && a >= 0.85, score: t * 0.6 + a * 0.4 };
  }
  const q = s => '"' + String(s).replace(/[\\"]/g, ' ').trim() + '"';

  async function musicBrainzAlbum (job) {
    const parts = ['releasegroup:' + q(job.title)];
    if (!job.comp) parts.push('artist:' + q(job.artist));
    const url = MB + '/ws/2/release-group/?fmt=json&limit=8&query=' + encodeURIComponent(parts.join(' AND '));
    const d = await getJson(url, 'mb');
    const list = (d && d['release-groups']) || [];
    let best = null;
    for (const g of list) {
      const credit = (g['artist-credit'] || []).map(c => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
      const s = scoreAlbum(job.title, job.artist, g.title, credit, job.comp);
      if (!s.ok) continue;
      // prefer albums over singles/compilations with the same title, then MusicBrainz's own score
      const typeBonus = g['primary-type'] === 'Album' ? 0.02 : 0;
      const total = s.score + typeBonus + (Number(g.score) || 0) / 10000;
      if (!best || total > best.total) best = { g, credit, total };
    }
    if (!best) return null;
    const g = best.g;
    const out = { mbid: g.id, title: g.title, artist: best.credit, year: yearOf(g['first-release-date']), type: g['primary-type'] || '',
      secondary: (g['secondary-types'] || []).join(', '), genres: [] };
    const artistId = ((g['artist-credit'] || [])[0] || {}).artist; if (artistId && artistId.id) out.artistMbid = artistId.id;
    if (!job.haveGenre) {
      try {
        const full = await getJson(MB + '/ws/2/release-group/' + encodeURIComponent(g.id) + '?fmt=json&inc=genres', 'mb');
        out.genres = ((full && full.genres) || []).sort((a, b) => (b.count || 0) - (a.count || 0)).map(x => x.name).slice(0, 3);
      } catch (_) {}
    }
    if (!out.genres.length) out.genres = (g.tags || []).filter(t => (t.count || 0) > 0).sort((a, b) => b.count - a.count).map(t => t.name).slice(0, 1);
    return out;
  }
  async function deezerAlbum (job) {
    const query = job.comp ? 'album:' + q(job.title) : 'artist:' + q(job.artist) + ' album:' + q(job.title);
    const d = await getJson(DEEZER + '/search/album?limit=10&q=' + encodeURIComponent(query), 'dz');
    let list = (d && d.data) || [];
    if (!list.length) { const d2 = await getJson(DEEZER + '/search/album?limit=10&q=' + encodeURIComponent((job.comp ? '' : job.artist + ' ') + job.title), 'dz'); list = (d2 && d2.data) || []; }
    let best = null;
    for (const a of list) {
      const s = scoreAlbum(job.title, job.artist, a.title, (a.artist && a.artist.name) || '', job.comp);
      if (s.ok && (!best || s.score > best.s)) best = { a, s: s.score };
    }
    if (!best) return null;
    const a = best.a;
    const out = { deezerId: a.id, title: a.title, artist: (a.artist && a.artist.name) || '', cover: a.cover_xl || a.cover_big || '', type: a.record_type || '', year: 0, genres: [] };
    if (!job.haveGenre || !job.haveYear) {
      try {
        const full = await getJson(DEEZER + '/album/' + encodeURIComponent(a.id), 'dz');
        if (full && !full.error) {
          out.year = yearOf(full.release_date);
          out.genres = (((full.genres || {}).data) || []).map(g => g.name).filter(Boolean).slice(0, 2);
          if (!out.cover) out.cover = full.cover_xl || full.cover_big || '';
        }
      } catch (_) {}
    }
    return out;
  }
  function titleCase (s) { return String(s || '').replace(/\b\p{L}/gu, c => c.toUpperCase()); }

  async function lookupAlbum (job) {
    const c = cfg();
    const rec = { key: job.key, kind: 'album', status: 'none', source: '', name: job.artist + ' — ' + job.title, data: {}, art: '' };
    let errors = 0, tried = 0;
    let mb = null, dz = null;
    if (c.musicbrainz) {
      tried++;
      try { mb = await musicBrainzAlbum(job); } catch (e) { errors++; noteError(e); }
      if (mb) {
        rec.status = 'ok'; rec.source = 'musicbrainz';
        rec.data = { mbid: mb.mbid, artistMbid: mb.artistMbid || '', title: mb.title, artist: mb.artist, year: mb.year, type: mb.type, secondary: mb.secondary, genre: titleCase(mb.genres[0] || '') };
        if (!job.haveArt || c.preferOnlineArt) {
          try { const f = await downloadImage(CAA + '/release-group/' + encodeURIComponent(mb.mbid) + '/front-1200', 'caa', job.key.replace(':', '-')); if (f) { rec.art = f; rec.data.artSource = 'Cover Art Archive'; } }
          catch (e) { noteError(e); }
        }
      }
    }
    const needDeezer = c.deezer && (!mb || (!rec.art && (!job.haveArt || c.preferOnlineArt)) || (!rec.data.genre && !job.haveGenre) || (!rec.data.year && !job.haveYear));
    if (needDeezer) {
      tried++;
      try { dz = await deezerAlbum(Object.assign({}, job, { haveGenre: job.haveGenre || !!rec.data.genre, haveYear: job.haveYear || !!rec.data.year })); } catch (e) { errors++; noteError(e); }
      if (dz) {
        if (rec.status !== 'ok') { rec.status = 'ok'; rec.source = 'deezer'; rec.data = { title: dz.title, artist: dz.artist, type: titleCase(dz.type) }; }
        rec.data.deezerId = dz.deezerId;
        if (!rec.data.year && dz.year) rec.data.year = dz.year;
        if (!rec.data.genre && dz.genres[0]) rec.data.genre = dz.genres[0];
        if (!rec.art && dz.cover && (!job.haveArt || c.preferOnlineArt)) {
          try { const f = await downloadImage(dz.cover, 'dz', job.key.replace(':', '-')); if (f) { rec.art = f; rec.data.artSource = 'Deezer'; } } catch (e) { noteError(e); }
        }
      }
    }
    // a service we couldn't reach might have had it: that's "try again soon", not "no match"
    if (rec.status !== 'ok' && errors) rec.status = 'error';
    return rec;
  }
  async function lookupArtist (job) {
    const rec = { key: job.key, kind: 'artist', status: 'none', source: '', name: job.name, data: {}, art: '' };
    if (!cfg().deezer) { rec.status = 'none'; return rec; }   // only Deezer has artist photos
    let d;
    try { d = await getJson(DEEZER + '/search/artist?limit=8&q=' + encodeURIComponent(job.name), 'dz'); }
    catch (e) { noteError(e); rec.status = 'error'; return rec; }
    let best = null;
    for (const a of (d && d.data) || []) {
      const s = similar(artistCore(job.name), artistCore(a.name));
      if (s >= 0.9 && (!best || s > best.s || (s === best.s && (a.nb_fan || 0) > (best.a.nb_fan || 0)))) best = { a, s };
    }
    if (!best) return rec;
    const a = best.a;
    rec.status = 'ok'; rec.source = 'deezer'; rec.data = { deezerId: a.id, name: a.name, albums: a.nb_album || 0, fans: a.nb_fan || 0 };
    const pic = a.picture_xl || a.picture_big || '';
    // Deezer's "no picture" placeholder has an empty image hash: /images/artist//
    if (pic && !/\/artist\/\//.test(pic)) {
      try { const f = await downloadImage(pic, 'dz', job.key.replace(':', '-')); if (f) rec.art = f; } catch (e) { noteError(e); }
    }
    return rec;
  }
  function noteError (e) { stats.lastError = e.message || String(e); stats.lastErrorAt = Date.now(); }

  /* ---------- queue ---------- */
  // mode: false = only what's due; 'retry' = also everything not matched yet; 'all' = everything but skipped
  function due (rec, now, mode) {
    if (!rec) return true;
    if (rec.status === 'skip') return false;
    if (mode === 'all') return true;
    if (rec.status === 'ok') return mode === 'art' ? !rec.art : false;
    if (mode === 'retry' || mode === 'art') return true;
    return now - (rec.checked || 0) > (rec.status === 'error' ? RETRY_ERROR : RETRY_NONE);
  }
  // albums: [{ key, title, artist, comp, haveArt, haveYear, haveGenre }], artists: [{ key, name }]
  function enqueue (albums, artists, mode) {
    const c = cfg();
    if (!c.enabled || (!c.musicbrainz && !c.deezer)) return 0;
    load();
    const now = Date.now(); let n = 0;
    for (const a of albums) {
      if (!a.title || SKIP_TITLES.has(norm(a.title)) || (!a.comp && SKIP_ARTISTS.has(norm(a.artist)))) continue;
      if (queued.has(a.key) || !due(records.get(a.key), now, mode)) continue;
      queue.push(Object.assign({ kind: 'album' }, a)); queued.add(a.key); n++;
    }
    for (const a of artists) {
      if (!a.name || SKIP_ARTISTS.has(norm(a.name))) continue;
      if (queued.has(a.key) || !due(records.get(a.key), now, mode === 'art' ? false : mode)) continue;
      queue.push(Object.assign({ kind: 'artist' }, a)); queued.add(a.key); n++;
    }
    if (n) { if (!running) { stats.done = 0; stats.matched = 0; } run(); }
    return n;
  }
  async function run () {
    if (running) return;
    running = true; stopFlag = false; stats.startedAt = Date.now();
    let streakErrors = 0;
    try {
      while (queue.length && !stopFlag) {
        const c = cfg();
        if (!c.enabled) { queue.length = 0; queued.clear(); break; }
        const job = queue.shift();
        stats.current = job.kind === 'album' ? job.artist + ' — ' + job.title : job.name;
        let rec;
        try { rec = job.kind === 'album' ? await lookupAlbum(job) : await lookupArtist(job); }
        catch (e) { noteError(e); rec = { key: job.key, kind: job.kind, status: 'error', source: '', name: stats.current, data: {}, art: '' }; }
        queued.delete(job.key);
        const prev = records.get(job.key);
        if (rec.status === 'error' && prev && prev.status === 'ok') { prev.checked = Date.now(); }   // keep a good match through an outage
        else save(rec);
        stats.done++; if (rec.status === 'ok') stats.matched++;
        streakErrors = rec.status === 'error' ? streakErrors + 1 : 0;
        if (streakErrors >= 8) {   // the services are unreachable: stop and try again later
          log('[music] online metadata paused: ' + stats.lastError);
          for (const j of queue) queued.delete(j.key);
          queue.length = 0; break;
        }
      }
    } finally {
      running = false; stats.current = '';
      flushChanges();
    }
  }
  function stop () { stopFlag = true; }

  /* ---------- admin actions ---------- */
  function setSkip (key, name, kind, skip) {
    load();
    const rec = records.get(key) || { key, kind, name, data: {}, art: '', source: '' };
    if (skip) { rec.status = 'skip'; rec.art = ''; rec.data = {}; rec.source = ''; }
    else rec.status = 'none';
    rec.checked = skip ? Date.now() : 0;
    save(rec); flushChanges();
  }
  async function refreshNow (job) {
    load(); queued.delete(job.key);
    const idx = queue.findIndex(j => j.key === job.key); if (idx >= 0) queue.splice(idx, 1);
    const rec = job.kind === 'artist' ? await lookupArtist(job) : await lookupAlbum(job);
    const prev = records.get(job.key);
    if (rec.status === 'error' && prev && prev.status === 'ok') return rec;   // keep the good match through an outage
    save(rec); flushChanges();
    return rec;
  }
  async function clearAll () {
    stop(); queue.length = 0; queued.clear();
    try { store.musicMeta.clear(); } catch (_) {}
    records = new Map();
    try { for (const n of await fsp.readdir(dir)) await fsp.unlink(path.join(dir, n)).catch(() => {}); } catch (_) {}
    changed++; flushChanges();
  }
  function artPath (rec) { return rec && rec.art ? path.join(dir, path.basename(rec.art)) : ''; }
  function status () {
    load();
    let albums = 0, albumsOk = 0, artists = 0, artistsOk = 0, photos = 0, art = 0, none = 0, errors = 0, skipped = 0;
    for (const r of records.values()) {
      if (r.kind === 'album') { albums++; if (r.status === 'ok') albumsOk++; } else { artists++; if (r.status === 'ok') artistsOk++; if (r.art) photos++; }
      if (r.art) art++; if (r.status === 'none') none++; if (r.status === 'error') errors++; if (r.status === 'skip') skipped++;
    }
    return { running, queued: queue.length, done: stats.done, current: stats.current, albums, albumsOk, artists, artistsOk, photos, art, none, errors, skipped,
      lastError: stats.lastError, lastErrorAt: stats.lastErrorAt };
  }

  return { config: cfg, load, get, enqueue, refreshNow, setSkip, clearAll, status, artPath, stop, albumKey, artistKey, isRunning: () => running };
}

module.exports = { createMetaFetcher, albumKey, artistKey, _internal: { albumCore, artistCore, similar, norm } };
