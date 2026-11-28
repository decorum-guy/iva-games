/** Real HTTP/WebSocket/SQLite probe. This is protocol automation, not browser play. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFile, cp, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import WebSocket from 'ws';
const root = fileURLToPath(new URL('../../../', import.meta.url));
await mkdir(resolve(root, '.qa'), { recursive: true });
const directory = await mkdtemp(resolve(root, '.qa/realtime-network-'));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(r => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
let processHandle, logs = '', cookie = '', clients = [], entry = resolve(root, 'dist-realtime/main.js');
let staticDirectory = resolve(root, 'games/forpost/dist');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  logs = '';
  processHandle = spawn(process.execPath, [entry], { cwd: root,
    env: { ...process.env, REALTIME_PORT: String(port), REALTIME_HOST: '127.0.0.1', REALTIME_PUBLIC_ORIGIN: origin,
      REALTIME_DATABASE_PATH: resolve(directory, 'realtime.sqlite'), REALTIME_PRACTICE_KEY_PATH: resolve(directory, 'key.pem'),
      REALTIME_STATIC_DIRECTORY: staticDirectory, IVA_BUILD_SHA: 'network-smoke' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  processHandle.stdout.on('data', d => { logs = (logs + d).slice(-6000); });
  processHandle.stderr.on('data', d => { logs = (logs + d).slice(-6000); });
  for (let i = 0; i < 250; i++) {
    try { const r = await fetch(origin + '/health/ready'); if (r.ok) return; } catch { /* startup */ }
    if (processHandle.exitCode !== null) throw new Error('Server exited during startup: ' + logs);
    await sleep(100);
  }
  throw new Error('Server health timeout: ' + logs);
}
async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  for (const client of clients) client.close(); clients = [];
  const exited = once(processHandle, 'exit'); processHandle.kill('SIGTERM');
  const [code] = await exited; assert.equal(code, 0, 'drained server shutdown');
}
async function post(path, value = {}, useCookie = true) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(useCookie && cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(value) });
  if (useCookie && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return { status: response.status, body: await response.json() };
}
async function socket(ticket) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws/realtime/v1', 'iva-realtime-v1', { origin });
  const messages = [], baselines = new Map();
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'full' || message.type === 'delta') {
      if (message.type === 'delta') {
        const baseline = baselines.get(message.baselineSnapshotSeq);
        if (!baseline) { messages.push({ type: 'protocolFailure', code: 'MISSING_BASELINE' }); return; }
        assert.equal(message.view, undefined, 'delta carries only a filtered patch'); message.view = { ...baseline, ...message.patch };
      }
      baselines.set(message.snapshotSeq, message.view);
      while (baselines.size > 32) baselines.delete(baselines.keys().next().value);
      ws.send(JSON.stringify({ type: 'ackSnapshot', protocolVersion: 1, matchId: message.matchId, epoch: message.epoch, controllerGeneration: message.controllerGeneration, snapshotSeq: message.snapshotSeq }));
    }
    messages.push(message);
  });
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'authenticate', ticket }));
  const client = { ws, messages, hello: null, beat: null,
    async wait(predicate, ms = 7000) {
      const until = Date.now() + ms;
      while (Date.now() < until) { const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0]; await sleep(20); }
      throw new Error('Message wait timed out; observed types: ' + messages.map(m => m.type + (m.code ? ':' + m.code : '')).join(','));
    },
    send(type, extra = {}) {
      ws.send(JSON.stringify({ type, protocolVersion: 1, matchId: client.hello.matchId, epoch: client.hello.epoch, controllerGeneration: client.hello.controllerGeneration, ...extra }));
    },
    close() { clearInterval(client.beat); ws.close(); },
  };
  clients.push(client); return client;
}
async function admitted(ticket) {
  const client = await socket(ticket); client.hello = await client.wait(m => m.type === 'hello');
  client.beat = setInterval(() => { if (client.ws.readyState === WebSocket.OPEN) client.send('heartbeat'); }, 1000);
  return client;
}
const passed = [];
const snapshot = message => message.type === 'full' || message.type === 'delta';
try {
  await start();
  const startRoom = await post('/api/realtime/v1/practice', { mapId: 'FP01', teamSize: 1, displayName: 'QA', botLevel: 'novice', mode: 'training', seed: 9123 });
  assert.equal(startRoom.status, 201); const firstTicket = startRoom.body.ticket, matchId = startRoom.body.matchId;
  assert.match(startRoom.body.route, /^\/realtime-assets\/[0-9a-f]{64}\/$/);
  const originalHtml = await (await fetch(origin + startRoom.body.route)).text();
  assert.equal(originalHtml, await (await fetch(origin + '/play/forpost/')).text());
  passed.push('current build and content-addressed client serve identical accepted bytes');
  const first = await admitted(firstTicket), firstView = await first.wait(m => m.type === 'full');
  assert.equal(first.hello.controlling, true); assert.equal(firstView.view.matchId, matchId);
  assert.equal(firstView.world, undefined); assert.equal(firstView.view.seed, undefined); assert.equal(firstView.view.history, undefined);
  first.send('input', { inputSeq: 500, payload: { moveX: 0, moveZ: 0, aimX: 1, aimZ: 0, fireHeld: false, firePressSeq: 0 } });
  await first.wait(m => snapshot(m) && m.worldTick > 2 && m.lastConsumedInputSeq === 500);
  // Preparation intentionally freezes units; movement must be checked in battle.
  await first.wait(m => snapshot(m) && m.view.phase === 'battle', 25_000);
  assert.ok(first.messages.some(m => m.type === 'delta')); assert.equal(first.messages.some(m => m.type === 'protocolFailure'), false);
  first.send('resync'); await first.wait(m => m.type === 'full' && m.view.phase === 'battle');
  passed.push('personal acknowledged delta stream and requested full resynchronization');
  passed.push('real practice admission and filtered full');
  const replay = await socket(firstTicket); await replay.wait(m => m.type === 'error');
  assert.equal(replay.messages.some(snapshot), false); replay.close(); passed.push('one-use ticket denied before state');
  const unauthorized = await post(`/api/realtime/v1/practice/${matchId}/ticket`, {}, false); assert.equal(unauthorized.status, 404); passed.push('another guest cannot resume');
  const secondTicket = await post(`/api/realtime/v1/practice/${matchId}/ticket`), second = await admitted(secondTicket.body.ticket);
  assert.equal(second.hello.controlling, false); second.send('claimControl');
  const control = await second.wait(m => m.type === 'controlChanged' && m.controlling); second.hello.controllerGeneration = control.controllerGeneration;
  await first.wait(m => m.type === 'controlChanged' && !m.controlling);
  first.send('input', { inputSeq: 1, payload: { moveX: 1, moveZ: 0, aimX: 1, aimZ: 0, fireHeld: false, firePressSeq: 0 } });
  await first.wait(m => m.type === 'error' && m.code === 'STALE_CONTROLLER'); passed.push('atomic one-controller transfer');
  const startMove = await second.wait(m => snapshot(m) && m.controllerGeneration === control.controllerGeneration && m.view.phase === 'battle');
  const initialFighter = startMove.view.units.find(u => u.ownerId === second.hello.participantId && u.kind === 'fighter');
  const direction = startMove.view.teams[startMove.view.yourTeam].side === 'L' ? 1 : -1;
  second.send('input', { inputSeq: 1, payload: { moveX: direction, moveZ: 0, aimX: direction, aimZ: 0, fireHeld: false, firePressSeq: 0 } });
  const moved = await second.wait(m => snapshot(m) && m.worldTick >= startMove.worldTick + 18);
  const movedFighter = moved.view.units.find(u => u.id === initialFighter.id);
  assert.ok((movedFighter.x - initialFighter.x) * direction > 0.1, 'new controller sequence 1 moves after previous stream sequence 500');
  const neutral = await second.wait(m => snapshot(m) && m.worldTick >= moved.worldTick + 12);
  const stoppedFighter = neutral.view.units.find(u => u.id === initialFighter.id);
  assert.ok(Math.abs(stoppedFighter.x - movedFighter.x) < 0.05, 'stale movement neutralizes without a key-up packet');
  passed.push('new input sequence after takeover and 250ms neutralization');
  const actionId = 'forpost-smoke-mode-1'; second.send('action', { actionId, payload: { type: 'mode', mode: 'tactics' } });
  const ack = await second.wait(m => m.type === 'actionAck' && m.actionId === actionId); assert.equal(ack.result.ok, true);
  second.send('action', { actionId, payload: { type: 'mode', mode: 'tactics' } });
  const repeated = await second.wait(m => m.type === 'actionAck' && m.actionId === actionId); assert.equal(repeated.replayed, true); assert.deepEqual(repeated.result, ack.result);
  second.send('action', { actionId, payload: { type: 'mode', mode: 'fighter' } }); await second.wait(m => m.type === 'error' && m.code === 'ACTION_CONFLICT');
  passed.push('durable ACK repeat and payload conflict');
  const before = await second.wait(m => snapshot(m) && m.worldTick > 10);
  first.close(); second.close();
  await sleep(11_000);
  const health = await (await fetch(origin + '/health/ready')).json(); assert.equal(health.ok, true); assert.equal(health.metrics.storageFailures, 0);
  await stop(); await start();
  const restoredTicket = await post(`/api/realtime/v1/practice/${matchId}/ticket`); assert.equal(restoredTicket.status, 200);
  const restored = await admitted(restoredTicket.body.ticket), full = await restored.wait(m => m.type === 'full');
  assert.ok(restored.hello.epoch > first.hello.epoch); assert.ok(full.worldTick >= before.worldTick); assert.equal(full.view.matchId, matchId);
  restored.send('action', { actionId, payload: { type: 'mode', mode: 'tactics' } });
  const restoredAck = await restored.wait(m => m.type === 'actionAck' && m.actionId === actionId); assert.equal(restoredAck.replayed, true);
  passed.push('pause, process restart, same match and committed receipt');
  const previousEpoch = restored.hello.epoch;
  for (const client of clients) client.close(); clients = [];
  const killed = once(processHandle, 'exit'); processHandle.kill('SIGKILL'); await killed; processHandle = null;
  await start();
  const crashTicket = await post(`/api/realtime/v1/practice/${matchId}/ticket`); assert.equal(crashTicket.status, 200);
  const crashClient = await admitted(crashTicket.body.ticket); assert.ok(crashClient.hello.epoch > previousEpoch);
  crashClient.send('action', { actionId, payload: { type: 'mode', mode: 'tactics' } });
  assert.equal((await crashClient.wait(m => m.type === 'actionAck' && m.actionId === actionId)).replayed, true);
  passed.push('abrupt process death, expired lease and durable receipt recovery');
  const pinnedArtifact = crashClient.hello.artifactId;
  await stop();
  const updatedDirectory = resolve(directory, 'updated-build');
  await cp(resolve(root, 'dist-realtime'), updatedDirectory, { recursive: true });
  const updatedClient = resolve(directory, 'updated-client'); await cp(staticDirectory, updatedClient, { recursive: true });
  await appendFile(resolve(updatedClient, 'index.html'), '\n<!-- controlled client-content retention probe -->\n'); staticDirectory = updatedClient;
  // A deliberately different compiled artifact tests version routing, not game balance.
  await appendFile(resolve(updatedDirectory, 'simulation-worker.js'), '\n// controlled artifact-retention probe\n');
  entry = resolve(updatedDirectory, 'main.js'); await start();
  const newHealth = await (await fetch(origin + '/health/ready')).json(); assert.notEqual(newHealth.artifactId, pinnedArtifact);
  const pinnedTicket = await post(`/api/realtime/v1/practice/${matchId}/ticket`), pinned = await admitted(pinnedTicket.body.ticket);
  assert.equal(pinned.hello.artifactId, pinnedArtifact);
  assert.equal(pinnedTicket.body.route, startRoom.body.route); assert.equal(await (await fetch(origin + pinnedTicket.body.route)).text(), originalHtml);
  pinned.send('action', { actionId, payload: { type: 'mode', mode: 'tactics' } });
  assert.equal((await pinned.wait(m => m.type === 'actionAck' && m.actionId === actionId)).replayed, true);
  const fresh = await post('/api/realtime/v1/practice', { mapId: 'FP03', teamSize: 1, displayName: 'QA next image', mode: 'training' });
  assert.equal(fresh.status, 201); const freshClient = await admitted(fresh.body.ticket);
  assert.equal(freshClient.hello.artifactId, newHealth.artifactId);
  assert.notEqual(fresh.body.route, startRoom.body.route); assert.match(await (await fetch(origin + fresh.body.route)).text(), /controlled client-content retention probe/);
  await post(`/api/realtime/v1/practice/${fresh.body.matchId}/abandon`);
  passed.push('new artifact starts new rooms while existing rooms retain exact simulation code');
  const abandoned = await post(`/api/realtime/v1/practice/${matchId}/abandon`); assert.equal(abandoned.status, 200);
  passed.push('owner can end saved practice');
  await stop();
  console.log(JSON.stringify({ passed: passed.length, checks: passed, lastHealth: health.metrics, evidenceDirectory: directory, kind: 'automated HTTP/WebSocket, not browser acceptance' }, null, 2));
} catch (error) { console.error(logs); throw error; }
finally { await stop(); }
