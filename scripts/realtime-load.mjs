// Real compiled realtime, Rapier, signed bridge, independent WebSockets and
// continuous inputs. This measures this machine; it is not browser gameplay,
// a completed expedition, a network-loss emulator, or a production VPS claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign, createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { applyLoadChanges } from './realtime-load-view.mjs';

const allowed = new Set(['--output', '--runtime', '--client', '--seconds', '--rooms', '--profile', '--memory-mib']);
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  assert.ok(allowed.has(process.argv[index]) && process.argv[index + 1] && !args.has(process.argv[index]), 'Use documented --name value arguments');
  args.set(process.argv[index], process.argv[index + 1]);
}
const seconds = Number(args.get('--seconds') ?? 3600), rooms = Number(args.get('--rooms') ?? 2), profile = args.get('--profile') ?? 'humans';
assert.ok(Number.isInteger(seconds) && seconds >= 20 && seconds <= 86_400);
assert.ok(Number.isInteger(rooms) && rooms >= 1 && rooms <= 8 && ['humans', 'bots'].includes(profile));
const humanCount = profile === 'humans' ? 6 : 1;
const output = resolve(args.get('--output') ?? `.qa/realtime-load/${Date.now()}-${profile}`);
assert.equal(existsSync(output), false, 'Load evidence directory must be new; never overwrite a saved database'); mkdirSync(output, { recursive: true, mode: 0o700 });
const data = join(output, 'data'); mkdirSync(data);
const memoryBudgetBytes = args.has('--memory-mib') ? Number(args.get('--memory-mib')) * 1024 ** 2 : os.totalmem();
assert.ok(Number.isFinite(memoryBudgetBytes) && memoryBudgetBytes >= 128 * 1024 ** 2);
const runtime = resolve(args.get('--runtime') ?? 'dist-realtime/main.js'), clientDirectory = resolve(args.get('--client') ?? 'games/tyaga/dist');
assert.ok(existsSync(runtime) && existsSync(join(clientDirectory, 'index.html')), 'Build the exact runtime/client before this test');
const publicFile = join(output, 'trusted-public.json'), keys = generateKeyPairSync('ed25519');
writeFileSync(publicFile, JSON.stringify({ load: keys.publicKey.export({ type: 'spki', format: 'pem' }) }), { mode: 0o600 });
const machine = { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(), cpuModel: os.cpus()[0]?.model,
  reportedLogicalCpus: os.availableParallelism(), reportedMemoryBytes: os.totalmem(), freeMemoryAtStart: os.freemem(),
  memoryReferenceBytes: memoryBudgetBytes, memoryReference: args.has('--memory-mib') ? 'explicit test budget, not an enforced limit' : 'OS-reported machine total, allocation limit not inferred',
  productionVpsMeasured: false };
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
const signature = (purpose, payload) => sign(null, Buffer.from(`${purpose}\n${payload}`), keys.privateKey).toString('base64url');
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(done => probe.close(done));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [runtime], { env: { ...process.env, NODE_ENV: 'test', REALTIME_HOST: '127.0.0.1', REALTIME_PORT: String(port),
  REALTIME_DATABASE_PATH: join(data, 'realtime.sqlite'), REALTIME_ARTIFACT_DIRECTORY: join(data, 'runtime-artifacts'), REALTIME_TRUSTED_KEYS_FILE: publicFile, REALTIME_ALLOWED_ORIGINS: origin,
  REALTIME_ALLOWED_HOSTS: `127.0.0.1:${port}`, REALTIME_TYAGA_STATIC_DIRECTORY: clientDirectory, REALTIME_MAX_MATCHES: String(rooms), REALTIME_REVISION: 'isolated-load-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let tail = '', fatal = null, stopping = false;
const childExit = once(child, 'exit');
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { appendFileSync(join(output, 'runtime.log'), bytes); tail = (tail + bytes).slice(-8192); });
child.once('exit', code => { if (!stopping) fatal = new Error(`Runtime exited ${code}: ${tail}`); });
const clients = [], starts = [], timers = [], errors = [], measurements = [];
let errorCount = 0;
const recordError = value => { errorCount += 1; if (errors.length < 100) errors.push(value); };
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; }); process.once('SIGTERM', () => { interrupted = true; });
const record = value => appendFileSync(join(output, 'measurements.jsonl'), JSON.stringify(value) + '\n');
async function bridge(path, body = {}, method = 'POST', expected = 200) {
  const unsigned = { keyId: 'load', nonce: randomBytes(24).toString('base64url'), issuedAt: Date.now(), method, path, body };
  const envelope = { ...unsigned, signature: signature('iva-bridge-v1', canonical(unsigned)) };
  const response = await fetch(origin + path, { method, headers: method === 'GET' ? { 'X-Iva-Service-Request': Buffer.from(JSON.stringify(envelope)).toString('base64url') } : { 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(envelope) }), signal: AbortSignal.timeout(10_000) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
}
const metrics = () => bridge('/internal/realtime/v1/metrics', {}, 'GET');
const scope = client => ({ protocolVersion: 'iva-realtime@1', matchId: client.matchId, epoch: client.snapshot.epoch, controllerGeneration: client.snapshot.controllerGeneration });
function send(client, value) { if (client.ws.readyState === WebSocket.OPEN && client.snapshot) { client.ws.send(JSON.stringify({ ...scope(client), ...value })); client.sent += 1; } }
async function connect(start, participant) {
  const now = Date.now(), sessionId = createHash('sha256').update(participant.playerId).digest('hex');
  const claims = { issuer: 'iva-platform', audience: 'iva-realtime', keyId: 'load', ticketId: randomBytes(24).toString('base64url'), playerId: participant.playerId,
    participantId: participant.participantId, matchId: start.matchId, roomId: start.input.roomId, rosterHash: start.status.rosterHash, gameId: 'tyaga',
    rulesVersion: start.status.manifest.rulesVersion, contentVersion: start.status.manifest.contentVersion, protocolVersion: 'iva-realtime@1',
    allowedOrigin: origin, permission: 'play', sessionId, issuedAt: now, expiresAt: now + 30_000 };
  const encoded = Buffer.from(canonical(claims)).toString('base64url');
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws/realtime/v1', 'iva-realtime-v1', { origin });
  const client = { ws, matchId: start.matchId, participantId: participant.participantId, sessionId, snapshot: null, baselines: new Map(), sequence: 0,
    anchor: null, lastPosition: null, travelled: 0, sent: 0, received: 0, resyncAt: 0, actions: new Map(), receipts: 0, overloadFrames: 0 };
  clients.push(client);
  ws.on('error', error => { if (!stopping) recordError({ type: 'socket-error', message: error.message }); });
  ws.on('close', (code) => { if (!stopping) recordError({ type: 'socket-close', code }); });
  ws.on('message', bytes => {
    try {
      const frame = JSON.parse(bytes); client.received += 1;
      if (frame.type === 'error') recordError({ type: 'protocol', code: frame.code });
      if (frame.type === 'actionAck') { const pending = client.actions.get(frame.actionId); if (pending) { assert.equal(frame.result.ok, true); client.actions.delete(frame.actionId); client.receipts += 1; } }
      if (frame.type !== 'full' && frame.type !== 'delta') return;
      if (frame.type === 'delta') {
        const baseline = client.baselines.get(frame.baselineSnapshotSeq);
        if (!baseline) { if (performance.now() - client.resyncAt > 250) { client.resyncAt = performance.now(); send(client, { type: 'resync' }); } return; }
        frame.view = applyLoadChanges(baseline, frame.changes);
      }
      if (client.snapshot && frame.epoch !== client.snapshot.epoch) { recordError({ type: 'unexpected-epoch-change' }); client.baselines.clear(); }
      client.snapshot = frame; client.baselines.set(frame.snapshotSeq, frame.view); while (client.baselines.size > 64) client.baselines.delete(client.baselines.keys().next().value);
      client.sequence = Math.max(client.sequence, frame.lastConsumedInputSeq);
      if (frame.pauseReason === 'overload') client.overloadFrames += 1;
      const person = frame.view.entities.find(entity => entity.participantId === client.participantId);
      if (person) { client.anchor ??= { ...person.position }; if (client.lastPosition) client.travelled += Math.hypot(person.position.x - client.lastPosition.x, person.position.z - client.lastPosition.z); client.lastPosition = { ...person.position }; }
      send(client, { type: 'ackSnapshot', snapshotSeq: frame.snapshotSeq });
    } catch (error) { recordError({ type: 'client-projection', message: error.message }); }
  });
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'authenticate', ticket: `${encoded}.${signature('iva-ticket-v1', encoded)}` })); return client;
}
function sampledTimings(report) {
  return report.diagnostics.workers.flatMap(worker => (worker.diagnostics?.games ?? []).map(game => ({ key: worker.runtimeArtifactIds.join(',') + ':' + game.gameId, game })));
}
function intervalQuantile(before, after, field, fraction = .99) {
  const initial = before[field], final = after[field], count = final.count - initial.count; assert.ok(count >= 0, 'Measurement counters reset during the load');
  let sum = 0; for (let index = 0; index < final.buckets.length; index++) { const delta = final.buckets[index].count - initial.buckets[index].count; assert.ok(delta >= 0); sum += delta; if (count && sum >= Math.ceil(count * fraction)) return { count, upperMs: final.buckets[index].upperMs }; }
  return { count, upperMs: null };
}
function sqliteBytes() { return ['realtime.sqlite', 'realtime.sqlite-wal', 'realtime.sqlite-shm'].reduce((sum, name) => sum + (existsSync(join(data, name)) ? statSync(join(data, name)).size : 0), 0); }
let report;
try {
  let health;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (fatal) throw fatal;
    try { const response = await fetch(origin + '/health/realtime/ready', { signal: AbortSignal.timeout(300) }); if (response.ok) { health = await response.json(); break; } } catch { /* Own child may still be loading its verified world reader. */ }
    await sleep(50);
  }
  assert.ok(health?.ok, tail); const manifest = health.games.find(game => game.gameId === 'tyaga'); assert.ok(manifest);
  for (let room = 0; room < rooms; room++) {
    const participants = Array.from({ length: 6 }, (_value, seatIndex) => ({ participantId: `load-${room}-${seatIndex}`, playerId: seatIndex < humanCount ? `load-player-${room}-${seatIndex}` : null,
      displayName: `Load fixture ${seatIndex + 1}`, seatIndex, controller: seatIndex < humanCount ? { kind: 'human', playerId: `load-player-${room}-${seatIndex}` } : { kind: 'bot', botProfileId: 'helper', botVersion: manifest.botVersion, difficulty: 'normal' } }));
    const input = { startCommandId: randomUUID(), roomId: randomUUID(), hostPlayerId: participants[0].playerId, rulesVersion: manifest.rulesVersion, contentVersion: manifest.contentVersion,
      settings: { mapId: room % 2 ? 'quarry' : 'ridge', mode: 'practice' }, participants };
    const created = await bridge('/internal/realtime/v1/matches', { gameId: 'tyaga', input });
    const status = await bridge(`/internal/realtime/v1/matches/${created.matchId}/status`, {}, 'GET'); const start = { ...created, input, status }; starts.push(start);
    await Promise.all(participants.filter(participant => participant.playerId).map(participant => connect(start, participant)));
  }
  const activeIds = clients.map(client => client.sessionId);
  const admissionTimer = setInterval(() => { void bridge('/internal/realtime/v1/admissions', { sessionIds: activeIds }).catch(error => { fatal = error; }); }, 20_000); timers.push(admissionTimer);
  const inputStarted = performance.now();
  timers.push(setInterval(() => {
    const angle = (performance.now() - inputStarted) / 12_000;
    for (const client of clients) {
      if (!client.snapshot?.hasControl || client.snapshot.phase !== 'running' || !client.anchor || !client.lastPosition) continue;
      const dx = client.anchor.x + 2 + Math.cos(angle) * 1.5 - client.lastPosition.x, dz = client.anchor.z + 3 + Math.sin(angle) * 1.5 - client.lastPosition.z, distance = Math.max(1, Math.hypot(dx, dz));
      send(client, { type: 'input', inputSeq: ++client.sequence, payload: { moveX: dx / distance, moveZ: dz / distance, run: false, throttle: 0, steer: 0, brake: false, tool: 0 } });
    }
  }, 1000 / 30));
  timers.push(setInterval(() => {
    for (const client of clients) {
      send(client, { type: 'heartbeat', nonce: randomUUID() });
      for (const [actionId, pending] of client.actions) {
        if (performance.now() - pending.started > 30_000) { recordError({ type: 'action-timeout' }); client.actions.delete(actionId); }
        else if (performance.now() - pending.sent > 2000) { pending.sent = performance.now(); send(client, { type: 'action', actionId, payload: pending.payload }); }
      }
    }
  }, 1000));
  let appearance = 0;
  timers.push(setInterval(() => {
    appearance = 1 - appearance;
    for (const client of clients) if (client.snapshot?.phase === 'running' && !client.actions.size) {
      const actionId = randomUUID(), payload = { type: 'appearance', head: appearance, backpack: appearance }, now = performance.now();
      client.actions.set(actionId, { payload, started: now, sent: now }); send(client, { type: 'action', actionId, payload });
    }
  }, 15_000));
  for (let attempt = 0; attempt < 200 && !clients.every(client => client.snapshot?.phase === 'running'); attempt++) { if (fatal) throw fatal; await sleep(50); }
  assert.ok(clients.every(client => client.snapshot?.phase === 'running'), 'All requested independent controllers must enter running worlds');
  await sleep(10_000);
  const first = await metrics(); assert.equal(first.diagnostics.legacyWorkers, 0); assert.equal(first.activeMatches, rooms);
  const started = performance.now(), initialBytes = sqliteBytes(); let previous = first;
  writeFileSync(join(output, 'configuration.json'), JSON.stringify({ machine, seconds, rooms, profile, humansPerRoom: humanCount, runtime,
    runtimeEntrySha256: createHash('sha256').update(readFileSync(runtime)).digest('hex'),
    clientEntrySha256: createHash('sha256').update(readFileSync(join(clientDirectory, 'index.html'))).digest('hex'),
    clientDirectory, manifests: starts.map(start => start.status.manifest), warmupSeconds: 10, inputHz: 30, expectedSnapshotHz: 20 }, null, 2));
  console.log(JSON.stringify({ state: 'measuring', output, seconds, rooms, profile, clients: clients.length, runtimeArtifactId: manifest.runtimeArtifactId }));
  while (performance.now() - started < seconds * 1000) {
    if (fatal) throw fatal; if (interrupted) throw new Error('Load measurement interrupted; not a completed hour');
    await sleep(Math.min(5000, Math.max(1, seconds * 1000 - (performance.now() - started))));
    const current = await metrics(), elapsedSeconds = (performance.now() - started) / 1000;
    const dt = current.gateway.process.uptimeSeconds - previous.gateway.process.uptimeSeconds;
    const cpu = current.gateway.process.cpuMicroseconds, oldCpu = previous.gateway.process.cpuMicroseconds;
    const utilization = (a, b) => (a.active - b.active) / Math.max(.001, a.active + a.idle - b.active - b.idle);
    const workerUtilizations = current.diagnostics.workers.map((worker, index) => utilization(worker.diagnostics.eventLoop.utilization, previous.diagnostics.workers[index].diagnostics.eventLoop.utilization));
    const sample = { elapsedSeconds, cpuCoreEquivalents: (cpu.user + cpu.system - oldCpu.user - oldCpu.system) / (dt * 1e6),
      gatewayUtilization: utilization(current.gateway.eventLoop.utilization, previous.gateway.eventLoop.utilization), workerUtilizations, sqliteBytes: sqliteBytes(),
      loadGenerator: { memory: process.memoryUsage(), cpuMicroseconds: process.cpuUsage() }, report: current };
    measurements.push({ elapsedSeconds, cpuCoreEquivalents: sample.cpuCoreEquivalents, gatewayUtilization: sample.gatewayUtilization,
      workerUtilizations, rss: current.gateway.process.memory.rss, sqliteBytes: sample.sqliteBytes }); record(sample); previous = current;
    assert.equal(current.ok, true, 'Runtime readiness failed under the requested load'); assert.equal(current.activeMatches, rooms);
    assert.equal(current.failedMatches, 0); assert.equal(current.workerRestarts, 0); assert.equal(current.unavailableMatches, 0);
  }
  const elapsedSeconds = (performance.now() - started) / 1000, final = previous;
  const base = new Map(sampledTimings(first).map(value => [value.key, value.game]));
  const timings = sampledTimings(final).map(({ key, game }) => ({ key, step: intervalQuantile(base.get(key), game, 'step'), commit: intervalQuantile(base.get(key), game, 'commit'),
    uncommitted: intervalQuantile(base.get(key), game, 'uncommitted'), snapshotAge: intervalQuantile(base.get(key), game, 'snapshotAge'),
    serialize: intervalQuantile(base.get(key), game, 'serialize'), recent: { step: game.step.recent, commit: game.commit.recent },
    wholeProcessMaxStepMs: game.step.maxMs, wholeProcessMaxCommitMs: game.commit.maxMs }));
  const peakRss = Math.max(...measurements.map(sample => sample.rss)), maximumWorkerUtilization = Math.max(...measurements.flatMap(sample => sample.workerUtilizations)), maximumGatewayUtilization = Math.max(...measurements.map(sample => sample.gatewayUtilization));
  const checks = { requestedDurationCompleted: elapsedSeconds >= seconds, fullHourCompleted: elapsedSeconds >= 3600,
    stepP99BelowHalfInterval: timings.every(timing => timing.step.count > 0 && timing.step.upperMs !== null && timing.step.upperMs < 1000 / manifest.tickRate / 2),
    commitP99AtMost50ms: timings.every(timing => timing.commit.count > 0 && timing.commit.upperMs !== null && timing.commit.upperMs <= 50),
    cpuHeadroom30Percent: maximumWorkerUtilization <= .7 && maximumGatewayUtilization <= .7,
    memoryHeadroom25PercentOfReference: peakRss <= memoryBudgetBytes * .75,
    noQueueOverflow: final.gateway.totals.queueOverflows === 0 && final.gateway.totals.backpressureCloses === 0,
    noRateLimitOrProtocolErrors: final.gateway.totals.rateLimits === 0 && errorCount === 0,
    noOverloadPause: clients.every(client => client.overloadFrames === 0), allControllersActuallyMoved: clients.every(client => client.travelled > .1),
    durableActionsAcknowledged: clients.every(client => client.receipts > 0) };
  report = { complete: true, localBudgetPassed: Object.entries(checks).filter(([name]) => name !== 'fullHourCompleted').every(([, value]) => value), checks,
    machine, durationSeconds: elapsedSeconds, requestedSeconds: seconds, rooms, profile, clients: clients.length, timings,
    peakRss, maximumWorkerUtilization, maximumGatewayUtilization, sqliteGrowthBytes: sqliteBytes() - initialBytes,
    clientSummary: clients.map(client => ({ sent: client.sent, received: client.received, travelledMetres: client.travelled, receipts: client.receipts, overloadFrames: client.overloadFrames })), errorCount, errors,
    limitations: ['Synthetic protocol clients, not a rendered browser or mission-completion test.', 'No TCP packet-loss impairment in this run.', 'This profile does not substitute for the separate simultaneous ferry/lift/rope stress scene.', 'Production VPS performance and its allocation were not measured.'] };
} catch (error) {
  report = { complete: false, localBudgetPassed: false, requestedSeconds: seconds, rooms, profile, machine, error: error.message, errorCount, errors, runtimeTail: tail };
} finally {
  stopping = true; for (const timer of timers) clearInterval(timer); for (const client of clients) { client.ws.removeAllListeners('message'); client.ws.close(1000); }
  try {
    child.kill('SIGTERM'); const exit = await Promise.race([childExit, new Promise((_done, reject) => setTimeout(() => reject(new Error('Owned realtime process failed to drain')), 32_000).unref())]);
    report.shutdown = { code: exit[0], signal: exit[1] }; if (exit[0] !== 0) report.localBudgetPassed = false;
  } catch (error) { report.shutdown = { error: error.message }; report.localBudgetPassed = false; child.kill('SIGKILL'); }
  for (const client of clients) client.ws.terminate();
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ state: 'finished', report: join(output, 'report.json'), complete: report.complete, localBudgetPassed: report.localBudgetPassed, checks: report.checks }));
process.exitCode = report.complete && report.localBudgetPassed ? 0 : 1;
