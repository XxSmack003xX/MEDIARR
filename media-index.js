'use strict';
/*
 * Keyframe index for Matroska files (v2.19).
 *
 * When MEDIARR copies the video into an HLS stream (only the sound is converted), every
 * piece of the stream has to begin on one of the file's own keyframes. To give the player
 * a timeline that matches the pieces exactly, the keyframe times are read from the file's
 * index (the Matroska "Cues"): a few small reads, not the whole file.
 *
 *   readMkvIndex(read)  read(offset, length) → Promise<Buffer>
 *     → { duration, keyframes: [seconds…] } or null when the file has no usable index
 *   boundaries(keyframes, duration, target) → [0, b1, …, duration]   pieces of ≥ target seconds
 */

const ID = { EBML: 0x1A45DFA3, SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC,
  INFO: 0x1549A966, TSCALE: 0x2AD7B1, DURATION: 0x4489, TRACKS: 0x1654AE6B, TRACKENTRY: 0xAE, TRACKNUM: 0xD7, TRACKTYPE: 0x83,
  CUES: 0x1C53BB6B, CUEPOINT: 0xBB, CUETIME: 0xB3, CUETRACKPOS: 0xB7, CUETRACK: 0xF7, CLUSTER: 0x1F43B675 };

// element header at buf[pos]: { id, size (-1 = unknown), head (header bytes) } or null if it doesn't fit
function header (buf, pos) {
  if (pos >= buf.length) return null;
  let b = buf[pos], n = 1;
  while (n <= 4 && !(b & (0x80 >> (n - 1)))) n++;
  if (n > 4 || pos + n > buf.length) return null;
  let id = 0; for (let i = 0; i < n; i++) id = id * 256 + buf[pos + i];
  const p = pos + n;
  if (p >= buf.length) return null;
  b = buf[p]; let m = 1;
  while (m <= 8 && !(b & (0x80 >> (m - 1)))) m++;
  if (m > 8 || p + m > buf.length) return null;
  let size = b & (0xFF >> m), ones = size === (0xFF >> m);
  for (let i = 1; i < m; i++) { size = size * 256 + buf[p + i]; if (buf[p + i] !== 0xFF) ones = false; }
  return { id, size: ones ? -1 : size, head: n + m };
}
function uint (buf, pos, len) { let v = 0; for (let i = 0; i < len && i < 8; i++) v = v * 256 + buf[pos + i]; return v; }
function float (buf, pos, len) { return len === 4 ? buf.readFloatBE(pos) : len === 8 ? buf.readDoubleBE(pos) : 0; }
// children of the element whose data is buf[start, end)
function * children (buf, start, end) {
  let pos = start;
  while (pos < end) {
    const h = header(buf, pos);
    if (!h || h.size < 0) return;
    const data = pos + h.head;
    if (data + h.size > end) { yield { id: h.id, data, size: h.size, cut: true }; return; }
    yield { id: h.id, data, size: h.size };
    pos = data + h.size;
  }
}

async function readMkvIndex (read) {
  const HEAD = 256 * 1024;
  let buf = await read(0, HEAD);
  if (!buf || buf.length < 64) return null;
  let h = header(buf, 0);
  if (!h || h.id !== ID.EBML || h.size < 0) return null;
  const segAt = h.head + h.size;
  h = header(buf, segAt);
  if (!h || h.id !== ID.SEGMENT) return null;
  const segData = segAt + h.head;

  // top-level elements at the front: SeekHead, Info, Tracks (and sometimes Cues)
  const at = {}, here = {};
  let pos = segData;
  while (pos < buf.length) {
    const e = header(buf, pos);
    if (!e || e.id === ID.CLUSTER || e.size < 0) break;
    const data = pos + e.head;
    if (e.id === ID.SEEKHEAD && data + e.size <= buf.length) {
      for (const s of children(buf, data, data + e.size)) {
        if (s.id !== ID.SEEK || s.cut) continue;
        let sid = 0, sp = -1;
        for (const f of children(buf, s.data, s.data + s.size)) { if (f.id === ID.SEEKID) sid = uint(buf, f.data, f.size); else if (f.id === ID.SEEKPOS) sp = uint(buf, f.data, f.size); }
        if (sid && sp >= 0 && at[sid] == null) at[sid] = segData + sp;
      }
    } else if (e.id === ID.INFO || e.id === ID.TRACKS || e.id === ID.CUES) here[e.id] = pos;
    pos = data + e.size;
  }
  // one whole top-level element, wherever it is
  const element = async (id, max) => {
    const off = here[id] != null ? here[id] : at[id];
    if (off == null) return null;
    let b = off + 12 <= buf.length ? buf.subarray(off, Math.min(buf.length, off + 12)) : await read(off, 12);
    const e = b && header(b, 0);
    if (!e || e.id !== id || e.size < 0 || e.size > max) return null;
    const total = e.head + e.size;
    b = off + total <= buf.length ? buf.subarray(off, off + total) : await read(off, total);
    if (!b || b.length < total) return null;
    return { buf: b, data: e.head, end: total };
  };

  let scale = 1000000, duration = 0;
  const info = await element(ID.INFO, 1 << 20);
  if (info) {
    let raw = 0;
    for (const f of children(info.buf, info.data, info.end)) { if (f.id === ID.TSCALE) scale = uint(info.buf, f.data, f.size) || scale; else if (f.id === ID.DURATION) raw = float(info.buf, f.data, f.size); }
    duration = raw > 0 ? raw * scale / 1e9 : 0;
  }
  let video = 0;
  const tracks = await element(ID.TRACKS, 4 << 20);
  if (tracks) {
    for (const t of children(tracks.buf, tracks.data, tracks.end)) {
      if (t.id !== ID.TRACKENTRY || t.cut) continue;
      let num = 0, type = 0;
      for (const f of children(tracks.buf, t.data, t.data + t.size)) { if (f.id === ID.TRACKNUM) num = uint(tracks.buf, f.data, f.size); else if (f.id === ID.TRACKTYPE) type = uint(tracks.buf, f.data, f.size); }
      if (type === 1 && num) { video = num; break; }
    }
  }
  const cues = await element(ID.CUES, 32 << 20);
  if (!cues) return duration ? { duration, keyframes: [] } : null;
  const times = [];
  for (const c of children(cues.buf, cues.data, cues.end)) {
    if (c.id !== ID.CUEPOINT || c.cut) continue;
    let t = -1, mine = !video;
    for (const f of children(cues.buf, c.data, c.data + c.size)) {
      if (f.id === ID.CUETIME) t = uint(cues.buf, f.data, f.size);
      else if (f.id === ID.CUETRACKPOS && video) { for (const g of children(cues.buf, f.data, f.data + f.size)) if (g.id === ID.CUETRACK && uint(cues.buf, g.data, g.size) === video) mine = true; }
    }
    if (t >= 0 && mine) times.push(t * scale / 1e9);
  }
  times.sort((a, b) => a - b);
  const keyframes = times.filter((t, i) => i === 0 || t - times[i - 1] > 0.0005);
  return { duration, keyframes };
}

// Where the stream is cut: on keyframes, each piece at least `target` seconds long.
// Returns null when the index is too thin to trust (big holes, or it stops early).
function boundaries (keyframes, duration, target) {
  if (!Array.isArray(keyframes) || keyframes.length < 2 || !(duration > 0)) return null;
  const k = keyframes.filter(t => t >= 0 && t < duration - 0.05);
  if (k.length < 2) return null;
  let gap = k[0];
  for (let i = 1; i < k.length; i++) gap = Math.max(gap, k[i] - k[i - 1]);
  gap = Math.max(gap, duration - k[k.length - 1]);
  if (gap > 30 || k[0] > 2) return null;
  const b = [0];
  for (const t of k) if (t - b[b.length - 1] >= target - 0.001) b.push(t);
  if (b.length > 1 && duration - b[b.length - 1] < 1) b.pop();   // no sliver at the very end
  b.push(duration);
  return b;
}

module.exports = { readMkvIndex, boundaries };
