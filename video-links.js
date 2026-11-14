'use strict';
/*
 * Direct movie and TV links (v2.16).
 *
 * The video version of the music player's direct links: personal link keys, each with its
 * own expiry, that play files from the download source (local folder or WebDAV) without
 * signing in. Unlike music keys, a video key can be limited to one file or one folder, so a
 * link for a single movie or one show can be shared without opening the whole library.
 *
 *   /video/d/<key>/f/<path…>/<file.mkv>            one file, seekable (Range), CORS *
 *   /video/d/<key>/folder/<path…>/playlist.m3u8     every video in a folder and its sub-folders
 *                                                   (a whole show, or one season), for VLC, Kodi, Infuse…
 *   ?transcode=1   convert on the fly for players that can't open the original (not seekable)
 *   ?dl=1          ask the browser to save the file instead of playing it
 */
const crypto = require('crypto');

const KEY_RE = /^vl_[a-f0-9]{48}$/;
const SUB_EXT = ['srt', 'vtt', 'ass', 'ssa', 'sub', 'idx', 'sup'];
// Folders that hold bonus material rather than the episodes or the movie (Plex's names)
const EXTRA_DIRS = /^(samples?|extras|featurettes|trailers|behind the scenes|deleted scenes|interviews|scenes|shorts|other|bonus)$/i;
const SAMPLE_FILE = /(^|[\s._\-[(])sample([\s._\-\])]|$)/i;
const LINK_DAYS = [1, 7, 30, 90, 365, 0];
const MAX_KEYS = 50;
const PLAYLIST_DEPTH = 3, PLAYLIST_MAX = 5000;

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function createVideoLinks (d) {
  const { store, fs, path } = d;

  function policy (c) {
    const l = Object.assign({ enabled: true, maxDays: 30, defaultDays: 7, users: true }, ((c || d.readConfig()).videoLinks) || {});
    const maxDays = LINK_DAYS.includes(Number(l.maxDays)) ? Number(l.maxDays) : 30;
    let defaultDays = LINK_DAYS.includes(Number(l.defaultDays)) ? Number(l.defaultDays) : 7;
    if (maxDays && (!defaultDays || defaultDays > maxDays)) defaultDays = maxDays;
    return { enabled: l.enabled !== false, maxDays, defaultDays, users: l.users !== false };
  }
  // what an admin sent in Settings → the stored policy (unknown values keep the current ones)
  function nextPolicy (cur, inc) {
    const next = Object.assign({}, cur);
    if (inc.enabled != null) next.enabled = !!inc.enabled;
    if (inc.users != null) next.users = !!inc.users;
    if (inc.maxDays != null && LINK_DAYS.includes(Number(inc.maxDays))) next.maxDays = Number(inc.maxDays);
    if (inc.defaultDays != null && LINK_DAYS.includes(Number(inc.defaultDays))) next.defaultDays = Number(inc.defaultDays);
    return policy({ videoLinks: next });
  }
  const canCreate = (me, pol) => !!me && pol.enabled && (me.role === 'admin' || pol.users);

  // "Movies/Heat (1995)/Heat.mkv" — never above the source folder, no hidden files
  function cleanRel (rel) {
    const segs = d.safeSegments(rel);
    if (segs.some(s => s.startsWith('.') || /[\\\0]/.test(s))) return null;
    return segs.join('/');
  }
  const inScope = (k, rel) => !k.scope || rel === k.scope || rel.startsWith(k.scope + '/');
  const isVideo = n => d.VIDEO_EXT.includes((String(n).split('.').pop() || '').toLowerCase());
  const isSub = n => SUB_EXT.includes((String(n).split('.').pop() || '').toLowerCase());

  function keyOut (k, withKey) {
    const o = { id: k.id, label: k.label, scope: k.scope || '', scopeKind: k.scopeKind || '', created: k.created, expires: k.expires,
      lastUsed: k.lastUsed, uses: k.uses, expired: !!(k.expires && k.expires <= Date.now()) };
    if (withKey) o.key = k.key; else o.username = k.username;
    return o;
  }

  /* ---------- listing a folder (for playlists) ---------- */
  function sourceReady () {
    if (d.isLocalSource()) return true;
    const c = d.readConfig().webdav || {};
    return !!(c.url && c.username);
  }
  async function listLocal (rel) {
    const dir = d.localTarget(rel);
    if (!dir) return null;
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return e.code === 'ENOTDIR' ? null : (e.code === 'ENOENT' ? null : []); }
    const folders = [], files = [];
    for (const ent of ents) {
      if (ent.name.startsWith('.')) continue;
      let isDir = ent.isDirectory(), isFile = ent.isFile();
      if (ent.isSymbolicLink()) {
        try { const st = await fs.promises.stat(path.join(dir, ent.name)); isDir = st.isDirectory(); isFile = st.isFile(); } catch (_) { continue; }
      }
      if (isDir) folders.push(ent.name); else if (isFile) files.push(ent.name);
    }
    return { folders, files };
  }
  async function listWebdav (rel) {
    const cfg = d.readConfig().webdav;
    let target = d.webdavTarget(cfg, rel);
    if (!target.endsWith('/')) target += '/';
    let up;
    for (let hop = 0; hop < 4; hop++) {
      up = await d.upstream(target, { method: 'PROPFIND', timeout: 20000,
        headers: { Authorization: d.webdavAuthHeader(cfg), Depth: '1', 'Content-Type': 'application/xml', Accept: 'application/xml' } });
      if ([301, 302, 307, 308].includes(up.status) && up.headers.location) {
        const next = new URL(up.headers.location, target);
        if (next.origin !== new URL(target).origin) break;
        target = next.toString(); continue;
      }
      break;
    }
    if (up.status === 404) return null;
    if (up.status >= 300) throw new Error('The WebDAV server answered HTTP ' + up.status);
    let self = ''; try { self = decodeURIComponent(new URL(target).pathname).replace(/\/+$/, ''); } catch (_) {}
    const entries = d.parsePropfind(up.body.toString('utf8')).filter(e => e.path !== self && e.name && !e.name.startsWith('.'));
    return { folders: entries.filter(e => e.isDir).map(e => e.name), files: entries.filter(e => !e.isDir).map(e => e.name) };
  }
  const listFolder = rel => d.isLocalSource() ? listLocal(rel) : listWebdav(rel);

  // every video under `rel`, episodes in order: this folder's files first, then each sub-folder
  async function collect (rel, depth, out) {
    const l = await listFolder(rel);
    if (!l) return out.length ? out : null;
    for (const f of l.files.filter(n => isVideo(n) && !SAMPLE_FILE.test(n)).sort(natural)) {
      if (out.length >= PLAYLIST_MAX) return out;
      out.push((rel ? rel + '/' : '') + f);
    }
    if (depth > 0) for (const sub of l.folders.filter(n => !EXTRA_DIRS.test(n)).sort(natural)) {
      if (out.length >= PLAYLIST_MAX) break;
      await collect((rel ? rel + '/' : '') + sub, depth - 1, out);
    }
    return out;
  }

  /* ---------- the public link ---------- */
  const enc = rel => rel.split('/').map(s => encodeURIComponent(s)).join('/');
  function dispo (type, name) {
    return type + "; filename=\"" + name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') + "\"; filename*=UTF-8''" + encodeURIComponent(name);
  }
  async function direct (req, res, u) {
    const plain = (code, msg) => {
      if (res.headersSent) return res.end();
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Access-Control-Allow-Origin': '*' });
      return res.end(req.method === 'HEAD' ? undefined : msg + '\n');
    };
    const m = u.pathname.match(/^\/video\/d\/([^/]+)\/(f|folder)\/(.*)$/);
    if (!m || !KEY_RE.test(m[1])) return plain(404, 'Not found');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Max-Age': '86400' });
      return res.end();
    }
    const pol = policy();
    if (!pol.enabled) return plain(403, 'Direct movie and TV links are turned off on this server.');
    const k = store.videoKeys.byKey(m[1]);
    if (!k) return plain(404, 'This link isn’t valid. It may have been revoked.');
    if (k.expires && k.expires <= Date.now()) return plain(410, 'This link has expired. Ask for a new one, or extend the key in Direct links.');
    const owner = d.readUsers().users.find(x => x.username.toLowerCase() === String(k.username).toLowerCase());
    if (!owner || !d.userApproved(owner)) return plain(403, 'This link’s owner no longer has access.');
    if (owner.role !== 'admin' && !pol.users) return plain(403, 'Only admins can share direct links on this server.');
    if (!sourceReady()) return plain(503, 'This server’s movie and TV source isn’t set up.');

    let segs;
    try { segs = m[3].split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { return plain(400, 'Bad link'); }
    if (m[2] === 'folder') { if (!/^playlist\.m3u8?$/i.test(segs[segs.length - 1] || '')) return plain(404, 'Not found'); segs.pop(); }
    if (segs.some(s => s === '.' || s === '..' || s.includes('/'))) return plain(400, 'Bad link');
    const rel = cleanRel(segs.join('/'));
    if (rel == null || rel !== segs.join('/')) return plain(400, 'Bad link');
    if (!inScope(k, rel)) return plain(403, 'This link’s key doesn’t cover that ' + (m[2] === 'f' ? 'file' : 'folder') + '.');

    const q = u.searchParams;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges,Content-Type');
    res.setHeader('X-Robots-Tag', 'noindex');
    const counts = req.method === 'GET' && !(req.headers.range && !/^bytes=0-/.test(req.headers.range));

    if (m[2] === 'f') {
      const name = segs[segs.length - 1] || '';
      if (!rel || !(isVideo(name) || isSub(name))) return plain(404, 'Only videos and subtitles can be opened with a direct link.');
      if (counts) { try { store.videoKeys.used(k.id, d.clientIp(req)); } catch (_) {} }
      res.setHeader('Content-Disposition', dispo(q.get('dl') === '1' ? 'attachment' : 'inline', name));
      res.setHeader('Cache-Control', 'no-store');
      return d.webdavStream(rel, req, res, { forceDirect: q.get('transcode') !== '1' || isSub(name) });
    }

    // folder → M3U8 playlist; every entry is a direct link made with the same key
    let list;
    try { list = await collect(rel, PLAYLIST_DEPTH, []); }
    catch (e) { return plain(502, 'Couldn’t read that folder: ' + e.message); }
    if (list == null) return plain(404, 'That folder isn’t there any more.');
    if (counts) { try { store.videoKeys.used(k.id, d.clientIp(req)); } catch (_) {} }
    const base = d.requestBaseUrl(req) + '/video/d/' + k.key + '/f/';
    const extra = q.get('transcode') === '1' ? '?transcode=1' : '';
    const title = (rel.split('/').pop() || 'Videos').replace(/[\r\n]+/g, ' ');
    const lines = ['#EXTM3U', '#PLAYLIST:' + title];
    for (const r of list) {
      lines.push('#EXTINF:-1,' + r.split('/').pop().replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' '));
      lines.push(base + enc(r) + extra);
    }
    const fname = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) + '.m3u8';
    res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': dispo('inline', fname) });
    return res.end(req.method === 'HEAD' ? undefined : lines.join('\n') + '\n');
  }

  /* ---------- signed-in API: /api/video/keys ---------- */
  async function api (req, res, u, me) {
    const p = u.pathname, send = (c, o) => d.sendJSON(res, c, o);
    const body = async () => { try { return JSON.parse(await d.readBody(req) || '{}') || {}; } catch (_) { return {}; } };
    if (p === '/api/video/keys' && req.method === 'GET') {
      const pol = policy();
      const out = { policy: pol, canCreate: canCreate(me, pol), keys: store.videoKeys.forUser(me.username).map(k => keyOut(k, true)) };
      if (me.role === 'admin' && u.searchParams.get('all') === '1') out.all = store.videoKeys.all().map(k => keyOut(k, false));
      return send(200, out);
    }
    if (p === '/api/video/keys' && req.method === 'POST') {
      const pol = policy();
      if (!pol.enabled) return send(400, { message: 'Direct links are turned off. An admin can turn them on in Direct links.' });
      if (!canCreate(me, pol)) return send(403, { message: 'Only admins can make direct links on this server.' });
      const b = await body();
      if (store.videoKeys.forUser(me.username).length >= MAX_KEYS) return send(400, { message: 'You have ' + MAX_KEYS + ' link keys already. Revoke one first.' });
      const e = d.linkExpiryFor(b.hours == null ? pol.defaultDays * 24 : b.hours, pol);
      if (e.error) return send(400, { message: e.error });
      const scope = b.scope ? cleanRel(b.scope) : '';
      if (scope == null) return send(400, { message: 'That file or folder can’t be shared.' });
      const scopeKind = scope ? (b.scopeKind === 'file' ? 'file' : 'folder') : '';
      if (scopeKind === 'file' && !(isVideo(scope) || isSub(scope))) return send(400, { message: 'Only videos can be shared.' });
      const label = String(b.label || '').trim().slice(0, 80) || (scope ? scope.split('/').pop() : 'Everything');
      const k = { id: crypto.randomBytes(8).toString('hex'), username: me.username, label, key: 'vl_' + crypto.randomBytes(24).toString('hex'), scope, scopeKind, created: Date.now(), expires: e.expires };
      store.videoKeys.create(k);
      return send(200, { ok: true, key: keyOut(store.videoKeys.byId(k.id), true) });
    }
    const m = p.match(/^\/api\/video\/keys\/([a-f0-9]{16})$/);
    if (m) {
      const k = store.videoKeys.byId(m[1]);
      const mine = k && String(k.username).toLowerCase() === String(me.username).toLowerCase();
      if (!k || (!mine && me.role !== 'admin')) return send(404, { message: 'Key not found' });
      if (req.method === 'DELETE') { store.videoKeys.remove(k.id); return send(200, { ok: true }); }
      if (req.method === 'POST') {
        if (!mine) return send(403, { message: 'Only the key’s owner can change it. You can revoke it.' });
        const b = await body(), f = {};
        if (b.label != null) f.label = String(b.label).trim().slice(0, 80) || k.label;
        if (b.hours != null) { const e = d.linkExpiryFor(b.hours, policy()); if (e.error) return send(400, { message: e.error }); f.expires = e.expires; }
        store.videoKeys.update(k.id, f);
        return send(200, { ok: true, key: keyOut(store.videoKeys.byId(k.id), true) });
      }
    }
    return false;
  }

  return {
    policy, nextPolicy, direct, api, inScope, cleanRel,
    prune: () => { try { store.videoKeys.prune(Date.now(), 30 * 86400000); } catch (_) {} },
    capAll: maxDays => { if (maxDays) try { store.videoKeys.capAll(Date.now() + maxDays * 86400000); } catch (_) {} },
    removeForUser: name => { try { store.videoKeys.removeForUser(name); } catch (_) {} },
    status: () => { const pol = policy(); let keys = 0; try { keys = store.videoKeys.all().filter(k => !(k.expires && k.expires <= Date.now())).length; } catch (_) {} return { enabled: pol.enabled, users: pol.users, activeKeys: keys }; }
  };
}

module.exports = { createVideoLinks, KEY_RE };
