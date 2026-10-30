'use strict';
/*
 * MEDIARR persistent store (v2.2+).
 *
 * Settings and accounts stay as human-editable JSON (config.json, users.json,
 * favorites.json, rss.json, autoadd.json). Fast-growing history and per-user
 * state live in one SQLite file, DATA_DIR/mediarr.db:
 *
 *   activity        add / play / admin audit log        (was adds.json, capped at 3,000)
 *   watch_progress  per-user playback positions          (was watch-progress.json)
 *   inbox, inbox_read  Notification Center                (was v2-state.json)
 *   errors          admin error log                      (was errors.json)
 *   plex_blocks     Plex stream-block events             (was blocked.json)
 *   kv              small documents: health history, 2.0 automation settings
 *                                                         (was health.json / v2-state.json)
 *   sessions        login sessions, so restarts and updates no longer sign people out.
 *                   Only a SHA-256 of each session token is stored.
 *   music_tracks    the music player's scanned library (a cache; rebuilt by rescanning)
 *   music_playlists, music_playlist_items, music_plays
 *                   per-user playlists and play counts (included in backups)
 *   music_meta      online album/artist matches, years, genres and downloaded art (a cache)
 *   music_keys      per-user keys for direct music links, each with its own expiry
 *
 * Uses Node's built-in node:sqlite (Node.js 22.13+), so MEDIARR still needs no
 * npm install. On first launch, migrateLegacy() imports the old JSON files, verifies
 * every record arrived, keeps a restorable backup of them, and then deletes them.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SCHEMA_VERSION = 4;   // 2 (v2.7): music library, playlists and play counts; 3 (v2.8): online music metadata; 4 (v2.10): music link keys
const LIMITS = { activity: 50000, errors: 2000, blocks: 5000, inbox: 2000, watchPerUser: 1000 };
// Old JSON files this store replaces. Deleted after a verified migration.
const LEGACY_FILES = ['adds.json', 'watch-progress.json', 'v2-state.json', 'errors.json', 'health.json', 'blocked.json'];
const LEGACY_LEFTOVERS = ['adds.json.tmp', 'watch-progress.json.tmp'];

function loadSqlite () {
  // node:sqlite prints an ExperimentalWarning on load in Node 22. The API MEDIARR
  // uses is stable in practice; hide only that one warning.
  const orig = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
    if (/SQLite is an experimental feature/i.test(msg)) return;
    return orig.call(this, warning, ...rest);
  };
  try { return require('node:sqlite'); }
  catch (e) {
    const err = new Error('MEDIARR 2.2+ needs Node.js 22.13 or newer for its built-in SQLite database (this is Node ' + process.version + '). ' +
      'Docker installs already include it; for a source install, upgrade Node.js.');
    err.code = 'MEDIARR_NO_SQLITE';
    throw err;
  } finally { process.emitWarning = orig; }
}

const j = v => JSON.stringify(v == null ? null : v);
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };
const str = (v, n) => v == null ? null : String(v).slice(0, n || 1000);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function open (dataDir, opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const { DatabaseSync } = loadSqlite();
  const file = path.join(dataDir, 'mediarr.db');
  const isNew = !fs.existsSync(file);
  const db = new DatabaseSync(file);
  if (isNew) { try { fs.chmodSync(file, 0o600); } catch (_) {} }
  // WAL gives fast, crash-safe writes. It is unavailable on some network
  // filesystems; SQLite then keeps its default rollback journal, which still works.
  try { db.exec('PRAGMA journal_mode=WAL'); } catch (_) {}
  db.exec('PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrateSchema(db);

  const S = {};   // prepared statements
  const prep = (k, sql) => S[k] || (S[k] = db.prepare(sql));
  function tx (fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  }

  /* ---------- kv ---------- */
  const kv = {
    get (key, def) { const r = prep('kvGet', 'SELECT value FROM kv WHERE key=?').get(key); return r ? parse(r.value, def) : def; },
    set (key, value) { prep('kvSet', 'INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, j(value)); },
    del (key) { prep('kvDel', 'DELETE FROM kv WHERE key=?').run(key); }
  };

  /* ---------- activity ---------- */
  let activityInserts = 0;
  function activityRow (e) {
    return [num(e.ts), str(e.username, 200), str(e.role, 20), str(e.service, 40), str(e.type, 40),
      str(e.title, 500), str(e.year, 20), str(e.ip, 80), j(e)];
  }
  const activity = {
    add (e) {
      if (!num(e.ts)) e = Object.assign({}, e, { ts: Date.now() });
      prep('actAdd', 'INSERT INTO activity(ts,username,role,service,type,title,year,ip,data) VALUES(?,?,?,?,?,?,?,?,?)').run(...activityRow(e));
      if (++activityInserts % 500 === 0) activity.prune();
    },
    prune () {
      prep('actPrune', 'DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET ?)').run(LIMITS.activity);
    },
    // newest first, same shape as the old adds.json array
    recent (limit) { return prep('actRecent', 'SELECT data FROM activity ORDER BY id DESC LIMIT ?').all(limit).map(r => parse(r.data, {})); },
    count () { return prep('actCount', 'SELECT count(*) c FROM activity').get().c; },
    countSince (username, since) {
      return prep('actCountSince', "SELECT count(*) c FROM activity WHERE username=? AND ts>=? AND type IS NOT 'play'").get(String(username || ''), since).c;
    },
    query ({ q, type, limit }) {
      const where = [], args = [];
      if (type && type !== 'all') {
        if (type === 'add') where.push("type IN ('movie','series')");
        else { where.push('type=?'); args.push(String(type)); }
      }
      if (q) {
        where.push("lower(coalesce(title,'')||' '||coalesce(username,'')||' '||coalesce(ip,'')||' '||coalesce(service,'')||' '||coalesce(type,'')) LIKE ? ESCAPE '\\'");
        args.push('%' + String(q).toLowerCase().replace(/[\\%_]/g, m => '\\' + m) + '%');
      }
      const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const total = db.prepare('SELECT count(*) c FROM activity' + w).get(...args).c;
      const rows = db.prepare('SELECT data FROM activity' + w + ' ORDER BY id DESC LIMIT ?').all(...args, Math.max(1, Math.min(5000, limit || 200)));
      return { adds: rows.map(r => parse(r.data, {})), total };
    },
    exportAll () { return activity.recent(LIMITS.activity); },
    // entries newest-first (adds.json order)
    replaceAll (entries) {
      tx(() => {
        db.exec('DELETE FROM activity');
        const ins = prep('actAdd', 'INSERT INTO activity(ts,username,role,service,type,title,year,ip,data) VALUES(?,?,?,?,?,?,?,?,?)');
        const list = (Array.isArray(entries) ? entries : []).slice(0, LIMITS.activity);
        for (let i = list.length - 1; i >= 0; i--) if (list[i] && typeof list[i] === 'object') ins.run(...activityRow(list[i]));
      });
    }
  };

  /* ---------- watch progress ---------- */
  const watch = {
    get (user, key) { const r = prep('wGet', 'SELECT data FROM watch_progress WHERE username=? AND key=?').get(user, key); return r ? parse(r.data, null) : null; },
    put (user, key, rec) {
      prep('wPut', 'INSERT INTO watch_progress(username,key,updated_at,data) VALUES(?,?,?,?) ON CONFLICT(username,key) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data')
        .run(user, key, num(rec.updatedAt) || Date.now(), j(rec));
      prep('wPrune', 'DELETE FROM watch_progress WHERE username=? AND key NOT IN (SELECT key FROM watch_progress WHERE username=? ORDER BY updated_at DESC LIMIT ?)')
        .run(user, user, LIMITS.watchPerUser);
    },
    forUser (user, limit) { return prep('wUser', 'SELECT data FROM watch_progress WHERE username=? ORDER BY updated_at DESC LIMIT ?').all(user, limit || LIMITS.watchPerUser).map(r => parse(r.data, {})); },
    exportAll () {
      const users = {};
      for (const r of prep('wAll', 'SELECT username,key,data FROM watch_progress ORDER BY username, updated_at DESC').all()) {
        (users[r.username] || (users[r.username] = {}))[r.key] = parse(r.data, {});
      }
      return { version: 1, users };
    },
    replaceAll (doc) {
      tx(() => {
        db.exec('DELETE FROM watch_progress');
        importWatch(doc);
      });
    }
  };
  function importWatch (doc) {
    const users = (doc && doc.users) || {};
    const ins = prep('wImport', 'INSERT INTO watch_progress(username,key,updated_at,data) VALUES(?,?,?,?) ON CONFLICT(username,key) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data WHERE excluded.updated_at >= watch_progress.updated_at');
    let n = 0;
    for (const [u, bucket] of Object.entries(users)) {
      for (const [k, rec] of Object.entries(bucket || {})) {
        if (!rec || typeof rec !== 'object') continue;
        ins.run(String(u).toLowerCase(), String(k), num(rec.updatedAt), j(rec)); n++;
      }
    }
    return n;
  }

  /* ---------- notification inbox ---------- */
  const inbox = {
    top () { const r = prep('ibTop', 'SELECT id,key,ts FROM inbox ORDER BY seq DESC LIMIT 1').get(); return r || null; },
    push (it) {
      prep('ibAdd', 'INSERT OR IGNORE INTO inbox(id,key,ts,event,title,message,level) VALUES(?,?,?,?,?,?,?)')
        .run(String(it.id), str(it.key, 1200), num(it.ts) || Date.now(), str(it.event, 60), str(it.title, 220), str(it.message, 800), str(it.level, 20));
      prep('ibPrune', 'DELETE FROM inbox WHERE seq <= (SELECT seq FROM inbox ORDER BY seq DESC LIMIT 1 OFFSET ?)').run(LIMITS.inbox);
    },
    // newest first; each item carries read:true/false for that user
    listFor (username, limit) {
      return prep('ibList', 'SELECT i.id,i.key,i.ts,i.event,i.title,i.message,i.level, (r.id IS NOT NULL) AS isread FROM inbox i LEFT JOIN inbox_read r ON r.id=i.id AND r.username=? ORDER BY i.seq DESC LIMIT ?')
        .all(String(username), limit || LIMITS.inbox)
        .map(r => ({ id: r.id, key: r.key, ts: r.ts, event: r.event, title: r.title, message: r.message, level: r.level, read: !!r.isread }));
    },
    markRead (username, ids, all) {
      tx(() => {
        if (all) prep('ibReadAll', 'INSERT OR IGNORE INTO inbox_read(username,id) SELECT ?, id FROM inbox').run(String(username));
        else { const ins = prep('ibRead', 'INSERT OR IGNORE INTO inbox_read(username,id) SELECT ?, id FROM inbox WHERE id=?'); for (const id of (ids || []).slice(0, 500)) ins.run(String(username), String(id)); }
      });
    },
    exportAll () {
      const items = prep('ibAll', 'SELECT id,key,ts,event,title,message,level FROM inbox ORDER BY seq DESC').all().map(r => Object.assign({}, r));
      const read = {};
      for (const r of prep('ibReadAllRows', 'SELECT username,id FROM inbox_read').all()) (read[r.username] || (read[r.username] = {}))[r.id] = true;
      return { inbox: items, read };
    }
  };
  function importInbox (doc) {
    const items = Array.isArray(doc && doc.inbox) ? doc.inbox : [];
    const ins = prep('ibImport', 'INSERT OR IGNORE INTO inbox(id,key,ts,event,title,message,level) VALUES(?,?,?,?,?,?,?)');
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]; if (!it || !it.id) continue;
      ins.run(String(it.id), str(it.key, 1200), num(it.ts), str(it.event, 60), str(it.title, 220), str(it.message, 800), str(it.level, 20));
    }
    const rd = prep('ibReadImport', 'INSERT OR IGNORE INTO inbox_read(username,id) SELECT ?, id FROM inbox WHERE id=?');
    for (const [u, ids] of Object.entries((doc && doc.read) || {})) for (const id of Object.keys(ids || {})) if (ids[id]) rd.run(String(u), String(id));
    return items.filter(x => x && x.id).length;
  }

  /* ---------- error log ---------- */
  const errors = {
    log (where, message, detail) {
      const now = Date.now();
      const top = prep('erTop', 'SELECT id,where_,message,last FROM errors ORDER BY id DESC LIMIT 1').get();
      // collapse repeats instead of flooding the log
      if (top && top.where_ === where && top.message === message && now - top.last < 300000) {
        prep('erBump', 'UPDATE errors SET count=count+1, last=? WHERE id=?').run(now, top.id);
        return { collapsed: true };
      }
      prep('erAdd', 'INSERT INTO errors(ts,last,count,where_,message,detail) VALUES(?,?,?,?,?,?)').run(now, now, 1, where, message, detail || '');
      prep('erPrune', 'DELETE FROM errors WHERE id <= (SELECT id FROM errors ORDER BY id DESC LIMIT 1 OFFSET ?)').run(LIMITS.errors);
      return { collapsed: false };
    },
    list ({ q, limit }) {
      const all = prep('erCount', 'SELECT count(*) c FROM errors').get().c;
      let rows = prep('erAll', 'SELECT ts,last,count,where_,message,detail FROM errors ORDER BY id DESC').all()
        .map(r => ({ ts: r.ts, last: r.last, count: r.count, where: r.where_, message: r.message, detail: r.detail }));
      if (q) rows = rows.filter(e => (e.where + ' ' + e.message + ' ' + e.detail).toLowerCase().includes(q));
      return { events: rows.slice(0, limit || 200), total: rows.length, all };
    },
    clear () { db.exec('DELETE FROM errors'); }
  };
  function importErrors (doc) {
    const ev = Array.isArray(doc && doc.events) ? doc.events : [];
    const ins = prep('erImport', 'INSERT INTO errors(ts,last,count,where_,message,detail) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM errors WHERE ts=? AND where_ IS ? AND message IS ?)');
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]; if (!e) continue;
      const w = str(e.where, 80) || '', m = str(e.message, 400) || '';
      ins.run(num(e.ts), num(e.last) || num(e.ts), num(e.count) || 1, w, m, str(e.detail, 600) || '', num(e.ts), w, m);
    }
    return ev.filter(Boolean).length;
  }

  /* ---------- Plex block log ---------- */
  const blocks = {
    add (ev) {
      prep('blAdd', 'INSERT INTO plex_blocks(ts,data) VALUES(?,?)').run(num(ev.ts) || Date.now(), j(ev));
      prep('blPrune', 'DELETE FROM plex_blocks WHERE id <= (SELECT id FROM plex_blocks ORDER BY id DESC LIMIT 1 OFFSET ?)').run(LIMITS.blocks);
    },
    recent (limit) { return prep('blRecent', 'SELECT data FROM plex_blocks ORDER BY id DESC LIMIT ?').all(limit || LIMITS.blocks).map(r => parse(r.data, {})); },
    clear () { db.exec('DELETE FROM plex_blocks'); },
    replaceAll (doc) { tx(() => { db.exec('DELETE FROM plex_blocks'); importBlocks(doc); }); }
  };
  function importBlocks (doc) {
    const ev = Array.isArray(doc && doc.events) ? doc.events : [];
    const ins = prep('blImport', 'INSERT INTO plex_blocks(ts,data) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM plex_blocks WHERE ts=? AND data=?)');
    for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i]; if (!e) continue; const d = j(e); ins.run(num(e.ts), d, num(e.ts), d); }
    return ev.filter(Boolean).length;
  }

  /* ---------- sessions (hashed tokens) ---------- */
  const sessions = {
    loadValid (now) {
      prep('ssExpire', 'DELETE FROM sessions WHERE expires < ?').run(now);
      return prep('ssAll', 'SELECT token_hash,username,expires,data FROM sessions').all()
        .map(r => ({ hash: r.token_hash, value: Object.assign(parse(r.data, {}), { username: r.username, expires: r.expires }) }));
    },
    put (hash, value) {
      const extra = { lastActivity: value.lastActivity || null, activity: value.activity || null };
      prep('ssPut', 'INSERT INTO sessions(token_hash,username,expires,data) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET username=excluded.username, expires=excluded.expires, data=excluded.data')
        .run(hash, String(value.username), num(value.expires), j(extra));
    },
    del (hash) { prep('ssDel', 'DELETE FROM sessions WHERE token_hash=?').run(hash); },
    clear () { db.exec('DELETE FROM sessions'); }
  };

  /* ---------- music library (v2.7) ---------- */
  const music = {
    allTracks () { return prep('mtAll', 'SELECT id,path,root,size,mtime,added_at,data FROM music_tracks').all(); },
    upsertTracks (rows) {
      if (!rows.length) return;
      tx(() => {
        const ins = prep('mtPut', 'INSERT INTO music_tracks(id,path,root,size,mtime,added_at,data) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path, root=excluded.root, size=excluded.size, mtime=excluded.mtime, data=excluded.data');
        for (const r of rows) ins.run(r.id, r.path, r.root, num(r.size), num(r.mtime), num(r.added_at) || Date.now(), j(r.data));
      });
    },
    deleteTracks (ids) {
      if (!ids.length) return;
      tx(() => { const del = prep('mtDel', 'DELETE FROM music_tracks WHERE id=?'); for (const id of ids) del.run(id); });
    },
    clearTracks () { db.exec('DELETE FROM music_tracks'); },
    trackCount () { return prep('mtCount', 'SELECT count(*) c FROM music_tracks').get().c; },
    /* play counts */
    played (username, id, ts) {
      prep('mpInc', 'INSERT INTO music_plays(username,track_id,count,last_at) VALUES(?,?,1,?) ON CONFLICT(username,track_id) DO UPDATE SET count=count+1, last_at=excluded.last_at')
        .run(String(username), String(id), num(ts) || Date.now());
    },
    playsFor (username) { return prep('mpUser', 'SELECT track_id id,count,last_at last FROM music_plays WHERE username=?').all(String(username)); },
    /* playlists */
    playlists (username) {
      return prep('plList', 'SELECT p.id,p.name,p.created_at created,p.updated_at updated,(SELECT count(*) FROM music_playlist_items i WHERE i.playlist_id=p.id) n FROM music_playlists p WHERE p.username=? ORDER BY lower(p.name)')
        .all(String(username)).map(r => Object.assign({}, r));
    },
    playlist (username, id) {
      const p = prep('plGet', 'SELECT id,name,created_at created,updated_at updated FROM music_playlists WHERE username=? AND id=?').get(String(username), String(id));
      if (!p) return null;
      const items = prep('plItems', 'SELECT track_id FROM music_playlist_items WHERE playlist_id=? ORDER BY pos').all(String(id)).map(r => r.track_id);
      return Object.assign({}, p, { items });
    },
    createPlaylist (username, name, items) {
      const id = crypto.randomBytes(8).toString('hex'), now = Date.now();
      tx(() => {
        prep('plNew', 'INSERT INTO music_playlists(id,username,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, String(username), str(name, 120), now, now);
        setItems(id, items || []);
      });
      return id;
    },
    renamePlaylist (username, id, name) {
      return prep('plRen', 'UPDATE music_playlists SET name=?, updated_at=? WHERE username=? AND id=?').run(str(name, 120), Date.now(), String(username), String(id)).changes > 0;
    },
    deletePlaylist (username, id) {
      return prep('plDel', 'DELETE FROM music_playlists WHERE username=? AND id=?').run(String(username), String(id)).changes > 0;
    },
    setPlaylistItems (username, id, items) {
      const p = prep('plOwn', 'SELECT id FROM music_playlists WHERE username=? AND id=?').get(String(username), String(id));
      if (!p) return false;
      tx(() => { setItems(id, items); prep('plTouch', 'UPDATE music_playlists SET updated_at=? WHERE id=?').run(Date.now(), String(id)); });
      return true;
    },
    exportAll () {
      const playlists = prep('plAll', 'SELECT id,username,name,created_at,updated_at FROM music_playlists ORDER BY username, lower(name)').all()
        .map(p => Object.assign({}, p, { items: prep('plItems', 'SELECT track_id FROM music_playlist_items WHERE playlist_id=? ORDER BY pos').all(p.id).map(r => r.track_id) }));
      const plays = prep('mpAll', 'SELECT username,track_id,count,last_at FROM music_plays').all().map(r => Object.assign({}, r));
      return { version: 1, playlists, plays };
    },
    importAll (doc, replace) {
      tx(() => {
        if (replace) db.exec('DELETE FROM music_playlist_items; DELETE FROM music_playlists; DELETE FROM music_plays;');
        const insP = prep('plImp', 'INSERT OR REPLACE INTO music_playlists(id,username,name,created_at,updated_at) VALUES(?,?,?,?,?)');
        for (const p of (doc && Array.isArray(doc.playlists) ? doc.playlists : [])) {
          if (!p || !p.id || !p.username) continue;
          insP.run(String(p.id), String(p.username), str(p.name, 120) || 'Playlist', num(p.created_at) || Date.now(), num(p.updated_at) || Date.now());
          setItems(String(p.id), Array.isArray(p.items) ? p.items : []);
        }
        const insC = prep('mpImp', 'INSERT INTO music_plays(username,track_id,count,last_at) VALUES(?,?,?,?) ON CONFLICT(username,track_id) DO UPDATE SET count=max(count,excluded.count), last_at=max(last_at,excluded.last_at)');
        for (const r of (doc && Array.isArray(doc.plays) ? doc.plays : [])) if (r && r.username && r.track_id) insC.run(String(r.username), String(r.track_id), num(r.count) || 1, num(r.last_at));
      });
      return (doc && Array.isArray(doc.playlists)) ? doc.playlists.length : 0;
    }
  };
  function setItems (id, items) {
    prep('plClear', 'DELETE FROM music_playlist_items WHERE playlist_id=?').run(String(id));
    const ins = prep('plAdd', 'INSERT INTO music_playlist_items(playlist_id,pos,track_id) VALUES(?,?,?)');
    (items || []).slice(0, 10000).forEach((t, i) => ins.run(String(id), i, String(t).slice(0, 64)));
  }

  /* ---------- online music metadata (v2.8, a cache) ---------- */
  const musicMeta = {
    all () {
      return prep('mmAll', 'SELECT key,kind,status,source,name,data,art,checked FROM music_meta').all()
        .map(r => ({ key: r.key, kind: r.kind, status: r.status, source: r.source || '', name: r.name || '', data: parse(r.data, {}), art: r.art || '', checked: r.checked || 0 }));
    },
    put (r) {
      prep('mmPut', 'INSERT INTO music_meta(key,kind,status,source,name,data,art,checked) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, status=excluded.status, source=excluded.source, name=excluded.name, data=excluded.data, art=excluded.art, checked=excluded.checked')
        .run(String(r.key), String(r.kind || ''), String(r.status || ''), str(r.source, 40) || '', str(r.name, 500) || '', j(r.data || {}), str(r.art, 200) || '', num(r.checked));
    },
    clear () { db.exec('DELETE FROM music_meta'); }
  };

  /* ---------- direct music link keys (v2.10) ---------- */
  const row2key = r => r && ({ id: r.id, username: r.username, label: r.label || '', key: r.key, created: r.created || 0, expires: r.expires || 0, lastUsed: r.last_used || 0, uses: r.uses || 0, lastIp: r.last_ip || '' });
  const musicKeys = {
    forUser (username) { return prep('mkUser', 'SELECT * FROM music_keys WHERE username=? ORDER BY created DESC').all(String(username)).map(row2key); },
    all () { return prep('mkAll', 'SELECT * FROM music_keys ORDER BY username, created DESC').all().map(row2key); },
    byKey (key) { return row2key(prep('mkByKey', 'SELECT * FROM music_keys WHERE key=?').get(String(key))) || null; },
    byId (id) { return row2key(prep('mkById', 'SELECT * FROM music_keys WHERE id=?').get(String(id))) || null; },
    create (k) {
      prep('mkNew', 'INSERT INTO music_keys(id,username,label,key,created,expires,last_used,uses,last_ip) VALUES(?,?,?,?,?,?,0,0,\'\')')
        .run(String(k.id), String(k.username), str(k.label, 80) || '', String(k.key), num(k.created) || Date.now(), num(k.expires));
    },
    update (id, fields) {
      if (fields.expires != null) prep('mkExp', 'UPDATE music_keys SET expires=? WHERE id=?').run(num(fields.expires), String(id));
      if (fields.label != null) prep('mkLabel', 'UPDATE music_keys SET label=? WHERE id=?').run(str(fields.label, 80) || '', String(id));
    },
    used (id, ip) { prep('mkUsed', 'UPDATE music_keys SET uses=uses+1, last_used=?, last_ip=? WHERE id=?').run(Date.now(), str(ip, 80) || '', String(id)); },
    remove (id) { return prep('mkDel', 'DELETE FROM music_keys WHERE id=?').run(String(id)).changes > 0; },
    removeForUser (username) { prep('mkDelUser', 'DELETE FROM music_keys WHERE username=?').run(String(username)); },
    // keys that ran out more than `keepMs` ago are dropped
    prune (now, keepMs) { prep('mkPrune', 'DELETE FROM music_keys WHERE expires>0 AND expires<?').run(now - keepMs); },
    capAll (maxExpires) { prep('mkCap', 'UPDATE music_keys SET expires=? WHERE expires=0 OR expires>?').run(num(maxExpires), num(maxExpires)); }
  };

  /* ---------- legacy import shared by migration and backup restore ---------- */
  function importLegacyDoc (name, doc) {
    switch (name) {
      case 'adds.json': {
        const list = Array.isArray(doc && doc.adds) ? doc.adds : [];
        const ins = prep('actImport', 'INSERT INTO activity(ts,username,role,service,type,title,year,ip,data) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM activity WHERE ts=? AND username IS ? AND type IS ? AND title IS ?)');
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i]; if (!e || typeof e !== 'object') continue;
          const row = activityRow(e);
          ins.run(...row, row[0], row[1], row[4], row[5]);
        }
        return list.filter(e => e && typeof e === 'object').length;
      }
      case 'watch-progress.json': return importWatch(doc);
      case 'v2-state.json': {
        const n = importInbox(doc);
        if (doc && doc.automation && typeof doc.automation === 'object') kv.set('v2.automation', Object.assign({}, kv.get('v2.automation', {}), doc.automation));
        return n;
      }
      case 'errors.json': return importErrors(doc);
      case 'blocked.json': return importBlocks(doc);
      case 'music.json': return music.importAll(doc, false);
      case 'health.json': {
        const cur = kv.get('health', null);
        const src = doc && typeof doc === 'object' ? doc : {};
        if (!cur) { kv.set('health', { services: src.services || {}, events: Array.isArray(src.events) ? src.events : [] }); }
        else {
          const seen = new Set((cur.events || []).map(e => e.service + '|' + e.downAt));
          const merged = (cur.events || []).concat((src.events || []).filter(e => e && !seen.has(e.service + '|' + e.downAt)))
            .sort((a, b) => (b.downAt || 0) - (a.downAt || 0));
          kv.set('health', { services: cur.services || src.services || {}, events: merged });
        }
        return Array.isArray(src.events) ? src.events.length : 0;
      }
      default: return 0;
    }
  }
  // Replace (restore) instead of merge.
  function restoreLegacyDoc (name, doc) {
    switch (name) {
      case 'adds.json': return activity.replaceAll(doc && doc.adds);
      case 'watch-progress.json': return watch.replaceAll(doc);
      case 'blocked.json': return blocks.replaceAll(doc);
      case 'music.json': return music.importAll(doc, true);
      case 'v2-state.json':
        tx(() => { db.exec('DELETE FROM inbox_read; DELETE FROM inbox;'); importInbox(doc); });
        if (doc && doc.automation) kv.set('v2.automation', doc.automation);
        return;
      default: return importLegacyDoc(name, doc);
    }
  }

  /* Verify every legacy record is now in the database. Returns '' or a reason. */
  function verifyLegacyDoc (name, doc) {
    if (name === 'adds.json') {
      const q = prep('actHas', 'SELECT 1 FROM activity WHERE ts=? AND username IS ? AND type IS ? AND title IS ? LIMIT 1');
      for (const e of (doc && doc.adds) || []) {
        if (!e || typeof e !== 'object') continue;
        const r = activityRow(e);
        if (!q.get(r[0], r[1], r[4], r[5])) return 'activity entry missing: ' + (e.title || e.ts);
      }
    } else if (name === 'watch-progress.json') {
      const q = prep('wHas', 'SELECT 1 FROM watch_progress WHERE username=? AND key=? LIMIT 1');
      for (const [u, b] of Object.entries((doc && doc.users) || {})) for (const k of Object.keys(b || {})) if (b[k] && typeof b[k] === 'object' && !q.get(String(u).toLowerCase(), k)) return 'watch progress missing for ' + u;
    } else if (name === 'v2-state.json') {
      const q = prep('ibHas', 'SELECT 1 FROM inbox WHERE id=? LIMIT 1');
      for (const it of (doc && doc.inbox) || []) if (it && it.id && !q.get(String(it.id))) return 'notification missing: ' + it.id;
    } else if (name === 'errors.json') {
      const q = prep('erHas', 'SELECT 1 FROM errors WHERE ts=? AND where_ IS ? AND message IS ? LIMIT 1');
      for (const e of (doc && doc.events) || []) if (e && !q.get(num(e.ts), str(e.where, 80) || '', str(e.message, 400) || '')) return 'error entry missing';
    } else if (name === 'blocked.json') {
      const q = prep('blHas', 'SELECT 1 FROM plex_blocks WHERE ts=? AND data=? LIMIT 1');
      for (const e of (doc && doc.events) || []) if (e && !q.get(num(e.ts), j(e))) return 'block event missing';
    } else if (name === 'health.json') {
      const h = kv.get('health', null);
      if (!h) return 'health history missing';
      const seen = new Set((h.events || []).map(e => e.service + '|' + e.downAt));
      for (const e of (doc && doc.events) || []) if (e && !seen.has(e.service + '|' + e.downAt)) return 'health event missing';
    }
    return '';
  }

  /*
   * First launch on 2.2: move the legacy JSON files into the database.
   *   1. Read every legacy file. Unreadable files are left untouched.
   *   2. Save a restorable backup containing all of them (kept, never auto-pruned).
   *   3. Import inside one transaction (safe to repeat: duplicates are skipped).
   *   4. Verify every record is present, then delete the legacy files.
   * If any step fails, the old files stay where they are and the next launch retries.
   */
  function migrateLegacy (backupDir, extraBackupFiles) {
    const present = LEGACY_FILES.filter(n => fs.existsSync(path.join(dataDir, n)));
    const leftovers = LEGACY_LEFTOVERS.filter(n => fs.existsSync(path.join(dataDir, n)));
    if (!present.length) {
      for (const n of leftovers) { try { fs.unlinkSync(path.join(dataDir, n)); } catch (_) {} }
      return null;
    }
    const docs = {}, unreadable = [];
    for (const n of present) {
      try { docs[n] = JSON.parse(fs.readFileSync(path.join(dataDir, n), 'utf8')); }
      catch (e) { unreadable.push(n); log('[migration] ' + n + ' could not be read (' + e.message + '); leaving it in place'); }
    }
    const names = Object.keys(docs);
    const result = { at: Date.now(), imported: {}, deleted: [], unreadable, backup: '' };
    if (!names.length) return result;

    // 2. backup in MEDIARR's normal backup format, so it can be restored from the admin page
    const files = {};
    for (const n of (extraBackupFiles || [])) { try { files[n] = JSON.parse(fs.readFileSync(path.join(dataDir, n), 'utf8')); } catch (_) {} }
    for (const n of names) files[n] = docs[n];
    const p2 = x => String(x).padStart(2, '0'), d = new Date();
    const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    const backupName = 'mediarr-config-' + stamp + '-pre-sqlite-migration.json';
    try {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const body = JSON.stringify({ app: 'mediarr-config-backup', version: 1, createdAt: d.toISOString(), reason: 'pre-sqlite-migration', host: os.hostname(), files }, null, 2);
      const tmp = path.join(backupDir, backupName + '.tmp');
      fs.writeFileSync(tmp, body, { mode: 0o600 });
      fs.renameSync(tmp, path.join(backupDir, backupName));
      result.backup = backupName;
    } catch (e) {
      log('[migration] could not write the safety backup (' + e.message + '); old files will be kept and migration retried next launch');
    }

    // 3 + 4. import and verify in one transaction
    try {
      tx(() => {
        for (const n of names) {
          result.imported[n] = importLegacyDoc(n, docs[n]);
          const problem = verifyLegacyDoc(n, docs[n]);
          if (problem) throw new Error(n + ': ' + problem);
        }
      });
    } catch (e) {
      log('[migration] import failed, nothing was deleted: ' + e.message);
      result.error = e.message;
      return result;
    }
    activity.prune();

    if (result.backup) {
      for (const n of names.concat(leftovers)) {
        try { fs.unlinkSync(path.join(dataDir, n)); result.deleted.push(n); }
        catch (e) { log('[migration] could not delete ' + n + ': ' + e.message); }
      }
    }
    kv.set('migration.sqlite', result);
    log('[migration] moved ' + names.map(n => n + ' (' + result.imported[n] + ')').join(', ') + ' into mediarr.db' +
      (result.backup ? '; backup: backups/' + result.backup : '') +
      (result.deleted.length ? '; removed: ' + result.deleted.join(', ') : '; old files kept'));
    return result;
  }

  function close () { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {} try { db.close(); } catch (_) {} }

  return { db, file, kv, activity, watch, inbox, errors, blocks, sessions, music, musicMeta, musicKeys, importLegacyDoc, restoreLegacyDoc, migrateLegacy, close, sha256, LIMITS, LEGACY_FILES };
}

function migrateSchema (db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v >= SCHEMA_VERSION) return;
  if (v < 1) db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, username TEXT, role TEXT, service TEXT,
      type TEXT, title TEXT, year TEXT, ip TEXT, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_user_ts ON activity(username, ts);
    CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);
    CREATE TABLE IF NOT EXISTS watch_progress (
      username TEXT NOT NULL, key TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (username, key));
    CREATE INDEX IF NOT EXISTS watch_user_updated ON watch_progress(username, updated_at);
    CREATE TABLE IF NOT EXISTS inbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, key TEXT, ts INTEGER,
      event TEXT, title TEXT, message TEXT, level TEXT);
    CREATE TABLE IF NOT EXISTS inbox_read (
      username TEXT NOT NULL, id TEXT NOT NULL REFERENCES inbox(id) ON DELETE CASCADE,
      PRIMARY KEY (username, id));
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, last INTEGER, count INTEGER,
      where_ TEXT, message TEXT, detail TEXT);
    CREATE TABLE IF NOT EXISTS plex_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL, data TEXT);
    PRAGMA user_version = 1;
    COMMIT;`);
  if (v < 2) db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS music_tracks (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, root TEXT, size INTEGER, mtime INTEGER,
      added_at INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS music_playlists (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL,
      created_at INTEGER, updated_at INTEGER);
    CREATE INDEX IF NOT EXISTS music_playlists_user ON music_playlists(username);
    CREATE TABLE IF NOT EXISTS music_playlist_items (
      playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
      pos INTEGER NOT NULL, track_id TEXT NOT NULL, PRIMARY KEY (playlist_id, pos));
    CREATE TABLE IF NOT EXISTS music_plays (
      username TEXT NOT NULL, track_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER, PRIMARY KEY (username, track_id));
    PRAGMA user_version = 2;
    COMMIT;`);
  if (v < 3) db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS music_meta (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, source TEXT, name TEXT,
      data TEXT, art TEXT, checked INTEGER);
    PRAGMA user_version = 3;
    COMMIT;`);
  if (v < 4) db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS music_keys (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, label TEXT, key TEXT NOT NULL UNIQUE,
      created INTEGER, expires INTEGER, last_used INTEGER, uses INTEGER, last_ip TEXT);
    CREATE INDEX IF NOT EXISTS music_keys_user ON music_keys(username);
    PRAGMA user_version = 4;
    COMMIT;`);
}

module.exports = { open, LEGACY_FILES, sha256 };
