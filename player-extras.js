'use strict';
/*
 * MEDIARR player extras (v2.14).
 *
 *   /api/player/info        chapters, skip markers (intro / recap / credits), previous and
 *                           next episode, seek-preview plan and the subtitles available
 *   /api/player/thumb       one seek-preview frame (made on demand with ffmpeg, cached)
 *   /api/player/subs/…      subtitles next to the video, uploaded ones, and OpenSubtitles search
 *   /api/player/settings    what's switched on (everyone) and the admin's settings
 *   /api/party…             Watch Together rooms: one shared play / pause / position
 *
 * Media files and folders are never written to: previews live in <data>/cache/thumbs and
 * subtitles in <data>/subtitles.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const OS_BASE = (process.env.MEDIARR_OPENSUBTITLES_URL || 'https://api.opensubtitles.com/api/v1').replace(/\/+$/, '');
const SUB_EXT = ['srt', 'vtt', 'ass', 'ssa'];
const DEFAULTS = { seekPreviews: true, watchTogether: true, subLangs: 'en', opensubtitles: { apiKey: '', username: '', password: '' } };
const THUMB_W = 240;
const REACTIONS = ['😂', '❤️', '😮', '👏', '😢', '🔥', '👍', '🎉'];
const LANGS = { en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', 'pt-br': 'Portuguese (Brazil)', pob: 'Portuguese (Brazil)', nl: 'Dutch', dut: 'Dutch', nld: 'Dutch', sv: 'Swedish', swe: 'Swedish', no: 'Norwegian', nor: 'Norwegian', da: 'Danish', dan: 'Danish', fi: 'Finnish', fin: 'Finnish', pl: 'Polish', pol: 'Polish', ru: 'Russian', rus: 'Russian', uk: 'Ukrainian', ukr: 'Ukrainian', cs: 'Czech', cze: 'Czech', ces: 'Czech', hu: 'Hungarian', hun: 'Hungarian', ro: 'Romanian', rum: 'Romanian', ron: 'Romanian', el: 'Greek', gre: 'Greek', ell: 'Greek', tr: 'Turkish', tur: 'Turkish', ar: 'Arabic', ara: 'Arabic', he: 'Hebrew', heb: 'Hebrew', hi: 'Hindi', hin: 'Hindi', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', 'zh-cn': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', vi: 'Vietnamese', vie: 'Vietnamese', th: 'Thai', tha: 'Thai', id: 'Indonesian', ind: 'Indonesian', bg: 'Bulgarian', bul: 'Bulgarian', hr: 'Croatian', hrv: 'Croatian', sr: 'Serbian', srp: 'Serbian', sk: 'Slovak', slo: 'Slovak', slk: 'Slovak', sl: 'Slovenian', slv: 'Slovenian', et: 'Estonian', est: 'Estonian', lv: 'Latvian', lav: 'Latvian', lt: 'Lithuanian', lit: 'Lithuanian', fa: 'Persian', per: 'Persian', fas: 'Persian', ms: 'Malay', may: 'Malay', msa: 'Malay' };
const langName = c => LANGS[String(c || '').toLowerCase()] || (c ? String(c).toUpperCase() : '');

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
const stem = n => String(n).replace(/\.[^.]+$/, '');

/* ---------- names ---------- */
const QUALITY = /[ ._\-\[(]+(?:2160p|1080p|1080i|720p|576p|480p|4k|uhd|web[ ._-]?dl|web[ ._-]?rip|webrip|bluray|blu-ray|bdrip|brrip|hdtv|dvdrip|remux|x264|x265|h[ .]?264|h[ .]?265|hevc|avc|xvid|hdr|hdr10|dv|10bit|aac|ac3|eac3|dts|atmos|proper|repack|internal|multi|amzn|nf|dsnp|hmax)\b.*$/i;
function tidy (s) { return String(s || '').replace(/[._]+/g, ' ').replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim(); }
/*
 * epInfo('Show.Name.S01E02.The.Title.1080p.mkv') → { show:'Show Name', season:1, episode:2, title:'The Title' }
 * epInfo('Movie Name (2019) 1080p.mkv')          → { movie:'Movie Name', year:2019 }
 */
function epInfo (name) {
  const base = stem(name);
  let m = /^(.*?)[ ._\-\[(]*\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:[ ._-]?E\d{1,3})*\b(.*)$/i.exec(base) || /^(.*?)[ ._\-\[(]+(\d{1,2})x(\d{2,3})\b(.*)$/i.exec(base);
  if (m) return { show: tidy(m[1]), season: Number(m[2]), episode: Number(m[3]), title: tidy(m[4].replace(QUALITY, '').replace(/^[ ._\-\])]+/, '')) };
  m = /^(.*?)[ ._\-]+(?:E|Ep|Episode)[ ._]?(\d{1,3})\b(.*)$/i.exec(base);
  if (m) return { show: tidy(m[1]), season: 0, episode: Number(m[2]), title: tidy(m[3].replace(QUALITY, '').replace(/^[ ._\-\])]+/, '')) };
  m = /^(.*?)[ ._(\[]+((?:19|20)\d{2})\b/.exec(base);
  if (m && tidy(m[1])) return { movie: tidy(m[1]), year: Number(m[2]) };
  return { movie: tidy(base.replace(QUALITY, '')) };
}
function niceLabel (name) {
  const e = epInfo(name);
  if (e.episode != null) return { title: e.title || (e.show ? e.show : 'Episode ' + e.episode), sub: (e.season ? 'S' + e.season + ' · ' : '') + 'E' + e.episode + (e.show && e.title ? ' · ' + e.show : ''), show: e.show || '', season: e.season, episode: e.episode };
  return { title: e.movie + (e.year ? ' (' + e.year + ')' : ''), sub: '', show: '' };
}
const SEASON_DIR = /^(?:season|series|staffel|saison|temporada|s)[ ._-]?\d{1,3}\b|^specials?$/i;
function looksEpisodic (a, b, folder) {
  const x = epInfo(a), y = epInfo(b);
  if (x.episode != null && y.episode != null) return true;
  if (SEASON_DIR.test(folder || '')) return true;
  const strip = s => stem(s).replace(/\d+/g, '#').toLowerCase();
  return strip(a) === strip(b) && /\d/.test(stem(a));   // "Show - 01", "Part 2"
}

/* ---------- subtitles text ---------- */
function decodeText (buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); if (b.length % 2) return ''; b.swap16(); return b.toString('utf16le'); }
  const s = buf.toString('utf8');
  return s.includes('�') ? buf.toString('latin1') : s.replace(/^﻿/, '');
}
const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/g;
const toMs = (h, m, s, f) => ((Number(h) || 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(String(f).padEnd(3, '0').slice(0, 3));
function fmtVtt (ms) {
  ms = Math.max(0, Math.round(ms));
  const p = (n, w) => String(n).padStart(w, '0');
  return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':' + p(Math.floor(ms / 1000) % 60, 2) + '.' + p(ms % 1000, 3);
}
// SRT (or loose VTT) → clean WebVTT, optionally shifted by `shift` ms. Returns '' when there are no cues.
function toVtt (text, shift) {
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const out = ['WEBVTT', ''];
  let cues = 0;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(l => l.trim() !== '' || false);
    const ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const stamps = []; let m; TIME.lastIndex = 0;
    while ((m = TIME.exec(lines[ti]))) stamps.push(toMs(m[1], m[2], m[3], m[4]));
    if (stamps.length < 2) continue;
    const a = stamps[0] + (shift || 0), b = stamps[1] + (shift || 0);
    if (b <= 0) continue;
    const body = lines.slice(ti + 1).map(l => l.replace(/\{\\[^}]*\}/g, '').replace(/<\/?font[^>]*>/gi, '')).filter(l => l.trim());
    if (!body.length) continue;
    out.push(fmtVtt(a) + ' --> ' + fmtVtt(b), ...body, '');
    cues++;
  }
  return cues ? out.join('\n') : '';
}

function createPlayerExtras (d) {
  const log = d.log || (() => {});
  const cfg = () => {
    const c = Object.assign({}, DEFAULTS, (d.readConfig().player) || {});
    c.opensubtitles = Object.assign({}, DEFAULTS.opensubtitles, c.opensubtitles || {});
    c.seekPreviews = c.seekPreviews !== false; c.watchTogether = c.watchTogether !== false;
    c.subLangs = String(c.subLangs || 'en').toLowerCase().replace(/[^a-z,\-]/g, '').slice(0, 60) || 'en';
    return c;
  };
  const sourceOk = () => { const w = d.readConfig().webdav; return d.isLocalSource() || !!(w.url && w.username); };
  const relOf = v => d.safeSegments(v).join('/');
  const THUMB_DIR = path.join(d.dataDir, 'cache', 'thumbs');
  const SUBS_DIR = path.join(d.dataDir, 'subtitles');

  /* ---------- folders ---------- */
  const dirCache = new Map();
  async function listDir (rel) {
    rel = relOf(rel);
    const hit = dirCache.get(rel);
    if (hit && Date.now() - hit.at < 30000) return hit.items;
    let items = [];
    if (d.isLocalSource()) {
      const dir = d.localTarget(rel);
      if (!dir) return [];
      let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        let isDir = e.isDirectory(), isFile = e.isFile();
        if (e.isSymbolicLink()) { try { const st = await fsp.stat(path.join(dir, e.name)); isDir = st.isDirectory(); isFile = st.isFile(); } catch (_) { continue; } }
        if (isDir || isFile) items.push({ name: e.name, isDir });
      }
    } else {
      const w = d.readConfig().webdav;
      let target = d.webdavTarget(w, rel); if (!target.endsWith('/')) target += '/';
      let up;
      for (let hop = 0; hop < 4; hop++) {
        up = await d.upstream(target, { method: 'PROPFIND', headers: { Authorization: d.webdavAuthHeader(w), Depth: '1', 'Content-Type': 'application/xml', Accept: 'application/xml' } });
        if ([301, 302, 307, 308].includes(up.status) && up.headers.location) {
          const next = new URL(up.headers.location, target);
          if (next.origin !== new URL(target).origin) return [];
          target = next.toString(); continue;
        }
        break;
      }
      if (!up || up.status >= 300) return [];
      const entries = d.parsePropfind(up.body.toString('utf8'));
      let selfPath = ''; try { selfPath = decodeURIComponent(new URL(target).pathname).replace(/\/+$/, ''); } catch (_) {}
      let self = entries.findIndex(e => selfPath && e.path === selfPath);
      if (self < 0) { const segs = d.safeSegments(w.folder).concat(d.safeSegments(rel)), last = segs[segs.length - 1] || ''; self = entries.findIndex(e => e.isDir && (e.name === last || e.name === '')); }
      if (self >= 0) entries.splice(self, 1);
      items = entries.filter(e => e.name).map(e => ({ name: e.name, isDir: e.isDir }));
    }
    dirCache.set(rel, { at: Date.now(), items });
    if (dirCache.size > 200) dirCache.delete(dirCache.keys().next().value);
    return items;
  }
  const isVideo = n => d.VIDEO_EXT.includes(extOf(n)) && !/\bsample\b/i.test(n);
  async function neighbours (rel) {
    const segs = d.safeSegments(rel); if (!segs.length) return {};
    const name = segs[segs.length - 1], dirSegs = segs.slice(0, -1), folder = dirSegs[dirSegs.length - 1] || '';
    const here = (await listDir(dirSegs.join('/'))).filter(e => !e.isDir && isVideo(e.name)).map(e => e.name).sort(natural);
    const i = here.indexOf(name);
    const mk = (dir, n) => Object.assign({ path: dir.concat(n).join('/'), name: n }, niceLabel(n));
    const out = { prev: null, next: null };
    if (i < 0) return out;
    if (i > 0 && looksEpisodic(name, here[i - 1], folder)) out.prev = mk(dirSegs, here[i - 1]);
    if (i < here.length - 1) { if (looksEpisodic(name, here[i + 1], folder)) out.next = mk(dirSegs, here[i + 1]); }
    else if (SEASON_DIR.test(folder) && dirSegs.length) {
      // last episode of a season: carry on with the first of the next season folder
      const parent = dirSegs.slice(0, -1);
      const seasons = (await listDir(parent.join('/'))).filter(e => e.isDir && SEASON_DIR.test(e.name) && !/^specials?$/i.test(e.name)).map(e => e.name).sort(natural);
      const k = seasons.indexOf(folder);
      if (k >= 0 && k < seasons.length - 1) {
        const nd = parent.concat(seasons[k + 1]);
        const first = (await listDir(nd.join('/'))).filter(e => !e.isDir && isVideo(e.name)).map(e => e.name).sort(natural)[0];
        if (first) out.next = mk(nd, first);
      }
    }
    return out;
  }

  /* ---------- chapters and skip markers ---------- */
  const probeCache = new Map();
  function fileKey (rel) {
    rel = relOf(rel);
    if (d.isLocalSource()) { try { const st = fs.statSync(d.localTarget(rel)); return rel + '|' + st.size + '|' + Math.round(st.mtimeMs); } catch (_) {} }
    return rel;
  }
  function probe (rel) {
    const key = fileKey(rel), hit = probeCache.get(key);
    if (hit) return hit;
    const ffprobe = d.ffprobe();
    const input = d.mediaInput(d.readConfig().webdav, rel);
    const pr = new Promise(resolve => {
      if (!ffprobe || !input) return resolve({ duration: 0, chapters: [] });
      let fp; try { fp = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:chapter=start_time,end_time:chapter_tags=title', '-show_chapters', '-of', 'json', input]); } catch (_) { return resolve({ duration: 0, chapters: [] }); }
      let out = ''; const t = setTimeout(() => { try { fp.kill('SIGKILL'); } catch (_) {} }, 15000);
      fp.stdout.on('data', c => { out += c; }); fp.stderr.on('data', () => {});
      fp.on('error', () => { clearTimeout(t); resolve({ duration: 0, chapters: [] }); });
      fp.on('close', () => {
        clearTimeout(t);
        let j = {}; try { j = JSON.parse(out); } catch (_) {}
        const duration = Number(j.format && j.format.duration) || 0;
        const chapters = (j.chapters || []).map((c, i) => ({ start: Math.max(0, Number(c.start_time) || 0), end: Number(c.end_time) || 0, title: String((c.tags && (c.tags.title || c.tags.TITLE)) || '').trim() || ('Chapter ' + (i + 1)) }))
          .filter(c => c.end > c.start).slice(0, 200);
        resolve({ duration, chapters });
      });
    });
    probeCache.set(key, pr);
    if (probeCache.size > 300) probeCache.delete(probeCache.keys().next().value);
    pr.then(r => { if (!r.duration) probeCache.delete(key); });
    return pr;
  }
  function markers (chapters, duration) {
    const out = { intro: null, recap: null, credits: null };
    for (const c of chapters) {
      const t = c.title.toLowerCase(), len = c.end - c.start;
      if (!out.recap && /\b(recap|previously)\b/.test(t) && len >= 5 && len <= 300) out.recap = { start: c.start, end: c.end };
      else if (!out.intro && /\b(intro|opening|op|title sequence|main titles?|theme)\b/.test(t) && !/\bcredits?\b.*\bend\b|\bend\b/.test(t) && len >= 5 && len <= 300 && c.start < duration * 0.5) out.intro = { start: c.start, end: c.end };
      else if (!out.credits && /\b(credits?|ending|outro|ed|closing)\b/.test(t) && !/\bopening\b/.test(t) && c.start > duration * 0.5) out.credits = { start: c.start, end: duration || c.end };
    }
    return out;
  }

  /* ---------- seek previews ---------- */
  function thumbPlan (duration) {
    if (!duration || duration < 30) return null;
    const interval = Math.max(5, Math.min(60, Math.ceil(duration / 180)));
    return { interval, count: Math.min(400, Math.ceil(duration / interval)), width: THUMB_W };
  }
  let thumbActive = 0; const thumbQueue = [], thumbJobs = new Map(), thumbBad = new Map();
  function thumbRun () {
    while (thumbActive < 2 && thumbQueue.length) { const job = thumbQueue.shift(); thumbActive++; job().finally(() => { thumbActive--; thumbRun(); }); }
  }
  function makeThumb (rel, i, plan, file, urgent) {
    const jobKey = file;
    if (thumbJobs.has(jobKey)) return thumbJobs.get(jobKey);
    const pr = new Promise((resolve, reject) => {
      const job = () => new Promise(done => {
        const ffmpeg = d.ffmpeg(), input = d.mediaInput(d.readConfig().webdav, rel);
        if (!ffmpeg || !input) { reject(new Error('unavailable')); return done(); }
        const t = Math.min(i * plan.interval + plan.interval / 2, Math.max(0, plan.duration - 1));
        let ff; try { ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-noaccurate_seek', '-ss', t.toFixed(2), '-i', input, '-frames:v', '1', '-an', '-sn', '-dn', '-vf', 'scale=' + THUMB_W + ':-2:flags=fast_bilinear', '-pix_fmt', 'yuvj420p', '-q:v', '6', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']); }
        catch (e) { reject(e); return done(); }
        const chunks = []; const timer = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (_) {} }, 25000);
        ff.stdout.on('data', c => chunks.push(c)); ff.stderr.on('data', () => {});
        ff.on('error', e => { clearTimeout(timer); reject(e); done(); });
        ff.on('close', async () => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          if (buf.length < 200) { reject(new Error('no frame')); return done(); }
          try { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file + '.tmp', buf); await fsp.rename(file + '.tmp', file); } catch (_) {}
          resolve(buf); done();
        });
      });
      if (urgent) thumbQueue.unshift(job); else thumbQueue.push(job);
      thumbRun();
    });
    thumbJobs.set(jobKey, pr);
    pr.catch(() => {}).finally(() => thumbJobs.delete(jobKey));
    return pr;
  }
  async function sendThumb (res, rel, i, urgent) {
    const c = cfg();
    if (!c.seekPreviews || !d.ffmpeg()) { res.writeHead(404); return res.end(); }
    const p = await probe(rel), plan = thumbPlan(p.duration);
    if (!plan || !(i >= 0 && i < plan.count)) { res.writeHead(404); return res.end(); }
    plan.duration = p.duration;
    const dir = path.join(THUMB_DIR, sha(fileKey(rel)).slice(0, 24)), file = path.join(dir, i + '.jpg');
    const send = buf => { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=604800' }); res.end(buf); };
    try { return send(await fsp.readFile(file)); } catch (_) {}
    const bad = thumbBad.get(file);
    if (bad && Date.now() - bad < 600000) { res.writeHead(404); return res.end(); }
    try { send(await makeThumb(rel, i, plan, file, urgent)); }
    catch (_) { thumbBad.set(file, Date.now()); if (thumbBad.size > 2000) thumbBad.clear(); if (!res.headersSent) { res.writeHead(404); res.end(); } }
  }
  async function prune () {
    // previews for files nobody has opened in a month
    try {
      for (const n of await fsp.readdir(THUMB_DIR)) {
        const p = path.join(THUMB_DIR, n);
        try { const st = await fsp.stat(p); if (Date.now() - st.mtimeMs > 30 * 86400000) await fsp.rm(p, { recursive: true, force: true }); } catch (_) {}
      }
    } catch (_) {}
  }
  function touchThumbs (rel) { const dir = path.join(THUMB_DIR, sha(fileKey(rel)).slice(0, 24)); const now = new Date(); fsp.utimes(dir, now, now).catch(() => {}); }

  /* ---------- subtitles ---------- */
  const subDir = rel => path.join(SUBS_DIR, sha(relOf(rel)).slice(0, 24));
  async function savedSubs (rel) { try { const j = JSON.parse(await fsp.readFile(path.join(subDir(rel), 'index.json'), 'utf8')); return Array.isArray(j) ? j : []; } catch (_) { return []; } }
  async function writeSaved (rel, list) { await fsp.mkdir(subDir(rel), { recursive: true }); await fsp.writeFile(path.join(subDir(rel), 'index.json'), JSON.stringify(list)); }
  async function addSaved (rel, vtt, meta) {
    const id = crypto.randomBytes(6).toString('hex');
    await fsp.mkdir(subDir(rel), { recursive: true });
    await fsp.writeFile(path.join(subDir(rel), id + '.vtt'), vtt);
    const list = await savedSubs(rel);
    const entry = Object.assign({ id, at: Date.now() }, meta);
    list.unshift(entry); await writeSaved(rel, list.slice(0, 30));
    for (const old of list.slice(30)) fsp.rm(path.join(subDir(rel), old.id + '.vtt'), { force: true }).catch(() => {});
    return entry;
  }
  async function sidecars (rel) {
    const segs = d.safeSegments(rel), name = segs[segs.length - 1] || '', base = stem(name).toLowerCase();
    const items = await listDir(segs.slice(0, -1).join('/'));
    return items.filter(e => !e.isDir && SUB_EXT.includes(extOf(e.name)) && (stem(e.name).toLowerCase() === base || e.name.toLowerCase().startsWith(base + '.')))
      .sort((a, b) => natural(a.name, b.name)).slice(0, 40)
      .map(e => {
        const tags = stem(e.name).slice(base.length).split('.').filter(Boolean).map(s => s.toLowerCase());
        const lang = tags.find(t => LANGS[t]) || '';
        const extra = tags.filter(t => /^(forced|sdh|hi|cc)$/.test(t)).map(t => t === 'forced' ? 'Forced' : 'SDH');
        return { id: 'f:' + Buffer.from(e.name).toString('base64url'), label: (langName(lang) || 'Subtitles') + (extra.length ? ' · ' + extra.join(' · ') : ''), lang: lang.length === 3 ? lang : lang, source: 'file', detail: e.name };
      });
  }
  async function readSourceFile (rel, max) {
    if (d.isLocalSource()) {
      const f = d.localTarget(rel); const st = await fsp.stat(f);
      if (!st.isFile() || st.size > max) throw new Error('too large');
      return fsp.readFile(f);
    }
    const w = d.readConfig().webdav;
    const up = await d.upstream(d.webdavTarget(w, rel), { headers: { Authorization: d.webdavAuthHeader(w) }, timeout: 30000 });
    if (up.status >= 300 || up.body.length > max) throw new Error('HTTP ' + up.status);
    return up.body;
  }
  function assToVtt (buf) {
    return new Promise((resolve, reject) => {
      const ffmpeg = d.ffmpeg(); if (!ffmpeg) return reject(new Error('This subtitle format needs ffmpeg on the server'));
      let ff; try { ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'ass', '-i', 'pipe:0', '-f', 'webvtt', 'pipe:1']); } catch (e) { return reject(e); }
      const out = []; const t = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (_) {} }, 20000);
      ff.stdout.on('data', c => out.push(c)); ff.stderr.on('data', () => {});
      ff.on('error', e => { clearTimeout(t); reject(e); });
      ff.on('close', () => { clearTimeout(t); const s = Buffer.concat(out).toString('utf8'); s.includes('-->') ? resolve(s) : reject(new Error('Couldn’t read that subtitle file')); });
      ff.stdin.on('error', () => {}); ff.stdin.end(buf);
    });
  }
  async function anyToVtt (buf, nameHint) {
    const text = decodeText(buf);
    if (/^\s*\[script info\]/i.test(text) || /^(ass|ssa)$/.test(extOf(nameHint || ''))) return toVtt(await assToVtt(Buffer.from(text, 'utf8')), 0);
    return toVtt(text, 0);
  }
  const vttCache = new Map();
  async function subText (rel, id) {
    const key = relOf(rel) + '|' + id, hit = vttCache.get(key);
    if (hit && Date.now() - hit.at < 600000) return hit.vtt;
    let vtt = '';
    if (id.startsWith('f:')) {
      const name = Buffer.from(id.slice(2), 'base64url').toString('utf8');
      const side = (await sidecars(rel)).find(s => s.id === id);
      if (!side || /[\/\\]/.test(name)) return '';
      const segs = d.safeSegments(rel).slice(0, -1).concat(name);
      vtt = await anyToVtt(await readSourceFile(segs.join('/'), 8 * 1024 * 1024), name);
    } else if (/^s:[a-f0-9]{12}$/.test(id)) {
      try { vtt = await fsp.readFile(path.join(subDir(rel), id.slice(2) + '.vtt'), 'utf8'); } catch (_) { vtt = ''; }
    }
    if (vtt) { vttCache.set(key, { at: Date.now(), vtt }); if (vttCache.size > 40) vttCache.delete(vttCache.keys().next().value); }
    return vtt;
  }
  async function subsFor (rel) {
    const saved = (await savedSubs(rel)).map(s => ({ id: 's:' + s.id, label: langName(s.lang) || stem(s.name || '') || 'Subtitles', lang: s.lang || '', source: s.source || 'upload', detail: s.release || s.name || '', by: s.by || '' }));
    let files = []; try { files = await sidecars(rel); } catch (_) {}
    return files.concat(saved);
  }

  /* ---------- OpenSubtitles ---------- */
  const UA = 'MEDIARR v' + (d.version || '0');
  let osToken = null;   // { token, base, at, user }
  async function osFetch (url, opt) {
    opt = opt || {};
    const os = cfg().opensubtitles;
    const headers = Object.assign({ 'Api-Key': os.apiKey, 'User-Agent': UA, Accept: 'application/json' }, opt.headers || {});
    let body = null;
    if (opt.body) { body = Buffer.from(JSON.stringify(opt.body)); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = body.length; }
    let r, target = url;
    for (let hop = 0; hop < 4; hop++) {
      try { r = await d.upstream(target, { method: opt.method || 'GET', headers, body, timeout: 20000 }); }
      catch (e) { throw new Error('OpenSubtitles couldn’t be reached (' + e.message + ')'); }
      if ([301, 302, 307, 308].includes(r.status) && r.headers.location) { target = new URL(r.headers.location, target).toString(); continue; }
      break;
    }
    let j = null; try { j = JSON.parse(r.body.toString('utf8')); } catch (_) {}
    if (r.status >= 400) {
      const msg = (j && (j.message || (Array.isArray(j.errors) && j.errors.join(', ')))) || ('HTTP ' + r.status);
      const e = new Error(r.status === 401 || r.status === 403 ? 'OpenSubtitles didn’t accept the API key or sign-in (' + msg + ')' : r.status === 406 || r.status === 429 ? 'OpenSubtitles limit reached: ' + msg : 'OpenSubtitles: ' + msg);
      e.status = r.status; throw e;
    }
    return j || {};
  }
  async function osAuth () {
    const os = cfg().opensubtitles;
    if (!os.username || !os.password) return { base: OS_BASE, headers: {} };
    if (osToken && osToken.user === os.username && Date.now() - osToken.at < 20 * 3600000) return { base: osToken.base, headers: { Authorization: 'Bearer ' + osToken.token } };
    const j = await osFetch(OS_BASE + '/login', { method: 'POST', body: { username: os.username, password: os.password } });
    if (!j.token) throw new Error('OpenSubtitles sign-in failed');
    const base = process.env.MEDIARR_OPENSUBTITLES_URL ? OS_BASE : (j.base_url ? 'https://' + String(j.base_url).replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/api/v1' : OS_BASE);
    osToken = { token: j.token, base, at: Date.now(), user: os.username };
    return { base, headers: { Authorization: 'Bearer ' + j.token } };
  }
  // OpenSubtitles' file hash: size + the first and last 64 KiB as little-endian 64-bit words
  async function movieHash (rel) {
    if (!d.isLocalSource()) return '';
    let fh;
    try {
      const f = d.localTarget(rel); fh = await fsp.open(f, 'r'); const st = await fh.stat();
      if (st.size < 131072) return '';
      let h = BigInt(st.size); const buf = Buffer.alloc(65536), mask = (1n << 64n) - 1n;
      for (const pos of [0, st.size - 65536]) { await fh.read(buf, 0, 65536, pos); for (let i = 0; i < 65536; i += 8) h = (h + buf.readBigUInt64LE(i)) & mask; }
      return h.toString(16).padStart(16, '0');
    } catch (_) { return ''; } finally { if (fh) fh.close().catch(() => {}); }
  }
  async function osSearch (rel, q, langs) {
    const c = cfg(); if (!c.opensubtitles.apiKey) { const e = new Error('Subtitle search isn’t set up yet'); e.status = 400; throw e; }
    const name = d.safeSegments(rel).pop() || '', e = epInfo(name);
    const params = new URLSearchParams();
    const query = String(q || '').trim() || (e.episode != null ? e.show : e.movie) || stem(name);
    params.set('query', query.slice(0, 120));
    if (!q && e.episode != null) { if (e.season) params.set('season_number', String(e.season)); params.set('episode_number', String(e.episode)); }
    if (!q && e.year) params.set('year', String(e.year));
    params.set('languages', String(langs || c.subLangs).toLowerCase().replace(/[^a-z,\-]/g, '') || 'en');
    const hash = q ? '' : await movieHash(rel); if (hash) params.set('moviehash', hash);
    const sorted = new URLSearchParams([...params.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    const auth = await osAuth();
    const j = await osFetch(auth.base + '/subtitles?' + sorted.toString(), { headers: auth.headers });
    const results = (Array.isArray(j.data) ? j.data : []).map(x => {
      const a = x.attributes || {}, f = (a.files || [])[0] || {}, fd = a.feature_details || {};
      return { fileId: Number(f.file_id) || 0, lang: String(a.language || ''), langName: langName(a.language), release: String(a.release || f.file_name || ''), downloads: Number(a.download_count) || 0, hi: !!a.hearing_impaired, ai: !!(a.ai_translated || a.machine_translated), trusted: !!a.from_trusted, exact: !!a.moviehash_match, feature: [fd.movie_name || fd.title || '', fd.season_number ? 'S' + fd.season_number + 'E' + fd.episode_number : ''].filter(Boolean).join(' · ') };
    }).filter(x => x.fileId).sort((a, b) => (b.exact - a.exact) || (b.downloads - a.downloads)).slice(0, 40);
    return { results, query, languages: params.get('languages') };
  }
  async function osDownload (rel, fileId, meta, user) {
    const auth = await osAuth();
    const j = await osFetch(auth.base + '/download', { method: 'POST', body: { file_id: Number(fileId) }, headers: auth.headers });
    if (!j.link) throw new Error('OpenSubtitles didn’t return a download link' + (j.message ? ': ' + j.message : ''));
    let r, target = j.link;
    for (let hop = 0; hop < 4; hop++) { r = await d.upstream(target, { timeout: 30000 }); if ([301, 302, 307, 308].includes(r.status) && r.headers.location) { target = new URL(r.headers.location, target).toString(); continue; } break; }
    if (r.status >= 300) throw new Error('Couldn’t download the subtitle (HTTP ' + r.status + ')');
    const vtt = await anyToVtt(r.body, j.file_name || '');
    if (!vtt) throw new Error('That subtitle file was empty or unreadable');
    const entry = await addSaved(rel, vtt, { source: 'opensubtitles', lang: String(meta.lang || '').slice(0, 12), release: String(meta.release || j.file_name || '').slice(0, 200), by: user, fileId: Number(fileId) });
    return { entry, remaining: j.remaining };
  }

  /* ---------- Watch Together ---------- */
  const rooms = new Map();
  const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode = () => { for (;;) { let c = ''; for (const b of crypto.randomBytes(6)) c += CODE[b % CODE.length]; if (!rooms.has(c)) return c; } };
  const roomState = r => ({ path: r.path, name: r.name, pos: r.pos, playing: r.playing, age: Math.max(0, Date.now() - r.at), seq: r.seq, by: r.by });
  const roomMembers = r => [...r.members.values()].map(m => ({ client: m.client.slice(0, 8), name: m.name, pos: m.pos, buffering: !!m.buffering, online: !!m.res || Date.now() - m.seen < 15000 }));
  const roomOut = r => ({ id: r.id, host: r.host, state: roomState(r), members: roomMembers(r), chat: r.chat.slice(-30), reactions: REACTIONS });
  function cast (r, ev, except) {
    const msg = 'event: party\ndata: ' + JSON.stringify(ev) + '\n\n';
    for (const m of r.members.values()) { if (!m.res || m.client === except) continue; try { m.res.write(msg); } catch (_) { m.res = null; } }
  }
  function sweep () {
    const now = Date.now();
    for (const [id, r] of rooms) {
      for (const [k, m] of r.members) if (!m.res && now - m.seen > 30000) { r.members.delete(k); cast(r, { type: 'members', members: roomMembers(r), left: m.name }); }
      if (!r.members.size && now - r.last > 600000) rooms.delete(id);
      else if (now - r.last > 12 * 3600000) { cast(r, { type: 'closed' }); rooms.delete(id); }
    }
  }
  const sweeper = setInterval(sweep, 15000); if (sweeper.unref) sweeper.unref();
  function setState (r, patch, by) { Object.assign(r, patch, { at: Date.now(), by }); r.seq++; r.last = Date.now(); }
  const clientOk = c => /^[a-f0-9]{8,48}$/.test(String(c || ''));
  const posOf = v => Math.max(0, Math.min(86400 * 4, Number(v) || 0));

  /* ---------- settings ---------- */
  function settingsOut (me) {
    const c = cfg(), admin = me && me.role === 'admin';
    const out = { seekPreviews: c.seekPreviews && !!d.ffmpeg(), watchTogether: c.watchTogether, subSearch: !!c.opensubtitles.apiKey, subLangs: c.subLangs, ffmpeg: !!d.ffmpeg(), admin: !!admin };
    if (admin) out.config = { seekPreviews: c.seekPreviews, watchTogether: c.watchTogether, subLangs: c.subLangs, opensubtitles: { hasKey: !!c.opensubtitles.apiKey, username: c.opensubtitles.username, hasPassword: !!c.opensubtitles.password } };
    return out;
  }

  /* ---------- routes ---------- */
  async function handle (req, res, u, me) {
    const p = u.pathname, q = u.searchParams, json = (s, o) => d.sendJSON(res, s, o);
    const body = async () => { try { return JSON.parse(await d.readBody(req) || '{}'); } catch (_) { return {}; } };
    const isAdmin = me.role === 'admin';
    let m;

    if (p === '/api/player/settings' && req.method === 'GET') return json(200, settingsOut(me)), true;
    if (p === '/api/player/settings' && req.method === 'POST') {
      if (!isAdmin) return json(403, { message: 'Admin only' }), true;
      const b = await body(), all = d.readConfig(), cur = cfg();
      if (b.seekPreviews != null) cur.seekPreviews = !!b.seekPreviews;
      if (b.watchTogether != null) cur.watchTogether = !!b.watchTogether;
      if (b.subLangs != null) cur.subLangs = String(b.subLangs).toLowerCase().replace(/\s+/g, '').replace(/[^a-z,\-]/g, '').slice(0, 60) || 'en';
      const os = b.opensubtitles || {};
      if (typeof os.apiKey === 'string' && os.apiKey !== '') cur.opensubtitles.apiKey = os.apiKey.trim().slice(0, 200);
      if (os.clearKey) cur.opensubtitles.apiKey = '';
      if (typeof os.username === 'string') cur.opensubtitles.username = os.username.trim().slice(0, 120);
      if (typeof os.password === 'string' && os.password !== '') cur.opensubtitles.password = os.password.slice(0, 200);
      if (os.clearPassword || !cur.opensubtitles.username) cur.opensubtitles.password = '';
      all.player = cur; d.writeConfig(all); osToken = null;
      const out = settingsOut(me);
      if (b.test) {
        try { if (!cur.opensubtitles.apiKey) throw new Error('Enter an API key first'); const auth = await osAuth(); await osFetch(auth.base + '/subtitles?languages=en&query=test', { headers: auth.headers }); out.test = { ok: true, message: cur.opensubtitles.username ? 'Connected and signed in as ' + cur.opensubtitles.username : 'Connected' }; }
        catch (e) { out.test = { ok: false, message: e.message }; }
      }
      return json(200, out), true;
    }

    if (p.startsWith('/api/player/')) {
      const rel = relOf(q.get('path') || '');
      if (!sourceOk()) return json(400, { message: 'No download source is configured' }), true;
      if (!rel) return json(400, { message: 'No file specified' }), true;

      if (p === '/api/player/info' && req.method === 'GET') {
        const c = cfg();
        const [pr, nb, subs] = await Promise.all([probe(rel), neighbours(rel).catch(() => ({})), subsFor(rel).catch(() => [])]);
        const plan = c.seekPreviews && d.ffmpeg() ? thumbPlan(pr.duration) : null;
        if (plan) touchThumbs(rel);
        const name = d.safeSegments(rel).pop();
        return json(200, Object.assign({ path: rel, name, duration: pr.duration, chapters: pr.chapters, markers: markers(pr.chapters, pr.duration), prev: nb.prev || null, next: nb.next || null, thumbs: plan, subs, settings: settingsOut(me) }, niceLabel(name))), true;
      }
      if (p === '/api/player/thumb' && req.method === 'GET') { await sendThumb(res, rel, parseInt(q.get('i'), 10), q.get('p') === '1'); return true; }

      if (p === '/api/player/subs' && req.method === 'GET') return json(200, { subs: await subsFor(rel) }), true;
      if (p === '/api/player/subs/file' && req.method === 'GET') {
        let vtt = ''; try { vtt = await subText(rel, String(q.get('id') || '')); } catch (e) { log('[player] subtitle: ' + e.message); }
        if (!vtt) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Subtitle not found'); return true; }
        const shift = Math.max(-600000, Math.min(600000, parseInt(q.get('offset'), 10) || 0));
        if (shift) vtt = toVtt(vtt, shift) || 'WEBVTT\n\n';
        const buf = Buffer.from(vtt, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }); res.end(buf); return true;
      }
      if (p === '/api/player/subs/search' && req.method === 'GET') {
        try { return json(200, await osSearch(rel, q.get('q') || '', q.get('lang') || '')), true; }
        catch (e) { return json(e.status === 400 ? 400 : 502, { message: e.message }), true; }
      }
      if (p === '/api/player/subs/download' && req.method === 'POST') {
        const b = await body();
        if (!cfg().opensubtitles.apiKey) return json(400, { message: 'Subtitle search isn’t set up yet' }), true;
        const have = (await savedSubs(rel)).find(s => s.fileId === Number(b.fileId));
        if (have) return json(200, { sub: (await subsFor(rel)).find(s => s.id === 's:' + have.id), reused: true }), true;
        try { const r = await osDownload(rel, b.fileId, b, me.username); vttCache.clear(); return json(200, { sub: (await subsFor(rel)).find(s => s.id === 's:' + r.entry.id), remaining: r.remaining }), true; }
        catch (e) { return json(502, { message: e.message }), true; }
      }
      if (p === '/api/player/subs/upload' && req.method === 'POST') {
        const chunks = []; let size = 0, tooBig = false;
        await new Promise(resolve => { req.on('data', c => { size += c.length; if (size > 3 * 1024 * 1024) tooBig = true; else chunks.push(c); }); req.on('end', resolve); req.on('error', resolve); });
        if (tooBig) return json(413, { message: 'That file is too large for a subtitle (3 MB at most)' }), true;
        const fname = String(q.get('name') || 'subtitle.srt').replace(/[\/\\\u0000-\u001f]/g, '').slice(0, 150);
        if (!SUB_EXT.includes(extOf(fname))) return json(400, { message: 'Choose a .srt, .vtt, .ass or .ssa file' }), true;
        let vtt = ''; try { vtt = await anyToVtt(Buffer.concat(chunks), fname); } catch (e) { return json(400, { message: e.message }), true; }
        if (!vtt) return json(400, { message: 'No subtitles could be read from that file' }), true;
        const tags = stem(fname).split('.').map(s => s.toLowerCase());
        const lang = String(q.get('lang') || tags.reverse().find(t => LANGS[t]) || '').toLowerCase().replace(/[^a-z\-]/g, '').slice(0, 12);
        const entry = await addSaved(rel, vtt, { source: 'upload', lang, name: fname, by: me.username });
        return json(200, { sub: (await subsFor(rel)).find(s => s.id === 's:' + entry.id) }), true;
      }
      if (p === '/api/player/subs' && req.method === 'DELETE') {
        const id = String(q.get('id') || '');
        if (!/^s:[a-f0-9]{12}$/.test(id)) return json(400, { message: 'Only downloaded or uploaded subtitles can be removed' }), true;
        const list = await savedSubs(rel), hit = list.find(s => s.id === id.slice(2));
        if (!hit) return json(404, { message: 'Not found' }), true;
        if (!isAdmin && hit.by !== me.username) return json(403, { message: 'Only the person who added it, or an admin, can remove it' }), true;
        await writeSaved(rel, list.filter(s => s !== hit)); await fsp.rm(path.join(subDir(rel), hit.id + '.vtt'), { force: true }); vttCache.clear();
        return json(200, { ok: true, subs: await subsFor(rel) }), true;
      }
      return false;
    }

    /* Watch Together */
    if (p === '/api/party' || p.startsWith('/api/party/')) {
      if (!cfg().watchTogether) return json(403, { message: 'Watch Together is turned off on this server' }), true;
      if (p === '/api/party' && req.method === 'POST') {
        const b = await body(), rel = relOf(b.path || '');
        if (!rel) return json(400, { message: 'Play something first' }), true;
        if (rooms.size >= 200) sweep();
        if (rooms.size >= 200) return json(429, { message: 'Too many watch parties right now' }), true;
        const r = { id: newCode(), host: me.username, path: rel, name: String(b.name || d.safeSegments(rel).pop()).slice(0, 300), pos: posOf(b.pos), playing: !!b.playing, at: Date.now(), by: me.username, seq: 1, members: new Map(), chat: [], last: Date.now() };
        rooms.set(r.id, r);
        return json(200, roomOut(r)), true;
      }
      if ((m = p.match(/^\/api\/party\/([A-Za-z0-9]{6})(\/stream)?$/))) {
        const r = rooms.get(m[1].toUpperCase());
        if (!r) return json(404, { message: 'That watch party has ended, or the code is wrong' }), true;
        if (!m[2] && req.method === 'GET') return json(200, roomOut(r)), true;
        if (m[2] && req.method === 'GET') {
          const client = String(q.get('client') || '').toLowerCase();
          if (!clientOk(client)) return json(400, { message: 'Bad client' }), true;
          if (!r.members.has(client) && r.members.size >= 50) return json(429, { message: 'This watch party is full' }), true;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 3000\n\n');
          let mem = r.members.get(client); const fresh = !mem;
          if (mem && mem.res) { try { mem.res.end(); } catch (_) {} }
          if (!mem) { mem = { client, name: me.username, pos: 0, buffering: false, seen: Date.now(), res: null }; r.members.set(client, mem); }
          mem.res = res; mem.seen = Date.now(); r.last = Date.now();
          res.write('event: party\ndata: ' + JSON.stringify({ type: 'hello', room: roomOut(r) }) + '\n\n');
          cast(r, { type: 'members', members: roomMembers(r), joined: fresh ? mem.name : undefined }, client);
          const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 20000); if (hb.unref) hb.unref();
          const close = () => { clearInterval(hb); if (mem.res === res) { mem.res = null; mem.seen = Date.now(); } };
          req.on('close', close); res.on('close', close);
          return true;
        }
        if (!m[2] && req.method === 'POST') {
          const b = await body(), client = String(b.client || '').toLowerCase(), a = String(b.action || '');
          if (!clientOk(client)) return json(400, { message: 'Bad client' }), true;
          const mem = r.members.get(client);
          if (mem) { mem.seen = Date.now(); if (b.pos != null) mem.pos = posOf(b.pos); mem.buffering = !!b.buffering; }
          r.last = Date.now();
          const who = me.username;
          if (a === 'play' || a === 'pause' || a === 'seek') {
            setState(r, { pos: posOf(b.pos), playing: a === 'seek' ? (b.playing != null ? !!b.playing : r.playing) : a === 'play' }, who);
            cast(r, { type: 'state', action: a, state: roomState(r) }, client);
          } else if (a === 'load') {
            const rel = relOf(b.path || ''); if (!rel) return json(400, { message: 'No file' }), true;
            setState(r, { path: rel, name: String(b.name || d.safeSegments(rel).pop()).slice(0, 300), pos: posOf(b.pos), playing: true }, who);
            cast(r, { type: 'state', action: 'load', state: roomState(r) }, client);
          } else if (a === 'say') {
            const text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
            if (text) { const msg = { from: who, text, at: Date.now() }; r.chat.push(msg); if (r.chat.length > 60) r.chat.shift(); cast(r, { type: 'chat', msg }); }
          } else if (a === 'react') {
            if (REACTIONS.includes(b.emoji)) cast(r, { type: 'react', from: who, emoji: b.emoji });
          } else if (a === 'leave') {
            if (mem) { try { if (mem.res) mem.res.end(); } catch (_) {} r.members.delete(client); cast(r, { type: 'members', members: roomMembers(r), left: mem.name }); }
            return json(200, { ok: true }), true;
          } else if (a !== 'ping') return json(400, { message: 'Unknown action' }), true;
          return json(200, { ok: true, state: roomState(r), members: roomMembers(r) }), true;
        }
      }
      return json(404, { message: 'Not found' }), true;
    }
    return false;
  }

  return { handle, prune, settings: settingsOut, _rooms: rooms };
}

module.exports = { createPlayerExtras, epInfo, niceLabel, looksEpisodic, toVtt, _internal: { decodeText } };
