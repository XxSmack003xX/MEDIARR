'use strict';
/*
 * Media cards for notifications (v2.17).
 *
 * Turns "🎬 Aliens Expanded — Added automatically from an RSS feed" into a card with the
 * poster, the plot, rating, runtime, genres, the episode (for TV), the file's quality and
 * links to IMDb, TMDB, Trakt, TVDB, Letterboxd or MusicBrainz — in each service's own
 * format (Discord embeds, Slack blocks, a Telegram photo, ntfy/Gotify markdown with the
 * poster attached, Pushover with the poster as its image).
 *
 *   build(ctx)  ctx = { svc: 'radarr'|'sonarr'|'lidarr', item, episodes, album, quality, size }
 *               → card | null   (fills gaps from Radarr/Sonarr and TMDB, never throws)
 *   payload(kind, target, ev, opts)  ev.card set → the service's request, or null to use the plain one
 */

const LINK_NAMES = { imdb: 'IMDb', tmdb: 'TMDB', trakt: 'Trakt', tvdb: 'TVDB', letterboxd: 'Letterboxd', musicbrainz: 'MusicBrainz' };
const DEFAULTS = { enabled: true, artwork: 'poster', links: { imdb: true, tmdb: true, trakt: true, tvdb: false, letterboxd: false, musicbrainz: true } };

function settings (c) {
  const m = Object.assign({}, DEFAULTS, (c && c.notify && c.notify.media) || {});
  const links = Object.assign({}, DEFAULTS.links, m.links || {});
  for (const k of Object.keys(links)) if (!LINK_NAMES[k]) delete links[k]; else links[k] = !!links[k];
  return { enabled: m.enabled !== false, artwork: ['poster', 'backdrop', 'none'].includes(m.artwork) ? m.artwork : 'poster', links };
}

const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
// only pictures the chat service can fetch itself: absolute http(s), not a LAN address
function publicImage (u) {
  u = String(u || '').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || !h.includes('.') ||
        /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1|\[?f[cd])/.test(h)) return '';
  } catch (_) { return ''; }
  return u.replace(/^http:\/\/image\.tmdb\.org/i, 'https://image.tmdb.org');
}
const tmdbSize = (u, size) => u.replace(/(image\.tmdb\.org\/t\/p\/)(original|w\d+)\//, '$1' + size + '/');
function pickImage (images, types) {
  if (!Array.isArray(images)) return '';
  for (const t of types) {
    const i = images.find(x => x && String(x.coverType || '').toLowerCase() === t);
    const u = i && publicImage(i.remoteUrl || i.url);
    if (u) return u;
  }
  return '';
}
function fmtRuntime (min) {
  min = Math.round(Number(min) || 0);
  if (min <= 0) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
}
function fmtSize (b) {
  b = Number(b) || 0;
  if (b <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (b >= 10 || i < 2 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i];
}
function fmtDate (d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t)) return '';
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
const epCode = e => 'S' + String(Number(e.seasonNumber) || 0).padStart(2, '0') + 'E' + String(Number(e.episodeNumber) || 0).padStart(2, '0');
function ratingText (r, tmdbVote) {
  const out = [];
  if (r && typeof r === 'object') {
    // Radarr v4+: { imdb:{value}, tmdb:{value}, rottenTomatoes:{value}, metacritic:{value} }; older/Sonarr: { value, votes }
    if (r.imdb && Number(r.imdb.value)) out.push(Number(r.imdb.value).toFixed(1) + ' IMDb');
    if (r.tmdb && Number(r.tmdb.value) && !out.length) out.push(Number(r.tmdb.value).toFixed(1) + ' TMDB');
    if (r.rottenTomatoes && Number(r.rottenTomatoes.value)) out.push(Math.round(Number(r.rottenTomatoes.value)) + '% RT');
    if (!out.length && Number(r.value) && (Number(r.votes) || 0) > 0) out.push(Number(r.value).toFixed(1) + '/10');
  }
  if (!out.length && Number(tmdbVote)) out.push(Number(tmdbVote).toFixed(1) + ' TMDB');
  return out.join(' · ');
}

function createNotifyMedia (d) {
  const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);

  async function build (ctx) {
    try { return await withTimeout(buildCard(ctx || {}), 8000); } catch (_) { return null; }
  }

  async function buildCard (ctx) {
    const svc = ctx.svc;
    let it = Object.assign({}, ctx.item || {});
    if (!svc || (!it.id && !it.title && !it.artistName && !it.tmdbId)) return null;
    const hasTmdb = !!(d.readConfig().tmdb || {}).apiKey;
    // the webhook or the add only carries part of the item; Radarr/Sonarr have the rest
    if ((svc === 'radarr' || svc === 'sonarr') && it.id && (!it.overview || !Array.isArray(it.images) || !it.images.length || !it.ratings)) {
      const got = await withTimeout(d.arrItem(svc, it.id), 5000);
      if (got && got.ok && got.item) it = Object.assign({}, got.item, it, { images: (it.images && it.images.length ? it.images : got.item.images), overview: it.overview || got.item.overview, ratings: it.ratings || got.item.ratings });
    }
    const card = { service: svc, facts: [], links: [] };

    if (svc === 'lidarr') {
      const artist = it.artistName || it.name || it.title || '';
      const al = ctx.album || null;
      card.kind = al ? 'album' : 'artist';
      card.title = al ? (al.title || '') : artist;
      card.subtitle = al ? artist : '';
      card.year = al ? String(al.releaseDate || '').slice(0, 4) : '';
      card.overview = clip((al && al.overview) || it.overview || '', 600);
      card.poster = pickImage(al && al.images, ['cover', 'poster']) || pickImage(it.images, ['poster', 'cover']);
      card.backdrop = pickImage(it.images, ['fanart', 'banner']);
      const genres = (al && al.genres && al.genres.length ? al.genres : it.genres) || [];
      if (genres.length) card.facts.push({ label: 'Genre', value: genres.slice(0, 3).join(', ') });
      if (al && al.albumType) card.facts.push({ label: 'Type', value: al.albumType });
      if (ctx.quality) card.facts.push({ label: 'Quality', value: ctx.quality + (ctx.size ? ' · ' + fmtSize(ctx.size) : '') });
      const mbArtist = it.foreignArtistId || it.mbId || '';
      const mbAlbum = al && (al.foreignAlbumId || '');
      if (mbAlbum) card.links.push({ id: 'musicbrainz', url: 'https://musicbrainz.org/release-group/' + encodeURIComponent(mbAlbum) });
      else if (mbArtist) card.links.push({ id: 'musicbrainz', url: 'https://musicbrainz.org/artist/' + encodeURIComponent(mbArtist) });
      card.url = card.links[0] ? card.links[0].url : '';
      return card.title ? card : null;
    }

    const isMovie = svc === 'radarr';
    let tm = null;
    if (hasTmdb && it.tmdbId && (!it.overview || !pickImage(it.images, ['poster']) || (isMovie && !it.runtime))) {
      tm = await withTimeout(d.tmdbJson((isMovie ? '/movie/' : '/tv/') + Number(it.tmdbId)), 4000);
    }
    card.kind = isMovie ? 'movie' : 'series';
    card.title = it.title || (tm && (tm.title || tm.name)) || '';
    card.year = it.year || (tm && String(tm.release_date || tm.first_air_date || '').slice(0, 4)) || '';
    card.overview = clip(it.overview || (tm && tm.overview) || '', 600);
    card.poster = pickImage(it.images, ['poster']) || (tm && tm.poster_path ? 'https://image.tmdb.org/t/p/w500' + tm.poster_path : '');
    card.backdrop = pickImage(it.images, ['fanart', 'banner']) || (tm && tm.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + tm.backdrop_path : '');
    if (card.poster) card.poster = tmdbSize(card.poster, 'w500');
    if (card.backdrop) card.backdrop = tmdbSize(card.backdrop, 'w1280');
    const imdbId = it.imdbId || (tm && (tm.imdb_id || (tm.external_ids && tm.external_ids.imdb_id))) || '';
    const tmdbId = it.tmdbId || (tm && tm.id) || '';
    const tvdbId = it.tvdbId || '';

    // the episode(s), for TV
    const eps = (ctx.episodes || []).filter(e => e && Number.isFinite(Number(e.episodeNumber)));
    if (!isMovie && eps.length) {
      card.kind = 'episode';
      if (eps.length === 1) {
        const e = eps[0];
        card.episode = { code: epCode(e), title: e.title || '', overview: clip(e.overview || '', 500), airDate: e.airDate || e.airDateUtc || '' };
        if (hasTmdb && tmdbId) {
          const te = await withTimeout(d.tmdbJson('/tv/' + Number(tmdbId) + '/season/' + Number(e.seasonNumber) + '/episode/' + Number(e.episodeNumber)), 4000);
          if (te) {
            if (!card.episode.title && te.name) card.episode.title = te.name;
            if (!card.episode.overview && te.overview) card.episode.overview = clip(te.overview, 500);
            if (te.still_path) card.still = 'https://image.tmdb.org/t/p/w780' + te.still_path;
            if (Number(te.vote_average) && (Number(te.vote_count) || 0) >= 3) card.episode.rating = Number(te.vote_average).toFixed(1);
          }
        }
      } else {
        const sorted = eps.slice().sort((a, b) => (a.seasonNumber - b.seasonNumber) || (a.episodeNumber - b.episodeNumber));
        card.episodes = sorted.slice(0, 8).map(e => epCode(e) + (e.title ? ' · ' + clip(e.title, 60) : ''));
        if (sorted.length > 8) card.episodes.push('and ' + (sorted.length - 8) + ' more');
      }
    }

    const rating = ratingText(it.ratings, tm && tm.vote_average);
    if (rating) card.facts.push({ label: 'Rating', value: rating });
    if (card.episode && card.episode.airDate) card.facts.push({ label: 'Aired', value: fmtDate(card.episode.airDate) });
    else if (isMovie) {
      const rel = it.digitalRelease || it.physicalRelease || it.inCinemas || it.releaseDate || (tm && tm.release_date);
      if (rel && fmtDate(rel)) card.facts.push({ label: 'Released', value: fmtDate(rel) });
    }
    const runtime = it.runtime || (tm && (tm.runtime || (Array.isArray(tm.episode_run_time) && tm.episode_run_time[0])));
    if (fmtRuntime(runtime)) card.facts.push({ label: 'Runtime', value: fmtRuntime(runtime) });
    const genres = (Array.isArray(it.genres) && it.genres.length ? it.genres : (tm && Array.isArray(tm.genres) ? tm.genres.map(g => g.name) : [])) || [];
    if (genres.length) card.facts.push({ label: 'Genre', value: genres.slice(0, 3).join(', ') });
    if (ctx.quality) card.facts.push({ label: 'Quality', value: ctx.quality + (ctx.size ? ' · ' + fmtSize(ctx.size) : '') });
    if (!isMovie) {
      const net = it.network || (tm && tm.networks && tm.networks[0] && tm.networks[0].name) || '';
      const seasons = (it.statistics && it.statistics.seasonCount) || (Array.isArray(it.seasons) ? it.seasons.filter(s => s.seasonNumber > 0).length : 0) || (tm && tm.number_of_seasons) || 0;
      const v = [net, seasons ? seasons + ' season' + (seasons === 1 ? '' : 's') : ''].filter(Boolean).join(' · ');
      if (v) card.facts.push({ label: 'Network', value: v });
    } else if (it.studio || (tm && tm.production_companies && tm.production_companies[0])) {
      card.facts.push({ label: 'Studio', value: it.studio || tm.production_companies[0].name });
    }
    if (it.certification) card.facts.push({ label: 'Rated', value: it.certification });
    card.facts = card.facts.slice(0, 6);

    const ep = eps.length === 1 ? eps[0] : null;
    if (imdbId) card.links.push({ id: 'imdb', url: 'https://www.imdb.com/title/' + encodeURIComponent(imdbId) + '/' });
    if (tmdbId) card.links.push({ id: 'tmdb', url: 'https://www.themoviedb.org/' + (isMovie ? 'movie/' : 'tv/') + Number(tmdbId) + (ep ? '/season/' + Number(ep.seasonNumber) + '/episode/' + Number(ep.episodeNumber) : '') });
    if (imdbId) card.links.push({ id: 'trakt', url: 'https://trakt.tv/search/imdb/' + encodeURIComponent(imdbId) });
    else if (tmdbId) card.links.push({ id: 'trakt', url: 'https://trakt.tv/search/tmdb/' + Number(tmdbId) + '?id_type=' + (isMovie ? 'movie' : 'show') });
    if (!isMovie && tvdbId) card.links.push({ id: 'tvdb', url: 'https://thetvdb.com/dereferrer/series/' + Number(tvdbId) });
    if (isMovie && tmdbId) card.links.push({ id: 'letterboxd', url: 'https://letterboxd.com/tmdb/' + Number(tmdbId) + '/' });
    card.url = card.links[0] ? card.links[0].url : '';
    return card.title ? card : null;
  }

  /* ---------- per-service formats ---------- */
  function shape (ev, opts) {
    const c = ev.card, s = opts.settings;
    const links = c.links.filter(l => s.links[l.id]).map(l => ({ name: LINK_NAMES[l.id], url: l.url }));
    const primary = links[0] ? links[0].url : '';
    const big = s.artwork === 'backdrop' ? (c.still || c.backdrop || '') : '';
    const small = s.artwork === 'none' ? '' : (s.artwork === 'backdrop' && big ? '' : (c.poster || ''));
    const epHead = c.episode ? c.episode.code + (c.episode.title ? ' · ' + c.episode.title : '') : '';
    const plot = c.episode ? (c.episode.overview || '') : c.overview;
    const svcName = { radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr' }[c.service] || '';
    return { c, links, primary, big, small, epHead, plot, svcName };
  }
  const escMd = s => String(s || '').replace(/([\\`*_~|>[\]])/g, '\\$1');   // Discord markdown
  const escSlack = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function payload (kind, target, ev, opts) {
    if (!ev.card) return null;
    const x = shape(ev, opts), c = x.c;
    const title = ev.title || c.title;
    const msg = ev.message || '';
    switch (kind) {
      case 'discord': {
        let desc = msg ? escMd(msg) : '';
        if (x.epHead) desc += (desc ? '\n\n' : '') + '**' + escMd(x.epHead) + '**';
        if (c.episodes && c.episodes.length) desc += (desc ? '\n\n' : '') + c.episodes.map(e => '• ' + escMd(e)).join('\n');
        if (x.plot) desc += (desc ? (x.epHead ? '\n' : '\n\n') : '') + escMd(x.plot);
        if (c.subtitle) desc = '*' + escMd(c.subtitle) + '*' + (desc ? '\n' + desc : '');
        const fields = c.facts.map(f => ({ name: f.label, value: clip(f.value, 200), inline: true }));
        if (x.links.length) fields.push({ name: 'Links', value: x.links.map(l => '[' + l.name + '](' + l.url + ')').join('  ·  '), inline: false });
        const embed = { title: clip(title, 250), description: desc.slice(0, 3800), color: opts.color, timestamp: new Date().toISOString(),
          fields: fields.slice(0, 10), footer: { text: 'MEDIARR' + (x.svcName ? ' · ' + x.svcName : '') } };
        if (x.primary) embed.url = x.primary;
        if (x.small) embed.thumbnail = { url: x.small };
        if (x.big) embed.image = { url: x.big };
        return { url: target.url, method: 'POST', json: { username: 'MEDIARR', embeds: [embed] } };
      }
      case 'slack': {
        const head = x.primary ? '*<' + x.primary + '|' + escSlack(title) + '>*' : '*' + escSlack(title) + '*';
        let text = head + (c.subtitle ? '\n_' + escSlack(c.subtitle) + '_' : '') + (msg ? '\n' + escSlack(msg) : '');
        if (x.epHead) text += '\n\n*' + escSlack(x.epHead) + '*';
        if (c.episodes && c.episodes.length) text += '\n' + c.episodes.map(e => '• ' + escSlack(e)).join('\n');
        if (x.plot) text += (x.epHead ? '\n' : '\n\n') + escSlack(x.plot);
        const sec = { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } };
        if (x.small) sec.accessory = { type: 'image', image_url: x.small, alt_text: clip(c.title, 100) || 'poster' };
        const blocks = [sec];
        if (x.big) blocks.push({ type: 'image', image_url: x.big, alt_text: clip(c.title, 100) || 'artwork' });
        const ctxEls = c.facts.map(f => ({ type: 'mrkdwn', text: '*' + escSlack(f.label) + ':* ' + escSlack(f.value) }));
        if (ctxEls.length) blocks.push({ type: 'context', elements: ctxEls.slice(0, 10) });
        if (x.links.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: x.links.map(l => '<' + l.url + '|' + l.name + '>').join('  ·  ') }] });
        return { url: target.url, method: 'POST', json: { text: title + (msg ? ' — ' + msg : ''), blocks } };
      }
      case 'telegram': {
        let botToken = target.url, chatId = target.extra || '';
        if (target.url.includes('|')) { const p2 = target.url.split('|'); botToken = p2[0]; chatId = p2[1]; }
        const pic = x.big || x.small;
        let h = '<b>' + escHtml(title) + '</b>' + (c.subtitle ? '\n<i>' + escHtml(c.subtitle) + '</i>' : '') + (msg ? '\n' + escHtml(msg) : '');
        if (x.epHead) h += '\n\n<b>' + escHtml(x.epHead) + '</b>';
        if (c.episodes && c.episodes.length) h += '\n' + c.episodes.map(e => '• ' + escHtml(e)).join('\n');
        const facts = c.facts.map(f => escHtml(f.label) + ': ' + escHtml(f.value)).join('\n');
        const links = x.links.map(l => '<a href="' + escHtml(l.url) + '">' + escHtml(l.name) + '</a>').join(' · ');
        const max = pic ? 1024 : 4096;
        // the plot gets whatever room the caption has left
        const tail = (facts ? '\n\n' + facts : '') + (links ? '\n\n' + links : '');
        const room = max - h.length - tail.length - 4;
        if (x.plot && room > 60) h += (x.epHead ? '\n' : '\n\n') + escHtml(clip(x.plot, room));
        h = (h + tail).slice(0, max);
        if (pic) return { url: 'https://api.telegram.org/bot' + botToken + '/sendPhoto', method: 'POST', json: { chat_id: chatId, photo: pic, caption: h, parse_mode: 'HTML' }, fallback: true };
        return { url: 'https://api.telegram.org/bot' + botToken + '/sendMessage', method: 'POST', json: { chat_id: chatId, text: h, parse_mode: 'HTML', disable_web_page_preview: true } };
      }
      case 'ntfy': {
        let body = (c.subtitle ? '_' + c.subtitle + '_\n' : '') + (msg || '');
        if (x.epHead) body += '\n\n**' + x.epHead + '**';
        if (c.episodes && c.episodes.length) body += '\n' + c.episodes.map(e => '- ' + e).join('\n');
        if (x.plot) body += (x.epHead ? '\n' : '\n\n') + x.plot;
        if (c.facts.length) body += '\n\n' + c.facts.map(f => '**' + f.label + ':** ' + f.value).join('  \n');
        // JSON publishing (POST to the server with the topic inside) takes any text, emoji included
        let pub;
        try {
          const t = new URL(target.url), segs = t.pathname.split('/').filter(Boolean);
          const topic = segs.pop();
          if (!topic) return null;
          t.pathname = '/' + segs.join('/');
          pub = { url: t.toString().replace(/\/(\?|$)/, '$1'), topic };
        } catch (_) { return null; }
        const json = { topic: pub.topic, title: title.slice(0, 250), message: (body.trim() || title).slice(0, 4000), markdown: true, priority: 3,
          tags: [ev.level === 'good' ? 'white_check_mark' : 'information_source'] };
        if (x.primary) json.click = x.primary;
        if (x.big || x.small) json.attach = x.big || x.small;
        if (x.links.length) json.actions = x.links.slice(0, 3).map(l => ({ action: 'view', label: l.name, url: l.url }));
        return { url: pub.url, method: 'POST', json };
      }
      case 'gotify': {
        let m = (c.subtitle ? '_' + c.subtitle + '_\n\n' : '') + (msg || '');
        if (x.small || x.big) m = '![](' + (x.big || x.small) + ')\n\n' + m;
        if (x.epHead) m += '\n\n**' + x.epHead + '**';
        if (c.episodes && c.episodes.length) m += '\n' + c.episodes.map(e => '- ' + e).join('\n');
        if (x.plot) m += (x.epHead ? '\n\n' : '\n\n') + x.plot;
        if (c.facts.length) m += '\n\n' + c.facts.map(f => '**' + f.label + ':** ' + f.value).join('  \n');
        if (x.links.length) m += '\n\n' + x.links.map(l => '[' + l.name + '](' + l.url + ')').join(' · ');
        const extras = { 'client::display': { contentType: 'text/markdown' } };
        if (x.primary) extras['client::notification'] = { click: { url: x.primary } };
        if (x.big || x.small) extras['client::notification'] = Object.assign(extras['client::notification'] || {}, { bigImageUrl: x.big || x.small });
        return { url: target.url, method: 'POST', json: { title, message: m.trim(), priority: 4, extras } };
      }
      case 'pushover': {
        let m = (c.subtitle ? '<i>' + escHtml(c.subtitle) + '</i>\n' : '') + escHtml(msg);
        if (x.epHead) m += '\n\n<b>' + escHtml(x.epHead) + '</b>';
        if (c.episodes && c.episodes.length) m += '\n' + c.episodes.map(e => '• ' + escHtml(e)).join('\n');
        if (x.plot) m += (x.epHead ? '\n' : '\n\n') + escHtml(clip(x.plot, 400));
        if (c.facts.length) m += '\n\n' + c.facts.map(f => '<b>' + escHtml(f.label) + ':</b> ' + escHtml(f.value)).join('\n');
        if (x.links.length > 1) m += '\n\n' + x.links.slice(1).map(l => '<a href="' + escHtml(l.url) + '">' + escHtml(l.name) + '</a>').join(' · ');
        const form = { token: (target.url || '').split('|')[0], user: (target.url || '').split('|')[1] || target.extra || '', title: title.slice(0, 250), message: m.trim().slice(0, 1024) || title, html: '1', priority: 0 };
        if (x.links[0]) { form.url = x.links[0].url; form.url_title = 'Open in ' + x.links[0].name; }
        return { url: 'https://api.pushover.net/1/messages.json', method: 'POST', form, attachUrl: x.big || x.small || '' };
      }
      case 'pushbullet': {
        let b = (c.subtitle ? c.subtitle + '\n' : '') + msg;
        if (x.epHead) b += '\n\n' + x.epHead;
        if (x.plot) b += '\n' + clip(x.plot, 400);
        if (c.facts.length) b += '\n\n' + c.facts.map(f => f.label + ': ' + f.value).join('\n');
        const json = x.primary ? { type: 'link', title, body: b.trim(), url: x.primary } : { type: 'note', title, body: b.trim() };
        return { url: 'https://api.pushbullet.com/v2/pushes', method: 'POST', headers: { 'Access-Token': target.url }, json };
      }
      case 'webhook': {
        const media = { kind: c.kind, service: c.service, title: c.title, subtitle: c.subtitle || '', year: c.year || '', overview: c.overview || '',
          poster: c.poster || '', backdrop: c.backdrop || '', still: c.still || '', episode: c.episode || null, episodes: c.episodes || null,
          facts: c.facts, links: x.links, url: x.primary };
        return { url: target.url, method: 'POST', json: { app: 'mediarr', event: ev.event || '', level: ev.level || 'info', title, message: msg, ts: Date.now(), media } };
      }
      default: return null;
    }
  }

  return { build, payload, settings };
}

module.exports = { createNotifyMedia, settings, publicImage, DEFAULTS, LINK_NAMES };
