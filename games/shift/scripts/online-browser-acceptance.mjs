/** Real Chromium + real authenticated HTTP/WS acceptance. No engine state or DB mutation.
 * UI checks use Playwright input. Full matches use the shipped bot policy, receiving
 * only each browser's permitted network snapshots, and sending ordinary wire commands.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { ShiftDemoClient, startShiftDemo } from './demo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const cycle = argument('--cycle', '1'), smoke = args.includes('--smoke');
const selectedCase = argument('--case', null);
const port = Number(argument('--port', process.env.SHIFT_QA_PORT || '4408'));
const timeoutMs = Number(argument('--match-timeout-ms', '600000'));
const concurrency = Math.max(1, Math.min(3, Number(process.env.SHIFT_QA_CONCURRENCY || '2')));
const observedPeers = [];
const qaRoot = join(ROOT, '.qa', 'shift-online'); await mkdir(qaRoot, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(qaRoot, `cycle-${cycle}-`));
const buildSnapshot = join(directory, 'build');
const buildInputs = { platform: resolve(process.env.SHIFT_QA_PLATFORM_BUILD || join(ROOT, 'dist-platform')), portal: resolve(process.env.SHIFT_QA_PORTAL_BUILD || join(ROOT, 'apps/portal/dist')) };
await cp(buildInputs.platform, join(buildSnapshot, 'platform'), { recursive: true });
await cp(buildInputs.portal, join(buildSnapshot, 'portal'), { recursive: true, dereference: true });
const report = { cycle, startedAt: new Date().toISOString(), classification: 'Automated Chromium UI plus permitted-view policy over each authenticated browser WebSocket; no personal gameplay, physical device or auditory claim',
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
  buildInputs, buildHashes: {}, sourceHashes: {}, matches: [], failures: [], checks: [], coverage: {}, concurrency, directory };
for (const [file, snapshot] of [['dist-platform/main.js', 'platform/main.js'], ['apps/portal/dist/index.html', 'portal/index.html']]) report.buildHashes[file] = createHash('sha256').update(await readFile(join(buildSnapshot, snapshot))).digest('hex');
async function hashTree(path, target, base = ROOT, key = path) {
  for (const entry of (await readdir(join(base, path), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(file, target, base, `${key}/${entry.name}`);
    else if (entry.isFile()) target[`${key}/${entry.name}`] = createHash('sha256').update(await readFile(join(base, file))).digest('hex');
  }
}
for (const path of ['games/shift/src', 'games/shift/scripts', 'games/shift/public', 'apps/platform/src', 'apps/portal/src', 'packages/session-kit/src']) await hashTree(path, report.sourceHashes);
for (const path of ['games/shift/assets-manifest.json', 'packages/game-registry/games.json', 'package.json', 'package-lock.json', 'vite.platform.config.ts', 'apps/portal/vite.config.ts']) report.sourceHashes[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');
await hashTree('platform', report.buildHashes, buildSnapshot, 'dist-platform');
await hashTree('portal', report.buildHashes, buildSnapshot, 'apps/portal/dist');
report.buildTreeHash = createHash('sha256').update(JSON.stringify(report.buildHashes)).digest('hex');
report.sourceTreeHash = createHash('sha256').update(JSON.stringify(report.sourceHashes)).digest('hex');
const log = value => process.stdout.write(JSON.stringify({ cycle, ...value }) + '\n');
const check = (name, details = {}) => { report.checks.push({ name, ...details }); log({ check: name, ...details }); };
async function bounded(promise, label, timeout = 8000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser operation timed out: ${label}`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function screenshot(page, name) { await page.bringToFront(); await page.screenshot({ path: join(directory, name), fullPage: false, animations: 'disabled', timeout: 30000 }); }
async function until(test, label, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { for (const peer of observedPeers) if (peer.failure) throw peer.failure; const result = await test(); if (result) return result; await delay(45); } throw new Error(`Timed out: ${label}`); }
const compiled = join(directory, 'policy');
const entry = join(directory, 'policy-entry.ts');
await writeFile(entry, `export { chooseBotCommands } from ${JSON.stringify(join(ROOT, 'games/shift/src/bots/policy.ts'))};\nexport { lineOfSight, worldPosition } from ${JSON.stringify(join(ROOT, 'games/shift/src/core/index.ts'))};\n`);
await build({ root: ROOT, configFile: false, logLevel: 'silent', build: { ssr: entry, outDir: compiled, emptyOutDir: true, minify: false } });
const { chooseBotCommands, lineOfSight, worldPosition } = await import(pathToFileURL(join(compiled, 'policy-entry.js')).href);

function instrumentBrowser(options = {}) {
  const NativeWebSocket = window.WebSocket;
  const NativeAudioContext = window.AudioContext;
  const latency = options.oneWayDelayMs || 0;
  const state = { sockets: [], active: null, automated: false, sent: 0, oneWayDelayMs: latency,
    inputMetrics: { ui: 0, policy: 0, peakPerSecond: 0, recent: [] }, audioContexts: [], activeGesture: null, gestures: { pointers: 0, keys: 0, trustedKeys: 0 } };
  window.addEventListener('pointerdown', () => { state.gestures.pointers++; }, true);
  window.addEventListener('keydown', event => {
    state.gestures.keys++; if (event.isTrusted) state.gestures.trustedKeys++;
    const gesture = { type: 'keyboard', trusted: event.isTrusted, inMatch: event.target instanceof Element && !!event.target.closest('.shift-match') };
    state.activeGesture = gesture;
    setTimeout(() => { if (state.activeGesture === gesture) state.activeGesture = null; }, 0);
  }, true);
  if (NativeAudioContext) window.AudioContext = class extends NativeAudioContext {
    constructor(...args) { super(...args); state.audioContexts.push({ context: this, initialState: this.state, createdDuring: state.activeGesture }); }
  };
  state.audioAudit = () => ({ contexts: state.audioContexts.map(record => ({ state: record.context.state, sampleRate: record.context.sampleRate, initialState: record.initialState, createdDuring: record.createdDuring })), gestures: { ...state.gestures } });
  const nativeSend = (socket, data, source) => {
    const transmit = () => {
      if (socket.readyState !== NativeWebSocket.OPEN) return;
      try {
        const frame = JSON.parse(data);
        if (frame.type === 'input') {
          const now = performance.now(), metrics = state.inputMetrics;
          metrics[source]++; metrics.recent = metrics.recent.filter(event => now - event.at < 1000);
          metrics.recent.push({ at: now, source, seq: frame.payload.seq, epoch: frame.payload.controllerEpoch });
          metrics.peakPerSecond = Math.max(metrics.peakPerSecond, metrics.recent.length);
        }
      } catch { /* The server still validates malformed native messages. */ }
      NativeWebSocket.prototype.send.call(socket, data);
    };
    if (latency) setTimeout(transmit, latency); else transmit();
  };
  window.__shiftAcceptance = state;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (String(url).includes('/live?')) {
        state.sockets.push(this); state.active = this;
        if (latency) {
          const delayed = new WeakSet();
          this.addEventListener('message', event => {
            if (delayed.has(event)) return;
            event.stopImmediatePropagation();
            const copy = new MessageEvent('message', { data: event.data, origin: event.origin }); delayed.add(copy);
            setTimeout(() => { if (this.readyState === NativeWebSocket.OPEN) this.dispatchEvent(copy); }, latency);
          }, true);
        }
      }
    }
    send(data) {
      if (state.automated && typeof data === 'string') {
        try { if (JSON.parse(data).type === 'input') return; } catch { /* Browser retains native validation. */ }
      }
      return nativeSend(this, data, 'ui');
    }
  };
  state.send = command => {
    const socket = state.active; if (!socket || socket.readyState !== NativeWebSocket.OPEN) return false;
    const frame = command.type === 'input' ? { type: 'input', version: 'shift-wire@1', payload: command }
      : { type: 'command', version: 'shift-wire@1', actionId: command.actionId, payload: command };
    nativeSend(socket, JSON.stringify(frame), 'policy'); state.sent++; return true;
  };
  state.disconnect = () => state.active?.close(1000, 'acceptance mid-move reconnect');
}

function auditView(view, peer) {
  assert.equal(view.wireVersion, 'shift-wire@1');
  for (const key of ['seed', 'botMemory', 'visible', 'receipts', 'teamEvents', 'teamEventCounter', 'eventCounter', 'teamRoundRecaps']) assert.ok(!(key in view), `Raw state leaked: ${key}`);
  assert.equal(view.board.length, 9); assert.equal(view.board.filter(x => x === null).length, 1);
  assert.equal(view.seats.length, view.settings.teamSize * 2);
  assert.ok(view.actors.every(a => a.role === 'pilot'));
  const observers = view.actors.filter(a => a.team === view.self.team && a.hp > 0);
  for (const actor of view.actors) {
    for (const key of ['input', 'lastInputTick', 'controllerEpoch', 'connected', 'disconnectedAtTick', 'nextShotTick']) assert.ok(!(key in actor), `Internal actor field: ${key}`);
    if (actor.team !== view.self.team) assert.ok(observers.some(a => lineOfSight(view.settings.arena, view.board, a, actor, view.motion, view.tick, 13)), 'Enemy actor outside shared team vision');
  }
  if (view.battery.mode === 'carried' && view.battery.team !== view.self.team && !view.actors.some(a => a.carrying)) {
    for (const key of ['spaceId', 'x', 'z', 'carrierId']) assert.ok(!(key in view.battery), `Hidden carrier field: ${key}`);
    report.coverage.hiddenCarrier = true;
  }
  for (const ghost of view.ghosts) { assert.ok(view.tick - ghost.seenAtTick < 60); for (const key of ['hp', 'carrying', 'aim', 'input']) assert.ok(!(key in ghost)); }
  assert.ok(view.pings.every(p => p.team === view.self.team));
  for (const event of view.events) assert.ok(event.id.startsWith(`v:${view.self.team}:`), 'Global event counter leaked');
  if (view.roundRecap) {
    assert.ok(['intermission', 'finished'].includes(view.phase), 'A recap leaked into an active round');
    assert.ok(view.roundRecap.events.every(event => event.id.startsWith(`v:${view.self.team}:`)));
    for (const point of view.roundRecap.batteryTrace) {
      if (point.gap) { for (const key of ['worldX', 'worldZ', 'spaceId', 'carrierId']) assert.ok(!(key in point), 'Hidden recap gap contains a location'); }
      else assert.ok(Number.isFinite(point.worldX) && Number.isFinite(point.worldZ));
    }
  }
  if (view.phase !== 'finished') {
    assert.ok(!('journal' in view));
    for (const [id, stats] of Object.entries(view.stats)) { assert.equal(view.seats.find(s => s.seatId === id)?.team, view.self.team); assert.ok(!('batteryTransfers' in stats)); }
  }
  peer.roles.add(view.self.role);
  if (view.motion) {
    report.coverage.shift = true;
    if (view.battery.spaceId === view.motion.roomId) report.coverage.batteryMoved = true;
    for (const actor of view.actors.filter(a => a.spaceId === view.motion.roomId && a.hp > 0)) {
      report.coverage[actor.team === view.self.team ? 'allyMoved' : 'visibleEnemyMoved'] = true;
      const position = worldPosition(view.board, actor, view.motion, view.tick);
      assert.ok(Number.isFinite(position.x) && Number.isFinite(position.z));
    }
    const signature = `${view.round}:${view.motion.startTick}`;
    if (!peer.motions.has(signature)) { peer.motions.add(signature); peer.samples.push({ type: 'motion', tick: view.tick, view }); }
  }
}

function watchPage(page, name, game) {
  const peer = { page, name, game, view: null, frames: 0, sockets: 0, errors: [], http: [], receipts: new Map(), receiptCounts: new Map(), commandsSentAt: new Map(), receiptLatencyMs: [], closes: [], roles: new Set(), motions: new Set(), samples: [], recent: new Map(), memory: { seq: 0, counter: 0, nextDecisionTick: 0, recentRooms: [] }, lastDriveTick: -1, failure: null };
  observedPeers.push(peer);
  page.on('pageerror', error => { peer.errors.push(error.message); });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/api/platform/')) return;
    peer.http.push({ method: response.request().method(), path, status: response.status() });
    if (peer.http.length > 250) peer.http.shift();
  });
  page.on('requestfailed', request => { if (new URL(request.url()).pathname.startsWith('/api/platform/')) peer.http.push({ path: new URL(request.url()).pathname, failed: request.failure()?.errorText }); });
  page.on('websocket', ws => {
    if (!ws.url().includes('/live?')) return;
    peer.sockets++;
    const receive = ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame.type === 'snapshot') {
          auditView(frame.view, peer); peer.view = frame.view; peer.matchId = frame.matchId; peer.frames++; peer.recent.set(frame.tick, frame.view);
          while (peer.recent.size > 40) peer.recent.delete(peer.recent.keys().next().value);
          if (peer.frames === 1 || frame.view.phase !== peer.previousPhase) peer.samples.push({ type: 'phase', tick: frame.tick, view: frame.view });
          peer.previousPhase = frame.view.phase;
          const other = game.peers?.find(p => p !== peer && p.view?.self.seatId !== frame.view.self.seatId && p.matchId === frame.matchId), same = other?.recent.get(frame.tick);
          if (same) {
            for (const key of ['board', 'boardRevision', 'motion', 'score', 'round', 'phase', 'cooldownUntilTick', 'rounds']) assert.deepEqual(frame.view[key], same[key], `Public ${key} differs at tick ${frame.tick}`);
            assert.notEqual(frame.view.self.seatId, same.self.seatId); game.comparedFrames++;
          }
        } else if (frame.type === 'receipt') {
          peer.receipts.set(frame.actionId, frame.result); peer.receiptCounts.set(frame.actionId, (peer.receiptCounts.get(frame.actionId) || 0) + 1);
          if (peer.commandsSentAt.has(frame.actionId)) peer.receiptLatencyMs.push(performance.now() - peer.commandsSentAt.get(frame.actionId));
        }
        else if (frame.type === 'error') { peer.errors.push(`wire:${frame.code}`); }
      } catch (error) { peer.failure ||= error; }
    };
    ws.on('framereceived', frame => { if (game.oneWayDelayMs) setTimeout(() => receive(frame), game.oneWayDelayMs); else receive(frame); });
    ws.on('close', () => peer.closes.push(Date.now()));
  });
  return peer;
}

async function createBrowserPeer(game, name) {
  // Every context receives a fresh ordinary login session of its QA account.
  const account = game.demo.accounts[name === 'pilot' ? 0 : 1], profile = new ShiftDemoClient(game.demo.origin, join(game.demo.directory, 'mail'));
  await profile.request('/session'); await profile.request('/auth/login', { email: account.email, password: account.password });
  assert.equal((await profile.request('/session')).user.playerId, account.playerId);
  const context = await browser.newContext({ storageState: profile.storageState(), viewport: { width: 1365, height: 950 }, locale: name === 'pilot' ? 'ru-RU' : 'en-US', reducedMotion: 'reduce' });
  await context.addInitScript(instrumentBrowser, { oneWayDelayMs: game.oneWayDelayMs });
  await context.addInitScript(() => {
    if (!localStorage.getItem('iva-shift.preferences.v1')) localStorage.setItem('iva-shift.preferences.v1', JSON.stringify({ lang: 'ru', mode: '2d', quality: 'low', reducedMotion: true }));
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  return watchPage(page, name, game);
}

async function lobbyTouchTargets(game) {
  const [host, guest] = game.peers;
  await Promise.all(game.peers.map(peer => peer.page.setViewportSize({ width: 844, height: 390 })));
  try {
    const targets = await host.page.locator('.shift-lobby select, .shift-lobby .shift-seat-remove, .shift-lobby-action-bar button').evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), name: element.getAttribute('aria-label') || element.textContent.trim(), width: bounds.width, height: bounds.height };
    }));
    assert.ok(targets.some(target => target.tag === 'select'), 'The small lobby has real team/role selects');
    assert.ok(targets.some(target => target.name.startsWith('Убрать')), 'The small lobby has an actual remove control');
    assert.ok(targets.some(target => target.name.includes('Я готов')), 'The small lobby has an actual ready control');
    const ready = await guest.page.locator('.shift-lobby-action-bar').getByRole('button', { name: /Я готов|I’m ready/ }).boundingBox();
    assert.ok(ready, 'Guest ready target is rendered');
    targets.push({ tag: 'button', name: 'Guest ready', width: ready.width, height: ready.height });
    for (const target of targets) assert.ok(target.width >= 44 && target.height >= 44, `844×390 lobby target below 44 px: ${JSON.stringify(target)}`);
    check('844×390 actual lobby select/remove/ready targets are at least 44×44 CSS px', { game: game.label, targets });
  } finally { await Promise.all(game.peers.map(peer => peer.page.setViewportSize({ width: 1365, height: 950 }))); }
}

async function keyboardAudioInFreshContext(game) {
  const old = game.peers[0], oldEpoch = old.view.self.controllerEpoch;
  const replacement = await createBrowserPeer(game, 'pilot');
  await replacement.page.goto(game.url, { waitUntil: 'domcontentloaded' });
  await until(() => replacement.view?.self.controllerEpoch > oldEpoch, 'Fresh audio-only keyboard context acquires its ordinary seat');
  await replacement.page.locator('.shift-scene canvas').first().waitFor();
  const before = await replacement.page.evaluate(() => window.__shiftAcceptance.audioAudit());
  assert.equal(before.gestures.pointers, 0); assert.equal(before.gestures.keys, 0);
  assert.ok(before.contexts.every(context => context.state !== 'running'), 'No AudioContext runs before a fresh profile gesture');
  let reachedGame = false;
  for (let count = 0; count < 40; count++) {
    reachedGame = await replacement.page.evaluate(() => !!document.activeElement?.closest('.shift-root'));
    if (reachedGame) break;
    await replacement.page.keyboard.press('Tab');
  }
  assert.ok(reachedGame, 'Keyboard focus reaches the actual match without a pointer');
  const beforeGameKey = await replacement.page.evaluate(() => window.__shiftAcceptance.audioAudit());
  await replacement.page.keyboard.press('Tab');
  const after = await until(async () => {
    const audit = await replacement.page.evaluate(() => window.__shiftAcceptance.audioAudit());
    return audit.contexts.some(context => context.state === 'running' && context.createdDuring?.trusted && context.createdDuring?.inMatch) && audit;
  }, 'Trusted online keyboard gesture unlocks native AudioContext');
  assert.equal(after.gestures.pointers, 0); assert.ok(after.gestures.trustedKeys > 0);
  await old.page.locator('.shift-connection').waitFor();
  assert.match(await old.page.locator('.shift-connection').innerText(), /другой вкладке|Another tab/i);
  game.peers[0] = replacement; await automated(replacement);
  check('Fresh authenticated online context unlocks native AudioContext through keyboard before any pointer', {
    game: game.label, before, beforeGameKey, after, classification: 'Browser AudioContext state only; no listening or speaker-output claim',
  });
}

async function send(peer, commands) {
  for (const command of commands) if (command.actionId) peer.commandsSentAt.set(command.actionId, performance.now());
  return bounded(peer.page.evaluate(commands => commands.map(command => window.__shiftAcceptance.send(command)), commands), `${peer.game.label}/${peer.name} wire send`);
}
async function automated(peer, enabled = true) { await peer.page.evaluate(enabled => { window.__shiftAcceptance.automated = enabled; }, enabled); }
async function receipt(peer, id) { return until(() => peer.receipts.get(id), `${peer.name} receipt ${id}`); }
const scoped = (peer, command) => ({ roundId: peer.view.round, controllerEpoch: peer.view.self.controllerEpoch, actionId: randomUUID(), ...command });

async function lobby(game, detailed) {
  const [host, guest] = game.peers, url = game.url;
  await Promise.all(game.peers.map(p => p.page.goto(url, { waitUntil: 'domcontentloaded' })));
  await host.page.getByRole('button', { name: /Начать матч|Start match/ }).waitFor();
  assert.equal(await host.page.getByRole('button', { name: /Начать матч|Start match/ }).isDisabled(), true);
  if (detailed) {
    await host.page.locator('.shift-lobby').getByRole('button', { name: 'EN', exact: true }).click();
    await host.page.locator('.shift-lobby').getByRole('button', { name: 'Settings', exact: true }).click();
    await host.page.getByRole('dialog').waitFor();
    assert.ok(await host.page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), 'Settings receives focus');
    await host.page.keyboard.press('Shift+Tab');
    assert.ok(await host.page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), 'Modal keyboard focus stays inside');
    await host.page.keyboard.press('Escape'); await host.page.getByRole('dialog').waitFor({ state: 'hidden' });
    await host.page.locator('.shift-lobby').getByRole('button', { name: 'RU', exact: true }).click();
    const team = host.page.getByRole('combobox', { name: 'Команда Лис', exact: true });
    await team.selectOption('amber'); await until(async () => (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room.settings.teams[game.hostSeat] === 'amber', 'UI team change');
    await team.selectOption('teal'); await until(async () => (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room.settings.teams[game.hostSeat] === 'teal', 'UI team restoration');
    const role = host.page.getByRole('combobox', { name: 'Роль Лис', exact: true });
    await role.selectOption('pilot'); await until(async () => (await role.inputValue()) === 'pilot', 'UI pilot selection');
    await role.selectOption('navigator'); await until(async () => (await role.inputValue()) === 'navigator', 'UI navigator selection');
    const bot = game.room.members.find(m => m.controller.kind === 'bot');
    await host.page.getByRole('button', { name: `Убрать ${bot.displayName}`, exact: true }).click();
    await host.page.getByRole('button', { name: 'Заполнить ботами', exact: true }).waitFor();
    await lobbyTouchTargets(game);
    await host.page.getByRole('combobox', { name: 'Сложность ботов' }).selectOption('normal');
    await host.page.getByRole('button', { name: 'Заполнить ботами', exact: true }).click();
    await until(async () => (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room.members.length === game.teamSize * 2, 'UI bot fill');
    check('Lobby team/role changes, bot removal/replacement, modal focus, disabled start reason and RU/EN', { game: game.label });
  }
  // Set the two human starting roles through the visible selectors, preserving balanced teams.
  for (const name of ['Лис', 'Сова']) {
    const role = host.page.getByRole('combobox', { name: `Роль ${name}`, exact: true });
    if (await role.inputValue() !== 'navigator') {
      await role.selectOption('navigator'); await until(async () => (await role.inputValue()) === 'navigator' && await role.isEnabled(), `${name} navigator role`);
    }
  }
  await guest.page.locator('.shift-lobby').getByRole('button', { name: 'EN', exact: true }).click();
  if (detailed) {
    await screenshot(host.page, `${game.label}-lobby-ru.png`);
    await screenshot(guest.page, `${game.label}-lobby-en.png`);
  }
  await host.page.getByRole('button', { name: /Я готов/ }).click();
  await guest.page.getByRole('button', { name: /I’m ready/ }).click();
  await until(async () => await host.page.getByRole('button', { name: /Начать матч/ }).isEnabled(), 'Both humans ready');
  await host.page.getByRole('button', { name: /Начать матч/ }).click();
  await until(() => game.peers.every(p => p.view), 'Both browsers live');
  assert.notEqual(host.view.self.seatId, guest.view.self.seatId); assert.notEqual(host.view.self.team, guest.view.self.team);
  assert.equal(host.view.self.role, 'navigator'); assert.equal(guest.view.self.role, 'navigator');
  for (const peer of game.peers) {
    await peer.page.locator('.shift-scene canvas').first().waitFor();
    await automated(peer);
  }
  assert.ok(await host.page.locator('.shift-match-tools').getByRole('button', { name: 'EN', exact: true }).isVisible(), 'Host keeps RU after lobby → match');
  assert.ok(await guest.page.locator('.shift-match-tools').getByRole('button', { name: 'RU', exact: true }).isVisible(), 'Guest keeps saved EN after lobby → match');
  check('Two independent authenticated browser seats start from ready lobby', { game: game.label, format: `${game.teamSize}v${game.teamSize}`, arena: game.arena });
}

async function contentionAndReconnect(game) {
  const [host, guest] = game.peers;
  await until(() => host.view.phase === 'active' && guest.view.phase === 'active', 'Round active');
  const rejected = host.view.shiftOptions.find(o => o.reason === 'NOT_ADJACENT');
  if (rejected) {
    await host.page.locator('.shift-room-keys').getByRole('button', { name: rejected.roomId, exact: true }).click();
    assert.equal(await host.page.getByRole('button', { name: /^Сдвинуть/ }).isDisabled(), true);
    assert.match(await host.page.locator('.shift-order').innerText(), /касаться шахты/);
  }
  const option = host.view.shiftOptions.find(o => o.roomId === 'O' && o.allowed) ?? host.view.shiftOptions.find(o => o.allowed);
  assert.ok(option, `No legal contention move: ${JSON.stringify({ round: host.view.round, role: host.view.self.role, tick: host.view.tick, phase: host.view.phase, options: host.view.shiftOptions.map(o => [o.roomId, o.reason]) })}`);
  assert.ok(guest.view.shiftOptions.find(o => o.roomId === option.roomId)?.allowed);
  await host.page.locator('.shift-room-keys').getByRole('button', { name: option.roomId, exact: true }).click();
  assert.ok(await host.page.getByRole('button', { name: /^Сдвинуть/ }).isEnabled());
  assert.match(await host.page.locator('.shift-order').innerText(), /Новые выходы/);
  const commands = game.peers.map(peer => scoped(peer, { type: 'shift', roomId: option.roomId, expectedBoardRevision: peer.view.boardRevision }));
  await Promise.all(game.peers.map((peer, i) => send(peer, [commands[i]])));
  const receipts = await Promise.all(game.peers.map((peer, i) => receipt(peer, commands[i].actionId)));
  assert.equal(receipts.filter(r => r.accepted).length, 1, 'One shaft receives exactly one concurrent winner');
  await until(() => host.view.motion, 'Move visible');
  const motion = { ...host.view.motion }, oldEpoch = guest.view.self.controllerEpoch;
  await guest.page.evaluate(() => window.__shiftAcceptance.disconnect());
  await until(() => guest.view.self.controllerEpoch > oldEpoch, 'Browser reconnect epoch');
  await until(() => !guest.view.motion && guest.view.board[motion.to] === motion.roomId, 'Move docks after reconnect');
  const priorCount = host.receiptCounts.get(commands[0].actionId);
  await send(host, [commands[0]]); await until(() => host.receiptCounts.get(commands[0].actionId) > priorCount, 'Repeated durable receipt');
  assert.deepEqual(await receipt(host, commands[0].actionId), receipts[0]);
  report.coverage.contention = true; report.coverage.midMoveReconnect = true;
  check('Contending navigators, public join forecast, disabled reason, mid-move socket reconnect and idempotent receipt', { game: game.label, receipts, oldEpoch, newEpoch: guest.view.self.controllerEpoch });
}

async function crashAndTakeover(game) {
  const peer = game.peers.find(p => p.view.self.role === 'navigator' && p.view.shiftOptions.some(o => o.allowed));
  assert.ok(peer, 'Another legal navigator action remains after contention');
  const option = peer.view.shiftOptions.find(o => o.allowed);
  const command = scoped(peer, { type: 'shift', roomId: option.roomId, expectedBoardRevision: peer.view.boardRevision });
  await send(peer, [command]); const accepted = await receipt(peer, command.actionId); assert.equal(accepted.accepted, true);
  const epochs = game.peers.map(p => p.view.self.controllerEpoch);
  // A real process kill after the normal durable acknowledgement, without editing SQLite.
  await game.demo.restart({ crash: true });
  await until(() => game.peers.every((p, i) => p.view.self.controllerEpoch > epochs[i] && p.view.recoveryTicksRemaining > 0), 'Both browsers receive recovered frozen checkpoint');
  assert.equal(peer.view.motion?.roomId, option.roomId); const recoveredTick = peer.view.tick;
  const count = peer.receiptCounts.get(command.actionId); await send(peer, [command]);
  await until(() => peer.receiptCounts.get(command.actionId) > count, 'Receipt survives actual process crash');
  assert.deepEqual(peer.receipts.get(command.actionId), accepted);
  const recoveryCommand = scoped(peer, { type: 'shift', roomId: option.roomId, expectedBoardRevision: peer.view.boardRevision });
  await send(peer, [recoveryCommand]); const rejectedDuringRecovery = await receipt(peer, recoveryCommand.actionId);
  assert.equal(rejectedDuringRecovery.accepted, false); assert.equal(rejectedDuringRecovery.reason, 'PHASE');
  await delay(150); assert.equal(peer.view.tick, recoveredTick, 'Recovery preserves simulation tick');
  await until(() => game.peers.every(p => p.view.recoveryTicksRemaining === 0 && !p.view.motion), 'Five-second recovery and move finish', 10000);
  const rejectedCount = peer.receiptCounts.get(recoveryCommand.actionId); await send(peer, [recoveryCommand]);
  await until(() => peer.receiptCounts.get(recoveryCommand.actionId) > rejectedCount, 'Recovery rejection stays rejected after resume');
  assert.deepEqual(peer.receipts.get(recoveryCommand.actionId), rejectedDuringRecovery);
  report.coverage.processCrashDuringMove = true;
  check('Actual SIGKILL after acknowledged move, frozen checkpoint, same durable receipt and reconnect', { game: game.label, recoveredTick });

  const old = game.peers[1], oldEpoch = old.view.self.controllerEpoch, seat = old.view.self.seatId;
  const page = await old.page.context().newPage(); page.setDefaultTimeout(12000);
  const replacement = watchPage(page, old.name, game);
  await page.goto(game.url, { waitUntil: 'domcontentloaded' });
  await until(() => replacement.view?.self.controllerEpoch > oldEpoch, 'Second tab obtains new controller epoch');
  assert.equal(replacement.view.self.seatId, seat);
  await old.page.locator('.shift-connection').waitFor();
  assert.match(await old.page.locator('.shift-connection').innerText(), /другой вкладке|Another tab/i);
  assert.equal(await old.page.evaluate(() => window.__shiftAcceptance.active?.readyState), 3);
  assert.ok(await page.locator('.shift-match-tools').getByRole('button', { name: 'RU', exact: true }).isVisible(), 'Guest keeps EN in takeover tab');
  game.peers[1] = replacement; await automated(replacement);
  // Keep the first tab visible as an inactive controller. Closing an individual
  // headless target can stall this local Chromium build; owned process teardown
  // happens after the batch, separately from gameplay and takeover acceptance.
  for (const current of game.peers) {
    const control = await bounded(current.page.evaluate(() => ({ automated: window.__shiftAcceptance.automated, socketState: window.__shiftAcceptance.active?.readyState })), `${game.label} takeover page responsiveness`);
    assert.equal(control.automated, true); assert.equal(control.socketState, 1);
  }
  report.coverage.controllerTakeover = true;
  check('Second-tab controller takeover leaves first tab visibly inactive', { game: game.label, oldEpoch, newEpoch: replacement.view.self.controllerEpoch });
}

async function drive(game) {
  const started = Date.now(), end = started + timeoutMs; let announcedRound = 0;
  while (Date.now() < end) {
    for (const peer of game.peers) if (peer.failure) throw peer.failure;
    if (game.peers.every(p => p.view?.phase === 'finished')) break;
    await Promise.all(game.peers.map(async peer => {
      const view = peer.view; if (!view || view.tick === peer.lastDriveTick) return;
      peer.lastDriveTick = view.tick;
      const commands = chooseBotCommands(view, peer.memory);
      if (commands.length) await send(peer, commands);
    }));
    const view = game.peers[0].view;
    if (view && view.round !== announcedRound) { announcedRound = view.round; log({ game: game.label, phase: view.phase, round: view.round, score: view.score }); }
    await delay(67);
  }
  assert.ok(game.peers.every(p => p.view?.phase === 'finished'), `${game.label} did not finish within the real-time deadline`);
  const final = game.peers[0].view;
  assert.ok(final.rounds.some(r => r.reason === 'delivery'), `${game.label}: ordinary match must include a real delivered battery`);
  assert.ok(game.comparedFrames > 0, 'Compared same-tick public fields from independent profiles');
  for (const peer of game.peers) {
    assert.ok(peer.roles.has('pilot') && peer.roles.has('navigator'), `${peer.name}: rotation must exercise both roles`);
    peer.inputMetrics = await bounded(peer.page.evaluate(() => window.__shiftAcceptance.inputMetrics), `${game.label} input telemetry`);
    if (peer.errors.length) log({ game: game.label, peer: peer.name, inputMetrics: peer.inputMetrics, errors: peer.errors });
    assert.deepEqual(peer.errors, [], `${peer.name} browser/wire errors`);
    await peer.page.locator('.shift-result').waitFor();
    assert.ok(await peer.page.locator('.shift-result').isVisible());
    peer.resultText = await bounded(peer.page.locator('.shift-result').innerText(), `${game.label} visible result text`);
    assert.match(peer.resultText, peer.name === 'navigator' ? /Delivered/ : /Доставлено/);
    await writeFile(join(directory, `${game.label}-${peer.name}-result.txt`), peer.resultText, { mode: 0o600 });
  }
  const result = { game: game.label, arena: game.arena, teamSize: game.teamSize, matchId: game.peers[0].matchId, result: { score: final.score, winner: final.winner, rounds: final.rounds }, realSeconds: Math.round((Date.now() - started) / 1000), comparedFrames: game.comparedFrames,
    injectedOneWayDelayMs: game.oneWayDelayMs,
    peers: game.peers.map(p => ({ name: p.name, frames: p.frames, roles: [...p.roles], socketConnections: p.sockets, moves: p.motions.size, inputMetrics: { ui: p.inputMetrics?.ui, policy: p.inputMetrics?.policy, peakPerSecond: p.inputMetrics?.peakPerSecond },
      ...(p.receiptLatencyMs.length ? { observedReceiptLatencyMs: { minimum: Math.round(Math.min(...p.receiptLatencyMs)), maximum: Math.round(Math.max(...p.receiptLatencyMs)) } } : {}) })) };
  report.matches.push(result);
  await writeFile(join(directory, `${game.label}-frames.json`), JSON.stringify(game.peers.map(p => ({ name: p.name, samples: p.samples, final: p.view })), null, 2), { mode: 0o600 });
  log({ complete: result });
}

async function rematch(game) {
  const [host, guest] = game.peers, oldId = (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room.matchId;
  await host.page.getByRole('button', { name: /Реванш|Rematch/ }).click();
  await host.page.getByRole('button', { name: /Начать матч|Start match/ }).waitFor();
  await guest.page.getByRole('button', { name: /I’m ready/ }).waitFor();
  const room = (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room;
  assert.equal(room.state, 'lobby'); assert.equal(room.matchId, null);
  assert.ok(room.members.filter(m => m.controller.kind === 'human').every(m => !m.ready));
  await host.page.getByRole('button', { name: /Я готов|I’m ready/ }).click(); await guest.page.getByRole('button', { name: /I’m ready|Я готов/ }).click();
  await until(async () => host.page.getByRole('button', { name: /Начать матч/ }).isEnabled(), 'Rematch readiness');
  await host.page.getByRole('button', { name: /Начать матч/ }).click();
  await until(async () => { const latest = (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room; return latest.matchId && latest.matchId !== oldId && latest.state === 'playing'; }, 'Distinct rematch starts');
  const latest = (await game.demo.pilot.request(`/rooms/${game.roomId}`)).room;
  await guest.page.locator('.shift-match-tools').getByRole('button', { name: 'RU', exact: true }).waitFor();
  check('Visible result → rematch → readiness → fresh authoritative match', { game: game.label, oldMatchId: oldId, newMatchId: latest.matchId });
  // Keep the real rematch independent; it may finish with substitute bots after these pages close.
}

let demo, browser, browserServer;
async function closeBrowser() {
  const server = browserServer, instance = browser; browserServer = null; browser = null;
  if (!server) return;
  const timer = setTimeout(() => {
    report.forcedBrowserTeardown = true;
    // Playwright kills the entire owned process group (renderer/GPU children too).
    void server.kill().catch(error => { report.browserTeardownError = error.message; });
  }, 8000);
  await instance?.close().catch(() => {}); await server.close().catch(() => {}); clearTimeout(timer);
}
try {
  demo = await startShiftDemo({ port, platformEntrypoint: join(buildSnapshot, 'platform/main.js'), portalDirectory: join(buildSnapshot, 'portal') });
  const localBrowser = join(ROOT, '.qa/shift-chromium/chrome-headless-shell-linux64/chrome-headless-shell');
  const executablePath = process.env.SHIFT_BROWSER_EXECUTABLE || process.env.SHIFT_CHROMIUM_EXECUTABLE || ((await stat(localBrowser).catch(() => null))?.isFile() ? localBrowser : undefined);
  const browserOptions = { headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] };
  report.browserExecutable = executablePath || 'Playwright installed Chromium';
  const allCases = [2, 3].flatMap(teamSize => ['foundry', 'calibration', 'depot'].map(arena => ({ teamSize, arena })));
  const matrix = selectedCase ? allCases.filter(item => `${item.arena}-${item.teamSize}v${item.teamSize}` === selectedCase) : smoke ? allCases.slice(0, 1) : allCases;
  assert.ok(matrix.length, 'Unknown --case; use e.g. foundry-3v3');
  for (let batch = 0; batch < matrix.length; batch += concurrency) {
    browserServer = await chromium.launchServer(browserOptions); browser = await chromium.connect(browserServer.wsEndpoint()); report.browserVersion = browser.version();
    const games = [];
    for (const item of matrix.slice(batch, batch + concurrency)) {
      const room = await demo.createRoom({ ...item, hostRole: 'navigator', rotateRoles: true, difficulty: 'normal' });
      const game = { ...item, room, roomId: room.roomId, demo, label: `${item.arena}-${item.teamSize}v${item.teamSize}`, url: `${demo.origin}/rooms/${room.roomId}`, hostSeat: room.members.find(m => m.playerId === demo.pilot.user.playerId).participantId, peers: [], comparedFrames: 0, oneWayDelayMs: item.arena === 'depot' && item.teamSize === 3 ? 60 : 0 };
      for (const name of ['pilot', 'navigator']) game.peers.push(await createBrowserPeer(game, name));
      await lobby(game, batch === 0 && games.length === 0);
      if (batch === 0 && games.length === 0) { await keyboardAudioInFreshContext(game); await contentionAndReconnect(game); await crashAndTakeover(game); }
      games.push(game);
      if (!smoke) game.run = drive(game).catch(error => { game.error = error; log({ game: game.label, matchFailure: error.message }); });
    }
    if (!smoke) { await Promise.all(games.map(game => game.run)); for (const game of games) if (game.error) throw game.error; }
    if (!smoke && batch === 0) await rematch(games[0]);
    await closeBrowser();
  }
  if (smoke) check('Smoke only: no full-cycle claim');
  else if (selectedCase) { assert.equal(report.matches.length, 1); report.targetedCase = selectedCase; }
  else { assert.equal(report.matches.length, 6); report.fullMatrix = true; }
  report.passed = true;
} catch (error) {
  report.passed = false; report.failures.push({ message: error.message, stack: error.stack });
  report.browserErrors = observedPeers.flatMap(p => p.errors.map(error => ({ game: p.game.label, peer: p.name, error })));
  await writeFile(join(directory, 'failure-http.json'), JSON.stringify(observedPeers.map(p => ({ name: p.name, game: p.game.label, requests: p.http }))), { mode: 0o600 });
  const pages = await Promise.all(observedPeers.slice(-4).map(async peer => {
    try { return { name: peer.name, game: peer.game.label, page: await bounded(peer.page.evaluate(() => ({ url: location.href, readyState: document.readyState, visibility: document.visibilityState, text: document.body.innerText.slice(0, 18000) })), 'Failure DOM observation', 4000) }; }
    catch (failure) { return { name: peer.name, game: peer.game.label, url: peer.page.url(), observationFailure: failure.message }; }
  }));
  await writeFile(join(directory, 'failure-pages.json'), JSON.stringify(pages, null, 2), { mode: 0o600 });
  await writeFile(join(directory, 'failure-views.json'), JSON.stringify(observedPeers.map(p => ({ name: p.name, game: p.game.label, view: p.view, failure: p.failure?.message }))), { mode: 0o600 });
  log({ failure: error.message }); process.exitCode = 1;
} finally {
  await demo?.stop().catch(error => { report.failures.push({ message: error.message }); report.passed = false; process.exitCode = 1; });
  await closeBrowser();
  report.finishedAt = new Date().toISOString(); await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  log({ passed: report.passed, fullMatrix: report.fullMatrix || false, report: join(directory, 'report.json'), coverage: report.coverage });
}
