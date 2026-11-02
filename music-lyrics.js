'use strict';
/*
 * MEDIARR music lyrics (v2.12).
 *
 * Where lyrics come from, best first:
 *   1. a match or text an admin picked for the song (kept until they reset it)
 *   2. timed lyrics on disk: Song.lrc next to the song, or timed lyrics embedded in it
 *   3. timed lyrics from LRCLIB (lrclib.net, free and open, no account needed)
 *   4. plain lyrics on disk: embedded, or Song.txt next to the song
 *   5. plain lyrics from LRCLIB
 *
 * Online lookups happen only when someone opens the lyrics of a song, one request
 * at a time, and the answer is cached in mediarr.db (music_lyrics). Only the song's
 * title, artist, album and length are sent. Music files are never changed.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const LRCLIB = (process.env.MEDIARR_LRCLIB_URL || 'https://lrclib.net').replace(/\/+$/, '');
const DAY = 86400000;
const RECHECK = { synced: 365 * DAY, plain: 30 * DAY, instrumental: 180 * DAY, none: 30 * DAY, error: 3600000 };
const MAX_FILE = 1024 * 1024;
const MAX_TEXT = 200000;
const SKIP_ARTISTS = new Set(['unknown artist', 'various artists', 'various', 'va', 'unknown', 'artist']);

/* ---------- text helpers ---------- */
function norm (s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// "Song (Remastered 2011)", "Song - 2011 Remaster", "Song (feat. X)" → "Song"
function cleanTitle (t) {
  return String(t || '')
    .replace(/\s*[\(\[][^\)\]]*\b(?:remaster(?:ed)?|feat\.?|ft\.?|featuring|bonus|demo|mono|stereo|version|edit|mix|live|explicit|clean|single)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|single version|radio edit|mono|stereo)(?:\s+\d{4})?(?:\s+version)?\s*$/i, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '').trim() || String(t || '').trim();
}
function firstArtist (a) { return String(a || '').split(/\s*(?:,|;|\/|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\band\b)\s*/i)[0].trim() || String(a || '').trim(); }
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
function similar (a, b) { a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1; return 1 - lev(a, b) / Math.max(a.length, b.length); }
function titleScore (a, b) { return Math.max(similar(a, b), similar(cleanTitle(a), cleanTitle(b))); }
function artistScore (a, b) {
  const x = norm(String(a || '').replace(/^the\s+/i, '')), y = norm(String(b || '').replace(/^the\s+/i, ''));
  if (!x || !y) return 0;
  if (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ')) return 1;   // "Queen" vs "Queen & David Bowie"
  return Math.max(similar(x, y), similar(firstArtist(a), firstArtist(b)));
}

// Text files can be UTF-8, UTF-16 (with a BOM) or an old Windows code page.
function decodeText (buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); if (b.length % 2) return ''; b.swap16(); return b.toString('utf16le'); }
  const s = buf.toString('utf8');
  if (!s.includes('�')) return s.replace(/^﻿/, '');
  return buf.toString('latin1');
}

/* ---------- LRC ---------- */
const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\s*\[(ar|ti|al|au|by|re|ve|length|offset|la|lang|tool|#)\s*:[^\]]*\]\s*$/i;
const ms = (m, s, f) => (Number(m) * 60 + Number(s)) * 1000 + (f ? Math.round(Number(f) * Math.pow(10, 3 - f.length)) : 0);
/*
 * parseLrc(text) → { synced: [[ms, line], …] | null, plain: 'text' }
 * Handles several timestamps per line, [offset:], word timings (<00:12.34>) and stray untimed lines.
 */
function parseLrc (text) {
  text = String(text || '').replace(/\r\n?/g, '\n').slice(0, MAX_TEXT);
  let offset = 0;
  const timed = [], untimed = [];
  for (const raw of text.split('\n')) {
    const om = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/i.exec(raw);
    if (om) { offset = Number(om[1]) || 0; continue; }
    if (META.test(raw)) continue;
    TS.lastIndex = 0;
    const stamps = []; let m, end = 0;
    // timestamps only count at the start of a line ("[00:12.00][01:30.00]Chorus")
    while ((m = TS.exec(raw)) && raw.slice(end, m.index).trim() === '') { stamps.push(ms(m[1], m[2], m[3])); end = TS.lastIndex; }
    const words = raw.slice(end).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
    if (stamps.length) for (const t of stamps) timed.push([Math.max(0, t - offset), words]);
    else untimed.push(raw.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/[ \t]+$/g, ''));
  }
  const untimedText = untimed.filter(l => l.trim()).length;
  if (timed.length >= 2 || (timed.length === 1 && !untimedText)) {
    timed.sort((a, b) => a[0] - b[0]);
    const lines = [];
    for (const l of timed) { if (!l[1] && lines.length && !lines[lines.length - 1][1]) continue; lines.push(l); }
    while (lines.length && !lines[lines.length - 1][1]) lines.pop();
    if (lines.some(l => l[1])) return { synced: lines.slice(0, 5000), plain: tidyPlain(lines.map(l => l[1]).join('\n')) };
  }
  return { synced: null, plain: tidyPlain(untimed.join('\n')) };
}
function tidyPlain (t) { return String(t || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT); }
// ID3 SYLT entries: each entry is a line, unless the tagger marks new lines with a leading line break
function syltLines (entries) {
  const nl = entries.some((e, i) => i > 0 && /^[\r\n]/.test(e[1]));
  const lines = [];
  for (const [t, x] of entries) {
    if (!nl || /^[\r\n]/.test(x) || !lines.length) lines.push([t, x.replace(/[\r\n]+/g, ' ').trim()]);
    else lines[lines.length - 1][1] = (lines[lines.length - 1][1] + x.replace(/[\r\n]+/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  lines.sort((a, b) => a[0] - b[0]);
  return lines.filter((l, i) => l[1] || (i && lines[i - 1][1]));
}
// Back to LRC text, for the admin's "Edit lyrics" box
function toLrc (lines) {
  const two = n => String(n).padStart(2, '0');
  return lines.map(([t, x]) => '[' + two(Math.floor(t / 60000)) + ':' + two(Math.floor(t / 1000) % 60) + '.' + two(Math.floor(t / 10) % 100) + ']' + x).join('\n');
}

function createLyrics (opts) {
  const store = opts.store;
  const log = opts.log || (() => {});
  const http = opts.upstream;
  const tags = opts.tags;
  const userAgent = 'MEDIARR/' + (opts.version || '0') + ' ( https://github.com/XxSmack003xX/MEDIARR )';
  const cfg = () => Object.assign({ enabled: true, online: true }, opts.getConfig() || {});
  const inflight = new Map();
  const localCache = new Map();   // path → { at, mtime, value }
  const dirCache = new Map();     // dir → { at, names }
  const stats = { lookups: 0, found: 0, lastError: '', lastErrorAt: 0, lastOkAt: 0 };

  /* ---------- lyrics on disk ---------- */
  async function dirNames (dir) {
    const c = dirCache.get(dir);
    if (c && Date.now() - c.at < 30000) return c.names;
    let names = [];
    try { names = await fsp.readdir(dir); } catch (_) {}
    dirCache.set(dir, { at: Date.now(), names });
    if (dirCache.size > 300) dirCache.delete(dirCache.keys().next().value);
    return names;
  }
  async function readSidecar (dir, name) {
    try {
      const f = path.join(dir, name);
      const st = await fsp.stat(f);
      if (!st.isFile() || st.size > MAX_FILE) return null;
      return decodeText(await fsp.readFile(f));
    } catch (_) { return null; }
  }
  async function readLocal (track) {
    const c = localCache.get(track.path);
    if (c && c.mtime === track.mtime && Date.now() - c.at < 60000) return c.value;
    const dir = path.dirname(track.path), base = path.basename(track.path).replace(/\.[^.]+$/, '').toLowerCase();
    const names = await dirNames(dir);
    const side = ext => names.find(n => n.toLowerCase() === base + ext) || names.find(n => n.toLowerCase() === path.basename(track.path).toLowerCase() + ext);
    const found = [];   // { synced, plain, source, label }
    const lrc = side('.lrc');
    if (lrc) { const t = await readSidecar(dir, lrc); if (t) found.push(Object.assign(parseLrc(t), { source: 'lrc', label: lrc })); }
    let embedded = [];
    try { embedded = await tags.readLyrics(track.path, { ffprobe: opts.ffprobe && opts.ffprobe() }); } catch (_) {}
    for (const e of embedded) {
      if (e.kind === 'sylt') { const lines = syltLines(e.lines); if (lines.length) found.push({ synced: lines, plain: tidyPlain(lines.map(l => l[1]).join('\n')), source: 'file', label: 'the song file' }); }
      else found.push(Object.assign(parseLrc(e.text), { source: 'file', label: 'the song file' }));
    }
    const txt = side('.txt');
    if (txt) { const t = await readSidecar(dir, txt); if (t) found.push(Object.assign(parseLrc(t), { source: 'txt', label: txt })); }
    const value = { synced: found.find(f => f.synced) || null, plain: found.find(f => f.plain) || null };
    localCache.set(track.path, { at: Date.now(), mtime: track.mtime, value });
    if (localCache.size > 300) localCache.delete(localCache.keys().next().value);
    return value;
  }

  /* ---------- LRCLIB ---------- */
  let chain = Promise.resolve(), lastCall = 0, gap = 250;
  const sleep = t => new Promise(r => setTimeout(r, t));
  function pace () {
    const p = chain.then(async () => { const w = lastCall + gap - Date.now(); if (w > 0) await sleep(w); lastCall = Date.now(); });
    chain = p.catch(() => {});
    return p;
  }
  async function getJson (pathAndQuery) {
    for (let busy = 0; ; ) {
      await pace();
      let r;
      try { r = await http(LRCLIB + pathAndQuery, { headers: { 'User-Agent': userAgent, 'Lrclib-Client': userAgent, Accept: 'application/json' }, timeout: 20000 }); }
      catch (e) { const err = new Error('LRCLIB couldn’t be reached (' + e.message + ')'); err.network = true; throw err; }
      if (r.status === 429 || r.status === 503) {
        if (++busy > 3) throw new Error('LRCLIB is busy right now');
        const ra = Number(r.headers['retry-after']);
        await sleep(Math.min(30000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * Math.pow(2, busy)));
        gap = Math.min(2000, gap + 250);
        continue;
      }
      if (gap > 250) gap -= 50;
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error('LRCLIB answered HTTP ' + r.status);
      stats.lastOkAt = Date.now();
      try { return JSON.parse(r.body.toString('utf8')); } catch (_) { throw new Error('unreadable answer from LRCLIB'); }
    }
  }
  // LRCLIB's answers use trackName/artistName…; accept the short names too
  function hit (x) {
    if (!x || typeof x !== 'object') return null;
    const synced = typeof x.syncedLyrics === 'string' ? x.syncedLyrics : '';
    const plain = typeof x.plainLyrics === 'string' ? x.plainLyrics : (typeof x.lyrics === 'string' ? x.lyrics : '');
    return {
      id: Number(x.id) || 0, track: String(x.trackName || x.name || ''), artist: String(x.artistName || x.artist || ''), album: String(x.albumName || x.album || ''),
      duration: Number(x.duration) || 0, instrumental: !!x.instrumental && !synced.trim() && !plain.trim(), synced: synced.slice(0, MAX_TEXT), plain: plain.slice(0, MAX_TEXT)
    };
  }
  function score (h, want) {
    const ts = titleScore(h.track, want.title), as = artistScore(h.artist, want.artist);
    const dd = want.duration && h.duration ? Math.abs(h.duration - want.duration) : 0;
    if (ts < 0.85 || as < 0.6 || dd > 4) return -1;
    if (!h.instrumental && !h.synced.trim() && !h.plain.trim()) return -1;
    return ts * 2 + as + (h.synced.trim() ? 0.5 : 0) - dd / 10 + (want.album && similar(h.album, want.album) > 0.8 ? 0.2 : 0);
  }
  function wantFor (track) {
    return { title: track.title || '', artist: track.artist || track.albumArtist || '', album: track.album || '', duration: Math.round(track.duration || 0) };
  }
  async function lookup (track) {
    const want = wantFor(track);
    if (!want.title || !want.artist || SKIP_ARTISTS.has(norm(want.artist))) return { status: 'none' };
    stats.lookups++;
    const q = new URLSearchParams({ track_name: want.title, artist_name: want.artist });
    if (want.album) q.set('album_name', want.album);
    if (want.duration > 0 && want.duration <= 3600) q.set('duration', String(want.duration));
    let h = hit(await getJson('/api/get?' + q.toString()));
    if (!h || score(h, want) < 0) {
      const sq = new URLSearchParams({ track_name: cleanTitle(want.title), artist_name: firstArtist(want.artist) });
      const list = await getJson('/api/search?' + sq.toString());
      h = null; let best = -1;
      for (const x of (Array.isArray(list) ? list : []).slice(0, 30)) { const c = hit(x); const s = c && score(c, want); if (s > best) { best = s; h = c; } }
    }
    if (!h) return { status: 'none' };
    stats.found++;
    return recordFrom(h);
  }
  function recordFrom (h) {
    return { status: h.instrumental ? 'instrumental' : 'found', source: 'lrclib', extId: String(h.id || ''), synced: h.synced || '', plain: h.plain || '', info: { track: h.track, artist: h.artist, album: h.album, duration: h.duration } };
  }

  /* ---------- cache ---------- */
  function row (id) { try { return store.musicLyrics.get(id); } catch (_) { return null; } }
  function save (id, fields) {
    const cur = row(id) || { trackId: id, status: '', source: '', extId: '', manual: 0, hidden: 0, shift: 0, synced: '', plain: '', info: {}, checked: 0 };
    const next = Object.assign({}, cur, fields, { trackId: id });
    store.musicLyrics.put(next);
    return next;
  }
  function stale (r) {
    if (!r || !r.checked) return true;
    const age = Date.now() - r.checked;
    if (r.status === 'error') return age > RECHECK.error;
    if (r.status === 'none') return age > RECHECK.none;
    if (r.status === 'instrumental') return age > RECHECK.instrumental;
    if (r.status === 'found') return age > (r.synced ? RECHECK.synced : RECHECK.plain);
    return true;
  }
  async function online (track, force) {
    const r = row(track.id);
    if (r && r.manual) return r;
    if (!force && r && r.checked && !stale(r)) return r;
    if (inflight.has(track.id)) return inflight.get(track.id);
    const job = (async () => {
      try {
        const rec = await lookup(track);
        return save(track.id, Object.assign({ status: 'none', source: '', extId: '', synced: '', plain: '', info: {} }, rec, { checked: Date.now() }));
      } catch (e) {
        stats.lastError = e.message; stats.lastErrorAt = Date.now();
        log('[lyrics] ' + e.message);
        // keep what was found before; just try again later
        if (r && (r.status === 'found' || r.status === 'instrumental')) return Object.assign({}, r, { error: e.message });
        return Object.assign(save(track.id, { status: 'error', checked: Date.now() }), { error: e.message });
      } finally { inflight.delete(track.id); }
    })();
    inflight.set(track.id, job);
    return job;
  }

  /* ---------- what the player shows ---------- */
  function shape (base, extra) { return Object.assign({ status: 'none', lines: null, text: null, source: '', label: '', shift: 0, manual: false, hidden: false }, base, extra); }
  function fromRecord (r) {
    const p = r.synced ? parseLrc(r.synced) : null;
    const lines = p && p.synced;
    const text = tidyPlain(r.plain) || (p ? p.plain : '');
    return { lines: lines || null, text: text || null };
  }
  async function get (track, force) {
    const c = cfg();
    if (!c.enabled) return shape({ status: 'off' });
    const r = row(track.id);
    const common = { shift: r ? r.shift || 0 : 0, manual: !!(r && r.manual), hidden: !!(r && r.hidden), onlineOn: !!c.online };
    if (r && r.hidden) return shape({ status: 'hidden' }, common);
    if (r && r.manual) {
      const x = fromRecord(r);
      return shape({ status: r.status === 'instrumental' ? 'instrumental' : (x.lines || x.text) ? 'found' : 'none', lines: x.lines, text: x.text, source: r.source, label: r.source === 'custom' ? 'MEDIARR (edited by an admin)' : 'LRCLIB', info: r.info }, common);
    }
    const local = await readLocal(track);
    if (local.synced) return shape({ status: 'found', lines: local.synced.synced, text: local.synced.plain, source: local.synced.source, label: local.synced.label }, common);
    let rec = null, error = '';
    if (c.online) { rec = await online(track, force); error = rec && rec.error || ''; }
    const recX = rec && rec.status === 'found' ? fromRecord(rec) : null;
    if (recX && (recX.lines || (!local.plain && recX.text))) return shape({ status: 'found', lines: recX.lines, text: recX.text, source: 'lrclib', label: 'LRCLIB', info: rec.info }, common);
    if (local.plain) return shape({ status: 'found', text: local.plain.plain, source: local.plain.source, label: local.plain.label }, common);
    if (rec && rec.status === 'instrumental') return shape({ status: 'instrumental', source: 'lrclib', label: 'LRCLIB' }, common);
    if (rec && rec.status === 'error') return shape({ status: 'error', message: error || 'LRCLIB couldn’t be reached. MEDIARR will try again later.' }, common);
    return shape({ status: 'none' }, common);
  }

  /* ---------- admin fixes ---------- */
  async function search (track, q) {
    const want = wantFor(track);
    const sq = q ? new URLSearchParams({ q: String(q).slice(0, 200) }) : new URLSearchParams({ track_name: cleanTitle(want.title), artist_name: firstArtist(want.artist) });
    if (!q && !want.title) return { results: [] };
    const list = await getJson('/api/search?' + sq.toString());
    const results = (Array.isArray(list) ? list : []).slice(0, 25).map(hit).filter(Boolean).map(h => ({
      id: h.id, track: h.track, artist: h.artist, album: h.album, duration: h.duration, instrumental: h.instrumental,
      synced: !!h.synced.trim(), plain: !!h.plain.trim(),
      preview: (h.plain || parseLrc(h.synced).plain || '').split('\n').filter(l => l.trim()).slice(0, 4).join('\n'),
      score: Math.round(Math.max(0, score(h, want)) * 100) / 100
    }));
    // likely matches first, LRCLIB's order otherwise
    results.forEach((r, i) => { r._i = i; });
    results.sort((a, b) => (b.score > 0) - (a.score > 0) || b.score - a.score || a._i - b._i);
    results.forEach(r => { delete r._i; });
    return { results, query: q || (want.title + ' ' + want.artist).trim() };
  }
  async function choose (track, extId) {
    const h = hit(await getJson('/api/get/' + encodeURIComponent(String(Number(extId) || 0))));
    if (!h) { const e = new Error('That result isn’t on LRCLIB any more'); e.code = 404; throw e; }
    return save(track.id, Object.assign(recordFrom(h), { manual: 1, hidden: 0, checked: Date.now() }));
  }
  function setText (track, text) {
    text = String(text || '').slice(0, MAX_TEXT);
    const p = parseLrc(text);
    if (!p.synced && !p.plain) { const e = new Error('Type or paste some lyrics first'); e.code = 400; throw e; }
    return save(track.id, { status: 'found', source: 'custom', extId: '', manual: 1, hidden: 0, synced: p.synced ? toLrc(p.synced) : '', plain: p.synced ? '' : p.plain, info: {}, checked: Date.now() });
  }
  function setShift (track, shiftMs) { return save(track.id, { shift: Math.max(-60000, Math.min(60000, Math.round(Number(shiftMs) || 0))) }); }
  function setHidden (track, on) { return save(track.id, { hidden: on ? 1 : 0 }); }
  // forget the admin's choice (and any timing change) and go back to finding lyrics automatically
  function reset (track) { try { store.musicLyrics.remove(track.id); } catch (_) {} localCache.delete(track.path); }
  function refresh (track) { localCache.delete(track.path); dirCache.delete(path.dirname(track.path)); }
  function clearOnline () { store.musicLyrics.clearAuto(); localCache.clear(); }
  function status () { return Object.assign({ cached: (() => { try { return store.musicLyrics.count(); } catch (_) { return 0; } })() }, stats); }

  return { get, search, choose, setText, setShift, setHidden, reset, refresh, clearOnline, status, readLocal, toLrc };
}

module.exports = { createLyrics, parseLrc, syltLines, toLrc, cleanTitle, firstArtist, _internal: { titleScore, artistScore, decodeText } };
