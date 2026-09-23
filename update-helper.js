'use strict';
/*
 * One-shot MEDIARR self-updater. Launched by server.js as a short-lived container
 * (from the currently installed image) with the Docker socket mounted.
 *
 * The replace/rollback logic lives in docker-recreate.js and is shared with the
 * Docker Controls updater. In short: the running MEDIARR container is renamed and
 * stopped rather than deleted, the new version is created under the original name,
 * and it must become healthy, keep every mount, and still see its data directory.
 * Otherwise the replacement is removed and the original container is restored as-is.
 */
const http = require('http');
const fs = require('fs');
const { makeDocker } = require('./docker-recreate');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const SELF_ID = process.env.MEDIARR_UPDATE_SELF_ID || '';
const TARGET_IMAGE = process.env.MEDIARR_UPDATE_TARGET_IMAGE || '';
const TARGET_VERSION = process.env.MEDIARR_UPDATE_TARGET_VERSION || '';
const OLD_VERSION = process.env.MEDIARR_UPDATE_OLD_VERSION || '';

function log (msg) { console.log('[mediarr-updater] ' + msg); }

function request (method, path, body, timeout) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = { Host: 'localhost', Accept: 'application/json', 'Content-Length': payload ? payload.length : 0 };
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({ socketPath: SOCKET, path, method, headers }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', c => { if (text.length < 2 * 1024 * 1024) text += c; });
      res.on('end', () => {
        let data = null;
        if (text.trim()) { try { data = JSON.parse(text); } catch (_) { data = text; } }
        resolve({ status: res.statusCode || 0, data, body: text });
      });
    });
    req.setTimeout(timeout || 30000, () => req.destroy(new Error('Docker API timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let API = '';
async function call (method, path, body, timeout) {
  if (!API) {
    const v = await request('GET', '/version', null, 15000);
    if (v.status !== 200 || !v.data || !v.data.ApiVersion) throw new Error('Docker API unavailable');
    API = '/v' + v.data.ApiVersion;
  }
  return request(method, API + path, body, timeout);
}

(async () => {
  if (!SELF_ID || !TARGET_IMAGE) throw new Error('Missing update parameters');
  if (!fs.existsSync(SOCKET)) throw new Error('Docker socket is missing');
  log('preparing ' + (OLD_VERSION || '?') + ' -> ' + (TARGET_VERSION || TARGET_IMAGE));
  await new Promise(r => setTimeout(r, 1500)); // let the API response reach the browser first

  const docker = makeDocker(call);
  const result = await docker.replaceContainer({
    id: SELF_ID,
    image: TARGET_IMAGE,
    readySeconds: 120,
    // Env baked into the old image (PATH, NODE_VERSION, MEDIARR_VERSION...) must not
    // override the new image's own values; user-set variables are kept.
    envFromImage: true,
    dropEnv: ['MEDIARR_VERSION'],
    // A detached /data still answers the health check, so verify the data itself.
    dataCheck: ['sh', '-c', 'test -f "${DATA_DIR:-/data}/users.json"'],
    log
  });

  if (result.ok) {
    log('update completed successfully' + (result.warning ? ' (' + result.warning + ')' : ''));
    return;
  }
  log(result.untouched ? 'no changes were made: ' + result.reason
    : result.rolledBack ? 'update was rolled back: ' + result.reason
    : 'update failed and could not roll back automatically: ' + result.reason);
  if (result.recovery) log('to recover manually run: ' + result.recovery);
  process.exitCode = 1;
})().catch(e => { console.error('[mediarr-updater] fatal: ' + (e && e.stack || e)); process.exitCode = 1; });
