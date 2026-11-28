/** Automated UI acceptance of the actual production bundles.
 * Isolated accounts/mail/SQLite/browser contexts. No application-state hooks,
 * API gameplay commands, mocked transport, timer jumps or production writes.
 * Gameplay observation: received browser WebSocket frames and visible DOM/HUD.
 * Gameplay control: Playwright keyboard, pointer, touchscreen and normal UI.
 */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import { delayedLoopback } from './latency-proxy.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, '.qa', 'test-bench-browser', process.env.IVA_BROWSER_RUN ?? 'current');
const digest = data => createHash('sha256').update(data).digest('hex');
function timing(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] * 10) / 10 : null;
  return { count: sorted.length, min: at(0), p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
}
const directory = await mkdtemp(join(tmpdir(), 'iva-test-bench-browser-'));
const mailbox = join(directory, 'mail');
const players = [];
const latencyMs = Number(process.env.IVA_BROWSER_LATENCY_MS ?? 0);
assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 1000, 'IVA_BROWSER_LATENCY_MS must be between 0 and 1000');
let fixtureDirectory;
let policy;
let browser;
let server;
let origin = '';
let port = 0;
let relay;
const report = {
  status: 'running', method: 'Automated Chromium UI against production client/server bundles',
  scope: 'Two isolated account contexts and two explicit bots; public UI inputs and observed snapshots',
  humanPlaytest: false, audioListening: false, physicalDevice: false, mockedGameApi: false,
  directGameplayApiCommands: 0, externalMessages: 0, fullCups: 0, tutorial: 'not started',
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  scenarios: [], cups: [], metrics: [], layouts: [], browserErrors: [], consoleErrors: [], consoleErrorsDropped: 0, failedAssets: [], expectedOfflineAssetFailures: [], actionErrors: [], observedGameActions: {},
  controls: { keyboardEvents: 0, touchGestures: 0, acceptedUiActions: 0 },
  transport: { path: latencyMs ? 'Owned loopback TCP delay relay for HTTP and WebSocket bytes' : 'Direct owned loopback', configuredPerDirectionMs: latencyMs, publicInternetMeasurement: false },
  openCoverage: ['Actual listening', 'Physical touch hardware', 'Human browser play'],
};
const http = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' });

function omitDataUrls(value) {
  const omitted = [];
  const text = value.replace(/data:[^\s"'<>]+/gi, url => {
    const comma = url.indexOf(',');
    const type = comma < 0 ? 'unspecified' : url.slice(5, comma).slice(0, 100);
    omitted.push({ type, characters: url.length });
    return `[data URL omitted: ${type}; ${url.length} characters]`;
  });
  return { text, omitted };
}

async function until(predicate, label, timeout = 10000, interval = 30) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(interval); }
  throw new Error(`Timed out: ${label}`);
}
async function scenario(name, work) {
  console.info(`[test-bench browser] ${name}`);
  const row = { name, status: 'running' }; report.scenarios.push(row);
  try { const evidence = await work(); row.status = 'passed'; if (evidence !== undefined) row.evidence = evidence; return evidence; }
  catch (error) { row.status = 'failed'; row.error = error.message; throw error; }
}
async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const address = probe.address(); assert.ok(address && typeof address !== 'string');
  await new Promise(resolve => probe.close(resolve)); return address.port;
}
async function start() {
  const child = spawn(process.execPath, [join(root, 'dist-platform/main.js')], {
    cwd: root,
    env: {
      ...process.env, NODE_ENV: 'development', PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: String(port),
      PORTAL_ORIGIN: origin, PLATFORM_ALLOWED_HOSTS: new URL(origin).host, PLATFORM_ALLOWED_ORIGINS: origin,
      PLATFORM_DATABASE_PATH: join(directory, 'platform.sqlite'), PLATFORM_LAB_DATABASE_PATH: join(directory, 'runtime.sqlite'),
      MAIL_MODE: 'file', MAIL_FILE_DIRECTORY: mailbox, TELEGRAM_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'false',
      PORTAL_DIST_DIRECTORY: join(root, 'apps/portal/dist'),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, log: '', error: null }; server = state;
  const collect = data => { state.log = (state.log + String(data)).slice(-20000); };
  child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', error => { state.error = error; });
  await until(async () => {
    if (state.error) throw state.error;
    assert.ok(child.exitCode === null && child.signalCode === null, `Test platform exited before readiness: ${state.log}`);
    if (!state.log.split(/\r?\n/).includes(`Iva Games platform listening on 127.0.0.1:${port}`)) return false;
    return (await http(origin + '/health/ready')).status === 200;
  }, 'isolated production platform readiness', 15000);
}
async function stop() {
  const state = server; if (!state) return; server = null;
  if (state.error) throw state.error;
  const child = state.child;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 'graceful test server shutdown', 12000); }
  catch (error) { child.kill('SIGKILL'); throw error; }
  assert.equal(child.exitCode, 0, `Test server shutdown: ${state.log}`);
}

class Account {
  cookie = ''; csrf = '';
  async request(path, body) {
    const response = await http(origin + '/api/platform/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: this.cookie, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('iva_dev_session='));
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json(); assert.ok(response.ok, `${path}: ${response.status} ${result.error?.code ?? ''}`);
    if (path === '/session') this.csrf = result.csrfToken;
    return result;
  }
  async register(handle) {
    await this.request('/session');
    const email = handle + '@example.test';
    const result = await this.request('/auth/register', { email, handle, displayName: handle, password: 'isolated browser acceptance password' });
    await this.request('/session');
    let token;
    for (const file of await readdir(mailbox)) {
      const message = await readFile(join(mailbox, file), 'utf8');
      if (!message.startsWith(`To: ${email}\n`)) continue;
      const url = message.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
      if (url) token = new URL(url).searchParams.get('token');
    }
    assert.ok(token, 'The isolated file mailbox must receive account verification');
    await this.request('/auth/verify', { token });
    assert.equal((await this.request('/session')).user.emailVerified, true);
    this.user = result.user; return this;
  }
}

function observe(player, page) {
  player.page = page; player.snapshot = null; player.receivedAt = 0;
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.browserErrors.push({ profile: player.name, message: error.message }));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location();
    // Redact embedded font payloads before bounding the message, so the CSP
    // reason after a long data URL remains in the diagnostic output.
    const sanitized = omitDataUrls(message.text());
    const text = sanitized.text.slice(0, 1400);
    const scenario = report.scenarios.at(-1)?.name ?? 'setup';
    const previous = report.consoleErrors.find(value => value.profile === player.name && value.message === text && value.scenario === scenario);
    if (previous) { previous.occurrences++; return; }
    if (report.consoleErrors.length >= 30) { report.consoleErrorsDropped++; return; }
    // These are evidence for review, separate from uncaught exceptions: this
    // suite deliberately loses a WebGL context and disconnects a profile.
    const source = location.url ? location.url.startsWith('data:') ? '[data URL omitted from source]' : new URL(location.url, origin).pathname : null;
    report.consoleErrors.push({ profile: player.name, scenario, message: text, textTruncated: sanitized.text.length > 1400, ...(sanitized.omitted.length ? { omittedDataUrls: sanitized.omitted } : {}), source, line: location.lineNumber, column: location.columnNumber, occurrences: 1 });
  });
  const assetPath = url => { const p = new URL(url).pathname; return !p.startsWith('/api/') && (p.startsWith('/test-bench/') || p.startsWith('/assets/')); };
  page.on('requestfailed', request => {
    if (assetPath(request.url()) && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      const failure = { profile: player.name, path: new URL(request.url()).pathname, error: request.failure()?.errorText };
      (player.intentionalOffline ? report.expectedOfflineAssetFailures : report.failedAssets).push(failure);
    }
  });
  page.on('response', response => {
    if (assetPath(response.url())) { player.loadedAssets.add(new URL(response.url()).pathname); if (response.status() >= 400) report.failedAssets.push({ profile: player.name, path: new URL(response.url()).pathname, status: response.status() }); }
    if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/actions')) {
      const type = response.request().postDataJSON()?.payload?.type ?? 'unknown';
      report.observedGameActions[type] = (report.observedGameActions[type] ?? 0) + 1;
      if (response.status() >= 400) report.actionErrors.push({ profile: player.name, type, status: response.status() });
    }
  });
  page.on('websocket', socket => {
    if (!socket.url().includes('/live')) return;
    player.socketConnections++;
    socket.on('framereceived', event => {
      try {
        const frame = JSON.parse(String(event.payload));
        if (frame.type === 'snapshot' && frame.view?.you) {
          player.snapshot = frame; player.receivedAt = Date.now(); player.receivedFrames++;
          // Sample the exact accepted sequence, not older inputs that might have
          // been superseded before a snapshot. Both timestamps use this runner's clock.
          const sent = player.pendingInputs.get(frame.epoch + ':' + frame.lastAcceptedSeq);
          if (sent) player.ackTimings.push(performance.now() - sent.sentAt);
          for (const [key, pending] of player.pendingInputs) if (pending.epoch !== frame.epoch || pending.seq <= frame.lastAcceptedSeq) player.pendingInputs.delete(key);
        }
        if (frame.type === 'error') player.transportErrors.push(frame.code);
      } catch { player.transportErrors.push('unparseable-frame'); }
    });
    socket.on('framesent', event => {
      try {
        const frame = JSON.parse(String(event.payload));
        if (frame.type === 'input') {
          player.sentInputs++; player.lastSent = frame;
          player.pendingInputs.set(frame.epoch + ':' + frame.seq, { epoch: frame.epoch, seq: frame.seq, sentAt: performance.now() });
          while (player.pendingInputs.size > 300) player.pendingInputs.delete(player.pendingInputs.keys().next().value);
        }
      } catch { /* Other browser frames are not game input. */ }
    });
    socket.on('close', () => player.socketCloses++);
  });
}
async function makePlayer(account, name, locale, hasTouch = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch });
  const separator = account.cookie.indexOf('=');
  await context.addCookies([{ name: account.cookie.slice(0, separator), value: account.cookie.slice(separator + 1), url: origin }]);
  const player = { account, name, locale, context, held: new Set(), loadedAssets: new Set(), pendingInputs: new Map(), ackTimings: [], socketConnections: 0, socketCloses: 0, receivedFrames: 0, sentInputs: 0, transportErrors: [], snapshot: null, lastInteract: 0, lastRestore: 0, driveRemainder: { throttle: 0, steering: 0 } };
  observe(player, await context.newPage()); players.push(player); return player;
}
const label = (player, ru, en) => player.locale === 'ru' ? ru : en;
const view = player => player.snapshot?.view;
const fresh = player => player.snapshot && Date.now() - player.receivedAt < 1200;
async function waitView(player, predicate, description, timeout = 12000) {
  return until(() => fresh(player) && predicate(view(player)) && view(player), description, timeout);
}
async function keys(player, wanted = []) {
  const next = new Set(wanted);
  for (const key of player.held) if (!next.has(key)) { await player.page.keyboard.up(key); report.controls.keyboardEvents++; }
  for (const key of next) if (!player.held.has(key)) { await player.page.keyboard.down(key); report.controls.keyboardEvents++; }
  player.held = next;
}
async function focusLane(player) {
  await player.page.locator('.tb-scene-canvas').click({ position: { x: 20, y: 120 } });
}
async function action(player, locator, type, activation = 'click') {
  await expect(locator).toBeEnabled();
  const pending = player.page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || !response.url().endsWith('/actions')) return false;
    try { return response.request().postDataJSON()?.payload?.type === type; } catch { return false; }
  });
  if (activation === 'Space') { await keys(player); await locator.focus(); await locator.press('Space'); report.controls.keyboardEvents += 2; }
  else await locator.click();
  const response = await pending; const body = await response.json();
  assert.equal(response.status(), 200, `UI ${type}: ${body.error?.code ?? 'HTTP failure'}`);
  report.controls.acceptedUiActions++;
  if (body.view) await waitView(player, current => current.matchId === body.view.matchId && current.revision >= body.view.revision, `snapshot confirms ${type}`);
  return body.view;
}
async function roomAction(player, locator, endpoint, activation = 'click') {
  const pending = player.page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(endpoint));
  if (activation === 'Space') { await locator.focus(); await locator.press('Space'); report.controls.keyboardEvents += 2; } else await locator.click();
  const response = await pending; const result = await response.json();
  assert.equal(response.status(), 200, `${endpoint}: ${result.error?.code ?? 'HTTP failure'}`);
  report.controls.acceptedUiActions++; return result;
}
async function inspect(player, name, { race = false, low = false } = {}) {
  const page = player.page;
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('.tb-drive-actions button,.tb-pause,.tb-local-footer button,.tb-pedals button')].map(button => { const r = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label') ?? button.textContent?.trim(), visible: r.width > 0 && r.height > 0, inViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }) }));
  report.layouts.push({ profile: player.name, name, ...layout });
  assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: horizontal overflow`);
  if (race) assert.deepEqual(layout.controls.filter(control => control.visible && !control.inViewport), [], `${name}: race controls outside viewport`);
  const canvas = page.locator('.tb-scene-canvas').first();
  if (await canvas.count()) {
    if (await canvas.getAttribute('data-renderer') === '3d') await page.waitForFunction(() => Number(document.querySelector('.tb-scene-canvas')?.getAttribute('data-draw-calls')) > 0);
    const metrics = await canvas.evaluate(node => ({ renderer: node.dataset.renderer, engine: node.dataset.engine, participantPaint: node.closest('.tb-scene')?.getAttribute('data-participant-paint'), drawCalls: Number(node.dataset.drawCalls || 0), frameP95Ms: Number(node.dataset.frameP95 || 0), width: node.clientWidth, height: node.clientHeight }));
    report.metrics.push({ profile: player.name, name, ...metrics });
    assert.ok(metrics.width >= 100 && metrics.height >= 100, `${name}: collapsed scene`);
    if (low && metrics.renderer === '3d') assert.ok(metrics.drawCalls <= 150, `${name}: ${metrics.drawCalls} low-quality draw calls exceeds target`);
  }
  await page.screenshot({ path: join(output, `${player.name}-${name}.png`), fullPage: false });
}

async function failureScreen(player) {
  const page = player.page;
  const dialog = page.locator('dialog[open]').first();
  const hasDialog = await dialog.count().catch(() => 0);
  const scope = hasDialog ? dialog : page.locator('body');
  const [visibleText, accessibility] = await Promise.all([
    scope.innerText({ timeout: 2000 }).catch(error => `Unavailable: ${error.message}`),
    scope.ariaSnapshot({ timeout: 2000 }).catch(error => `Unavailable: ${error.message}`),
  ]);
  return {
    profile: player.name, path: new URL(page.url()).pathname, scope: hasDialog ? 'open dialog' : 'body',
    visibleText: visibleText.slice(0, 1800), visibleTextTruncated: visibleText.length > 1800,
    accessibility: accessibility.slice(0, 4200), accessibilityTruncated: accessibility.length > 4200,
  };
}

async function settings(player, { locale = player.locale, renderer = '3d', quality = 'low', exhaustive = false } = {}) {
  const page = player.page;
  await page.getByRole('button', { name: label(player, 'Настройки', 'Settings'), exact: true }).click();
  let dialog = page.locator('dialog[open]');
  if (locale !== player.locale) { await dialog.getByLabel(label(player, 'Язык', 'Language'), { exact: true }).selectOption(locale); player.locale = locale; }
  await dialog.getByLabel(label(player, 'Вид', 'View'), { exact: true }).selectOption(renderer);
  await dialog.getByLabel(label(player, 'Качество', 'Quality'), { exact: true }).selectOption(quality);
  if (exhaustive) {
    await dialog.getByLabel(label(player, 'Размер текста', 'Text size'), { exact: true }).selectOption('130');
    await expect(dialog.getByLabel(label(player, 'Размер текста', 'Text size'), { exact: true })).toHaveValue('130');
    await dialog.getByLabel(label(player, 'Уменьшить движение', 'Reduce motion'), { exact: true }).check();
    await dialog.getByLabel(label(player, 'Пыль и брызги', 'Dust and spray'), { exact: true }).uncheck();
    const sound = dialog.locator('input[type=range]').first(); await sound.focus(); await sound.press('Home'); await sound.press('ArrowRight');
    await expect(sound).toHaveValue('0.05');
    const music = dialog.locator('input[type=range]').nth(1); await music.focus(); await music.press('Home'); await expect(music).toHaveValue('0');
    const bind = dialog.locator('.tb-bindings button').first(); await bind.click(); await bind.press('KeyA');
    await expect(dialog.getByRole('alert')).toContainText(label(player, 'уже занята', 'already assigned'));
    await bind.press('KeyZ'); await expect(bind.locator('kbd')).toHaveText('Z');
    await dialog.getByRole('button', { name: label(player, 'Сбросить клавиши', 'Reset keys') }).click(); await expect(bind.locator('kbd')).toHaveText('W');
    await dialog.getByRole('button', { name: label(player, 'Готово', 'Done'), exact: true }).click();
    await inspect(player, 'settings-130-text');
    await page.getByRole('button', { name: label(player, 'Настройки', 'Settings'), exact: true }).click(); dialog = page.locator('dialog[open]');
    await dialog.getByLabel(label(player, 'Размер текста', 'Text size'), { exact: true }).selectOption('100');
    await dialog.getByLabel(label(player, 'Уменьшить движение', 'Reduce motion'), { exact: true }).uncheck();
    await dialog.getByLabel(label(player, 'Пыль и брызги', 'Dust and spray'), { exact: true }).check();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  } else await dialog.getByRole('button', { name: label(player, 'Готово', 'Done'), exact: true }).click();
  await expect(page.locator('canvas.tb-scene-canvas')).toHaveAttribute('data-renderer', renderer);
}

async function selectPart(player, slot, part, online = true, expectError) {
  const page = player.page;
  await page.locator('.tb-slot-nav button').filter({ hasText: policy.SLOT_NAMES[slot][player.locale] }).click();
  const button = part ? page.locator('.tb-parts button').filter({ hasText: policy.PARTS[part].name[player.locale] }) : page.locator('.tb-parts').getByRole('button', { name: label(player, 'Снять деталь', 'Remove part'), exact: true });
  if (expectError) {
    const before = view(player)?.you.build;
    await button.click(); await expect(page.locator('.tb-builder-strip [role=alert]')).toContainText(expectError);
    if (online) { await delay(130); assert.deepEqual(view(player).you.build, before, 'A rejected UI build must preserve its confirmed blueprint'); }
  } else if (online) await action(player, button, 'blueprint'); else await button.click();
}
async function preset(player, id, online = true) {
  const button = player.page.locator('.tb-presets button').filter({ hasText: policy.PRESET_NAMES[id][player.locale] });
  if (online) await action(player, button, 'blueprint'); else await button.click();
}

async function localHud(player) {
  return player.page.locator('.tb-race').evaluate(node => {
    const transform = node.querySelector('.tb-track-map g[transform]')?.getAttribute('transform') ?? '';
    const match = /translate\(([-\d.e+]+)[,\s]+([-\d.e+]+)\)/.exec(transform);
    const capsule = node.querySelector('.tb-cargo-slot');
    const healthText = capsule?.querySelector('strong')?.textContent?.trim() ?? '';
    const cargoStatus = capsule?.className;
    const health = capsule?.classList.contains('broken') || healthText === '×' ? 0
      : capsule?.classList.contains('at-dock') || capsule?.classList.contains('deposited') ? null
      : /^\d+(\.\d+)?$/.test(healthText) ? Number(healthText) : null;
    return { x: match ? (Number(match[1]) - 50) / 9 : null, z: match ? (250 - Number(match[2])) / 4.8 : null, speed: Number(node.querySelector('.tb-speed b')?.textContent), charge: Number(node.querySelector('.tb-energy b')?.textContent), timer: node.querySelector('.tb-race-timer strong')?.textContent, health, cargoStatus, interaction: node.querySelector('.tb-interact')?.textContent, canInteract: !node.querySelector('.tb-interact')?.hasAttribute('disabled'), next: !!node.querySelector('.tb-race-lesson .tb-primary'), lessonTitle: node.querySelector('.tb-race-lesson h2')?.textContent, result: !!node.querySelector('.tb-run-result') };
  });
}
async function stableLessonMilestone(player, name) {
  const before = await localHud(player);
  assert.equal(before.next, true, `${name}: the lesson goal must expose Continue`);
  await delay(400);
  const after = await localHud(player);
  const state = hud => ({ x: hud.x, z: hud.z, speed: hud.speed, charge: hud.charge, timer: hud.timer, health: hud.health, cargoStatus: hud.cargoStatus, next: hud.next });
  assert.deepEqual(state(after), state(before), `${name}: the reached lesson goal must preserve its clock, cargo and physics while waiting for Continue`);
  return after;
}
async function localDriveTo(player, target, speed = 2.2, extra = () => false, timeout = 30000) {
  await focusLane(player); const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hud = await localHud(player); assert.notEqual(hud.z, null, 'Visible minimap position is required for the local UI driver');
    if (await extra(hud) || hud.z >= target - .35 && hud.speed <= .35) { await keys(player, ['Space']); return hud; }
    const desired = Math.min(speed, Math.max(0, (target - hud.z - .25) * 1.0));
    await keys(player, hud.speed > desired + .12 || desired < .1 ? ['Space'] : hud.speed < desired ? ['KeyW'] : []);
    await delay(45);
  }
  await keys(player); throw new Error(`Local keyboard driver did not reach ${target} m: ${JSON.stringify(await localHud(player))}`);
}

async function practiceChecks(alice, bob) {
  await scenario('Every catalog part can be selected on a legal practice build', async () => {
    await alice.page.goto(origin + '/games/test-bench?mode=practice'); await expect(alice.page.locator('.tb-builder')).toBeVisible();
    const chosen = [];
    for (const slot of Object.keys(policy.SLOT_NAMES)) {
      await preset(alice, 'universal', false);
      for (const part of Object.values(policy.PARTS).filter(value => value.slots.includes(slot))) {
        await selectPart(alice, slot, part.id, false);
        const button = alice.page.locator('.tb-parts button').filter({ hasText: part.name.ru });
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(alice.page.locator('.tb-part-description strong')).toHaveText(part.name.ru);
        chosen.push({ slot, part: part.id });
      }
      if (slot.startsWith('aux-')) {
        await alice.page.locator('.tb-parts').getByRole('button', { name: 'Снять деталь', exact: true }).click();
        await expect(alice.page.locator('.tb-parts').getByRole('button', { name: 'Снять деталь', exact: true })).toBeDisabled();
      }
    }
    await preset(alice, 'universal', false);
    await selectPart(alice, 'aux-left', 'ballast', false);
    await alice.page.getByRole('button', { name: /Поменять модули местами/ }).click();
    await expect(alice.page.locator('.tb-slot-nav button').filter({ hasText: 'Правое крепление' })).toContainText('Балласт');
    return { selectedCombinations: chosen, auxiliaryRemoval: true, swap: true, actualRenderInspection: false };
  });
  await scenario('Practice pause, keyboard button activation, two assemblies and WebGL fallback', async () => {
    const page = alice.page;
    await page.goto(origin + '/games/test-bench?mode=practice');
    await expect(page.locator('.tb-builder')).toBeVisible();
    await preset(alice, 'universal', false);
    await page.getByRole('button', { name: /Повернуть/ }).click();
    const top = page.getByRole('button', { name: 'Сверху', exact: true });
    await top.click(); await expect(top).toHaveAttribute('aria-pressed', 'true');
    await top.click();
    const starts = [];
    for (const presetId of ['universal', 'gentle']) {
      await preset(alice, presetId, false);
      await page.getByRole('button', { name: /Проверить/ }).click();
      await expect(page.locator('.tb-race')).toBeVisible();
      if (presetId === 'universal') {
        await focusLane(alice); await keys(alice, ['KeyW']); await delay(350); await keys(alice);
        const pause = page.locator('.tb-pause'); await pause.focus(); await pause.press('Space');
        await expect(page.locator('.tb-race')).toHaveClass(/paused/);
        const before = await localHud(alice); await delay(400); const after = await localHud(alice);
        assert.deepEqual({ z: after.z, charge: after.charge, timer: after.timer }, { z: before.z, charge: before.charge, timer: before.timer }, 'Paused practice must not advance physics/timer/charge');
        await pause.press('Space'); await expect(page.locator('.tb-race')).not.toHaveClass(/paused/);
        const lost = await page.locator('canvas.tb-scene-canvas').evaluate(canvas => {
          const context = canvas.getContext('webgl2'); const extension = context?.getExtension('WEBGL_lose_context');
          if (!extension) return false; extension.loseContext(); return true;
        });
        assert.equal(lost, true, 'The production 3D canvas must expose context-loss testing');
        await expect(page.locator('canvas.tb-scene-canvas')).toHaveAttribute('data-renderer', '2d');
        const fallback = await localHud(alice); assert.ok(fallback.z >= before.z - .05, 'Renderer fallback must preserve the lane');
        await page.getByRole('button', { name: 'Вернуть 3D', exact: true }).click();
        await expect(page.locator('canvas.tb-scene-canvas')).toHaveAttribute('data-renderer', '3d');
      }
      const reached = await localDriveTo(alice, 16, 2.4);
      starts.push({ preset: presetId, x: reached.x, z: reached.z, speed: reached.speed, charge: reached.charge, remainingSeconds: reached.timer });
      await inspect(alice, `practice-${presetId}-same-ribs`, { race: true, low: true });
      await keys(alice); await page.locator('.tb-local-footer').getByRole('button', { name: /В мастерскую/ }).click();
      await expect(page.locator('.tb-builder')).toBeVisible();
    }
    return { compared: starts, obstacle: 'Same real fragile-track ribs at 11–15 m', visualInspection: 'Screenshots recorded, not a human inspection', rendererLoss: 'real WEBGL_lose_context fault', pause: 'position/charge/timer unchanged' };
  });
  await scenario('English short-screen touch emulation and 2D driving', async () => {
    const page = bob.page; await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(origin + '/games/test-bench?mode=practice');
    await expect(page.locator('.tb-builder')).toBeVisible();
    await preset(bob, 'universal', false);
    await page.getByRole('button', { name: /Test drive/ }).click(); await expect(page.locator('.tb-race')).toBeVisible();
    await expect(page.locator('canvas.tb-scene-canvas')).toHaveAttribute('data-renderer', '2d');
    await inspect(bob, 'short-en-2d-controls', { race: true });
    const pedal = page.getByRole('button', { name: 'Accelerate', exact: true });
    await expect(pedal).toBeVisible(); const bounds = await pedal.boundingBox(); assert.ok(bounds);
    const cdp = await bob.context.newCDPSession(page);
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1, radiusX: 4, radiusY: 4 };
    const before = await localHud(bob);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await delay(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); report.controls.touchGestures++;
    const after = await localHud(bob); assert.ok(after.z > before.z + .03, 'Touch accelerator must move the real machine');
    await focusLane(bob); await keys(bob, ['Space']); await delay(300); await keys(bob);
    const slider = page.getByRole('slider', { name: 'Steering' }); await slider.focus(); await slider.press('ArrowRight');
    await page.locator('.tb-pause').focus(); await page.locator('.tb-pause').press('Space'); await expect(page.locator('.tb-race')).toHaveClass(/paused/);
    await page.locator('.tb-pause').press('Space'); await expect(page.locator('.tb-race')).not.toHaveClass(/paused/);
    await inspect(bob, 'short-en-2d-after-touch', { race: true });
    await cdp.detach(); await page.setViewportSize({ width: 1440, height: 900 });
    return { viewport: '844×390', emulatedTouch: true, physicalDevice: false, deltaZ: after.z - before.z, nativeSpaceActivation: 'pause/resume' };
  });
}

async function tutorial(player) {
  report.tutorial = 'running'; const page = player.page;
  await page.goto(origin + '/games/test-bench');
  await page.getByRole('button', { name: /Как играть/ }).click();
  await expect(page.locator('.tb-builder')).toBeVisible();
  await expect(page.getByRole('button', { name: /Проверить/ })).toBeDisabled();
  await selectPart(player, 'front-axle', 'terrain', false);
  await expect(page.getByRole('button', { name: /Проверить/ })).toBeEnabled();
  await page.getByRole('button', { name: /Проверить/ }).click();
  await expect(page.locator('.tb-race')).toBeVisible();
  const next = () => page.locator('.tb-race-lesson .tb-primary');
  await localDriveTo(player, 14, 3, hud => hud.next); await keys(player); await next().click();
  await until(async () => (await localHud(player)).z < 1, 'tutorial restarts at the dock lesson');
  await localDriveTo(player, 3.1, 1.7, hud => hud.canInteract && hud.speed <= .35);
  await keys(player); const load = page.locator('.tb-interact'); await expect(load).toBeEnabled(); await load.focus(); await load.press('Space');
  await expect(page.locator('.tb-cargo-slot')).toHaveClass(/secured/); await next().click();
  await focusLane(player); await keys(player, ['KeyW']);
  await until(async () => (await localHud(player)).next, 'tutorial captures and pauses the completed fast impact comparison', 20000, 40);
  const fast = await stableLessonMilestone(player, 'fast impact'); await keys(player);
  assert.equal(fast.lessonTitle, 'Почувствуй удар');
  assert.match(fast.cargoStatus ?? '', /\b(secured|loose|broken)\b/, 'The fast comparison must show the actually damaged capsule');
  assert.ok(Number.isFinite(fast.health) && fast.health >= 0 && fast.health < 100, `Fast milestone must show real damage, received ${fast.health}`);
  await next().click();
  await until(async () => (await localHud(player)).z < 1, 'tutorial restarts for the slow comparison');
  await expect(page.locator('.tb-race-lesson p b')).toHaveText(String(fast.health));
  await localDriveTo(player, 3.1, 1.7, hud => hud.canInteract && hud.speed <= .35);
  await keys(player); await page.locator('.tb-interact').click(); await expect(page.locator('.tb-cargo-slot')).toHaveClass(/secured/);
  await localDriveTo(player, 14, .85, hud => hud.next, 45000);
  await until(async () => (await localHud(player)).next, 'tutorial holds its slow goal through the required settling period', 10000, 40);
  const slow = await stableLessonMilestone(player, 'slow crossing'); await keys(player);
  assert.equal(slow.lessonTitle, 'Теперь пройди медленнее');
  assert.match(slow.cargoStatus ?? '', /\bsecured\b/, 'The slow comparison must keep the capsule secured');
  assert.ok(slow.z >= 13.5, `The slow comparison must cross the ribs, received z=${slow.z}`);
  assert.ok(Number.isFinite(slow.health) && slow.health > fast.health && slow.health <= 100, `Slow comparison integrity ${slow.health} must exceed fast ${fast.health}`);
  await expect(next()).toBeVisible(); await inspect(player, 'tutorial-slow-comparison', { race: true, low: true }); await next().click();
  await localDriveTo(player, 22.5, 1.8, hud => hud.next, 25000); await keys(player, ['Space']);
  await expect(next()).toBeVisible({ timeout: 5000 }); await keys(player); await next().click();
  await expect(next()).toContainText('В тренировку'); await next().click(); await expect(page.locator('.tb-builder')).toBeVisible();
  report.tutorial = 'completed through UI and real local physics';
  return { completed: true, steps: 6, fastIntegrity: fast.health, fastCargoStatus: fast.cargoStatus, slowIntegrity: slow.health, milestonePauseMs: 400, baselineMatchesFastHud: true, slowCargoSecured: true, observation: 'Visible minimap, HUD and lesson controls', control: 'Keyboard and UI only' };
}

async function createCup(alice, bob) {
  await alice.page.goto(origin + '/games/test-bench');
  await alice.page.getByRole('button', { name: /^Создать комнату/ }).click();
  const dialog = alice.page.getByRole('dialog', { name: 'Создать комнату' });
  await expect(dialog.getByLabel('Мест в комнате', { exact: true })).toBeVisible();
  const options = await dialog.getByLabel('Мест в комнате', { exact: true }).locator('option').allTextContents();
  assert.deepEqual(options, ['2', '3', '4', '5', '6']);
  await dialog.getByLabel('Мест в комнате', { exact: true }).selectOption('4');
  let room = (await roomAction(alice, dialog.getByRole('button', { name: /^Создать комнату/ }), '/rooms')).room;
  await expect(alice.page.locator('.tb-lobby')).toBeVisible();
  await expect(alice.page.getByRole('button', { name: /Начать кубок/ })).toBeDisabled();
  await alice.page.getByRole('button', { name: 'Настроить комнату', exact: true }).click();
  const roomDialog = alice.page.locator('dialog[open]');
  await roomDialog.getByLabel('Название', { exact: true }).fill('Browser acceptance cup');
  await roomDialog.getByLabel('Число мест', { exact: true }).selectOption('4');
  room = (await roomAction(alice, roomDialog.getByRole('button', { name: 'Сохранить', exact: true }), '/settings')).room;
  const inviteAndJoin = async () => {
    await alice.page.getByRole('button', { name: /^Пригласить друга/ }).click();
    const row = alice.page.locator('.tb-invite-row').filter({ hasText: bob.account.user.displayName });
    const invitation = (await roomAction(alice, row.getByRole('button', { name: 'Пригласить', exact: true }), '/invitations')).invitation;
    await alice.page.locator('dialog[open]').getByRole('button', { name: 'Готово', exact: true }).click();
    // The recipient fixture accepts its isolated invitation; game control stays in UI.
    await bob.account.request(`/invitations/${invitation.invitationId}/accept`, {});
    await bob.account.request(`/rooms/${room.roomId}/join`, {});
    await alice.page.reload();
    await expect(alice.page.locator('.tb-seat-list')).toContainText(bob.account.user.displayName);
  };
  await inviteAndJoin();
  await roomAction(alice, alice.page.getByRole('button', { name: 'Убрать участника ' + bob.account.user.displayName, exact: true }), '/kick');
  await expect(alice.page.locator('.tb-seat-list')).not.toContainText(bob.account.user.displayName);
  await inviteAndJoin();
  await alice.page.reload(); await bob.page.goto(origin + '/rooms/' + room.roomId);
  await expect(alice.page.locator('.tb-seat-list')).toContainText(bob.account.user.displayName);
  await expect(bob.page.locator('.tb-lobby')).toBeVisible();
  await alice.page.getByLabel('Сложность бота', { exact: true }).selectOption('normal');
  room = (await roomAction(alice, alice.page.getByRole('button', { name: /Добавить бота/ }), '/bots')).room;
  const bot = room.members.find(member => member.controller.kind === 'bot');
  room = (await roomAction(alice, alice.page.getByRole('button', { name: 'Убрать участника ' + bot.displayName, exact: true }), '/remove')).room;
  assert.equal(room.members.filter(member => member.controller.kind === 'bot').length, 0);
  room = (await roomAction(alice, alice.page.getByRole('button', { name: /Добавить бота/ }), '/bots')).room;
  await alice.page.getByLabel('Сложность бота', { exact: true }).selectOption('easy');
  room = (await roomAction(alice, alice.page.getByRole('button', { name: /Добавить бота/ }), '/bots')).room;
  assert.equal(room.members.filter(member => member.controller.kind === 'bot').length, 2);
  await expect(alice.page.getByRole('button', { name: /Добавить бота/ })).toBeDisabled();
  await expect(alice.page.getByLabel('Сложность бота', { exact: true })).toBeDisabled();
  await expect(alice.page.locator('.tb-seat-list')).toContainText('БОТ');
  await roomAction(alice, alice.page.getByRole('button', { name: /^Я готов/ }), '/ready', 'Space');
  await roomAction(alice, alice.page.getByRole('button', { name: /^Пока не готов/ }), '/ready');
  await expect(alice.page.getByRole('button', { name: /Начать кубок/ })).toBeDisabled();
  await roomAction(alice, alice.page.getByRole('button', { name: /^Я готов/ }), '/ready');
  await roomAction(bob, bob.page.getByRole('button', { name: /^I’m ready/ }), '/ready');
  await expect(alice.page.getByRole('button', { name: /Начать кубок/ })).toBeEnabled({ timeout: 8000 });
  await inspect(alice, 'ru-four-seat-lobby'); await inspect(bob, 'en-four-seat-lobby');
  room = (await roomAction(alice, alice.page.getByRole('button', { name: /Начать кубок/ }), '/start')).room;
  await Promise.all([alice, bob].map(player => waitView(player, value => !!value, 'personalized live cup snapshot')));
  assert.notEqual(view(alice).you.participantId, view(bob).you.participantId);
  return { roomId: room.roomId, matchId: view(alice).matchId, labelledBotSeats: 2, capacities: options, readyUnready: true };
}

async function buildStage(alice, bob, stage) {
  for (const player of [alice, bob]) await waitView(player, current => current.stage === stage && ['briefing', 'building'].includes(current.phase), `stage ${stage + 1} briefing`);
  for (const player of [alice, bob]) {
    if (view(player).phase === 'briefing') {
      await expect(player.page.locator('.tb-briefing')).toBeVisible();
      await action(player, player.page.locator('.tb-briefing').getByRole('button', { name: new RegExp(label(player, '^К сборке', '^To the workshop')) }), 'confirm');
    }
  }
  await Promise.all([alice, bob].map(player => waitView(player, current => current.phase === 'building' && current.stage === stage, 'real building phase')));
  await Promise.all([alice, bob].map(player => expect(player.page.locator('.tb-builder')).toBeVisible()));
  if (stage === 0) {
    await preset(alice, 'gentle');
    await selectPart(alice, 'front-axle', 'high');
    await selectPart(alice, 'rear-axle', 'high', true, 'Бюджет — 16 жетонов');
    await expect(alice.page.locator('.tb-budget strong')).toContainText('17');
    await selectPart(alice, 'front-axle', 'terrain');
    await preset(bob, 'universal');
    await selectPart(bob, 'front-axle', 'terrain'); await selectPart(bob, 'cargo', 'cradle');
    assert.notDeepEqual(view(alice).you.build.blueprint, view(bob).you.build.blueprint, 'Independent drivers must compare different legal machines');
    assert.equal(view(alice).players.find(player => player.playerId === bob.account.user.playerId).blueprint, null, 'Peer workshop draft is private');
    await action(alice, alice.page.locator('.tb-builder-actions').getByRole('button', { name: /^Готов/ }), 'ready', 'Space');
    await expect(alice.page.locator('.tb-parts button').first()).toBeDisabled();
    await action(alice, alice.page.getByRole('button', { name: 'Изменить сборку', exact: true }), 'ready');
    await expect(alice.page.locator('.tb-parts button').first()).toBeEnabled();
    assert.equal(view(alice).you.build.ready, false);
  } else if (stage === 1) {
    await selectPart(alice, 'battery', 'large');
    await selectPart(alice, 'aux-right', null);
    assert.equal(view(alice).you.edits, 2);
    await selectPart(alice, 'motor', 'torque', true, 'только два крепления');
    await selectPart(alice, 'battery', 'small');
    assert.equal(view(alice).you.edits, 1, 'Restoring an original part must return one edit');
    await selectPart(bob, 'rear-axle', 'terrain'); await selectPart(bob, 'aux-right', 'ballast');
  } else {
    await selectPart(alice, 'motor', 'torque'); await selectPart(alice, 'battery', 'large'); await selectPart(bob, 'motor', 'torque');
    assert.equal(view(alice).you.edits, 2);
  }
  const builds = [alice, bob].map(player => ({ profile: player.name, blueprint: view(player).you.build.blueprint, budget: view(player).you.budget, edits: view(player).you.edits }));
  const paints = await Promise.all([alice, bob].map(player => player.page.locator('.tb-scene').getAttribute('data-participant-paint')));
  assert.ok(paints.every(Boolean)); assert.notEqual(paints[0], paints[1], 'Different room seats have different chassis paint in both renderers');
  for (const player of [alice, bob]) await inspect(player, `stage-${stage + 1}-builder`, { low: true });
  for (const player of [alice, bob]) await action(player, player.page.locator('.tb-builder-actions').getByRole('button', { name: new RegExp(label(player, '^Готов', '^Ready')) }), 'ready');
  await Promise.all([alice, bob].map(player => waitView(player, current => current.stage === stage && current.phase === 'countdown', 'four-second countdown')));
  await Promise.all([alice, bob].map(player => expect(player.page.locator('.tb-countdown')).toBeVisible()));
  await Promise.all([alice, bob].map(player => waitView(player, current => current.stage === stage && current.phase === 'racing', 'real racing phase', 8000)));
  for (const player of [alice, bob]) { player.driveRemainder = { throttle: 0, steering: 0 }; await focusLane(player); }
  return builds;
}

async function keyboardDrive(player) {
  const snapshot = player.snapshot;
  if (!fresh(player) || snapshot.view.phase !== 'racing' || !snapshot.view.you.lane || snapshot.view.you.lane.finished) { await keys(player); return; }
  const lane = snapshot.view.you.lane, track = snapshot.view.track;
  const decision = policy.chooseBotInput(lane, track, 'normal');
  const desired = decision.input.steering * (33 - 16 * Math.min(1, lane.car.speed / policy.PARTS[lane.blueprint.motor].maxSpeed)) * Math.PI / 180;
  const actual = lane.car.wheels[0]?.steering ?? 0;
  const steering = desired > .02 ? actual < desired ? 1 : 0 : desired < -.02 ? actual > desired ? -1 : 0 : 0;
  const wanted = [];
  if (decision.input.brake) wanted.push('Space');
  else if (decision.input.throttle > .05) wanted.push('KeyW');
  if (steering > 0) wanted.push('KeyD'); else if (steering < 0) wanted.push('KeyA');
  if (decision.restore && Date.now() - player.lastRestore > 2400) { player.restoreUntil = Date.now() + 750; player.lastRestore = Date.now(); }
  if (player.restoreUntil > Date.now()) wanted.push('KeyR');
  await keys(player, wanted);
  if (decision.interact && Date.now() - player.lastInteract > 450) { await player.page.keyboard.press('KeyE'); report.controls.keyboardEvents += 2; player.lastInteract = Date.now(); }
}

async function reconnect(player, roomId) {
  const before = player.snapshot; const epoch = before.epoch;
  await keys(player); player.intentionalOffline = true; await player.context.setOffline(true);
  await player.page.reload({ waitUntil: 'commit', timeout: 2500 }).catch(() => {});
  await delay(400); await player.context.setOffline(false); player.intentionalOffline = false;
  await player.page.goto(origin + '/rooms/' + roomId);
  await waitView(player, current => current.matchId === before.matchId && current.phase === 'racing' && player.snapshot.epoch !== epoch, 'independent profile reconnect to the same cup');
  const after = player.snapshot;
  assert.equal(after.view.you.build.revision, before.view.you.build.revision);
  assert.deepEqual(after.view.you.build.blueprint, before.view.you.build.blueprint);
  assert.ok(after.view.you.lane.tick >= before.view.you.lane.tick);
  assert.ok(after.view.you.lane.car.charge <= before.view.you.lane.car.charge + .001);
  await focusLane(player);
  return { method: 'One isolated context offline, reload, online and normal room return', sameMatch: true, epochReplaced: true, savedBuild: true, beforeTick: before.view.you.lane.tick, afterTick: after.view.you.lane.tick };
}

async function restartDuringRace(alice, bob) {
  for (const player of [alice, bob]) await keys(player, ['Space']);
  await delay(150); const before = [alice, bob].map(player => player.snapshot);
  await stop(); await start();
  for (const [index, player] of [alice, bob].entries()) {
    await waitView(player, current => current.phase === 'recovering' && current.matchId === before[index].matchId, 'five-second recovery after real server restart', 12000);
    const recovered = view(player);
    assert.deepEqual(recovered.you.build.blueprint, before[index].view.you.build.blueprint);
    assert.equal(recovered.you.lane.resets, before[index].view.you.lane.resets);
    assert.ok(recovered.you.lane.car.charge <= before[index].view.you.lane.car.charge + .001);
    assert.notEqual(player.snapshot.epoch, before[index].epoch);
    await expect(player.page.locator('.tb-countdown')).toBeVisible();
    await expect(player.page.locator('.tb-countdown')).toContainText(label(player, 'Возвращаемся на трассу', 'Returning to the track'));
    assert.ok(Number(await player.page.locator('.tb-countdown strong').textContent()) >= 1, 'Recovery has a visible positive countdown');
  }
  for (const player of [alice, bob]) { await waitView(player, current => current.phase === 'racing', 'resumed race after recovery', 8000); await keys(player); await focusLane(player); }
  return { realProcessRestart: true, persistedBuilds: true, noBatteryRefill: true, recoveryScreen: true, freshEpochs: true };
}

async function driveStage(alice, bob, roomId, stage) {
  const saved = { stage, track: view(alice).track.id, mirrored: view(alice).track.mirrored, events: {}, disconnect: null, restart: null, reset: null };
  const seen = new Map([alice, bob].map(player => [player.name, new Map()]));
  const maxCharge = {};
  if (stage === 0) {
    await keys(alice, ['KeyR']); await delay(740); await keys(alice);
    await waitView(alice, current => current.you.lane?.resets === 1, 'held reset charges a real five-second penalty');
    await expect(alice.page.locator('.tb-race-timer small')).toContainText('+5');
    saved.reset = { resets: view(alice).you.lane.resets, shownPenaltyText: await alice.page.locator('.tb-race-timer small').textContent() };
  }
  const deadline = Date.now() + 115000;
  let disconnected = false, restarted = false, snapshots = false;
  while (Date.now() < deadline) {
    const current = [alice, bob].map(player => view(player));
    if (current.every(state => state?.stage === stage && state.phase === 'debrief')) break;
    for (const player of [alice, bob]) {
      const lane = view(player)?.you.lane;
      if (lane) { for (const event of lane.events) seen.get(player.name).set(event.id, event); maxCharge[player.name] ??= lane.car.charge; }
    }
    if (!snapshots && current.every(state => state?.you.lane?.tick > 150)) {
      for (const player of [alice, bob]) await keys(player, ['Space']);
      await inspect(alice, `stage-${stage + 1}-race-3d`, { race: true, low: true });
      await inspect(bob, `stage-${stage + 1}-race-2d`, { race: true });
      for (const player of [alice, bob]) await focusLane(player);
      snapshots = true;
    }
    if (stage === 0 && !disconnected && current[1]?.you.lane?.car.position.z > 5 && current[1]?.you.lane?.car.position.z < 20) {
      for (const player of [alice, bob]) await keys(player, ['Space']);
      saved.disconnect = await reconnect(bob, roomId); disconnected = true; await focusLane(alice);
    }
    if (stage === 1 && !restarted && current[0]?.you.lane?.gatesPassed >= 1 && current[0]?.you.lane?.gatesPassed < 3) {
      saved.restart = await restartDuringRace(alice, bob); restarted = true;
    }
    await Promise.all([alice, bob].map(keyboardDrive)); await delay(25);
  }
  for (const player of [alice, bob]) await keys(player);
  for (const player of [alice, bob]) await waitView(player, current => current.phase === 'debrief' && current.stage === stage, `stage ${stage + 1} completed`, 3000);
  const resultA = view(alice).stages[stage]; const resultB = view(bob).stages[stage];
  assert.deepEqual(resultA, resultB, 'Both browser profiles must see the same committed stage protocol');
  assert.equal(resultA.results.length, 4);
  for (const player of [alice, bob]) {
    const result = resultA.results.find(row => row.participantId === view(player).you.participantId);
    assert.equal(result.finished, true, `${player.name}: keyboard-driven ${saved.track} trial did not finish: ${JSON.stringify(result)}`);
    assert.ok(result.delivered > 0, `${player.name}: trial must deliver surviving cargo`);
    saved.events[player.name] = Object.fromEntries(['loaded', 'picked-up', 'damaged', 'lost', 'broken', 'gate', 'restored', 'delivered'].map(kind => [kind, (resultA.events[view(player).you.participantId] ?? []).filter(event => event.kind === kind).length]));
  }
  if (stage === 0) {
    assert.equal(disconnected, true, 'Online reconnect was exercised');
    const participantId = view(alice).you.participantId;
    const result = resultA.results.find(row => row.participantId === participantId);
    assert.equal(result.resets, 1);
    const delivered = resultA.events[participantId].find(event => event.kind === 'delivered'); assert.ok(delivered);
    assert.equal(result.elapsedTicks - delivered.tick, 300, 'Committed scoring adds 300 ticks for the one reset');
    saved.reset.penaltySeconds = (result.elapsedTicks - delivered.tick) / 60;
  }
  if (stage === 1) assert.equal(restarted, true, 'Online server restart was exercised');
  saved.results = resultA.results; saved.sameProtocol = true;
  for (const player of [alice, bob]) {
    await expect(player.page.locator('.tb-results')).toBeVisible();
    const detail = player.page.locator('.tb-stage-record details').first(); await detail.locator('summary').click(); await expect(detail).toHaveAttribute('open', '');
  }
  for (const player of [alice, bob]) await action(player, player.page.locator('.tb-results-footer').getByRole('button', { name: new RegExp(label(player, '^Дальше', '^Continue')) }), 'confirm');
  return saved;
}

async function cup(alice, bob) {
  const created = await scenario('Create four-seat room, invite/kick/reinvite, bots, ready and start through UI', () => createCup(alice, bob));
  const record = { ...created, stages: [] }; report.cups.push(record);
  for (let stage = 0; stage < 3; stage++) {
    const builds = await scenario(`Cup stage ${stage + 1}: briefing and legal build controls`, () => buildStage(alice, bob, stage));
    const raced = await scenario(`Cup stage ${stage + 1}: two keyboard drivers and two bots`, () => driveStage(alice, bob, created.roomId, stage));
    record.stages.push({ ...raced, builds });
  }
  await Promise.all([alice, bob].map(player => waitView(player, current => current.phase === 'finished', 'committed final cup results')));
  assert.deepEqual(view(alice).standings, view(bob).standings);
  assert.equal(view(alice).stages.length, 3); assert.equal(view(alice).standings.length, 4);
  for (const player of [alice, bob]) {
    await expect(player.page.locator('.tb-results h1')).toHaveText(label(player, 'Кубок завершён', 'Cup complete'));
    const tabs = player.page.locator('.tb-stage-tabs button'); assert.equal(await tabs.count(), 3);
    for (let i = 0; i < 3; i++) { await tabs.nth(i).click(); await expect(tabs.nth(i)).toHaveAttribute('aria-pressed', 'true'); }
    await inspect(player, 'cup-results');
  }
  record.standings = view(alice).standings; record.status = 'completed'; report.fullCups++;
  return created;
}

async function rematch(alice, bob, prior) {
  const result = await roomAction(alice, alice.page.locator('.tb-results-footer').getByRole('button', { name: /^Реванш/ }), '/rooms');
  await expect(alice.page.locator('.tb-lobby')).toBeVisible();
  const roomId = result.room.roomId; assert.notEqual(roomId, prior.roomId);
  const room = (await alice.account.request('/rooms/' + roomId)).room;
  assert.equal(room.members.filter(member => member.controller.kind === 'bot').length, 2);
  const invitations = (await bob.account.request('/invitations')).invitations;
  const invitation = invitations.find(value => value.roomId === roomId && value.status === 'pending');
  assert.ok(invitation, 'The UI rematch must invite the human friend');
  await bob.account.request(`/invitations/${invitation.invitationId}/accept`, {}); await bob.account.request(`/rooms/${roomId}/join`, {});
  await bob.page.goto(origin + '/rooms/' + roomId); await alice.page.reload();
  await roomAction(alice, alice.page.getByRole('button', { name: /^Я готов/ }), '/ready');
  await roomAction(bob, bob.page.getByRole('button', { name: /^I’m ready/ }), '/ready');
  await expect(alice.page.getByRole('button', { name: /Начать кубок/ })).toBeEnabled();
  await roomAction(alice, alice.page.getByRole('button', { name: /Начать кубок/ }), '/start');
  await waitView(alice, current => current.roomId === roomId && current.matchId !== prior.matchId, 'new rematch begins');
  return { newRoom: true, newMatch: view(alice).matchId !== prior.matchId, botSeatsPreserved: 2, friendInvited: true, startedFromUi: true, fullRematchCupPlayed: false };
}

let cleanupPromise;
function cleanup() {
  cleanupPromise ??= (async () => {
    let failure;
    try { for (const close of [() => browser?.close(), () => relay?.close(), stop]) { try { await close(); } catch (error) { failure ??= error; } } }
    finally { await rm(directory, { recursive: true, force: true }); if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true }); }
    if (failure) throw failure;
  })(); return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); });

let failure;
try {
  await mkdir(output, { recursive: true });
  for (const file of ['dist-platform/main.js', 'dist-platform/test-bench-worker.js', 'apps/portal/dist/index.html']) {
    assert.ok((await stat(join(root, file)).catch(() => null))?.isFile(), 'Run npm run build:foundation before browser acceptance');
  }
  report.builtMainSha256 = digest(await readFile(join(root, 'dist-platform/main.js')));
  report.builtWorkerSha256 = digest(await readFile(join(root, 'dist-platform/test-bench-worker.js')));
  report.builtIndexSha256 = digest(await readFile(join(root, 'apps/portal/dist/index.html')));
  fixtureDirectory = await mkdtemp(join(root, '.qa', 'test-bench-driver-'));
  await build({ root, configFile: false, logLevel: 'error', build: { ssr: join(root, 'games/test-bench/scripts/qa-driver.ts'), target: 'node22', outDir: fixtureDirectory, emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'qa-driver.mjs' } } } });
  policy = await import(pathToFileURL(join(fixtureDirectory, 'qa-driver.mjs')).href);
  port = await availablePort(); if (latencyMs) relay = await delayedLoopback(port, latencyMs);
  origin = `http://127.0.0.1:${relay?.port ?? port}`; await start();
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], ...(process.env.IVA_CHROMIUM_PATH ? { executablePath: process.env.IVA_CHROMIUM_PATH } : {}) });
  report.browserVersion = browser.version();
  const accountA = await new Account().register('bench_ui_alice'), accountB = await new Account().register('bench_ui_bob');
  assert.notEqual(accountA.cookie, accountB.cookie);
  const friendship = await accountA.request('/friend-requests', { playerId: accountB.user.playerId });
  await accountB.request(`/friend-requests/${friendship.requestId}/accept`, {});
  const alice = await makePlayer(accountA, 'alice', 'ru'), bob = await makePlayer(accountB, 'bob', 'ru', true);
  await scenario('Home scenes, RU/EN preferences, focus and settings errors', async () => {
    for (const player of [alice, bob]) await player.page.goto(origin + '/games/test-bench');
    const healthRoundTrips = await alice.page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 5; i++) { const start = performance.now(); const response = await fetch('/health/ready', { cache: 'no-store' }); if (!response.ok) throw new Error('Readiness request failed'); await response.arrayBuffer(); samples.push(performance.now() - start); }
      return samples;
    });
    report.transport.browserHealthRoundTripMs = timing(healthRoundTrips);
    if (latencyMs >= 50 && latencyMs <= 100) assert.ok(report.transport.browserHealthRoundTripMs.p50 >= 100 && report.transport.browserHealthRoundTripMs.p50 <= 200, 'The measured delayed browser path must be within the requested 100–200ms RTT band');
    await expect(alice.page.locator('canvas.tb-scene-canvas')).toHaveAttribute('data-renderer', '3d');
    await settings(alice, { exhaustive: true, renderer: '3d', quality: 'low' });
    await settings(bob, { locale: 'en', renderer: '2d', quality: 'low', exhaustive: true });
    await inspect(alice, 'home-ru-3d', { low: true }); await inspect(bob, 'home-en-2d');
    return { independentContexts: 2, localizations: ['ru', 'en'], renderers: ['3d', '2d'], keyRebindAndReset: true, duplicateKeyError: true, text130: true };
  });
  await practiceChecks(alice, bob);
  await scenario('Complete the six-step tutorial through visible HUD and real keys', () => tutorial(alice));
  const finished = await cup(alice, bob);
  await scenario('Rematch preserves explicit bots, invites the friend and starts a new cup', () => rematch(alice, bob, finished));
  assert.deepEqual(report.browserErrors, [], 'Uncaught browser application errors');
  assert.deepEqual(report.failedAssets, [], 'Failed production game assets');
  assert.deepEqual(report.actionErrors, [], 'Unexpected rejected UI gameplay actions');
  for (const player of players) assert.deepEqual(player.transportErrors, [], `${player.name}: transport error frames`);
  report.assetLoads = players.map(player => ({ profile: player.name, glbs: [...player.loadedAssets].filter(path => path.endsWith('.glb')).length, files: player.loadedAssets.size, receivedSnapshots: player.receivedFrames, sentInputFrames: player.sentInputs, socketConnections: player.socketConnections, socketCloses: player.socketCloses }));
  report.transport.inputToAcknowledgedSnapshotMs = players.map(player => ({ profile: player.name, ...timing(player.ackTimings) }));
  for (const player of players) assert.ok(player.ackTimings.length > 20, 'Actual browser input acknowledgements must be measured');
  assert.ok(report.assetLoads[0].glbs >= 30, 'The real renderer must load final exported GLBs across workshop and trials');
  const cargoEvents = report.cups.flatMap(value => value.stages).flatMap(value => Object.values(value.events));
  if (!cargoEvents.some(value => value.lost > 0 && value['picked-up'] > 0)) report.openCoverage.push('A surviving loose cargo pickup was not observed in this browser run; separate targeted exercise remains required');
  report.openCoverage.push('An exact tied final result was not constructed by this real-input run; scoring tests are separate evidence');
  report.status = 'passed automated scope';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error.stack ?? error.message;
  report.lastObserved = players.map(player => ({ profile: player.name, phase: view(player)?.phase, stage: view(player)?.stage, lane: view(player)?.you.lane ? { tick: view(player).you.lane.tick, position: view(player).you.lane.car.position, speed: view(player).you.lane.car.speed, yaw: view(player).you.lane.car.yaw, gates: view(player).you.lane.gatesPassed, cargo: view(player).you.lane.cargo.map(cargo => ({ status: cargo.status, health: cargo.health })) } : null }));
  report.failureScreens = [];
  for (const player of players) {
    // Keep the observed names and visible state in the console's final report:
    // CI deliberately uploads no screenshots, traces or report artifacts.
    report.failureScreens.push(await failureScreen(player));
    await player.page.screenshot({ path: join(output, `${player.name}-failure.png`), fullPage: true }).catch(() => {});
    await writeFile(join(output, `${player.name}-failure.txt`), await player.page.locator('body').innerText().catch(() => 'Page unavailable'));
  }
} finally {
  report.transport.inputToAcknowledgedSnapshotMs = players.map(player => ({ profile: player.name, ...timing(player.ackTimings) }));
  try { await cleanup(); } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = error.message; }
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({ ...report, layouts: report.layouts.map(({ name, profile, width, height, scrollWidth, controls }) => ({ name, profile, width, height, scrollWidth, offscreen: controls.filter(control => control.visible && !control.inViewport) })) }));
}
if (failure) throw failure;
