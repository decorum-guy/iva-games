/**
 * One paired real-clock HTTP measurement of setup pacing, without a browser.
 * node scripts/district-pacing-compare.mjs [before-sha] [after-sha]
 * Builds detached copies under ignored .qa. Never changes current dist/source.
 * Both copies use their original core/runtime/platform, a real clock and SQLite.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import Database from 'better-sqlite3';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = value => createHash('sha256').update(value).digest('hex');
const beforeSha = git('rev-parse', process.argv[2] ?? 'c37cc1ccfe08c91e5a19ad3c11e6871e597a6904');
const afterSha = git('rev-parse', process.argv[3] ?? 'HEAD');
const seed = 'district-paired-setup-20261127-v1', botSeed = 'district-paired-setup-bots-v1';
const participantIds = ['paired-human', 'paired-bot-a', 'paired-bot-b'];
const pollMs = 80;
process.umask(0o077);
await mkdir(join(root, '.qa/district-pacing-comparison'), { recursive: true });
const directory = await mkdtemp(join(root, '.qa/district-pacing-comparison/run-'));
const checkouts = [], runs = [];
const result = { realHttp: true, realSqlite: true, controlledClock: false, acceleratedClock: false,
  mockedGameApi: false, browserMeasured: false, seed, botSeed, participantIds, pollMs,
  platformWorkerMs: 1000, runs, limitations: [
    'One paired deterministic setup scenario, not a distribution or full-game duration measurement.',
    'Times are HTTP observation boundaries. No exact timestamp is invented for actions batched inside one response.',
    'The poll cadence is 80ms for both versions; a browser polling every 1100ms may observe a coarser cadence.',
  ] };

async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve())); return port;
}
async function compile(label, revision) {
  const own = join(directory, label), checkout = join(own, 'checkout');
  await mkdir(own);
  git('worktree', 'add', '--quiet', '--detach', checkout, revision); checkouts.push(checkout);
  // Shared installed third-party dependencies are identical in the two lockfiles.
  // Exact aliases force every local workspace import to this detached checkout,
  // preventing a workspace symlink from accidentally compiling current code.
  const aliases = [];
  for (const packagePath of ['games/district', 'packages/session-kit', 'packages/telegram-transport']) {
    const pkg = JSON.parse(await readFile(join(checkout, packagePath, 'package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(pkg.exports)) aliases.push({
      find: new RegExp('^' + (pkg.name + (subpath === '.' ? '' : subpath.slice(1))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
      replacement: join(checkout, packagePath, target),
    });
  }
  await build({ root: checkout, configFile: join(checkout, 'vite.platform.config.ts'), logLevel: 'error',
    resolve: { alias: aliases }, build: { outDir: join(own, 'server'), emptyOutDir: true } });
  await build({ root: checkout, configFile: false, logLevel: 'error', resolve: { alias: aliases }, build: {
    ssr: 'games/district/src/territorial/core.ts', target: 'node22', outDir: join(own, 'core'),
    rollupOptions: { output: { entryFileNames: 'core.mjs' } },
  } });
  const core = await import(pathToFileURL(join(own, 'core/core.mjs')).href);
  const bundle = await readFile(join(own, 'server/main.js'));
  const runtime = await readFile(join(checkout, 'games/district/src/territorial/runtime.ts'));
  assert.equal(bundle.toString().includes('district-pace-v1'), runtime.toString().includes('district-pace-v1'));
  const manifest = { label, revision, serverSha256: sha(bundle), runtimeSha256: sha(runtime),
    packageLockSha256: sha(await readFile(join(checkout, 'package-lock.json'))),
    scheduledPacing: runtime.toString().includes('district-pace-v1') };
  return { own, checkout, core, manifest };
}

async function measure(compiled) {
  const { own, checkout, core, manifest } = compiled;
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const runtimePath = join(own, 'runtime.sqlite'), mail = join(own, 'mail');
  let running, log = '';
  async function start() {
    assert.ok(!running);
    const child = spawn(process.execPath, [join(own, 'server/main.js')], { cwd: checkout, env: {
      ...process.env, NODE_ENV: 'development', PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: String(port),
      PORTAL_ORIGIN: origin, PLATFORM_ALLOWED_HOSTS: `127.0.0.1:${port}`, PLATFORM_ALLOWED_ORIGINS: origin,
      PLATFORM_DATABASE_PATH: join(own, 'platform.sqlite'), PLATFORM_LAB_DATABASE_PATH: runtimePath,
      PORTAL_DIST_DIRECTORY: join(own, 'no-portal'), MAIL_MODE: 'file', MAIL_FILE_DIRECTORY: mail,
      // Historical before-revisions still require this; current releases ignore it.
      DISTRICT_TERRITORIAL_ENABLED: 'true', TELEGRAM_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'false',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    running = child; let startup = '', spawnError;
    child.stdout.on('data', bytes => { startup += bytes; log += bytes; });
    child.stderr.on('data', bytes => { startup += bytes; log += bytes; });
    child.on('error', error => { spawnError = error; });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, startup);
      if (startup.includes(`Iva Games platform listening on 127.0.0.1:${port}`)) {
        assert.equal((await fetch(origin + '/health/ready')).status, 200); return;
      }
      await delay(25);
    }
    throw new Error('Isolated server did not start: ' + startup);
  }
  async function stop() {
    const child = running; if (!child) return; running = undefined;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const deadline = Date.now() + 35_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); throw new Error('Isolated server failed shutdown'); }
    }
    await writeFile(join(own, 'server.log'), log);
  }
  let cookie = '', csrf = '';
  async function request(path, body) {
    const startedAt = Date.now();
    const response = await fetch(origin + '/api/platform/v1' + path, { method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(10_000), headers: { Cookie: cookie, ...(body === undefined ? {} : {
        Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(),
      }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const session = response.headers.getSetCookie().find(value => value.startsWith('iva_dev_session='));
    if (session) cookie = session.split(';')[0];
    const data = await response.json(), observedAt = Date.now();
    assert.ok(response.ok, `${manifest.label} ${path}: ${response.status} ${data.error?.code ?? ''}`);
    if (data.csrfToken) csrf = data.csrfToken;
    return { data, startedAt, observedAt };
  }
  try {
    await start(); await request('/session');
    const account = { handle: 'paired_pacing', email: 'paired_pacing@example.test', displayName: 'TEST · Paired pacing', password: randomBytes(24).toString('hex') };
    await request('/auth/register', account); await request('/session');
    let token;
    for (const filename of await readdir(mail)) {
      const text = await readFile(join(mail, filename), 'utf8');
      const url = text.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
      if (url) token = new URL(url).searchParams.get('token');
    }
    assert.ok(token); await request('/auth/verify', { token }); await request('/session');
    let room = (await request('/rooms', { gameId: 'district', capacity: 3, title: 'TEST · Paired pacing',
      settings: { mapId: 'azure-bay', mapVersion: '2', newsPreset: 'medium' } })).data.room;
    const path = '/rooms/' + room.roomId;
    for (let i = 0; i < 2; i++) room = (await request(path + '/bots', { difficulty: 'normal', expectedRevision: room.revision })).data.room;
    room = (await request(path + '/ready', { ready: true, expectedRevision: room.revision })).data.room;
    room = (await request(path + '/start', { expectedRevision: room.revision })).data.room;
    await stop();
    const database = new Database(runtimePath);
    try {
      const original = JSON.parse(database.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(room.matchId));
      assert.equal(original.revision, 0);
      const participants = original.participants.map((participant, index) => ({ ...participant, participantId: participantIds[index] }));
      const prepared = core.createTerritory({ matchId: original.matchId, roomId: original.roomId, participants,
        map: original.map, preset: 'medium', seed, now: Date.now() });
      database.prepare('UPDATE district_territorial_matches SET state_json=?,bot_seed=? WHERE match_id=?')
        .run(JSON.stringify(prepared), botSeed, room.matchId);
    } finally { database.close(); }
    await start();
    let current = (await request(path + '/match')).data.view;
    assert.equal(current.you.participantId, participantIds[0]); assert.equal(current.phase, 'setup-home');
    const post = payload => request(path + '/actions', { actionId: randomUUID(), expectedRevision: current.revision,
      payload: { ...payload, phaseId: current.phaseId } });
    const home = current.legal.options[0].id;
    current = (await post({ type: 'place', nodeId: home })).data.view;
    const road = current.legal.options[0].id;
    const routeReceipt = await post({ type: 'route', edgeId: road });
    current = routeReceipt.data.view;
    assert.equal(current.revision, 2);
    const observations = [], startedAt = routeReceipt.startedAt;
    let prior = { observedAt: routeReceipt.observedAt, revision: 2, buildings: current.buildings, routes: current.routes };
    const schedules = new Map();
    while (Date.now() - startedAt < 25_000) {
      const reply = await request(path + '/match'); current = reply.data.view;
      if (current.botActionAt !== undefined && !schedules.has(current.revision)) schedules.set(current.revision,
        { revision: current.revision, participantId: current.botParticipantId, scheduledAt: current.botActionAt, firstObservedAt: reply.observedAt });
      if (current.revision > prior.revision) {
        const buildings = Object.entries(current.buildings).filter(([id]) => !Object.hasOwn(prior.buildings, id));
        const routes = Object.entries(current.routes).filter(([id]) => !Object.hasOwn(prior.routes, id));
        const actions = current.revision - prior.revision;
        assert.equal(actions, buildings.length + routes.length);
        observations.push({ requestAt: reply.startedAt, observedAt: reply.observedAt, serverNow: current.serverNow,
          previousObservedAt: prior.observedAt, revisionBefore: prior.revision, revisionAfter: current.revision,
          actions, homes: buildings, roads: routes, elapsedSinceRouteRequestMs: reply.observedAt - startedAt,
          observedIntervalMs: reply.observedAt - prior.observedAt,
          // A receipt returns the action's saved view even if reconciliation has
          // already advanced the persisted board before that POST completes.
          firstBatchMayBeInsideRoutePost: prior.revision === 2,
          ...(schedules.has(prior.revision) ? { schedule: schedules.get(prior.revision) } : {}) });
        prior = { observedAt: reply.observedAt, revision: current.revision, buildings: current.buildings, routes: current.routes };
      }
      if (current.activeParticipantId === participantIds[0] && current.phase === 'setup-home' && current.revision === 10) break;
      await delay(pollMs);
    }
    assert.equal(current.revision, 10); assert.equal(current.activeParticipantId, participantIds[0]); assert.equal(current.phase, 'setup-home');
    assert.equal(observations.reduce((total, item) => total + item.actions, 0), 8);
    const entry = { ...manifest, origin, map: current.map.id, difficulty: 'normal', home, road,
      routeRequestAt: startedAt, routeReceiptAt: routeReceipt.observedAt, routeReceiptServerNow: routeReceipt.data.view.serverNow,
      routePostMs: routeReceipt.observedAt - startedAt, completeObservedAt: observations.at(-1).observedAt,
      totalFromRouteRequestMs: observations.at(-1).observedAt - startedAt,
      totalAfterRouteReceiptMs: observations.at(-1).observedAt - routeReceipt.observedAt,
      observations, schedules: [...schedules.values()], final: { revision: current.revision, phase: current.phase,
        activeParticipantId: current.activeParticipantId, buildings: current.buildings, routes: current.routes,
        players: current.players.map(player => ({ participantId: player.participantId, handCount: player.handCount, points: player.points })) } };
    runs.push(entry); await writeFile(join(own, 'measurement.json'), JSON.stringify(entry, null, 2) + '\n');
    console.log(JSON.stringify({ label: manifest.label, revision: manifest.revision, actions: 8,
      routePostMs: entry.routePostMs, totalMs: entry.totalFromRouteRequestMs,
      batches: observations.map(item => item.actions), intervalsMs: observations.map(item => item.observedIntervalMs) }));
  } finally { await stop(); }
}

try {
  const before = await compile('before', beforeSha), after = await compile('after', afterSha);
  assert.equal(before.manifest.packageLockSha256, after.manifest.packageLockSha256, 'Pair requires identical installed dependency locks');
  assert.equal(before.manifest.scheduledPacing, false); assert.equal(after.manifest.scheduledPacing, true);
  await measure(before); await measure(after);
  assert.equal(runs[0].home, runs[1].home); assert.equal(runs[0].road, runs[1].road);
  assert.deepEqual(runs[0].final, runs[1].final, 'A paired run must end with the same board, owner IDs and resource counts');
  result.identicalFinalPosition = true;
  await writeFile(join(directory, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ artifacts: directory, beforeMs: runs[0].totalFromRouteRequestMs,
    afterMs: runs[1].totalFromRouteRequestMs, identicalFinalPosition: true }));
} catch (error) {
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ ...result, error: String(error) }, null, 2) + '\n');
  console.error('Isolated paired pacing diagnostics:', directory); throw error;
} finally {
  for (const checkout of checkouts) git('worktree', 'remove', checkout);
}
