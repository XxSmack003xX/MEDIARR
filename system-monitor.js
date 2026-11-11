'use strict';
/*
 * MEDIARR resource monitor (v2.15): CPU, memory, disks, network, temperatures,
 * every process, and Docker containers, for the admin's Resource Monitor page.
 *
 * Sampling runs every 2 seconds only while someone has the page open (and stops a
 * minute after the last request), so an idle MEDIARR costs nothing. The last six
 * minutes are kept for the page's charts.
 *
 * Linux reads /proc and /sys directly. macOS/BSD use `ps` and `df`, Windows uses
 * `tasklist` and drive letters; those show less detail.
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const STEP = 2000;          // ms between samples
const KEEP = 180;           // samples kept (6 minutes)
const IDLE_STOP = 60000;    // stop sampling this long after the last request
const DISK_EVERY = 10000;   // disk space changes slowly
const PSEUDO_FS = /^(proc|sysfs|devtmpfs|devpts|tmpfs|cgroup2?|securityfs|pstore|debugfs|tracefs|configfs|fusectl|mqueue|hugetlbfs|bpf|binfmt_misc|autofs|rpc_pipefs|nsfs|ramfs|squashfs|efivarfs|selinuxfs|fuse\.lxcfs|fuse\.gvfsd-fuse|fuse\.portal|overlay|aufs|shm|none|devfs|nullfs|map|iso9660|udf)$/i;
const DISK_DEV = /^(sd[a-z]+|hd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|md\d+)$/;

function run (cmd, args, timeout) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeout || 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '')));
  });
}
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const read = f => fsp.readFile(f, 'utf8').catch(() => '');
const readSync = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };
// /dev/sda1 → sda, /dev/nvme0n1p2 → nvme0n1, /dev/mmcblk0p1 → mmcblk0
function baseDevice (src) {
  const n = String(src || '').replace(/^\/dev\//, '');
  if (/^nvme\d+n\d+p\d+$/.test(n) || /^mmcblk\d+p\d+$/.test(n)) return n.replace(/p\d+$/, '');
  if (/^(sd|hd|vd|xvd)[a-z]+\d+$/.test(n)) return n.replace(/\d+$/, '');
  return n;
}
function mountLabel (mp) {
  if (mp === '/' ) return 'System';
  const last = mp.split(/[\\/]/).filter(Boolean).pop() || mp;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function createSystemMonitor (d) {
  const PROC = d.procRoot || '/proc';
  const SYS = d.sysRoot || '/sys';
  const IS_LINUX = process.platform === 'linux' && fs.existsSync(PROC + '/stat');
  const CLK = 100;            // USER_HZ on every mainstream Linux
  let PAGE = 4096;

  const S = {
    timer: null, lastAsk: 0, last: null, busy: null,
    cpu: null, procs: new Map(), disk: new Map(), net: new Map(), at: 0,
    disks: [], disksAt: 0, users: new Map(), usersAt: 0,
    hist: { t: [], cpu: [], mem: [], swap: [], rx: [], tx: [], rd: [], wr: [] },
    ctr: { list: [], prev: new Map(), at: 0, busy: false, error: '' },
    winCpu: null
  };

  /* ---------- users (uid → name) ---------- */
  function userName (uid) {
    if (Date.now() - S.usersAt > 60000) {
      S.users = new Map(); S.usersAt = Date.now();
      for (const line of readSync((d.fsRoot || '') + '/etc/passwd').split('\n')) { const p = line.split(':'); if (p.length > 2) S.users.set(Number(p[2]), p[0]); }
    }
    return S.users.get(uid) || String(uid);
  }

  /* ---------- CPU ---------- */
  function cpuLinux (text) {
    const rows = [];
    for (const line of text.split('\n')) {
      if (!/^cpu\d* /.test(line)) continue;
      const f = line.trim().split(/\s+/).slice(1, 9).map(num);
      rows.push({ total: f.reduce((a, b) => a + b, 0), idle: f[3] + f[4], iowait: f[4] });
    }
    const prev = S.cpu; S.cpu = rows;
    if (!prev || prev.length !== rows.length) return null;
    const pct = (a, b) => { const dt = a.total - b.total; return dt > 0 ? Math.max(0, Math.min(100, (1 - (a.idle - b.idle) / dt) * 100)) : 0; };
    const io = rows[0].total - prev[0].total > 0 ? (rows[0].iowait - prev[0].iowait) / (rows[0].total - prev[0].total) * 100 : 0;
    return { total: pct(rows[0], prev[0]), cores: rows.slice(1).map((r, i) => pct(r, prev[i + 1])), iowait: Math.max(0, io), dTotal: (rows[0].total - prev[0].total) };
  }
  function cpuGeneric () {
    const now = os.cpus().map(c => { const t = c.times; const total = t.user + t.nice + t.sys + t.idle + t.irq; return { total, idle: t.idle }; });
    const prev = S.winCpu; S.winCpu = now;
    if (!prev || prev.length !== now.length) return null;
    const pct = (a, b) => { const dt = a.total - b.total; return dt > 0 ? Math.max(0, Math.min(100, (1 - (a.idle - b.idle) / dt) * 100)) : 0; };
    const cores = now.map((c, i) => pct(c, prev[i]));
    return { total: cores.reduce((a, b) => a + b, 0) / (cores.length || 1), cores, iowait: 0 };
  }
  function cpuTemp () {
    if (!IS_LINUX) return null;
    const pri = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'cpu', 'acpitz'];
    let best = null;
    try {
      for (const h of fs.readdirSync(SYS + '/class/hwmon')) {
        const dir = SYS + '/class/hwmon/' + h, name = readSync(dir + '/name').trim();
        const rank = pri.indexOf(name); if (rank < 0) continue;
        let t = 0;
        for (const f of fs.readdirSync(dir)) if (/^temp\d+_input$/.test(f)) t = Math.max(t, num(readSync(dir + '/' + f)) / 1000);
        if (t > 0 && (!best || rank < best.rank)) best = { rank, t };
      }
    } catch (_) {}
    if (!best) {
      try {
        for (const z of fs.readdirSync(SYS + '/class/thermal')) {
          if (!z.startsWith('thermal_zone')) continue;
          const type = readSync(SYS + '/class/thermal/' + z + '/type').trim();
          if (!/x86_pkg_temp|cpu|soc|acpitz/i.test(type)) continue;
          const t = num(readSync(SYS + '/class/thermal/' + z + '/temp')) / 1000;
          if (t > 0 && (!best || t > best.t)) best = { rank: 9, t };
        }
      } catch (_) {}
    }
    return best ? Math.round(best.t) : null;
  }

  /* ---------- memory ---------- */
  function memLinux (text) {
    const m = {};
    for (const line of text.split('\n')) { const x = /^(\w+):\s+(\d+)/.exec(line); if (x) m[x[1]] = num(x[2]) * 1024; }
    const total = m.MemTotal || os.totalmem(), avail = m.MemAvailable != null ? m.MemAvailable : (m.MemFree + (m.Buffers || 0) + (m.Cached || 0));
    const cache = Math.max(0, (m.Buffers || 0) + (m.Cached || 0) + (m.SReclaimable || 0) - (m.Shmem || 0));
    const out = { total, used: Math.max(0, total - avail), available: avail, cache: Math.min(cache, avail), free: m.MemFree || 0, swapTotal: m.SwapTotal || 0, swapUsed: Math.max(0, (m.SwapTotal || 0) - (m.SwapFree || 0)), limit: null };
    // a memory limit on MEDIARR's container (cgroup v2, then v1)
    const cg = (d.fsRoot || '') + '/sys/fs/cgroup';
    let max = readSync(cg + '/memory.max').trim(), cur = readSync(cg + '/memory.current').trim();
    if (!max) { max = readSync(cg + '/memory/memory.limit_in_bytes').trim(); cur = readSync(cg + '/memory/memory.usage_in_bytes').trim(); }
    if (max && max !== 'max' && num(max) > 0 && num(max) < total * 0.98) out.limit = { max: num(max), used: num(cur) };
    return out;
  }

  /* ---------- processes ---------- */
  async function procsLinux (dtSec, cores, memTotal, uptime) {
    let names = [];
    try { names = (await fsp.readdir(PROC)).filter(n => /^\d+$/.test(n)); } catch (_) { return { list: [], threads: 0 }; }
    const seen = new Map(), list = [];
    let threads = 0;
    await Promise.all(names.map(async pid => {
      const [stat, cmd, st] = await Promise.all([read(PROC + '/' + pid + '/stat'), read(PROC + '/' + pid + '/cmdline'), fsp.stat(PROC + '/' + pid).catch(() => null)]);
      if (!stat) return;
      const a = stat.indexOf('('), b = stat.lastIndexOf(')');
      if (a < 0 || b < a) return;
      const name = stat.slice(a + 1, b), f = stat.slice(b + 2).split(' ');
      // f[0]=state f[1]=ppid … f[11]=utime f[12]=stime … f[17]=num_threads f[19]=starttime f[21]=rss(pages)
      const ticks = num(f[11]) + num(f[12]), nT = num(f[17]);
      threads += nT;
      const prev = S.procs.get(pid);
      const started = num(f[19]) / CLK;
      let cpu = 0;
      if (prev && prev.start === started && dtSec > 0) cpu = Math.max(0, (ticks - prev.ticks) / CLK / dtSec / cores * 100);
      seen.set(pid, { ticks, start: started });
      const rss = num(f[21]) * PAGE;
      const args = cmd ? cmd.replace(/\u0000+$/, '').split('\u0000') : [];
      list.push({
        pid: Number(pid), ppid: num(f[1]), name, cmd: args.join(' ').slice(0, 400), user: st ? userName(st.uid) : '',
        state: f[0], cpu: Math.round(cpu * 10) / 10, mem: rss, memPct: memTotal ? Math.round(rss / memTotal * 1000) / 10 : 0,
        threads: nT, up: Math.max(0, Math.round(uptime - started)), kernel: !cmd && num(f[1]) === 2
      });
    }));
    S.procs = seen;
    return { list, threads };
  }
  async function procsPs (cores, memTotal) {
    const out = await run('ps', ['-axww', '-o', 'pid=,ppid=,%cpu=,rss=,state=,etime=,user=,command='], 6000);
    const list = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const et = m[6].split(/[-:]/).map(Number).reverse();   // [[dd-]hh:]mm:ss
      const up = (et[0] || 0) + (et[1] || 0) * 60 + (et[2] || 0) * 3600 + (et[3] || 0) * 86400;
      const rss = num(m[4]) * 1024, cmd = m[8].trim();
      list.push({ pid: Number(m[1]), ppid: Number(m[2]), name: path.basename(cmd.split(' ')[0]) || cmd, cmd: cmd.slice(0, 400), user: m[7], state: m[5].charAt(0), cpu: Math.round(num(m[3]) / cores * 10) / 10, mem: rss, memPct: memTotal ? Math.round(rss / memTotal * 1000) / 10 : 0, threads: 0, up, kernel: false });
    }
    return { list, threads: 0 };
  }
  async function procsWindows (memTotal) {
    const out = await run('tasklist', ['/fo', 'csv', '/nh'], 8000);
    const list = [];
    for (const line of out.split(/\r?\n/)) {
      const c = line.match(/"([^"]*)"/g); if (!c || c.length < 5) continue;
      const v = c.map(x => x.slice(1, -1));
      const rss = num(v[4].replace(/[^\d]/g, '')) * 1024;
      list.push({ pid: num(v[1]), ppid: 0, name: v[0], cmd: v[0], user: '', state: 'R', cpu: 0, mem: rss, memPct: memTotal ? Math.round(rss / memTotal * 1000) / 10 : 0, threads: 0, up: 0, kernel: false });
    }
    return { list, threads: 0 };
  }

  /* ---------- disks ---------- */
  async function disksLinux () {
    const mounts = readSync(PROC + '/mounts').split('\n').map(l => l.split(' ')).filter(p => p.length >= 3)
      .map(p => ({ src: p[0], mp: p[1].replace(/\\040/g, ' ').replace(/\\011/g, '\t'), type: p[2] }));
    const out = [], byKey = new Map();
    for (const m of mounts) {
      if (PSEUDO_FS.test(m.type) && m.mp !== '/') continue;
      if (/^\/(proc|sys|dev|run)(\/|$)/.test(m.mp) && m.mp !== '/') continue;
      if (/^\/(etc\/(hosts|hostname|resolv\.conf)|var\/run\/docker\.sock)$/.test(m.mp)) continue;
      let st; try { st = await fsp.statfs(m.mp); } catch (_) { continue; }
      const size = st.blocks * st.bsize; if (!size || size < 64 * 1024 * 1024) continue;
      const free = st.bavail * st.bsize, used = Math.max(0, size - st.bfree * st.bsize);
      // bind mounts of the same filesystem report identical numbers: show them as one disk
      const key = st.blocks + ':' + st.bfree + ':' + st.bsize;
      if (byKey.has(key)) { const x = byKey.get(key); if (!x.mounts.includes(m.mp)) x.mounts.push(m.mp); continue; }
      const dev = /^\/dev\//.test(m.src) ? baseDevice(m.src) : '';
      const disk = { id: key, mounts: [m.mp], device: dev, source: m.src, type: m.type === 'overlay' ? 'overlay' : m.type, size, used, free, pct: Math.round(used / (used + free || 1) * 1000) / 10, network: /^(nfs4?|cifs|smb3|fuse\.sshfs|9p|fuse\.rclone)$/.test(m.type) };
      byKey.set(key, disk); out.push(disk);
    }
    for (const x of out) { x.mounts.sort((a, b) => a.length - b.length); x.name = mountLabel(x.mounts[0]); }
    return out.sort((a, b) => (a.mounts[0] === '/' ? -1 : b.mounts[0] === '/' ? 1 : b.size - a.size));
  }
  async function disksGeneric () {
    const out = [];
    if (process.platform === 'win32') {
      for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        let st; try { st = await fsp.statfs(L + ':\\'); } catch (_) { continue; }
        const size = st.blocks * st.bsize; if (!size) continue;
        const free = st.bavail * st.bsize, used = Math.max(0, size - st.bfree * st.bsize);
        out.push({ id: L, mounts: [L + ':\\'], name: L + ':', device: '', type: '', size, used, free, pct: Math.round(used / size * 1000) / 10, network: false });
      }
      return out;
    }
    const df = await run('df', ['-kP'], 5000);
    for (const line of df.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/); if (p.length < 6) continue;
      const mp = p.slice(5).join(' '); if (!/^\/dev\//.test(p[0]) && !/^\/\//.test(p[0]) && !/:/.test(p[0])) continue;
      if (/^\/System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)/.test(mp)) continue;
      const size = num(p[1]) * 1024, used = num(p[2]) * 1024, free = num(p[3]) * 1024;
      if (!size) continue;
      out.push({ id: p[0] + mp, mounts: [mp], name: mountLabel(mp), device: '', type: '', size, used, free, pct: Math.round(used / (used + free || 1) * 1000) / 10, network: /^\/\/|:/.test(p[0]) });
    }
    return out;
  }
  function diskIo (dt) {
    const rows = {}, now = new Map();
    for (const line of readSync(PROC + '/diskstats').split('\n')) {
      const p = line.trim().split(/\s+/); if (p.length < 10 || !DISK_DEV.test(p[2])) continue;
      now.set(p[2], { r: num(p[5]) * 512, w: num(p[9]) * 512 });
    }
    let rd = 0, wr = 0;
    for (const [dev, v] of now) {
      const prev = S.disk.get(dev);
      const r = prev && dt > 0 ? Math.max(0, (v.r - prev.r) / dt) : 0, w = prev && dt > 0 ? Math.max(0, (v.w - prev.w) / dt) : 0;
      rows[dev] = { read: r, write: w };
      if (!/^md\d+$/.test(dev)) { rd += r; wr += w; }   // md arrays repeat their members' traffic
    }
    S.disk = now;
    return { devices: rows, read: rd, write: wr };
  }
  function netIo (dt) {
    const now = new Map(), ifaces = [];
    let rx = 0, tx = 0;
    for (const line of readSync(PROC + '/net/dev').split('\n').slice(2)) {
      const m = /^\s*([^:]+):\s*(.*)$/.exec(line); if (!m) continue;
      const name = m[1].trim(), f = m[2].trim().split(/\s+/).map(num);
      if (name === 'lo' || /^(veth|docker\d|br-|virbr|vnet|tap|tun|cali|flannel|cni|kube)/.test(name)) continue;
      now.set(name, { rx: f[0], tx: f[8] });
    }
    for (const [name, v] of now) {
      const prev = S.net.get(name);
      const r = prev && dt > 0 ? Math.max(0, (v.rx - prev.rx) / dt) : 0, t = prev && dt > 0 ? Math.max(0, (v.tx - prev.tx) / dt) : 0;
      ifaces.push({ name, rx: r, tx: t, totalRx: v.rx, totalTx: v.tx }); rx += r; tx += t;
    }
    S.net = now;
    return { rx, tx, ifaces };
  }

  /* ---------- Docker containers ---------- */
  async function containers () {
    if (S.ctr.busy || !d.dockerAvailable()) return;
    S.ctr.busy = true;
    try {
      const listed = (await d.dockerApi('GET', '/containers/json?all=1', 8000)).data || [];
      const now = Date.now();
      const out = await Promise.all(listed.slice(0, 80).map(async c => {
        const id = c.Id, name = String((c.Names || [])[0] || id.slice(0, 12)).replace(/^\//, '');
        const row = { id: id.slice(0, 12), name, image: String(c.Image || '').replace(/@sha256:.*$/, ''), state: c.State, status: c.Status, cpu: 0, mem: 0, memLimit: 0, rx: 0, tx: 0, pids: 0, self: false };
        if (c.State !== 'running') return row;
        try {
          const s = (await d.dockerApi('GET', '/containers/' + id + '/stats?stream=false&one-shot=true', 8000)).data || {};
          const cu = s.cpu_stats || {}, total = num(cu.cpu_usage && cu.cpu_usage.total_usage), sys = num(cu.system_cpu_usage);
          const ncpu = num(cu.online_cpus) || ((cu.cpu_usage && cu.cpu_usage.percpu_usage) || []).length || os.cpus().length;
          const prev = S.ctr.prev.get(id); row._had = !!prev;
          // one-shot stats carry no "previous" reading, so compare with our last one
          const pre = s.precpu_stats && num(s.precpu_stats.system_cpu_usage) ? { total: num(s.precpu_stats.cpu_usage && s.precpu_stats.cpu_usage.total_usage), sys: num(s.precpu_stats.system_cpu_usage) } : prev;
          if (pre && sys > pre.sys) row.cpu = Math.round(Math.max(0, (total - pre.total) / (sys - pre.sys)) * 1000) / 10;   // share of the whole machine
          S.ctr.prev.set(id, { total, sys });
          const ms = s.memory_stats || {}, st = ms.stats || {};
          row.mem = Math.max(0, num(ms.usage) - num(st.inactive_file != null ? st.inactive_file : st.total_inactive_file != null ? st.total_inactive_file : st.cache));
          row.memLimit = num(ms.limit);
          for (const n of Object.values(s.networks || {})) { row.rx += num(n.rx_bytes); row.tx += num(n.tx_bytes); }
          row.pids = num(s.pids_stats && s.pids_stats.current);
          void ncpu;
        } catch (_) {}
        return row;
      }));
      try { const me = await d.selfId(); if (me) for (const r of out) if (me.startsWith(r.id)) r.self = true; } catch (_) {}
      S.ctr.list = out.sort((a, b) => (b.state === 'running') - (a.state === 'running') || b.cpu - a.cpu || a.name.localeCompare(b.name));
      S.ctr.at = now; S.ctr.error = '';
      // a container seen for the first time has no CPU reading yet: take a second look shortly
      if (out.some(r => r.state === 'running' && !r._had)) setTimeout(() => { if (S.timer) containers(); }, 1500);
      for (const r of out) delete r._had;
    } catch (e) {
      S.ctr.error = /EACCES|permission/i.test(e.message || '') ? 'MEDIARR isn’t allowed to read the Docker socket.' : 'Docker couldn’t be reached (' + (e.message || 'error') + ').';
    } finally { S.ctr.busy = false; }
  }

  /* ---------- one sample ---------- */
  function push (k, v) { const a = S.hist[k]; a.push(v); if (a.length > KEEP) a.shift(); }
  async function sample () {
    const t = Date.now(), dt = S.at ? (t - S.at) / 1000 : 0;
    const cores = os.cpus().length || 1;
    let cpu, mem, uptime, load = os.loadavg(), procs, io = { read: 0, write: 0, devices: {} }, net = { rx: 0, tx: 0, ifaces: [] }, tasks = null;
    if (IS_LINUX) {
      const [stat, meminfo, up, la] = await Promise.all([read(PROC + '/stat'), read(PROC + '/meminfo'), read(PROC + '/uptime'), read(PROC + '/loadavg')]);
      cpu = cpuLinux(stat); mem = memLinux(meminfo); uptime = num(up.split(' ')[0]) || os.uptime();
      const lp = la.trim().split(/\s+/); if (lp.length >= 3) load = lp.slice(0, 3).map(num);
      if (lp[3]) { const r = lp[3].split('/'); tasks = { running: num(r[0]), total: num(r[1]) }; }
      procs = await procsLinux(dt, cores, mem.total, uptime);
      io = diskIo(dt); net = netIo(dt);
    } else {
      cpu = cpuGeneric(); uptime = os.uptime();
      const total = os.totalmem(), free = os.freemem();
      mem = { total, used: total - free, available: free, cache: 0, free, swapTotal: 0, swapUsed: 0, limit: null };
      procs = process.platform === 'win32' ? await procsWindows(total) : await procsPs(cores, total);
    }
    if (t - S.disksAt > DISK_EVERY || !S.disks.length) { S.disks = IS_LINUX ? await disksLinux() : await disksGeneric(); S.disksAt = t; }
    for (const x of S.disks) { const v = x.device && io.devices[x.device]; x.read = v ? v.read : null; x.write = v ? v.write : null; }
    S.at = t;
    const c = cpu || { total: 0, cores: new Array(cores).fill(0), iowait: 0 };
    if (cpu) {
      push('t', t); push('cpu', Math.round(c.total * 10) / 10); push('mem', mem.used); push('swap', mem.swapUsed);
      push('rx', Math.round(net.rx)); push('tx', Math.round(net.tx)); push('rd', Math.round(io.read)); push('wr', Math.round(io.write));
    }
    const cpus = os.cpus();
    const rt = d.runtime();
    const pid1 = IS_LINUX ? readSync(PROC + '/1/comm').trim() : '';
    const scope = !IS_LINUX ? 'all' : rt.container && !/^(systemd|init)$/.test(pid1) ? 'container' : 'all';
    S.last = {
      now: t, step: STEP, ready: !!cpu,
      host: {
        name: os.hostname(), platform: process.platform, os: osName(), kernel: os.release(), arch: os.arch(), uptime,
        cpuModel: (cpus[0] && cpus[0].model || '').replace(/\s+/g, ' ').replace(/\((R|TM)\)/g, '').trim(), cores, mhz: cpus.length ? Math.round(cpus.reduce((a, x) => a + (x.speed || 0), 0) / cpus.length) : 0,
        runtime: rt.label, container: !!rt.container, mediarrPid: process.pid, node: process.version
      },
      cpu: { pct: Math.round(c.total * 10) / 10, cores: c.cores.map(v => Math.round(v)), iowait: Math.round(c.iowait * 10) / 10, load: load.map(v => Math.round(v * 100) / 100), temp: cpuTemp(), tasks },
      mem, disks: S.disks, io: { read: io.read, write: io.write }, net,
      procs: { list: procs.list, count: procs.list.length, threads: procs.threads, scope },
      hist: S.hist
    };
    return S.last;
  }
  function osName () {
    if (process.platform === 'linux') {
      const r = readSync((d.fsRoot || '') + '/etc/os-release'); const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(r);
      return m ? m[1] : 'Linux';
    }
    return { darwin: 'macOS', win32: 'Windows', freebsd: 'FreeBSD' }[process.platform] || process.platform;
  }

  function tick () {
    if (Date.now() - S.lastAsk > IDLE_STOP) { clearInterval(S.timer); S.timer = null; S.procs.clear(); S.cpu = null; S.at = 0; S.winCpu = null; return; }
    if (!S.busy) S.busy = sample().catch(e => { console.log('  [monitor] ' + e.message); }).finally(() => { S.busy = null; });
    if (Date.now() - S.ctr.at > 4500) containers();
  }
  async function snapshot (opts) {
    S.lastAsk = Date.now();
    if (!S.timer) {
      // first look: two quick readings so CPU numbers are real straight away
      if (!S.busy) { S.busy = sample().finally(() => { S.busy = null; }); }
      await S.busy;
      await new Promise(r => setTimeout(r, 700));
      if (!S.busy) { S.busy = sample().finally(() => { S.busy = null; }); }
      S.timer = setInterval(tick, STEP); if (S.timer.unref) S.timer.unref();
      containers();
    }
    if (S.busy) await S.busy;
    if (!S.last) await sample();
    const out = Object.assign({}, S.last);
    const lim = opts && opts.procs;
    if (lim === '0') out.procs = Object.assign({}, out.procs, { list: [] });
    else if (lim && /^\d+$/.test(lim)) out.procs = Object.assign({}, out.procs, { list: out.procs.list.slice().sort((a, b) => b.cpu - a.cpu || b.mem - a.mem).slice(0, Number(lim)) });
    out.containers = { available: d.dockerAvailable(), list: S.ctr.list, error: S.ctr.error, at: S.ctr.at };
    return out;
  }
  try { const ps = Number(require('child_process').execFileSync('getconf', ['PAGESIZE'], { timeout: 2000 }).toString()); if (ps > 0) PAGE = ps; } catch (_) {}
  return { snapshot, _state: S };
}

module.exports = { createSystemMonitor, baseDevice };
