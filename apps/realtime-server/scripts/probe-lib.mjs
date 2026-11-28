/** Isolated real-process QA helpers. No production credentials or accounts. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const isSnapshot = message => message.type === 'full' || message.type === 'delta';
export async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
export async function writeReport(path, report) { const temporary = path + '.tmp'; await writeFile(temporary, JSON.stringify(report, null, 2) + '\n'); await rename(temporary, path); }
export async function startRig({ prefix, port, publicOrigin, maxRooms = 4 } = {}) {
  await mkdir(resolve(root, '.qa'), { recursive: true }); const directory = await mkdtemp(resolve(root, '.qa/' + prefix + '-'));
  port ??= await freePort(); const endpoint = `http://127.0.0.1:${port}`, origin = publicOrigin ?? endpoint;
  let logs = '', cookie = '';
  const processHandle = spawn(process.execPath, [resolve(root, 'dist-realtime/main.js')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, REALTIME_PORT: String(port), REALTIME_HOST: '127.0.0.1', REALTIME_PUBLIC_ORIGIN: origin, REALTIME_MAX_ROOMS: String(maxRooms),
      REALTIME_DATABASE_PATH: resolve(directory, 'realtime.sqlite'), REALTIME_PRACTICE_KEY_PATH: resolve(directory, 'practice.pem'),
      REALTIME_TRUSTED_KEYS_PATH: '', REALTIME_STATIC_DIRECTORY: resolve(root, 'games/forpost/dist'), IVA_BUILD_SHA: 'isolated-' + prefix } });
  for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', data => { logs = (logs + data.toString()).slice(-8000); });
  const rig = { directory, endpoint, origin, processHandle,
    async health() { const response = await fetch(endpoint + '/health/ready'); return await response.json(); },
    async post(path, body = {}) {
      const response = await fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = await response.json(); if (!response.ok) throw new Error(`${path}: ${response.status} ${result.error?.code}`); return result;
    },
    async stop() {
      if (processHandle.exitCode !== null) return;
      const stopped = once(processHandle, 'exit'); processHandle.kill('SIGTERM');
      const [code] = await stopped; assert.equal(code, 0, 'own server must drain cleanly: ' + logs);
    },
    logs: () => logs,
  };
  for (let i = 0; i < 300; i++) {
    try { const response = await fetch(endpoint + '/health/ready'); if (response.ok) return rig; } catch { /* startup */ }
    if (processHandle.exitCode !== null) throw new Error('QA server exited: ' + logs); await sleep(100);
  }
  await rig.stop(); throw new Error('QA server startup timeout: ' + logs);
}
export async function connectClient(rig, ticket, onMessage = () => {}) {
  const ws = new WebSocket(rig.origin.replace('http:', 'ws:') + '/ws/realtime/v1', 'iva-realtime-v1', { origin: rig.origin });
  const messages = [], baselines = new Map(); let beat = null, hello = null, error = null;
  const client = { ws, messages, get hello() { return hello; }, get error() { return error; },
    send(type, extra = {}) { if (hello && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, protocolVersion: 1, matchId: hello.matchId, epoch: hello.epoch, controllerGeneration: hello.controllerGeneration, ...extra })); },
    close() { clearInterval(beat); ws.close(); },
    async wait(predicate, timeout = 12_000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (error) throw error; const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0]; await sleep(10);
      }
      throw new Error('Socket timeout: ' + messages.map(m => m.type + (m.code ? ':' + m.code : '')).slice(-12).join(','));
    },
  };
  ws.on('error', caught => { error = caught; });
  ws.on('message', data => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'hello') { hello = message; baselines.clear(); beat = setInterval(() => client.send('heartbeat'), 1000); }
      if (message.type === 'controlChanged' && hello) { hello.controllerGeneration = message.controllerGeneration; hello.controlling = message.controlling; }
      if (isSnapshot(message)) {
        if (message.type === 'delta') {
          const baseline = baselines.get(message.baselineSnapshotSeq); assert.ok(baseline, 'delta baseline belongs to this observer');
          assert.equal(message.view, undefined); message.view = { ...baseline, ...message.patch };
        }
        for (const field of ['seed', 'idSalt', 'history', 'receipts', 'rewindTicks', 'botRandom']) assert.equal(message.view[field], undefined, 'private world field: ' + field);
        baselines.set(message.snapshotSeq, message.view); while (baselines.size > 32) baselines.delete(baselines.keys().next().value);
        client.send('ackSnapshot', { snapshotSeq: message.snapshotSeq });
      }
      messages.push(message); while (messages.length > 128) messages.shift(); onMessage(message, client);
    } catch (caught) { error = caught; client.close(); }
  });
  ws.on('close', () => clearInterval(beat));
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'authenticate', ticket }));
  await client.wait(message => message.type === 'hello'); return client;
}
