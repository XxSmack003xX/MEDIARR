'use strict';
/*
 * MEDIARR music tag reader (v2.7).
 *
 * Reads tags, duration, codec details and the location of embedded cover art
 * without loading whole files: only headers and tag blocks are read.
 *
 *   MP3 / MP2      ID3v2.2–2.4, ID3v1, APEv2; Xing/Info/VBRI or CBR duration
 *   FLAC           STREAMINFO, Vorbis comments, PICTURE blocks
 *   Ogg            Vorbis and Opus (comments, METADATA_BLOCK_PICTURE, granule duration)
 *   MP4 / M4A      iTunes ilst atoms (AAC, ALAC, …), mvhd duration, covr art
 *   WAV, AIFF      fmt/COMM, LIST INFO and embedded ID3 chunks
 *
 * Everything else (WMA, APE, WavPack, Musepack, DSD, Matroska, …) is read with
 * ffprobe when it is installed. MEDIARR's Docker image includes it.
 */
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const ID3_GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
  'Folk', 'Folk-Rock', 'National Folk', 'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass', 'Avantgarde', 'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic',
  'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam', 'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle',
  'Duet', 'Punk Rock', 'Drum Solo', 'A Cappella', 'Euro-House', 'Dance Hall', 'Goa', 'Drum & Bass', 'Club-House', 'Hardcore', 'Terror', 'Indie', 'BritPop', 'Negerpunk', 'Polsk Punk', 'Beat', 'Christian Gangsta Rap', 'Heavy Metal', 'Black Metal', 'Crossover',
  'Contemporary Christian', 'Christian Rock', 'Merengue', 'Salsa', 'Thrash Metal', 'Anime', 'JPop', 'Synthpop', 'Abstract', 'Art Rock', 'Baroque', 'Bhangra', 'Big Beat', 'Breakbeat', 'Chillout', 'Downtempo', 'Dub', 'EBM', 'Eclectic', 'Electro',
  'Electroclash', 'Emo', 'Experimental', 'Garage', 'Global', 'IDM', 'Illbient', 'Industro-Goth', 'Jam Band', 'Krautrock', 'Leftfield', 'Lounge', 'Math Rock', 'New Romantic', 'Nu-Breakz', 'Post-Punk', 'Post-Rock', 'Psytrance', 'Shoegaze', 'Space Rock',
  'Trop Rock', 'World Music', 'Neoclassical', 'Audiobook', 'Audio Theatre', 'Neue Deutsche Welle', 'Podcast', 'Indie Rock', 'G-Funk', 'Dubstep', 'Garage Rock', 'Psybient'];

/* ---------- file access ---------- */
async function openReader (file) {
  const fh = await fsp.open(file, 'r');
  const st = await fh.stat();
  return {
    size: st.size,
    async read (pos, len) {
      if (pos < 0 || pos >= st.size || len <= 0) return Buffer.alloc(0);
      len = Math.min(len, st.size - pos);
      const b = Buffer.allocUnsafe(len);
      const { bytesRead } = await fh.read(b, 0, len, pos);
      return bytesRead === len ? b : b.subarray(0, bytesRead);
    },
    close () { return fh.close().catch(() => {}); }
  };
}
function bufReader (buf) {
  return { size: buf.length, async read (pos, len) { return buf.subarray(Math.max(0, pos), Math.max(0, pos) + Math.max(0, len)); }, close () {} };
}

/* ---------- small helpers ---------- */
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
function deunsync (b) {
  const out = Buffer.allocUnsafe(b.length); let j = 0;
  for (let i = 0; i < b.length; i++) { out[j++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return out.subarray(0, j);
}
function utf16 (b, defaultBE) {
  let be = !!defaultBE, s = 0;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { be = false; s = 2; } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { be = true; s = 2; }
  let x = b.subarray(s); if (x.length % 2) x = x.subarray(0, x.length - 1);
  if (!be) return x.toString('utf16le');
  const sw = Buffer.from(x); sw.swap16(); return sw.toString('utf16le');
}
// ID3 text with its encoding byte. Returns every value (ID3v2.4 separates them with NULs).
function id3Text (enc, b) {
  let s;
  if (enc === 1 || enc === 2) {
    // split on 16-bit NULs; each part may carry its own BOM
    const parts = []; let st = 0;
    for (let i = 0; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) { parts.push(b.subarray(st, i)); st = i + 2; }
    parts.push(b.subarray(st));
    return parts.map(p => utf16(p, enc === 2)).map(clean).filter(Boolean);
  }
  s = enc === 3 ? b.toString('utf8') : b.toString('latin1');
  return s.split('\0').map(clean).filter(Boolean);
}
function clean (s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f﻿]/g, ' ').replace(/\s+/g, ' ').trim(); }
function intOf (v) { const m = /^\s*(\d{1,4})/.exec(String(v == null ? '' : v)); return m ? Number(m[1]) : 0; }
function pairOf (v) {   // "3/12" → [3, 12]
  const m = /^\s*(\d{1,4})?\s*(?:\/\s*(\d{1,4}))?/.exec(String(v == null ? '' : v));
  return m ? [Number(m[1] || 0), Number(m[2] || 0)] : [0, 0];
}
function genreName (g) {
  g = clean(g);
  // ID3 references: "(17)", "(17)Rock", "17", "(RX)", "(CR)"
  const m = /^\((\d{1,3})\)(.*)$/.exec(g);
  if (m) return clean(m[2]) || ID3_GENRES[Number(m[1])] || '';
  if (/^\d{1,3}$/.test(g)) return ID3_GENRES[Number(g)] || '';
  if (g === '(RX)' || g === 'RX') return 'Remix';
  if (g === '(CR)' || g === 'CR') return 'Cover';
  return g;
}
function setTag (tags, key, value, multiJoin) {
  if (value == null) return;
  if (Array.isArray(value)) value = value.filter(Boolean);
  if (Array.isArray(value)) { if (!value.length) return; value = multiJoin ? value.join(multiJoin) : value[0]; }
  value = clean(value);
  if (value && !tags[key]) tags[key] = value;
}

/* ---------- ID3v2 ---------- */
const ID3_MAP = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumartist', TP2: 'albumartist',
  TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year', TDRC: 'year', TDRL: 'year',
  TORY: 'origyear', TDOR: 'origyear', TRCK: 'track', TRK: 'track', TPOS: 'disc', TPA: 'disc', TCMP: 'compilation', TCP: 'compilation',
  TXXX: 'txxx', TXX: 'txxx'
};
function apicHead (b, isV22) {
  if (b.length < 4) return null;
  const enc = b[0]; let p = 1, mime;
  if (isV22) { const f = b.toString('latin1', 1, 4).toUpperCase(); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
  else { const z = b.indexOf(0, 1); if (z < 0) return null; mime = b.toString('latin1', 1, z).toLowerCase() || 'image/jpeg'; p = z + 1; }
  if (mime === 'jpg' || mime === 'image/jpg') mime = 'image/jpeg';
  if (mime === 'png') mime = 'image/png';
  if (mime === '-->') return null;   // linked, not embedded
  const type = b[p]; p++;
  if (enc === 1 || enc === 2) { while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2; p += 2; }
  else { const z = b.indexOf(0, p); if (z < 0) return null; p = z + 1; }
  if (p > b.length) return null;
  return { mime, type, headLen: p };
}
async function parseId3v2 (r, base, out) {
  const h = await r.read(base, 10);
  if (h.length < 10 || h.toString('latin1', 0, 3) !== 'ID3') return 0;
  const ver = h[3], flags = h[5], size = syncsafe(h, 6);
  const end = base + 10 + size + ((flags & 0x10) ? 10 : 0);
  if (ver < 2 || ver > 4) return end;
  out.hasId3v2 = true;
  let pos = base + 10, limit = base + 10 + size, body = null;
  if ((flags & 0x80) && ver < 4) {   // whole-tag unsynchronisation (ID3v2.2/2.3)
    if (size > 32 * 1024 * 1024) return end;
    body = deunsync(await r.read(pos, size)); pos = 0; limit = body.length;
  }
  const rd = body ? async (p, l) => body.subarray(p, p + l) : (p, l) => r.read(p, l);
  if (ver >= 3 && (flags & 0x40)) {
    const e = await rd(pos, 4); if (e.length < 4) return end;
    pos += ver === 4 ? syncsafe(e, 0) : e.readUInt32BE(0) + 4;
  }
  const hl = ver === 2 ? 6 : 10;
  let artType = -1;
  while (pos + hl <= limit) {
    const fh = await rd(pos, hl); if (fh.length < hl || fh[0] === 0) break;
    const id = fh.toString('latin1', 0, ver === 2 ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsz = ver === 2 ? fh.readUIntBE(3, 3) : fh.readUInt32BE(4);
    if (ver === 4 && !((fh[4] | fh[5] | fh[6] | fh[7]) & 0x80)) fsz = syncsafe(fh, 4);   // some writers use plain sizes in 2.4
    const fflags = ver === 2 ? 0 : fh.readUInt16BE(8);
    const dataPos = pos + hl;
    if (fsz <= 0 || dataPos + fsz > limit) break;
    const packed = ver === 4 ? (fflags & 0x000c) : ver === 3 ? (fflags & 0x00c0) : 0;   // compressed or encrypted
    const dli = (ver === 4 && (fflags & 0x0001)) ? 4 : 0;
    const frameUnsync = ver === 4 && (fflags & 0x0002);
    if (!packed) {
      if (id === 'APIC' || id === 'PIC') {
        const head = await rd(dataPos + dli, Math.min(fsz - dli, 1024));
        const pic = apicHead(head, id === 'PIC');
        if (pic && (artType !== 3) && (artType < 0 || pic.type === 3)) {
          artType = pic.type;
          out.art = (body || frameUnsync) ? { kind: 'embed' } : { kind: 'range', off: dataPos + dli + pic.headLen, len: fsz - dli - pic.headLen, mime: pic.mime };
        }
      } else if (ID3_MAP[id] && fsz < 262144) {
        let d = await rd(dataPos + dli, fsz - dli);
        if (frameUnsync) d = deunsync(d);
        const vals = d.length ? id3Text(d[0], d.subarray(1)) : [];
        const key = ID3_MAP[id];
        if (key === 'txxx') {
          const desc = (vals[0] || '').toUpperCase().replace(/[_ ]/g, '');
          if (desc === 'ALBUMARTIST') setTag(out.tags, 'albumartist', vals[1]);
          else if (desc === 'COMPILATION') setTag(out.tags, 'compilation', vals[1]);
          else if (desc === 'DISCNUMBER') setTag(out.tags, 'disc', vals[1]);
        } else if (key === 'genre') setTag(out.tags, 'genre', vals.map(genreName).filter(Boolean));
        else setTag(out.tags, key, vals, key === 'artist' ? ', ' : null);
      }
    }
    pos = dataPos + fsz;
  }
  return end;
}

/* ---------- ID3v1 / APEv2 at the end of a file ---------- */
async function parseTail (r, out) {
  let end = r.size;
  const t = await r.read(r.size - 128, 128);
  if (t.length === 128 && t.toString('latin1', 0, 3) === 'TAG') {
    end -= 128;
    if (!out.hasId3v2 || !out.tags.title) {
      const s = (a, b) => clean(t.toString('latin1', a, b).split('\0')[0]);
      setTag(out.tags, 'title', s(3, 33)); setTag(out.tags, 'artist', s(33, 63)); setTag(out.tags, 'album', s(63, 93)); setTag(out.tags, 'year', s(93, 97));
      if (t[125] === 0 && t[126]) setTag(out.tags, 'track', String(t[126]));
      if (t[127] < ID3_GENRES.length) setTag(out.tags, 'genre', ID3_GENRES[t[127]]);
    }
  }
  const f = await r.read(end - 32, 32);
  if (f.length === 32 && f.toString('latin1', 0, 8) === 'APETAGEX') {
    const size = f.readUInt32LE(12), count = f.readUInt32LE(16), flags = f.readUInt32LE(20);
    const start = end - size;
    if (size > 32 && size < 16 * 1024 * 1024 && start >= 0) {
      const b = await r.read(start, size - 32);
      parseApeItems(b, count, out, start);
      end = start - ((flags & 0x80000000) ? 32 : 0);
    }
  }
  return end;
}
function parseApeItems (b, count, out, fileOff) {
  let p = 0;
  for (let n = 0; n < count && p + 8 < b.length; n++) {
    const len = b.readUInt32LE(p), fl = b.readUInt32LE(p + 4);
    const z = b.indexOf(0, p + 8); if (z < 0) break;
    const key = b.toString('latin1', p + 8, z).toUpperCase().replace(/[_ ]/g, '');
    const vp = z + 1; if (vp + len > b.length) break;
    if (((fl >> 1) & 3) === 0) {
      const v = b.toString('utf8', vp, vp + len).split('\0');
      const k = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumartist', GENRE: 'genre', YEAR: 'year', TRACK: 'track', DISC: 'disc', COMPILATION: 'compilation' }[key];
      if (k) setTag(out.tags, k, v, k === 'artist' ? ', ' : null);
    } else if (key === 'COVERART(FRONT)' && !out.art) {
      const zz = b.indexOf(0, vp);
      if (zz > 0 && zz < vp + len) out.art = { kind: 'range', off: fileOff + zz + 1, len: vp + len - zz - 1, mime: '' };
    }
    p = vp + len;
  }
}

/* ---------- MPEG audio (MP3/MP2) ---------- */
const BR = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mpegHeader (b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3, layerBits = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (bri === 0 || bri === 15 || sri === 3) return null;
  const table = BR[(ver === 3 ? '1' : '2') + '-' + (ver === 3 ? layer : (layer === 1 ? 1 : 2))];
  const bitrate = table[bri], sampleRate = SR[ver][sri];
  const spf = layer === 1 ? 384 : (layer === 3 && ver !== 3) ? 576 : 1152;
  const frameLen = layer === 1 ? (Math.floor(12 * bitrate * 1000 / sampleRate) + pad) * 4 : Math.floor(spf / 8 * bitrate * 1000 / sampleRate) + pad;
  const mono = (b[i + 3] >> 6) === 3;
  const sideInfo = layer !== 3 ? 0 : ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  return { ver, layer, bitrate, sampleRate, spf, frameLen, channels: mono ? 1 : 2, sideInfo };
}
async function mpegInfo (r, start, audioEnd, out) {
  const buf = await r.read(start, 131072);
  for (let i = 0; i + 4 <= buf.length; i++) {
    const h = mpegHeader(buf, i); if (!h || h.frameLen < 24) continue;
    const n = i + h.frameLen;
    if (n + 4 <= buf.length) { const h2 = mpegHeader(buf, n); if (!h2 || h2.sampleRate !== h.sampleRate || h2.ver !== h.ver || h2.layer !== h.layer) continue; }
    else if (start + n + 4 < audioEnd) continue;
    let frames = 0;
    const xo = i + 4 + h.sideInfo;
    const xt = buf.toString('latin1', xo, xo + 4);
    if ((xt === 'Xing' || xt === 'Info') && xo + 12 <= buf.length && (buf.readUInt32BE(xo + 4) & 1)) frames = buf.readUInt32BE(xo + 8);
    else if (buf.toString('latin1', i + 36, i + 40) === 'VBRI' && i + 54 <= buf.length) frames = buf.readUInt32BE(i + 50);
    const bytes = Math.max(0, audioEnd - (start + i));
    if (frames) { out.duration = frames * h.spf / h.sampleRate; out.bitrate = out.duration ? Math.round(bytes * 8 / out.duration) : 0; out.vbr = xt === 'Xing' || !xt; }
    else { out.duration = bytes * 8 / (h.bitrate * 1000); out.bitrate = h.bitrate * 1000; }
    out.sampleRate = h.sampleRate; out.channels = h.channels; out.codec = h.layer === 3 ? 'mp3' : h.layer === 2 ? 'mp2' : 'mp1';
    return true;
  }
  return false;
}

/* ---------- Vorbis comments (FLAC, Ogg) ---------- */
const VC_MAP = {
  TITLE: 'title', ARTIST: 'artist', ALBUMARTIST: 'albumartist', ALBUM: 'album', GENRE: 'genre', DATE: 'year', YEAR: 'year', ORIGINALDATE: 'origyear', ORIGINALYEAR: 'origyear',
  TRACKNUMBER: 'track', TRACK: 'track', TRACKTOTAL: 'tracktotal', TOTALTRACKS: 'tracktotal', DISCNUMBER: 'disc', DISC: 'disc', DISCTOTAL: 'disctotal', TOTALDISCS: 'disctotal', COMPILATION: 'compilation'
};
function parseVorbisComments (b, p, out) {
  if (p + 8 > b.length) return;
  const vl = b.readUInt32LE(p); p += 4 + vl;
  if (p + 4 > b.length) return;
  const count = b.readUInt32LE(p); p += 4;
  const multi = {};
  for (let n = 0; n < count && p + 4 <= b.length; n++) {
    const len = b.readUInt32LE(p); p += 4;
    if (p + len > b.length) { out.truncatedComments = true; break; }
    const eq = b.indexOf(0x3d, p);   // '='
    if (eq > p && eq < p + len) {
      const key = b.toString('latin1', p, eq).toUpperCase().replace(/[_ ]/g, '');
      if (key === 'METADATABLOCKPICTURE') { if (!out.art) out.art = { kind: 'embed' }; }
      else if (key === 'COVERART') { if (!out.art) out.art = { kind: 'embed' }; }
      else if (VC_MAP[key]) (multi[VC_MAP[key]] || (multi[VC_MAP[key]] = [])).push(b.toString('utf8', eq + 1, p + len));
    }
    p += len;
  }
  for (const [k, v] of Object.entries(multi)) setTag(out.tags, k, k === 'genre' ? v.map(genreName) : v, k === 'artist' ? ', ' : null);
}
// Pull the picture out of an Ogg METADATA_BLOCK_PICTURE comment (base64 FLAC picture block).
function vorbisPicture (b, p) {
  if (p + 8 > b.length) return null;
  p += 4 + b.readUInt32LE(p);
  const count = b.readUInt32LE(p); p += 4;
  let best = null;
  for (let n = 0; n < count && p + 4 <= b.length; n++) {
    const len = b.readUInt32LE(p); p += 4;
    const eq = b.indexOf(0x3d, p);
    if (eq > p && eq < p + len && b.toString('latin1', p, eq).toUpperCase().replace(/[_ ]/g, '') === 'METADATABLOCKPICTURE') {
      try {
        const blk = Buffer.from(b.toString('latin1', eq + 1, p + len), 'base64');
        const pic = flacPicture(blk, 0);
        if (pic && (!best || pic.type === 3)) best = { mime: pic.mime, data: blk.subarray(pic.off, pic.off + pic.len), type: pic.type };
      } catch (_) {}
    }
    p += len;
  }
  return best;
}
function flacPicture (b, p) {
  if (p + 32 > b.length) return null;
  const type = b.readUInt32BE(p); const ml = b.readUInt32BE(p + 4);
  const mime = b.toString('latin1', p + 8, p + 8 + ml);
  const dl = b.readUInt32BE(p + 8 + ml);
  const off = p + 8 + ml + 4 + dl + 16;
  if (off + 4 > b.length) return null;
  return { type, mime, off: off + 4, len: b.readUInt32BE(off) };
}

/* ---------- FLAC ---------- */
async function parseFlac (r, start, out) {
  if ((await r.read(start, 4)).toString('latin1') !== 'fLaC') return false;
  let pos = start + 4, artType = -1;
  for (let n = 0; n < 512; n++) {
    const h = await r.read(pos, 4); if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = h.readUIntBE(1, 3), dp = pos + 4;
    if (type === 0) {
      const b = await r.read(dp, 34);
      if (b.length === 34) {
        const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = (b[13] & 0x0f) * 4294967296 + b.readUInt32BE(14);
        out.sampleRate = sr; out.channels = ((b[12] >> 1) & 7) + 1; out.bits = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
        if (sr && total) out.duration = total / sr;
      }
    } else if (type === 4 && len < 8 * 1024 * 1024) {
      parseVorbisComments(await r.read(dp, len), 0, out);
    } else if (type === 6) {
      const b = await r.read(dp, Math.min(len, 8192));
      const pic = flacPicture(b, 0);
      if (pic && artType !== 3 && (artType < 0 || pic.type === 3)) { artType = pic.type; out.art = { kind: 'range', off: dp + pic.off, len: pic.len, mime: pic.mime }; }
    }
    pos = dp + len;
    if (last) break;
  }
  out.codec = 'flac';
  if (out.duration) out.bitrate = Math.round(Math.max(0, r.size - pos) * 8 / out.duration);
  return true;
}

/* ---------- Ogg (Vorbis, Opus) ---------- */
async function oggPackets (r, want, cap) {
  const packets = []; let pos = 0, cur = [], curLen = 0, truncated = false;
  for (let pages = 0; packets.length < want && pos < r.size && pages < 4096; pages++) {
    const h = await r.read(pos, 27);
    if (h.length < 27 || h.toString('latin1', 0, 4) !== 'OggS') break;
    const nseg = h[26];
    const segs = await r.read(pos + 27, nseg);
    let dp = pos + 27 + nseg, i = 0;
    while (i < nseg) {
      let len = 0, ended = false; const st = dp;
      while (i < nseg) { const s = segs[i++]; len += s; if (s < 255) { ended = true; break; } }
      if (curLen + len <= cap) cur.push(await r.read(st, len)); else truncated = true;
      curLen += len; dp = st + len;
      if (ended) { packets.push({ buf: Buffer.concat(cur), truncated }); cur = []; curLen = 0; truncated = false; if (packets.length >= want) break; }
    }
    let total = 0; for (let k = 0; k < nseg; k++) total += segs[k];
    pos += 27 + nseg + total;
  }
  return packets;
}
async function parseOgg (r, out, wantPicture) {
  const pk = await oggPackets(r, 2, wantPicture ? 48 * 1024 * 1024 : 2 * 1024 * 1024);
  if (!pk.length) return false;
  const p0 = pk[0].buf, p1 = pk[1] && pk[1].buf;
  let rate = 0, preskip = 0, cOff = -1;
  if (p0.toString('latin1', 0, 7) === '\x01vorbis') {
    out.codec = 'vorbis'; out.channels = p0[11]; rate = out.sampleRate = p0.readUInt32LE(12);
    const nom = p0.readInt32LE(20); if (nom > 0) out.bitrate = nom;
    if (p1 && p1.toString('latin1', 0, 7) === '\x03vorbis') cOff = 7;
  } else if (p0.toString('latin1', 0, 8) === 'OpusHead') {
    out.codec = 'opus'; out.channels = p0[9]; preskip = p0.readUInt16LE(10); rate = 48000; out.sampleRate = p0.readUInt32LE(12) || 48000;
    if (p1 && p1.toString('latin1', 0, 8) === 'OpusTags') cOff = 8;
  } else return false;   // Ogg FLAC, Speex, … → ffprobe
  if (wantPicture) return (p1 && cOff > 0) ? vorbisPicture(p1, cOff) : null;
  if (p1 && cOff > 0) { parseVorbisComments(p1, cOff, out); if (pk[1].truncated && out.art) out.art = { kind: 'embed' }; }
  // duration: granule position of the last page
  const tailLen = Math.min(r.size, 131072);
  const tail = await r.read(r.size - tailLen, tailLen);
  for (let i = tail.lastIndexOf('OggS'); i >= 0; i = tail.lastIndexOf('OggS', i - 1)) {
    if (i + 14 > tail.length) continue;
    const g = tail.readBigUInt64LE(i + 6);
    if (g !== 0xffffffffffffffffn && g > 0n) { out.duration = Math.max(0, Number(g) - preskip) / rate; break; }
    if (i === 0) break;
  }
  if (out.duration && !out.bitrate) out.bitrate = Math.round(r.size * 8 / out.duration);
  return true;
}

/* ---------- MP4 / M4A ---------- */
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'ilst']);
const MP4_ITEMS = { '\xa9nam': 'title', '\xa9ART': 'artist', 'aART': 'albumartist', '\xa9alb': 'album', '\xa9gen': 'genre', '\xa9day': 'year', 'trkn': 'track', 'disk': 'disc', 'cpil': 'compilation', 'gnre': 'gnre', 'covr': 'covr' };
async function parseMp4 (r, out, wantPicture) {
  const ft = await r.read(4, 4);
  if (ft.toString('latin1') !== 'ftyp') return false;
  let soundTrack = false, haveStsd = false, picture = null;
  async function walk (start, end, parent) {
    let pos = start;
    for (let guard = 0; pos + 8 <= end && guard < 4096; guard++) {
      const h = await r.read(pos, 16); if (h.length < 8) return;
      let size = h.readUInt32BE(0), hl = 8; const type = h.toString('latin1', 4, 8);
      if (size === 1) { if (h.length < 16) return; size = Number(h.readBigUInt64BE(8)); hl = 16; } else if (size === 0) size = end - pos;
      if (size < hl || pos + size > end + 8) return;
      const ds = pos + hl, de = Math.min(pos + size, end);
      if (MP4_CONTAINERS.has(type)) {
        if (type === 'trak') soundTrack = false;
        await walk(ds, de, type);
      } else if (type === 'meta') {
        const peek = await r.read(ds, 8);
        await walk(peek.toString('latin1', 4, 8) === 'hdlr' ? ds : ds + 4, de, 'meta');   // QuickTime-style meta has no version field
      } else if (type === 'mvhd' && !wantPicture) {
        const b = await r.read(ds, 32);
        const v = b[0], ts = v === 1 ? b.readUInt32BE(20) : b.readUInt32BE(12), du = v === 1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
        if (ts) out.duration = du / ts;
      } else if (type === 'hdlr' && parent === 'mdia') {
        const b = await r.read(ds, 12); soundTrack = b.toString('latin1', 8, 12) === 'soun';
      } else if (type === 'stsd' && soundTrack && !haveStsd && !wantPicture) {
        const b = await r.read(ds, 64);
        if (b.length >= 44) {
          haveStsd = true;
          const fmt = b.toString('latin1', 12, 16);
          out.codec = { mp4a: 'aac', alac: 'alac', 'ac-3': 'ac3', 'ec-3': 'eac3', Opus: 'opus', fLaC: 'flac', '.mp3': 'mp3' }[fmt] || fmt.trim().toLowerCase();
          out.channels = b.readUInt16BE(8 + 24); out.bits = b.readUInt16BE(8 + 26); out.sampleRate = b.readUInt16BE(8 + 32);
          if (out.codec === 'aac') out.bits = 0;
        }
      } else if (parent === 'ilst' && MP4_ITEMS[type]) {
        await mp4Item(type, ds, de);
      }
      pos += size;
    }
  }
  async function mp4Item (type, s, e) {
    // children are 'data' atoms: [size][data][type(4)][locale(4)][value]
    let pos = s;
    while (pos + 16 <= e) {
      const h = await r.read(pos, 16);
      const size = h.readUInt32BE(0); if (size < 16 || pos + size > e) return;
      if (h.toString('latin1', 4, 8) === 'data') {
        const dtype = h.readUInt32BE(8) & 0xffffff, vs = pos + 16, vl = size - 16, key = MP4_ITEMS[type];
        if (key === 'covr') {
          if (!picture && !out.art) {
            if (wantPicture) picture = { mime: dtype === 14 ? 'image/png' : 'image/jpeg', data: await r.read(vs, vl) };
            else out.art = { kind: 'range', off: vs, len: vl, mime: dtype === 14 ? 'image/png' : dtype === 13 ? 'image/jpeg' : '' };
          }
          return;
        }
        if (wantPicture || vl > 65536) return;
        const v = await r.read(vs, vl);
        if (key === 'track' || key === 'disc') { if (v.length >= 6) { const n = v.readUInt16BE(2), t = v.readUInt16BE(4); setTag(out.tags, key, n ? n + (t ? '/' + t : '') : ''); } }
        else if (key === 'gnre') { if (v.length >= 2) setTag(out.tags, 'genre', ID3_GENRES[v.readUInt16BE(0) - 1]); }
        else if (key === 'compilation') setTag(out.tags, 'compilation', v[0] ? '1' : '');
        else setTag(out.tags, key, v.toString('utf8'));
        return;
      }
      pos += size;
    }
  }
  await walk(0, r.size, '');
  if (wantPicture) return picture;
  if (!out.codec) out.codec = 'aac';
  if (out.duration) out.bitrate = Math.round(r.size * 8 / out.duration);
  return true;
}

/* ---------- WAV / AIFF ---------- */
const INFO_MAP = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'year', IGNR: 'genre', ITRK: 'track', IPRT: 'track' };
async function parseRiff (r, out) {
  const h = await r.read(0, 12);
  const riff = h.toString('latin1', 0, 4), form = h.toString('latin1', 8, 12);
  const isWav = (riff === 'RIFF' || riff === 'RF64') && form === 'WAVE';
  const isAiff = riff === 'FORM' && (form === 'AIFF' || form === 'AIFC');
  if (!isWav && !isAiff) return false;
  const le = isWav;
  let pos = 12, byteRate = 0, dataLen = 0, frames = 0;
  for (let guard = 0; pos + 8 <= r.size && guard < 1024; guard++) {
    const ch = await r.read(pos, 8);
    const id = ch.toString('latin1', 0, 4); let len = le ? ch.readUInt32LE(4) : ch.readUInt32BE(4);
    const dp = pos + 8;
    if (id === 'data' || id === 'SSND') { if (len === 0xffffffff || dp + len > r.size) len = r.size - dp; dataLen = len; }
    else if (id === 'fmt ') {
      const b = await r.read(dp, 16);
      out.channels = b.readUInt16LE(2); out.sampleRate = b.readUInt32LE(4); byteRate = b.readUInt32LE(8); out.bits = b.readUInt16LE(14);
      const fmt = b.readUInt16LE(0); out.codec = fmt === 3 ? 'pcm_f32' : fmt === 0x55 ? 'mp3' : fmt === 0x11 || fmt === 2 ? 'adpcm' : 'pcm';
    } else if (id === 'COMM') {
      const b = await r.read(dp, 26);
      out.channels = b.readUInt16BE(0); frames = b.readUInt32BE(2); out.bits = b.readUInt16BE(6);
      const ex = ((b[8] & 0x7f) << 8) | b[9], mant = b.readUInt32BE(10);
      out.sampleRate = Math.round(mant * Math.pow(2, ex - 16383 - 31));
      out.codec = (form === 'AIFC' && b.length >= 22) ? ({ NONE: 'pcm', sowt: 'pcm', fl32: 'pcm_f32', alaw: 'alaw', ulaw: 'ulaw' }[b.toString('latin1', 18, 22)] || 'aifc') : 'pcm';
    } else if (id === 'LIST' && len < 1048576) {
      const b = await r.read(dp, len);
      if (b.toString('latin1', 0, 4) === 'INFO') {
        let p = 4;
        while (p + 8 <= b.length) {
          const sid = b.toString('latin1', p, p + 4), sl = b.readUInt32LE(p + 4);
          if (INFO_MAP[sid]) setTag(out.tags, INFO_MAP[sid], b.toString('utf8', p + 8, Math.min(b.length, p + 8 + sl)).split('\0')[0]);
          p += 8 + sl + (sl & 1);
        }
      }
    } else if (isAiff && (id === 'NAME' || id === 'AUTH') && len < 4096) {
      setTag(out.tags, id === 'NAME' ? 'title' : 'artist', (await r.read(dp, len)).toString('utf8').split('\0')[0]);
    } else if (id === 'id3 ' || id === 'ID3 ') {
      await parseId3v2(r, dp, out);
      if (out.art && out.art.kind === 'range') { /* offsets are absolute, still valid */ }
    }
    pos = dp + len + (len & 1);
  }
  if (isWav && byteRate && dataLen) out.duration = dataLen / byteRate;
  if (isAiff && frames && out.sampleRate) out.duration = frames / out.sampleRate;
  if (out.duration) out.bitrate = Math.round(dataLen * 8 / out.duration);
  out.container = isWav ? 'wav' : 'aiff';
  return true;
}

/* ---------- ffprobe fallback ---------- */
function ffprobe (bin, file, timeoutMs) {
  return new Promise(resolve => {
    if (!bin) return resolve(null);
    let outp = '', done = false;
    const p = spawn(bin, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, timeoutMs || 20000);
    p.stdout.on('data', d => { if (outp.length < 4 * 1024 * 1024) outp += d; });
    const fin = () => { if (done) return; done = true; clearTimeout(t); try { resolve(JSON.parse(outp)); } catch (_) { resolve(null); } };
    p.on('close', fin); p.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
  });
}
function applyProbe (j, out) {
  if (!j) return false;
  const streams = Array.isArray(j.streams) ? j.streams : [];
  const a = streams.find(s => s.codec_type === 'audio');
  if (!a) return false;
  const tags = {};
  for (const src of [a.tags, j.format && j.format.tags]) for (const [k, v] of Object.entries(src || {})) { const kk = k.toLowerCase().replace(/[_ ]/g, ''); if (!(kk in tags)) tags[kk] = v; }
  const pick = (...ks) => { for (const k of ks) if (tags[k]) return tags[k]; return ''; };
  setTag(out.tags, 'title', pick('title')); setTag(out.tags, 'artist', pick('artist', 'author', 'wm/albumartist'));
  setTag(out.tags, 'albumartist', pick('albumartist', 'wm/albumartist', 'band')); setTag(out.tags, 'album', pick('album'));
  setTag(out.tags, 'genre', genreName(String(pick('genre')).split(/[;\0]/)[0])); setTag(out.tags, 'year', pick('date', 'year', 'originaldate', 'wm/year'));
  setTag(out.tags, 'track', pick('track', 'tracknumber', 'wm/tracknumber')); setTag(out.tags, 'disc', pick('disc', 'discnumber', 'wm/partofset'));
  setTag(out.tags, 'compilation', pick('compilation', 'itunescompilation'));
  if (!out.duration) out.duration = Number(a.duration) || Number(j.format && j.format.duration) || 0;
  if (!out.codec || out.codec === 'unknown') out.codec = String(a.codec_name || '').toLowerCase();
  out.sampleRate = out.sampleRate || Number(a.sample_rate) || 0;
  out.channels = out.channels || Number(a.channels) || 0;
  out.bits = out.bits || Number(a.bits_per_raw_sample) || Number(a.bits_per_sample) || 0;
  out.bitrate = out.bitrate || Number(a.bit_rate) || Number(j.format && j.format.bit_rate) || 0;
  if (!out.art && streams.some(s => s.codec_type === 'video' && (s.disposition && s.disposition.attached_pic || /^(mjpeg|png|bmp|gif|webp)$/.test(s.codec_name || '')))) out.art = { kind: 'embed' };
  return true;
}

/* ---------- entry point ---------- */
const NATIVE = { mp3: 'mpeg', mp2: 'mpeg', mpga: 'mpeg', mp1: 'mpeg', flac: 'flac', ogg: 'ogg', oga: 'ogg', opus: 'ogg', m4a: 'mp4', m4b: 'mp4', m4p: 'mp4', mp4: 'mp4', '3ga': 'mp4', wav: 'riff', wave: 'riff', aif: 'riff', aiff: 'riff', aifc: 'riff' };
/*
 * readTags(file, { ffprobe }) → { tags, duration, codec, container, bitrate, sampleRate, channels, bits, art }
 * art is { kind:'range', off, len, mime } for art that can be read straight from the file,
 * { kind:'embed' } for art that needs ffmpeg (or Ogg decoding), or null.
 */
async function readTags (file, opts) {
  opts = opts || {};
  const ext = (String(file).split('.').pop() || '').toLowerCase();
  const out = { tags: {}, duration: 0, codec: '', container: ext, bitrate: 0, sampleRate: 0, channels: 0, bits: 0, art: null };
  let ok = false, r;
  try {
    r = await openReader(file);
    const kind = NATIVE[ext];
    if (kind === 'mpeg' || kind === 'flac' || (!kind && ext !== 'wv' && ext !== 'ape' && ext !== 'mpc')) {
      // ID3v2 may also prefix FLAC, AAC/ADTS and other raw streams
      const start = await parseId3v2(r, 0, out);
      if (kind === 'flac') ok = await parseFlac(r, start, out);
      else if (kind === 'mpeg') { const end = await parseTail(r, out); ok = await mpegInfo(r, start, end, out); }
    } else if (kind === 'ogg') ok = await parseOgg(r, out);
    else if (kind === 'mp4') ok = await parseMp4(r, out);
    else if (kind === 'riff') ok = await parseRiff(r, out);
    if (!kind || ext === 'wv' || ext === 'ape' || ext === 'mpc') await parseTail(r, out).catch(() => {});
  } catch (e) { ok = false; out.error = e.message; }
  finally { if (r) await r.close(); }
  if ((!ok || !out.duration) && opts.ffprobe) {
    const j = await ffprobe(opts.ffprobe, file);
    if (applyProbe(j, out)) ok = true;
  }
  out.ok = ok && out.duration > 0;
  delete out.hasId3v2; delete out.truncatedComments;
  return out;
}
/* Read embedded art bytes without ffmpeg (Ogg pictures, MP4 covr). */
async function readEmbeddedPicture (file) {
  const ext = (String(file).split('.').pop() || '').toLowerCase();
  const kind = NATIVE[ext]; let r;
  try {
    r = await openReader(file);
    if (kind === 'ogg') return await parseOgg(r, { tags: {} }, true);
    if (kind === 'mp4') return await parseMp4(r, { tags: {} }, true);
    if (kind === 'mpeg' || kind === 'flac' || kind === 'riff') {
      const out = { tags: {}, art: null };
      if (kind === 'riff') await parseRiff(r, out); else { const s = await parseId3v2(r, 0, out); if (kind === 'flac') await parseFlac(r, s, out); }
      if (out.art && out.art.kind === 'range') return { mime: out.art.mime, data: await r.read(out.art.off, out.art.len) };
      if (out.art) {   // unsynchronised ID3: decode the whole tag in memory
        const h = await r.read(0, 10); const size = syncsafe(h, 6);
        if (size < 48 * 1024 * 1024) {
          const whole = Buffer.concat([h, await r.read(10, size)]);
          const flags = h[5]; const body = (flags & 0x80) ? Buffer.concat([h, deunsync(whole.subarray(10))]) : whole;
          const o2 = { tags: {}, art: null }; body[5] = flags & ~0x80;
          await parseId3v2(bufReader(body), 0, o2);
          if (o2.art && o2.art.kind === 'range') return { mime: o2.art.mime, data: body.subarray(o2.art.off, o2.art.off + o2.art.len) };
        }
      }
    }
  } catch (_) {} finally { if (r) await r.close(); }
  return null;
}

module.exports = { readTags, readEmbeddedPicture, ffprobe, intOf, pairOf, genreName, clean, ID3_GENRES, _internal: { mpegHeader, parseId3v2, bufReader, deunsync } };
