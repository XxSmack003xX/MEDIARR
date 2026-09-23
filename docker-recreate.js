'use strict';
/*
 * Shared Docker container recreation for MEDIARR.
 *
 * Used by both server.js (Docker Controls -> Update for allowed containers) and
 * update-helper.js (MEDIARR's own self-update). Keeping one implementation stops
 * the two copies drifting apart, which is how the self-updater came to lose
 * volumes that the Docker Controls updater already preserved.
 *
 * Safety model for replaceContainer():
 *   1. The original container is RENAMED and stopped, never deleted up front.
 *   2. The replacement is created under the original name.
 *   3. It must start, become healthy, keep every original mount, and (optionally)
 *      still see its data directory.
 *   4. Only then is the original deleted (containers only - volumes are never removed).
 *   5. On any failure the replacement is removed and the ORIGINAL container is
 *      renamed back and restarted. Nothing is rebuilt, so a defect in the
 *      recreate body cannot also break the rollback.
 *
 * Every Docker call goes through a caller-supplied `call(method, path, body, timeoutMs)`
 * that resolves { status, data, body } and does not throw on HTTP errors, and whose
 * paths already include the API version prefix handling.
 */

const HOST_CONFIG_KEYS = [
  'Binds', 'PortBindings', 'RestartPolicy', 'NetworkMode', 'ExtraHosts', 'GroupAdd', 'Devices', 'DeviceRequests',
  'CapAdd', 'CapDrop', 'SecurityOpt', 'Privileged', 'ReadonlyRootfs', 'Tmpfs', 'ShmSize', 'Init', 'Runtime', 'Dns',
  'DnsOptions', 'DnsSearch', 'Sysctls', 'IpcMode', 'PidMode', 'UTSMode', 'UsernsMode', 'LogConfig', 'Links',
  'VolumeDriver', 'VolumesFrom', 'PublishAllPorts', 'CgroupnsMode', 'Cgroup', 'OomScoreAdj', 'StorageOpt',
  'CpuShares', 'Memory', 'NanoCpus', 'CgroupParent', 'BlkioWeight', 'BlkioWeightDevice', 'BlkioDeviceReadBps',
  'BlkioDeviceWriteBps', 'BlkioDeviceReadIOps', 'BlkioDeviceWriteIOps', 'CpuPeriod', 'CpuQuota',
  'CpuRealtimePeriod', 'CpuRealtimeRuntime', 'CpusetCpus', 'CpusetMems', 'DeviceCgroupRules',
  'MemoryReservation', 'MemorySwap', 'MemorySwappiness', 'OomKillDisable', 'PidsLimit', 'Ulimits',
  'CpuCount', 'CpuPercent', 'IOMaximumIOps', 'IOMaximumBandwidth', 'MaskedPaths', 'ReadonlyPaths'
];

/* Copy HostConfig, folding every mount (including named/anonymous volumes that only
   appear in the top-level Mounts list) into Binds so nothing is dropped. */
function recreateHostConfig (inspect) {
  const h = (inspect && inspect.HostConfig) || {}, out = {};
  for (const k of HOST_CONFIG_KEYS) if (h[k] != null) out[k] = h[k];
  const binds = Array.isArray(out.Binds) ? out.Binds.slice() : [];
  const destinations = new Set();
  for (const b of binds) {
    const parts = String(b || '').split(':');
    if (parts.length >= 2) destinations.add(parts[1]);
  }
  for (const m of ((inspect && inspect.Mounts) || [])) {
    if (!m || !m.Destination || destinations.has(m.Destination)) continue;
    if (m.Type === 'volume' && m.Name) binds.push(String(m.Name) + ':' + String(m.Destination) + (m.RW === false ? ':ro' : ''));
    else if (m.Type === 'bind' && m.Source) binds.push(String(m.Source) + ':' + String(m.Destination) + (m.RW === false ? ':ro' : ''));
    destinations.add(m.Destination);
  }
  if (binds.length) out.Binds = binds;
  out.AutoRemove = false;
  return out;
}

function recreateNetworking (inspect) {
  const nets = (inspect && inspect.NetworkSettings && inspect.NetworkSettings.Networks) || {}, ep = {};
  for (const [name, n] of Object.entries(nets)) {
    if (!name || !n) continue;
    const aliases = (n.Aliases || []).filter(a => a && a !== inspect.Id && !String(inspect.Id || '').startsWith(String(a)));
    ep[name] = {};
    if (aliases.length) ep[name].Aliases = aliases;
    if (n.DriverOpts) ep[name].DriverOpts = n.DriverOpts;
    if (n.IPAMConfig) ep[name].IPAMConfig = n.IPAMConfig;
    if (Array.isArray(n.Links) && n.Links.length) ep[name].Links = n.Links;
  }
  return Object.keys(ep).length ? { EndpointsConfig: ep } : undefined;
}

/* opts.imageEnv: the ORIGINAL image's baked Env. Entries identical to it are dropped so the
   new image's own defaults (PATH, NODE_VERSION, ...) win; user-supplied overrides are kept.
   opts.dropEnv: array of variable names never to carry over (e.g. MEDIARR_VERSION). */
function recreateBody (inspect, image, opts) {
  opts = opts || {};
  const c = (inspect && inspect.Config) || {};
  let env = Array.isArray(c.Env) ? c.Env.slice() : undefined;
  if (env) {
    const baked = new Set(Array.isArray(opts.imageEnv) ? opts.imageEnv : []);
    const drop = new Set((opts.dropEnv || []).map(String));
    env = env.filter(e => !baked.has(e) && !drop.has(String(e).split('=')[0]));
  }
  const body = {
    Image: image,
    Hostname: c.Hostname || undefined,
    Domainname: c.Domainname || undefined,
    User: c.User || undefined,
    AttachStdin: c.AttachStdin,
    AttachStdout: c.AttachStdout,
    AttachStderr: c.AttachStderr,
    ExposedPorts: c.ExposedPorts || undefined,
    Tty: c.Tty,
    OpenStdin: c.OpenStdin,
    StdinOnce: c.StdinOnce,
    Env: env,
    Cmd: c.Cmd || undefined,
    Healthcheck: c.Healthcheck || undefined,
    Volumes: c.Volumes || undefined,
    WorkingDir: c.WorkingDir || undefined,
    Entrypoint: c.Entrypoint || undefined,
    NetworkDisabled: c.NetworkDisabled,
    MacAddress: c.MacAddress || undefined,
    Labels: c.Labels || undefined,
    StopSignal: c.StopSignal || undefined,
    StopTimeout: c.StopTimeout,
    Shell: c.Shell || undefined,
    HostConfig: recreateHostConfig(inspect)
  };
  const net = recreateNetworking(inspect); if (net) body.NetworkingConfig = net;
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/* Docker Engine < 25 (API < 1.44) rejects more than one network at create time.
   Create with the primary network only and attach the rest afterwards; that works
   on every engine version. */
function splitNetworking (body) {
  const ep = body && body.NetworkingConfig && body.NetworkingConfig.EndpointsConfig;
  const names = ep ? Object.keys(ep) : [];
  if (names.length <= 1) return { createBody: body, extra: [] };
  const mode = body.HostConfig && body.HostConfig.NetworkMode;
  const primary = names.includes(mode) ? mode : names[0];
  const createBody = Object.assign({}, body, { NetworkingConfig: { EndpointsConfig: { [primary]: ep[primary] } } });
  const extra = names.filter(n => n !== primary).map(n => ({ name: n, config: ep[n] }));
  return { createBody, extra };
}

/* Every mount the original had must exist on the replacement, pointing at the same
   volume name / host path. Anything else means data would silently be left behind. */
function mountsMatch (oldInspect, newInspect) {
  const key = m => m.Type === 'volume' ? 'volume:' + m.Name : m.Type === 'bind' ? 'bind:' + m.Source : String(m.Type) + ':' + (m.Name || m.Source || '');
  const have = new Map(((newInspect && newInspect.Mounts) || []).map(m => [m.Destination, key(m)]));
  const missing = [];
  for (const m of ((oldInspect && oldInspect.Mounts) || [])) {
    if (!m || !m.Destination || m.Type === 'tmpfs') continue;
    if (have.get(m.Destination) !== key(m)) missing.push(m.Destination);
  }
  return { ok: missing.length === 0, missing };
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)); }
function msgOf (r, fallback) {
  return (r && r.data && r.data.message) || (r && typeof r.body === 'string' && r.body.trim()) || fallback || ('HTTP ' + (r && r.status));
}

/* Build the replace/rollback routine around a caller-supplied `call`. */
function makeDocker (call) {
  const ok = (r, codes) => (codes || [200, 201, 204, 304]).includes(r.status);
  async function must (method, p, body, codes, timeout, what) {
    const r = await call(method, p, body, timeout || 30000);
    if (!ok(r, codes)) throw new Error((what ? what + ': ' : '') + msgOf(r));
    return r;
  }
  async function inspect (id) {
    const r = await call('GET', '/containers/' + encodeURIComponent(id) + '/json', null, 15000);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error('inspect: ' + msgOf(r));
    return r.data || {};
  }
  async function imageEnv (imageId) {
    try {
      const r = await call('GET', '/images/' + encodeURIComponent(imageId) + '/json', null, 15000);
      return (r.status === 200 && r.data && r.data.Config && Array.isArray(r.data.Config.Env)) ? r.data.Config.Env : [];
    } catch (_) { return []; }
  }
  async function rename (id, name) {
    await must('POST', '/containers/' + encodeURIComponent(id) + '/rename?name=' + encodeURIComponent(name), null, [200, 204], 15000, 'rename');
  }
  async function stop (id) {
    await must('POST', '/containers/' + encodeURIComponent(id) + '/stop?t=10', null, [204, 304], 45000, 'stop');
  }
  async function start (id) {
    await must('POST', '/containers/' + encodeURIComponent(id) + '/start', null, [204, 304], 30000, 'start');
  }
  /* Container only. `v` is never set, so volumes survive. */
  async function removeContainer (id) {
    if (!id) return true;
    try { await call('POST', '/containers/' + encodeURIComponent(id) + '/stop?t=10', null, 45000); } catch (_) {}
    for (let i = 0; i < 3; i++) {
      try { await call('DELETE', '/containers/' + encodeURIComponent(id) + '?force=1', null, 30000); } catch (_) {}
      if (!(await inspect(id).catch(() => null))) return true;
      await sleep(1000);
    }
    return false;
  }
  async function create (name, body) {
    const { createBody, extra } = splitNetworking(body);
    const r = await must('POST', '/containers/create?name=' + encodeURIComponent(name), createBody, [201], 30000, 'create');
    const id = r.data && r.data.Id;
    if (!id) throw new Error('create: Docker did not return a container ID');
    try {
      for (const n of extra) {
        await must('POST', '/networks/' + encodeURIComponent(n.name) + '/connect', { Container: id, EndpointConfig: n.config || {} },
          [200, 204], 30000, 'connect network ' + n.name);
      }
    } catch (e) { await removeContainer(id); throw e; }
    return String(id);
  }
  /* Healthy if the image/compose defines a healthcheck; otherwise running and stable. */
  async function waitReady (id, seconds) {
    const until = Date.now() + seconds * 1000;
    let stableSince = 0;
    while (Date.now() < until) {
      await sleep(1500);
      const c = await inspect(id);
      if (!c) return { ok: false, reason: 'container disappeared' };
      const s = c.State || {};
      if (s.Dead || s.Status === 'exited' || s.OOMKilled) return { ok: false, reason: 'exited: ' + (s.Error || ('code ' + s.ExitCode)) };
      const health = s.Health && s.Health.Status;
      if (health === 'healthy') return { ok: true, inspect: c };
      if (health === 'unhealthy') return { ok: false, reason: 'became unhealthy' };
      if (!health && s.Running && !s.Restarting) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 6000) return { ok: true, inspect: c };
      } else if (!health) stableSince = 0;
    }
    return { ok: false, reason: 'did not become ready within ' + seconds + 's' };
  }
  /* Run a command inside a running container and return its exit code (null if unknown). */
  async function execCode (id, cmd, seconds) {
    try {
      const c = await call('POST', '/containers/' + encodeURIComponent(id) + '/exec', { Cmd: cmd, AttachStdout: false, AttachStderr: false }, 15000);
      if (c.status !== 201 || !c.data || !c.data.Id) return null;
      const ex = c.data.Id;
      const s = await call('POST', '/exec/' + encodeURIComponent(ex) + '/start', { Detach: true }, 15000);
      if (!ok(s, [200, 204])) return null;
      const until = Date.now() + (seconds || 15) * 1000;
      while (Date.now() < until) {
        const j = await call('GET', '/exec/' + encodeURIComponent(ex) + '/json', null, 10000);
        if (j.status === 200 && j.data && j.data.Running === false) return typeof j.data.ExitCode === 'number' ? j.data.ExitCode : null;
        await sleep(400);
      }
    } catch (_) {}
    return null;
  }

  /*
   * Replace a container with a new image, rolling back to the untouched original on failure.
   * opts: { id, image, readySeconds=90, dataCheck: ['sh','-c','test -f ...'] | null,
   *         envFromImage: bool (drop baked env of the old image), dropEnv: [], log: fn }
   * Resolves { ok, id?, rolledBack?, reason?, recovery?, warning? }.
   */
  async function replaceContainer (opts) {
    const log = opts.log || (() => {});
    const old = await inspect(opts.id);
    if (!old) throw new Error('The container to update no longer exists');
    const name = String(old.Name || '').replace(/^\/+/, '');
    if (!name) throw new Error('Could not determine the container name');
    const wasRunning = !!(old.State && old.State.Running);
    const readySeconds = opts.readySeconds || 90;

    const body = recreateBody(old, opts.image, {
      imageEnv: opts.envFromImage ? await imageEnv(old.Image) : null,
      dropEnv: opts.dropEnv || []
    });

    // Baseline: does the running original actually see its data?
    let hadData = null;
    if (opts.dataCheck && wasRunning) {
      const code = await execCode(old.Id, opts.dataCheck);
      hadData = code === null ? null : code === 0;
      log('data check on current container: ' + (hadData === null ? 'unavailable' : hadData ? 'data present' : 'no data yet'));
    }

    const parked = (name + '-rollback-' + Date.now()).slice(0, 120);
    const recovery = 'docker rename ' + parked + ' ' + name + ' && docker start ' + name;
    // If this fails, nothing has been changed yet — say so plainly.
    try { await rename(old.Id, parked); }
    catch (e) { return { ok: false, rolledBack: true, untouched: true, reason: 'update aborted before any change (' + e.message + ')' }; }
    log('parked original as ' + parked + ' (manual recovery if interrupted: ' + recovery + ')');

    let replacement = '';
    try {
      if (wasRunning) { await stop(old.Id); log('stopped original'); }
      replacement = await create(name, body);
      log('created replacement ' + replacement.slice(0, 12));
      if (wasRunning) {
        await start(replacement);
        const ready = await waitReady(replacement, readySeconds);
        if (!ready.ok) throw new Error('replacement ' + ready.reason);
      }
      const now = await inspect(replacement);
      const mounts = mountsMatch(old, now);
      if (!mounts.ok) throw new Error('replacement is missing mounts: ' + mounts.missing.join(', '));
      if (opts.dataCheck && wasRunning && hadData === true) {
        const code = await execCode(replacement, opts.dataCheck);
        if (code !== null && code !== 0) throw new Error('replacement cannot see its data directory');
      }
    } catch (e) {
      log('update failed: ' + e.message + ' — restoring the original container');
      const gone = await removeContainer(replacement);
      try {
        if (!gone) throw new Error('could not remove the failed replacement');
        await rename(old.Id, name);
        if (wasRunning) {
          await start(old.Id);
          const ready = await waitReady(old.Id, readySeconds);
          if (!ready.ok) log('original restored but not ready yet: ' + ready.reason);
        }
        log('rollback complete: original container restored unchanged');
        return { ok: false, rolledBack: true, reason: e.message };
      } catch (re) {
        log('ROLLBACK FAILED: ' + re.message + ' — recover with: ' + recovery);
        return { ok: false, rolledBack: false, reason: e.message + ' · rollback: ' + re.message, recovery };
      }
    }

    // Success: discard the original container. Volumes are left in place.
    const removed = await removeContainer(old.Id);
    log(removed ? 'removed original container' : 'update succeeded but the old container ' + parked + ' could not be removed');
    return { ok: true, id: replacement, warning: removed ? '' : 'Old container ' + parked + ' was left behind; you can remove it manually.' };
  }

  return { inspect, replaceContainer, waitReady, execCode, create, removeContainer };
}

module.exports = { recreateHostConfig, recreateNetworking, recreateBody, splitNetworking, mountsMatch, makeDocker };
