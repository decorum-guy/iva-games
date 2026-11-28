/** Wall-clock load run with real HTTP/WS, workers and WAL. No accelerated ticks. */
import assert from 'node:assert/strict';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectClient, isSnapshot, sleep, startRig, writeReport } from './probe-lib.mjs';
const seconds = Number(process.argv.find(arg => arg.startsWith('--seconds='))?.slice(10) ?? 3600);
const roomCount = Number(process.argv.find(arg => arg.startsWith('--rooms='))?.slice(8) ?? 4);
if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 7200 || !Number.isSafeInteger(roomCount) || roomCount < 1 || roomCount > 4) throw new Error('Expected --seconds=30..7200 --rooms=1..4');
const rig = await startRig({ prefix: 'realtime-load', maxRooms: roomCount });
const reportPath = resolve(rig.directory, 'report.json'), slots = [], samples = [], failures = [], results = [];
const start = Date.now(), healthAtStart = await rig.health();
const machine = { node: process.version, platform: os.platform(), arch: os.arch(), availableParallelism: os.availableParallelism(), totalMemoryBytes: os.totalmem(),
  cpuQuota: await readFile('/sys/fs/cgroup/cpu.max', 'utf8').catch(() => 'unavailable'), memoryLimit: await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => 'unavailable') };
let complete = false, stopping = false;
process.once('SIGTERM', () => { stopping = true; }); process.once('SIGINT', () => { stopping = true; });
function snapshotReport() { return { kind: 'real wall-clock HTTP/WebSocket simulation load; no browser/FPS claim', complete, targetSeconds: seconds, elapsedSeconds: (Date.now() - start) / 1000,
  roomCount, teamSize: 3, botLevel: 'strong', artifactId: healthAtStart.artifactId, contentId: healthAtStart.contentId, sourceTrace: rig.sourceTrace, machine, failures, results,
  slots: slots.map(slot => ({ mapId: slot.mapId, matchId: slot.matchId, starts: slot.starts, snapshots: slot.snapshots, deltas: slot.deltas, lastTick: slot.lastTick, phase: slot.phase,
    peakProjectedEntities: slot.peakProjectedEntities, temporaryBotObserved: slot.temporaryBotObserved })), samples }; }
async function begin(slot, number) {
  const admission = await rig.post('/api/realtime/v1/practice', { mapId: slot.mapId, teamSize: 3, displayName: 'Automated load observer', botLevel: 'strong', mode: 'training', seed: 91000 + number + slot.starts * 100 });
  slot.matchId = admission.matchId; slot.starts++; slot.finished = false;
  const owner = await connectClient(rig, admission.ticket); await owner.wait(isSnapshot);
  const ticket = await rig.post(`/api/realtime/v1/practice/${slot.matchId}/ticket`);
  slot.client = await connectClient(rig, ticket.ticket, message => {
    if (!isSnapshot(message)) { if (message.type === 'error') failures.push({ slot: number, code: message.code, at: Date.now() - start }); return; }
    slot.snapshots++; if (message.type === 'delta') slot.deltas++;
    slot.lastTick = message.worldTick; slot.phase = message.view.phase;
    slot.peakProjectedEntities = Math.max(slot.peakProjectedEntities, message.view.units.length + message.view.buildings.length + message.view.transports.length);
    slot.temporaryBotObserved ||= message.view.participants.find(p => p.id === message.view.you)?.temporaryBot === true;
    if (message.view.phase === 'finished' && message.phase === 'finished' && !slot.finished) { slot.finished = true; results.push({ mapId: slot.mapId, matchId: slot.matchId, resultId: message.view.resultId, winner: message.view.winner, ticks: message.worldTick }); }
    if (message.phase === 'failed-recoverable' || message.phase === 'paused') failures.push({ slot: number, phase: message.phase, at: Date.now() - start });
  });
  assert.equal(slot.client.hello.controlling, false); owner.close();
}
try {
  for (let i = 0; i < roomCount; i++) {
    const slot = { mapId: ['FP01', 'FP02', 'FP03', 'FP01'][i], starts: 0, snapshots: 0, deltas: 0, lastTick: 0, phase: 'preparation', peakProjectedEntities: 0, temporaryBotObserved: false };
    slots.push(slot); await begin(slot, i);
  }
  console.log(JSON.stringify({ started: true, reportPath, artifactId: healthAtStart.artifactId, contentId: healthAtStart.contentId, targetSeconds: seconds, roomCount }));
  let lastSample = 0, lastProgress = 0;
  while (!stopping && Date.now() - start < seconds * 1000) {
    if (failures.length) throw new Error('Unexpected room failure or pause during four-room load');
    for (const [i, slot] of slots.entries()) {
      if (slot.client.error) throw slot.client.error;
      if (slot.finished) { slot.client.close(); await rig.post(`/api/realtime/v1/practice/${slot.matchId}/abandon`); await begin(slot, i); }
    }
    if (Date.now() - lastSample >= 5000) {
      lastSample = Date.now(); const health = await rig.health(); samples.push({ elapsedSeconds: (Date.now() - start) / 1000, ...health });
      if (!health.ok || health.metrics.storageFailures) throw new Error('Server health failed during load');
      await writeReport(reportPath, snapshotReport());
    }
    if (Date.now() - lastProgress >= 60_000) { lastProgress = Date.now(); console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now() - start) / 1000), completedMatches: results.length, ticks: slots.map(slot => slot.lastTick), lastMetrics: samples.at(-1)?.metrics })); }
    await sleep(200);
  }
  if (!stopping) { assert.ok(slots.every(slot => slot.temporaryBotObserved)); assert.equal(failures.length, 0); complete = true; }
} catch (error) { failures.push({ error: error.message, at: Date.now() - start }); console.error(rig.logs()); process.exitCode = 1; }
finally {
  for (const slot of slots) slot.client?.close();
  await rig.stop(); await writeReport(reportPath, snapshotReport());
  console.log(JSON.stringify({ complete, reportPath, elapsedSeconds: (Date.now() - start) / 1000, failures: failures.length, completedMatches: results.length, finalMetrics: samples.at(-1)?.metrics }));
}
