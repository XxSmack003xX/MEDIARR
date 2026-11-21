'use strict';
/*
 * Library health (v2.20): finds movies and episodes that Plex has no video details for
 * (Plex shows "Resolution: None" — the file is gone, unreadable, empty or never analysed),
 * lists them, and repairs them:
 *
 *   1. the file is there → ask Plex to analyse it again (often all it needs)
 *   2. otherwise → Radarr/Sonarr: mark the release that produced it as failed (blocklist),
 *      delete the dead file, search for a replacement
 *   3. follow the replacement: downloading → imported → Plex rescans that folder → fixed
 *
 * State lives in <data>/media-health.json. Every step is written to the item's log.
 */
const fs = require('fs');
const path = require('path');

const PAGE = 400;                 // Plex items per request
const DEEP_AT_ONCE = 4;           // flagged items checked in detail at the same time
const FOLLOW_EVERY = Number(process.env.MEDIARR_HEALTH_FOLLOW_MS) || 3 * 60000;   // how often repairs in progress are checked (override for tests)
const GIVE_UP_SEARCH = 24 * 3600000;
const STOP_FOLLOWING = 7 * 24 * 3600000;
const PLEX_PICKUP = 2 * 3600000;  // after an import, how long to wait for Plex to show the new file
const REASONS = {
  'no-media': 'Plex has no file for it',
  'no-video': 'Plex shows Resolution: None',
  'empty-file': 'The file is empty (0 bytes)'
};
const FILE_STATES = { missing: 'File not found', unreadable: 'File can’t be read', present: 'File is there', unknown: 'Not checked' };
const DEFAULTS = { schedule: 'off', analyzeFirst: true, blocklist: true, autoRepair: false };

function createMediaHealth (d) {
  const FILE = path.join(d.dataDir, 'media-health.json');
  let st = load();
  let scanning = null, repairing = false, followTimer = null;

  function load () {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
    s = s && typeof s === 'object' ? s : {};
    s.scan = s.scan || { status: 'never' };
    if (s.scan.status === 'running') s.scan = Object.assign({}, s.scan, { status: 'error', error: 'MEDIARR restarted during the scan' });
    s.items = Array.isArray(s.items) ? s.items : [];
    s.fixed = Array.isArray(s.fixed) ? s.fixed : [];
    for (const it of s.items) if (it.repair && ['queued', 'analyzing', 'replacing'].includes(it.repair.state)) it.repair.state = 'queued';   // interrupted
    return s;
  }
  let saveT = null;
  function save (now) {
    const write = () => { saveT = null; try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(st)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { d.log('library health: could not save: ' + e.message); } };
    if (now) { clearTimeout(saveT); write(); } else if (!saveT) saveT = setTimeout(write, 500);
  }
  const cfg = () => Object.assign({}, DEFAULTS, (d.readConfig().mediaHealth) || {});
  const plexCfg = () => { const p = d.readConfig().plex || {}; return { base: p.url ? d.normUrl(p.url) : '', token: p.token || '' }; };

  /* ---------- Plex ---------- */
  async function plex (pathAndQuery, method, timeout) {
    const p = plexCfg();
    if (!p.base || !p.token) throw new Error('Plex isn’t set up in MEDIARR');
    const up = await d.upstream(p.base + pathAndQuery, { method: method || 'GET', headers: { 'X-Plex-Token': p.token, Accept: 'application/json' }, timeout: timeout || 60000 });
    if (up.status === 401) throw new Error('Plex refused the token');
    if (up.status === 404) { const e = new Error('not found'); e.status = 404; throw e; }
    if (up.status >= 400) throw new Error('Plex answered HTTP ' + up.status);
    const t = up.body ? up.body.toString('utf8') : '';
    if (!t.trim()) return {};
    try { return JSON.parse(t).MediaContainer || {}; } catch (_) { return {}; }
  }
  async function plexAll (sectionKey, type) {
    const out = []; let start = 0, total = Infinity;
    while (start < total) {
      const mc = await plex('/library/sections/' + encodeURIComponent(sectionKey) + '/all?type=' + type + '&includeGuids=1&X-Plex-Container-Start=' + start + '&X-Plex-Container-Size=' + PAGE, 'GET', 120000);
      const list = mc.Metadata || [];
      out.push.apply(out, list);
      total = Number(mc.totalSize != null ? mc.totalSize : (mc.size != null && list.length < PAGE ? start + list.length : Infinity));
      if (!list.length) break;
      start += list.length;
    }
    return out;
  }
  function guidsOf (m) {
    const g = {};
    for (const x of (m && m.Guid) || []) {
      const mm = /^(imdb|tmdb|tvdb):\/\/(.+)$/.exec(String(x.id || ''));
      if (mm) g[mm[1]] = mm[2];
    }
    // older agents put it in the main guid: com.plexapp.agents.imdb://tt123?lang=en
    const old = /agents\.(imdb|themoviedb|thetvdb):\/\/([^?/]+)/.exec(String((m && m.guid) || ''));
    if (old) { const k = old[1] === 'themoviedb' ? 'tmdb' : old[1] === 'thetvdb' ? 'tvdb' : 'imdb'; if (!g[k]) g[k] = old[2]; }
    return g;
  }
  // What Plex shows as the resolution: "None" in Plex when it has no videoResolution (and no size to work it out from),
  // even when it knows the codec. That's the test, so the list matches what Plex shows.
  const hasRes = v => { const s = String(v == null ? '' : v).trim().toLowerCase(); return !!s && s !== 'none' && s !== 'unknown' && s !== '0'; };
  const hasVideo = md => !!(md && (hasRes(md.videoResolution) || (Number(md.width) > 0 && Number(md.height) > 0)));
  function partsOf (m) { const ps = []; for (const md of (m.Media || [])) for (const p of (md.Part || [])) ps.push(p); return ps; }
  // why this item is dead, or '' when it has a usable version
  function verdict (m) {
    const media = (m.Media || []).filter(md => !md.deletedAt);
    if (!media.length) return 'no-media';
    if (media.some(hasVideo)) return '';
    const parts = partsOf({ Media: media });
    if (parts.length && parts.every(p => Number(p.size) === 0)) return 'empty-file';
    return 'no-video';
  }
  function fileStateOf (m) {
    const parts = partsOf(m);
    if (!parts.length) return 'missing';
    if (parts.some(p => p.exists === true || p.exists === 1 || p.exists === '1')) {
      return parts.some(p => (p.exists === true || p.exists === 1 || p.exists === '1') && !(p.accessible === false || p.accessible === 0 || p.accessible === '0')) ? 'present' : 'unreadable';
    }
    if (parts.some(p => p.exists === false || p.exists === 0 || p.exists === '0')) return 'missing';
    return 'unknown';
  }

  /* ---------- Radarr / Sonarr ---------- */
  const arrOn = svc => { const c = d.readConfig()[svc] || {}; return !!(c.url && c.apiKey); };
  async function arr (svc, method, p, body) {
    const c = d.readConfig()[svc] || {};
    if (!c.url || !c.apiKey) return { ok: false, status: 0, message: svc + ' isn’t set up' };
    const buf = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { 'X-Api-Key': c.apiKey, Accept: 'application/json' };
    if (buf) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = buf.length; }
    try {
      const up = await d.upstream(d.normUrl(c.url) + p, { method, headers, body: buf || undefined, timeout: 60000 });
      const t = up.body ? up.body.toString('utf8') : '';
      let j = null; try { j = t ? JSON.parse(t) : null; } catch (_) {}
      if (up.status >= 400) {
        let msg = 'HTTP ' + up.status;
        if (Array.isArray(j) && j[0]) msg = j[0].errorMessage || j[0].message || msg; else if (j && j.message) msg = j.message;
        return { ok: false, status: up.status, message: msg };
      }
      return { ok: true, status: up.status, data: j };
    } catch (e) { return { ok: false, status: 0, message: e.message }; }
  }
  const list = r => (r && r.ok ? (Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.records) ? r.data.records : [])) : []);
  const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

  async function arrIndex () {
    const ix = { movies: null, series: null, episodes: new Map() };
    if (arrOn('radarr')) {
      const r = await d.arrListAll('radarr', '/api/v3/movie');
      if (r.ok) {
        ix.movies = { tmdb: new Map(), imdb: new Map(), title: new Map() };
        for (const m of r.items) {
          if (m.tmdbId) ix.movies.tmdb.set(String(m.tmdbId), m);
          if (m.imdbId) ix.movies.imdb.set(String(m.imdbId), m);
          ix.movies.title.set(norm(m.title) + '|' + (m.year || ''), m);
        }
      }
    }
    if (arrOn('sonarr')) {
      const r = await d.arrListAll('sonarr', '/api/v3/series');
      if (r.ok) {
        ix.series = { tvdb: new Map(), imdb: new Map(), tmdb: new Map(), title: new Map() };
        for (const s of r.items) {
          if (s.tvdbId) ix.series.tvdb.set(String(s.tvdbId), s);
          if (s.imdbId) ix.series.imdb.set(String(s.imdbId), s);
          if (s.tmdbId) ix.series.tmdb.set(String(s.tmdbId), s);
          ix.series.title.set(norm(s.title), s);
        }
      }
    }
    return ix;
  }
  async function seriesEpisodes (ix, seriesId) {
    if (!ix.episodes.has(seriesId)) ix.episodes.set(seriesId, list(await arr('sonarr', 'GET', '/api/v3/episode?seriesId=' + seriesId)));
    return ix.episodes.get(seriesId);
  }
  async function matchArr (ix, it) {
    if (it.kind === 'movie') {
      if (!ix.movies) return null;
      const g = it.guids || {};
      const m = (g.tmdb && ix.movies.tmdb.get(String(g.tmdb))) || (g.imdb && ix.movies.imdb.get(String(g.imdb))) || ix.movies.title.get(norm(it.title) + '|' + (it.year || ''));
      return m ? { svc: 'radarr', id: m.id, title: m.title, year: m.year, monitored: !!m.monitored, hasFile: !!m.hasFile, fileId: m.movieFile ? m.movieFile.id : (m.movieFileId || 0) } : null;
    }
    if (!ix.series) return null;
    const g = it.showGuids || {};
    const s = (g.tvdb && ix.series.tvdb.get(String(g.tvdb))) || (g.imdb && ix.series.imdb.get(String(g.imdb))) || (g.tmdb && ix.series.tmdb.get(String(g.tmdb))) || ix.series.title.get(norm(it.show));
    if (!s) return null;
    const ep = (await seriesEpisodes(ix, s.id)).find(e => e.seasonNumber === it.season && e.episodeNumber === it.episode);
    return { svc: 'sonarr', id: s.id, title: s.title, episodeId: ep ? ep.id : 0, monitored: ep ? !!ep.monitored : false, hasFile: ep ? !!ep.hasFile : false, fileId: ep ? (ep.episodeFileId || 0) : 0 };
  }

  /* ---------- scanning ---------- */
  const itemId = m => 'plex:' + m.ratingKey;
  function brief (m, kind, sec, why, showGuids) {
    const parts = partsOf(m);
    const it = { id: itemId(m), kind, ratingKey: String(m.ratingKey), sectionKey: String(sec.key), sectionTitle: sec.title || '',
      title: kind === 'episode' ? (m.title || '') : (m.title || ''), year: m.year || null, thumb: m.thumb || m.parentThumb || m.grandparentThumb || '',
      guids: guidsOf(m), reasons: [why], file: parts[0] && parts[0].file ? String(parts[0].file) : '', size: parts.reduce((a, p) => a + (Number(p.size) || 0), 0),
      addedAt: m.addedAt ? m.addedAt * 1000 : null };
    if (kind === 'episode') Object.assign(it, { show: m.grandparentTitle || '', showKey: String(m.grandparentRatingKey || ''), season: Number(m.parentIndex), episode: Number(m.index), showGuids: showGuids || {} });
    return it;
  }
  async function scan (why) {
    if (scanning) return scanning;
    const t0 = Date.now();
    st.scan = { status: 'running', startedAt: t0, why: why || 'manual', progress: { phase: 'Reading your Plex libraries', done: 0, total: 0 } };
    save();
    scanning = (async () => {
      const found = [];
      const counts = { movies: 0, episodes: 0, sections: 0 };
      const sections = (await plex('/library/sections')).Directory || [];
      const usable = sections.filter(s => s.type === 'movie' || s.type === 'show');
      if (!usable.length) throw new Error('Plex has no movie or TV libraries');
      for (const sec of usable) {
        counts.sections++;
        st.scan.progress = { phase: 'Checking ' + (sec.title || 'a library'), done: counts.movies + counts.episodes, total: 0 };
        if (sec.type === 'movie') {
          const all = await plexAll(sec.key, 1);
          counts.movies += all.length;
          for (const m of all) { const why = verdict(m); if (why) found.push(brief(m, 'movie', sec, why)); }
        } else {
          const shows = await plexAll(sec.key, 2);
          const sg = new Map(shows.map(s => [String(s.ratingKey), guidsOf(s)]));
          const eps = await plexAll(sec.key, 4);
          counts.episodes += eps.length;
          for (const m of eps) { const why = verdict(m); if (why) found.push(brief(m, 'episode', sec, why, sg.get(String(m.grandparentRatingKey)))); }
        }
        save();
      }
      // a closer look at each one: is the file there at all?
      st.scan.progress = { phase: 'Checking the files of ' + found.length + ' item' + (found.length === 1 ? '' : 's'), done: 0, total: found.length };
      let next = 0;
      const worker = async () => {
        while (next < found.length) {
          const it = found[next++];
          try {
            const mc = await plex('/library/metadata/' + encodeURIComponent(it.ratingKey) + '?checkFiles=1&includeGuids=1', 'GET', 30000);
            const m = (mc.Metadata || [])[0];
            if (m) { it.fileState = fileStateOf(m); if (!it.file) { const p = partsOf(m)[0]; if (p && p.file) it.file = String(p.file); } }
            else it.fileState = 'unknown';
          } catch (e) { it.fileState = 'unknown'; }
          st.scan.progress.done++;
        }
      };
      await Promise.all(Array.from({ length: DEEP_AT_ONCE }, worker));
      // who can replace it
      st.scan.progress = { phase: 'Matching with Radarr and Sonarr', done: 0, total: found.length };
      const ix = await arrIndex();
      for (const it of found) { try { it.arr = await matchArr(ix, it); } catch (_) { it.arr = null; } st.scan.progress.done++; }
      // keep what we knew about items found before
      const before = new Map(st.items.map(x => [x.id, x]));
      const now = Date.now();
      const items = found.map(it => {
        const old = before.get(it.id);
        return Object.assign(it, { firstSeen: old ? old.firstSeen : now, lastSeen: now, repair: old ? old.repair : null, ignored: old ? !!old.ignored : false });
      });
      // anything we were repairing that Plex now plays: fixed
      const stillDead = new Set(items.map(x => x.id));
      for (const old of st.items) {
        if (stillDead.has(old.id)) continue;
        if (old.repair && !['fixed'].includes(old.repair.state)) addFixed(old, 'Plex has video details for it now');
      }
      const newOnes = items.filter(x => !before.has(x.id) && !x.ignored);
      st.items = items;
      st.scan = { status: 'done', why: why || 'manual', startedAt: t0, finishedAt: Date.now(), counts: Object.assign(counts, { found: items.length, new: newOnes.length }) };
      save(true);
      d.log('library health: ' + counts.movies + ' movies and ' + counts.episodes + ' episodes checked, ' + items.length + ' without video details');
      if (newOnes.length && d.notify) {
        const mv = newOnes.filter(x => x.kind === 'movie').length, ep = newOnes.length - mv;
        d.notify('jobs', '🩺 Library health', 'Found ' + [mv ? mv + ' movie' + (mv === 1 ? '' : 's') : '', ep ? ep + ' episode' + (ep === 1 ? '' : 's') : ''].filter(Boolean).join(' and ') + ' that Plex has no video details for. See Library health in MEDIARR.', 'warn');
      }
      if (cfg().autoRepair) { const ids = items.filter(x => !x.ignored && !x.repair).map(x => x.id); if (ids.length) queueRepair(ids, 'automatic'); }
      return st.scan;
    })().catch(e => {
      st.scan = { status: 'error', why: why || 'manual', startedAt: t0, finishedAt: Date.now(), error: e.message };
      save(true);
      d.log('library health: scan failed: ' + e.message);
      return st.scan;
    }).finally(() => { scanning = null; });
    return scanning;
  }

  /* ---------- repairing ---------- */
  function step (it, text, state) {
    it.repair = it.repair || { state: 'queued', steps: [] };
    it.repair.steps.push({ at: Date.now(), text });
    if (it.repair.steps.length > 40) it.repair.steps.splice(0, it.repair.steps.length - 40);
    if (state) it.repair.state = state;
    it.repair.updatedAt = Date.now();
    save();
  }
  function addFixed (it, how) {
    const done = Object.assign({}, it, { fixedAt: Date.now(), how });
    if (done.repair) { done.repair = Object.assign({}, done.repair, { state: 'fixed' }); done.repair.steps = (done.repair.steps || []).concat([{ at: Date.now(), text: how }]); }
    st.fixed.unshift(done);
    if (st.fixed.length > 200) st.fixed.length = 200;
    if (d.notify) d.notify('jobs', '🩹 Repaired: ' + label(it), how, 'good', it.arr ? { svc: it.arr.svc, item: { id: it.arr.id, title: it.arr.title } } : undefined);
  }
  const label = it => it.kind === 'episode' ? (it.show + ' S' + String(it.season).padStart(2, '0') + 'E' + String(it.episode).padStart(2, '0')) : (it.title + (it.year ? ' (' + it.year + ')' : ''));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function queueRepair (ids, who) {
    const want = new Set(ids);
    let n = 0;
    for (const it of st.items) {
      if (!want.has(it.id) || it.ignored) continue;
      if (it.repair && ['queued', 'analyzing', 'replacing', 'searching', 'downloading', 'imported'].includes(it.repair.state)) continue;
      it.repair = { state: 'queued', steps: [], startedAt: Date.now(), by: who || '' };
      step(it, 'Queued for repair' + (who ? ' (' + who + ')' : ''));
      n++;
    }
    save(true);
    runQueue();
    return n;
  }
  async function runQueue () {
    if (repairing) return;
    repairing = true;
    try {
      for (;;) {
        const it = st.items.find(x => x.repair && x.repair.state === 'queued' && !x.ignored);
        if (!it) break;
        try { await repairOne(it); } catch (e) { step(it, 'Stopped: ' + e.message, 'failed'); }
        await sleep(400);
      }
    } finally { repairing = false; }
    followSoon();
  }
  async function plexItem (it) {
    try { const mc = await plex('/library/metadata/' + encodeURIComponent(it.ratingKey) + '?checkFiles=1', 'GET', 30000); return (mc.Metadata || [])[0] || null; } catch (e) { return e.status === 404 ? false : null; }
  }
  async function repairOne (it) {
    const o = cfg();
    // 1. the file is there: maybe Plex just never read it properly
    if (o.analyzeFirst && (it.fileState === 'present' || it.fileState === 'unknown' || !it.fileState) && it.reasons[0] !== 'no-media') {
      step(it, 'Asking Plex to analyse the file again', 'analyzing');
      try { await plex('/library/metadata/' + encodeURIComponent(it.ratingKey) + '/analyze', 'PUT', 30000); } catch (e) { step(it, 'Plex couldn’t start the analysis: ' + e.message); }
      for (let i = 0; i < 12; i++) {
        await sleep(i < 3 ? 3000 : 5000);
        const m = await plexItem(it);
        if (m && !verdict(m)) {
          step(it, 'Plex read the file: it has video details now', 'fixed');
          addFixed(it, 'Plex analysed the file again and it plays');
          st.items = st.items.filter(x => x !== it); save(true);
          return;
        }
        if (m) it.fileState = fileStateOf(m);
      }
      step(it, 'Still no video details after the analysis (' + (FILE_STATES[it.fileState] || it.fileState).toLowerCase() + ')');
    }
    // 2. a replacement from Radarr / Sonarr
    if (!it.arr) {
      const ix = await arrIndex();
      it.arr = await matchArr(ix, it).catch(() => null);
    }
    if (!it.arr) { step(it, it.kind === 'movie' ? 'This movie isn’t in Radarr, so MEDIARR can’t get a replacement. Add it to Radarr, or replace the file yourself.' : 'This show or episode isn’t in Sonarr, so MEDIARR can’t get a replacement.', 'manual'); return; }
    if (it.kind === 'episode' && !it.arr.episodeId) { step(it, 'Sonarr has the show but not this episode (S' + it.season + 'E' + it.episode + ').', 'manual'); return; }
    step(it, 'Getting a replacement through ' + (it.arr.svc === 'radarr' ? 'Radarr' : 'Sonarr'), 'replacing');
    return it.arr.svc === 'radarr' ? replaceMovie(it, o) : replaceEpisode(it, o);
  }
  async function markFailed (svc, records, it) {
    const grab = records.filter(r => String(r.eventType).toLowerCase() === 'grabbed' || r.eventType === 1)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (!grab) { step(it, 'No download of it in ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') + '’s history to blocklist'); return; }
    const r = await arr(svc, 'POST', '/api/v3/history/failed/' + grab.id);
    step(it, r.ok ? 'Blocklisted the release it came from, so it isn’t downloaded again' + (grab.sourceTitle ? ': ' + grab.sourceTitle : '') : 'Couldn’t blocklist the old release (' + r.message + ')');
  }
  async function replaceMovie (it, o) {
    const id = it.arr.id;
    const mv = await arr('radarr', 'GET', '/api/v3/movie/' + id);
    if (!mv.ok) throw new Error('Radarr: ' + mv.message);
    const m = mv.data || {};
    const fileId = m.movieFile ? m.movieFile.id : (m.movieFileId || 0);
    it.repair.oldFileId = fileId || 0;
    if (o.blocklist) await markFailed('radarr', list(await arr('radarr', 'GET', '/api/v3/history/movie?movieId=' + id)), it);
    if (fileId) {
      const del = await arr('radarr', 'DELETE', '/api/v3/moviefile/' + fileId);
      step(it, del.ok || del.status === 404 ? 'Removed the dead file from Radarr' + (m.movieFile && m.movieFile.relativePath ? ' (' + m.movieFile.relativePath + ')' : '') : 'Couldn’t remove the old file (' + del.message + ')');
    } else step(it, 'Radarr has no file for it');
    if (!m.monitored) {
      const ed = await arr('radarr', 'PUT', '/api/v3/movie/editor', { movieIds: [id], monitored: true });
      step(it, ed.ok ? 'Turned on monitoring in Radarr so it can be replaced' : 'Couldn’t turn on monitoring (' + ed.message + ')');
    }
    const cmd = await d.arrCommand('radarr', { name: 'MoviesSearch', movieIds: [id] });
    if (!cmd.ok) throw new Error('Radarr search: ' + cmd.message);
    it.repair.searchAt = Date.now();
    step(it, 'Radarr is searching for a replacement', 'searching');
  }
  async function replaceEpisode (it, o) {
    const sid = it.arr.id, eid = it.arr.episodeId;
    const ep = await arr('sonarr', 'GET', '/api/v3/episode/' + eid);
    if (!ep.ok) throw new Error('Sonarr: ' + ep.message);
    const e = ep.data || {};
    const fileId = e.episodeFileId || 0;
    it.repair.oldFileId = fileId;
    if (o.blocklist) await markFailed('sonarr', list(await arr('sonarr', 'GET', '/api/v3/history/series?seriesId=' + sid + '&seasonNumber=' + it.season)).filter(r => r.episodeId === eid), it);
    if (fileId) {
      // a file shared by several episodes: the other dead ones are being replaced by the same search
      const del = await arr('sonarr', 'DELETE', '/api/v3/episodefile/' + fileId);
      step(it, del.ok ? 'Removed the dead file from Sonarr' : del.status === 404 ? 'The dead file was already removed' : 'Couldn’t remove the old file (' + del.message + ')');
    } else step(it, 'Sonarr has no file for it');
    if (!e.monitored) {
      const mo = await arr('sonarr', 'PUT', '/api/v3/episode/monitor', { episodeIds: [eid], monitored: true });
      step(it, mo.ok ? 'Turned on monitoring for the episode in Sonarr' : 'Couldn’t turn on monitoring (' + mo.message + ')');
    }
    const cmd = await d.arrCommand('sonarr', { name: 'EpisodeSearch', episodeIds: [eid] });
    if (!cmd.ok) throw new Error('Sonarr search: ' + cmd.message);
    it.repair.searchAt = Date.now();
    step(it, 'Sonarr is searching for a replacement', 'searching');
  }

  /* ---------- following replacements ---------- */
  function followSoon () {
    if (followTimer) return;
    const active = st.items.some(x => x.repair && ['searching', 'downloading', 'imported', 'no-release'].includes(x.repair.state));
    if (!active) return;
    followTimer = setTimeout(() => { followTimer = null; follow().catch(() => {}).finally(followSoon); }, FOLLOW_EVERY);
    if (followTimer.unref) followTimer.unref();
  }
  async function follow () {
    const now = Date.now();
    for (const it of st.items.slice()) {
      const r = it.repair;
      if (!r || !['searching', 'downloading', 'imported', 'no-release'].includes(r.state)) continue;
      if (now - (r.searchAt || r.startedAt || now) > STOP_FOLLOWING) { step(it, 'Stopped following after 7 days. ' + (it.arr.svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' keeps looking for it.', 'no-release'); r.stale = true; continue; }
      if (r.stale) continue;
      try { await followOne(it, now); } catch (e) { /* try again next time */ }
    }
    save(true);
  }
  async function followOne (it, now) {
    const r = it.repair, svc = it.arr.svc;
    if (r.state !== 'imported') {
      let hasFile = false, fileId = 0, file = '';
      if (svc === 'radarr') { const m = await arr('radarr', 'GET', '/api/v3/movie/' + it.arr.id); if (m.ok && m.data) { hasFile = !!m.data.hasFile; fileId = m.data.movieFile ? m.data.movieFile.id : 0; file = m.data.movieFile ? (m.data.movieFile.relativePath || '') : ''; } }
      else { const e = await arr('sonarr', 'GET', '/api/v3/episode/' + it.arr.episodeId); if (e.ok && e.data) { hasFile = !!e.data.hasFile; fileId = e.data.episodeFileId || 0; } }
      if (hasFile && fileId && fileId !== r.oldFileId) {
        r.newFileId = fileId; r.importedAt = now;
        step(it, 'Replacement downloaded and imported' + (file ? ': ' + file : ''), 'imported');
        await plexRescan(it);
      } else {
        const q = list(await arr(svc, 'GET', svc === 'radarr' ? '/api/v3/queue/details?movieId=' + it.arr.id : '/api/v3/queue/details?seriesId=' + it.arr.id))
          .filter(x => svc === 'radarr' || x.episodeId === it.arr.episodeId);
        if (q.length) {
          const x = q[0];
          const pct = x.size ? Math.round(100 * (1 - (x.sizeleft || 0) / x.size)) : null;
          const txt = 'Downloading' + (x.title ? ' ' + x.title : '') + (pct != null ? ' (' + pct + '%)' : '');
          if (r.state !== 'downloading' || r.lastQueue !== txt) { r.lastQueue = txt; step(it, txt, 'downloading'); }
        } else if (r.state === 'downloading') {
          step(it, 'The download left the queue without being imported; ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' will try another release', 'searching');
        } else if (r.state === 'searching' && now - (r.searchAt || now) > GIVE_UP_SEARCH) {
          step(it, 'No replacement found in 24 hours. ' + (svc === 'radarr' ? 'Radarr' : 'Sonarr') + ' keeps watching for one.', 'no-release');
        }
      }
    }
    if (it.repair.state === 'imported') {
      const m = await plexItem(it);
      if (m && !verdict(m)) {
        step(it, 'Plex plays the new file', 'fixed');
        addFixed(it, 'Replaced with a new download');
        st.items = st.items.filter(x => x !== it);
      } else if (m === false) {
        step(it, 'Plex rebuilt the entry for the new file', 'fixed');
        addFixed(it, 'Replaced with a new download');
        st.items = st.items.filter(x => x !== it);
      } else if (now - (r.importedAt || now) > PLEX_PICKUP && !r.pickupWarned) {
        r.pickupWarned = true;
        step(it, 'Plex hasn’t picked up the new file yet. Scanning that library in Plex usually does it.');
        await plexRescan(it);
      }
    }
  }
  async function plexRescan (it) {
    const dir = it.file ? it.file.replace(/[\\/][^\\/]*$/, '') : '';
    try {
      await plex('/library/sections/' + encodeURIComponent(it.sectionKey) + '/refresh' + (dir ? '?path=' + encodeURIComponent(dir) : ''), 'GET', 30000);
      step(it, 'Asked Plex to scan ' + (dir ? 'the folder' : 'the library') + ' for the new file');
    } catch (e) { step(it, 'Couldn’t ask Plex to scan: ' + e.message); }
  }

  /* ---------- schedule ---------- */
  function due () {
    const c = cfg();
    if (c.schedule === 'off' || scanning) return false;
    const every = c.schedule === 'daily' ? 86400000 : 7 * 86400000;
    const last = st.scan.finishedAt || st.scan.startedAt || 0;
    return Date.now() - last > every;
  }
  const tick = setInterval(() => { if (due() && plexCfg().base) scan('scheduled'); }, 30 * 60000);
  if (tick.unref) tick.unref();
  setTimeout(() => { runQueue(); followSoon(); }, 5000).unref();

  /* ---------- API ---------- */
  function out (it) {
    return Object.assign({}, it, { reasonText: (it.reasons || []).map(r => REASONS[r] || r), fileText: FILE_STATES[it.fileState || 'unknown'], label: label(it) });
  }
  function status () {
    const items = st.items.map(out);
    const c = cfg(), p = plexCfg();
    return {
      ready: !!(p.base && p.token), radarr: arrOn('radarr'), sonarr: arrOn('sonarr'),
      settings: c, scan: st.scan,
      summary: {
        total: items.filter(x => !x.ignored).length,
        movies: items.filter(x => !x.ignored && x.kind === 'movie').length,
        episodes: items.filter(x => !x.ignored && x.kind === 'episode').length,
        missing: items.filter(x => !x.ignored && x.fileState === 'missing').length,
        repairing: items.filter(x => x.repair && ['queued', 'analyzing', 'replacing', 'searching', 'downloading', 'imported'].includes(x.repair.state)).length,
        ignored: items.filter(x => x.ignored).length,
        fixed: st.fixed.length
      },
      items, fixed: st.fixed.slice(0, 50).map(out)
    };
  }
  function csv () {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Type', 'Title', 'Year', 'Show', 'Season', 'Episode', 'Library', 'Problem', 'File', 'File path', 'Size (bytes)', 'In Radarr/Sonarr', 'Repair', 'First found']];
    for (const it of st.items) rows.push([it.kind, it.title, it.year || '', it.show || '', it.season != null ? it.season : '', it.episode != null ? it.episode : '', it.sectionTitle,
      (it.reasons || []).map(r => REASONS[r] || r).join('; '), FILE_STATES[it.fileState || 'unknown'], it.file, it.size, it.arr ? (it.arr.svc === 'radarr' ? 'Radarr' : 'Sonarr') : 'No',
      it.ignored ? 'ignored' : (it.repair ? it.repair.state : ''), it.firstSeen ? new Date(it.firstSeen).toISOString() : '']);
    return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  async function handle (req, res, u, me) {
    const p = u.pathname, send = (c, o) => d.sendJSON(res, c, o);
    if (!p.startsWith('/api/admin/health')) return false;
    if (!me || me.role !== 'admin') return send(403, { message: 'Admins only' }), true;
    const body = async () => { try { return JSON.parse(await d.readBody(req) || '{}') || {}; } catch (_) { return {}; } };
    if (p === '/api/admin/health' && req.method === 'GET') return send(200, status()), true;
    if (p === '/api/admin/health/export.csv' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mediarr-library-health-' + new Date().toISOString().slice(0, 10) + '.csv"', 'Cache-Control': 'no-store' });
      res.end(csv()); return true;
    }
    if (p === '/api/admin/health/scan' && req.method === 'POST') {
      if (!plexCfg().base || !plexCfg().token) return send(400, { message: 'Connect Plex in Settings first (address and token).' }), true;
      if (scanning) return send(200, { ok: true, running: true }), true;
      scan('by ' + me.username);
      return send(202, { ok: true, running: true }), true;
    }
    if (p === '/api/admin/health/repair' && req.method === 'POST') {
      const b = await body();
      const ids = b.all ? st.items.filter(x => !x.ignored).map(x => x.id) : (Array.isArray(b.ids) ? b.ids.map(String) : []);
      if (!ids.length) return send(400, { message: 'Choose what to repair' }), true;
      return send(200, { ok: true, queued: queueRepair(ids, me.username) }), true;
    }
    if (p === '/api/admin/health/ignore' && req.method === 'POST') {
      const b = await body(), ids = new Set(Array.isArray(b.ids) ? b.ids.map(String) : []), on = b.ignore !== false;
      let n = 0;
      for (const it of st.items) if (ids.has(it.id)) { it.ignored = on; n++; if (on && it.repair && it.repair.state === 'queued') it.repair.state = 'cancelled'; }
      save(true);
      return send(200, { ok: true, changed: n }), true;
    }
    if (p === '/api/admin/health/settings' && req.method === 'POST') {
      const b = await body(), cur = d.readConfig(), next = Object.assign({}, DEFAULTS, cur.mediaHealth || {});
      if (['off', 'daily', 'weekly'].includes(b.schedule)) next.schedule = b.schedule;
      for (const k of ['analyzeFirst', 'blocklist', 'autoRepair']) if (b[k] != null) next[k] = !!b[k];
      cur.mediaHealth = next; d.writeConfig(cur);
      return send(200, { ok: true, settings: next }), true;
    }
    return false;
  }

  return { handle, scan, status, queueRepair, _state: () => st, _follow: follow, _verdict: verdict };
}

module.exports = { createMediaHealth, REASONS };
