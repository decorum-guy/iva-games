/** Resume a synthetic saved v0.3 lobby through two real browsers and the current
 * built server. New rooms must use the current v0.4 profile independently. */
import assert from 'node:assert/strict';
import { chromium, devices, expect, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import { runDistrictAcceptance } from './district-browser-acceptance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const path of ['dist-platform/main.js', 'apps/portal/dist/index.html']) {
  assert.ok((await stat(join(root, path)).catch(() => null))?.isFile(), 'Run npm run build:foundation first');
}
const directory = await mkdtemp(join(tmpdir(), 'iva-district-browser-'));
const mailbox = join(directory, 'mail');
let running = null;
let browser = null;
let mobileBrowser = null;
let origin = '';
let port = 0;
let legacyFixture;
let fixtureDirectory;
let savedLegacyLobbies = 0;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });

async function start() {
  const child = spawn(process.execPath, ['dist-platform/main.js'], {
    cwd: root,
    env: {
      ...process.env, NODE_ENV: 'development', PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: String(port),
      PORTAL_ORIGIN: origin, PLATFORM_ALLOWED_HOSTS: `127.0.0.1:${port}`, PLATFORM_ALLOWED_ORIGINS: origin,
      PLATFORM_DATABASE_PATH: join(directory, 'platform.sqlite'), PLATFORM_LAB_DATABASE_PATH: join(directory, 'lab.sqlite'),
      MAIL_MODE: 'file', MAIL_FILE_DIRECTORY: mailbox, TELEGRAM_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'false',
      PORTAL_DIST_DIRECTORY: join(root, 'apps/portal/dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { child, output: '', error: null };
  running = state;
  const collect = part => { state.output = (state.output + String(part)).slice(-12000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', error => { state.error = error; });
  const ready = `Iva Games platform listening on 127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (state.error) throw state.error;
    assert.ok(child.exitCode === null && child.signalCode === null, 'Built platform exited before readiness');
    // A racing process on the selected port must never be treated as our test server.
    if (state.output.split(/\r?\n/).includes(ready)) {
      assert.equal((await request(origin + '/health/ready')).status, 200);
      return;
    }
    await delay(25);
  }
  throw new Error('Built platform readiness timeout');
}

async function stop() {
  const state = running;
  if (!state) return;
  running = null;
  const { child } = state;
  if (state.error || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 10000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    const killDeadline = Date.now() + 1500;
    while (child.exitCode === null && child.signalCode === null && Date.now() < killDeadline) await delay(25);
    throw new Error(`Built platform did not stop gracefully. Startup and shutdown log:\n${state.output}`);
  }
}

class Client {
  cookie = '';
  csrf = '';

  async request(path, data, key) {
    const response = await request(`${origin}/api/platform/v1${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: this.cookie,
        ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('iva_dev_session='));
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json();
    assert.ok(response.ok, `${path}: HTTP ${response.status}, ${result.error?.code ?? 'unknown error'}`);
    if (path === '/session') this.csrf = result.csrfToken;
    return result;
  }

  async register(handle) {
    await this.request('/session');
    const email = `${handle}@example.test`;
    const registered = await this.request('/auth/register', {
      email, handle, displayName: handle, password: 'isolated local fixture password',
    });
    await this.request('/session');
    let token;
    for (const file of await readdir(mailbox)) {
      const contents = await readFile(join(mailbox, file), 'utf8');
      if (!contents.startsWith(`To: ${email}\n`)) continue;
      const url = contents.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
      if (url) token = new URL(url).searchParams.get('token');
    }
    assert.ok(token, 'Verification must reach the isolated file mailbox');
    await this.request('/auth/verify', { token });
    assert.equal((await this.request('/session')).user.emailVerified, true);
    return registered.user;
  }
}

async function createLegacyLobby(host, { title, capacity, mapId }) {
  // Only setup uses the historical registration. No game transition, live DTO
  // or route is replaced: the normal built server resumes this stored lobby.
  await stop();
  let saved;
  try {
    saved = await legacyFixture.createSavedLegacyLobby({
      databasePath: join(directory, 'platform.sqlite'), runtimeDatabasePath: join(directory, 'lab.sqlite'),
      publicOrigin: origin, playerId: host.id, title, capacity, mapId,
    });
  } finally { await start(); }
  assert.equal(saved.rulesVersion, 'district@0.3');
  assert.equal(saved.contentVersion, 'district-maps@0.2');
  assert.deepEqual(saved.settings, { mapId, mapVersion: '1' });
  const restored = (await host.client.request(`/rooms/${saved.roomId}`)).room;
  assert.deepEqual(restored, saved, 'The current server must preserve the saved v0.3 lobby');
  const catalogue = (await host.client.request('/games')).games.find(game => game.gameId === 'district');
  assert.equal(catalogue.rulesVersion, legacyFixture.latestDistrictProfile.rulesVersion);
  assert.equal(catalogue.contentVersion, legacyFixture.latestDistrictProfile.contentVersion);
  savedLegacyLobbies++;
  return restored;
}

let cleanupPromise;
function cleanup() {
  cleanupPromise ??= (async () => {
    try {
      await Promise.allSettled([mobileBrowser?.close(), browser?.close()]);
      await stop();
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    }
  })();
  return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

try {
  port = await availablePort(); origin = `http://127.0.0.1:${port}`;
  await mkdir(join(root, '.qa'), { recursive: true });
  // Keep the compiled fixture under the repo so its external runtime packages
  // resolve from the same node_modules as the checked application.
  fixtureDirectory = await mkdtemp(join(root, '.qa', 'district-legacy-fixture-'));
  await build({ root, configFile: join(root, 'vite.platform.config.ts'), logLevel: 'error',
    build: { ssr: 'scripts/district-legacy-lobby-fixture.ts', outDir: fixtureDirectory, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'legacy-lobby.mjs' } } } });
  legacyFixture = await import(pathToFileURL(join(fixtureDirectory, 'legacy-lobby.mjs')).href);
  await start();
  const alice = new Client(), bob = new Client();
  const a = await alice.register('district_qa_a');
  const b = await bob.register('district_qa_b');
  const friendship = await alice.request('/friend-requests', { playerId: b.playerId }, 'district-live-friend');
  await bob.request(`/friend-requests/${friendship.requestId}/accept`, {}, 'district-live-accept-friend');
  const latest = (await alice.request('/rooms', { gameId: 'district', capacity: 2,
    title: 'Current District default verification' }, 'district-current-default')).room;
  assert.equal(latest.rulesVersion, legacyFixture.latestDistrictProfile.rulesVersion);
  assert.equal(latest.contentVersion, legacyFixture.latestDistrictProfile.contentVersion);
  assert.deepEqual(latest.settings, { mapId: 'azure-bay', mapVersion: '2', newsPreset: 'medium' });
  await alice.request(`/rooms/${latest.roomId}/cancel`, {}, 'district-current-default-close');
  let room = await createLegacyLobby({ client: alice, id: a.playerId }, {
    title: 'District saved v0.3 browser verification', capacity: 2, mapId: 'azure-bay',
  });
  const roomId = room.roomId;
  const invitation = (await alice.request(`/rooms/${roomId}/invitations`, { playerId: b.playerId }, 'district-live-invite')).invitation;
  await bob.request(`/invitations/${invitation.invitationId}/accept`, {}, 'district-live-accept');
  room = (await bob.request(`/rooms/${roomId}/join`, {}, 'district-live-join')).room;
  await alice.request(`/rooms/${roomId}/ready`, { ready: true, expectedRevision: room.revision }, 'district-live-ready-a');
  await bob.request(`/rooms/${roomId}/ready`, { ready: true, expectedRevision: room.revision }, 'district-live-ready-b');
  room = (await alice.request(`/rooms/${roomId}/start`, { expectedRevision: room.revision }, 'district-live-start')).room;
  const output = join(root, '.qa', 'district-browser'); await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const contexts = [], pages = [], clients = [alice, bob], browserErrors = [];
  let acceptedUiActions = 0;
  for (const client of clients) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const separator = client.cookie.indexOf('=');
    await context.addCookies([{ name: client.cookie.slice(0, separator), value: client.cookie.slice(separator + 1), url: origin }]);
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(`${origin}/rooms/${roomId}`);
    await expect(page.getByRole('region', { name: 'Игра Район' })).toBeVisible();
    contexts.push(context); pages.push(page);
  }
  const selectionFrameMs = await pages[0].locator('polygon[data-cell-id="A1"]').evaluate(async polygon => {
    const start = performance.now();
    polygon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (polygon.getAttribute('aria-pressed') !== 'true') throw new Error('Selection did not render');
    return Math.round((performance.now() - start) * 10) / 10;
  });
  const current = async client => (await client.request(`/rooms/${roomId}/match`)).view;
  const beforeNavigation = await current(alice);
  const map = pages[0].locator('.district-map-surface');
  const cell = map.locator('polygon[data-cell-id="A1"]');
  await cell.focus();
  await cell.press('Escape');
  await expect(cell).toHaveAttribute('aria-pressed', 'false');
  for (let step = 0; step < 2; step++) await map.getByRole('button', { name: 'Увеличить карту' }).click();
  const scroll = map.locator('.di-scroll');
  await scroll.evaluate(element => { element.scrollLeft = 80; element.scrollTop = 40; });
  assert.ok(await scroll.evaluate(element => element.scrollLeft > 0 && element.scrollTop > 0));
  for (let step = 0; step < 2; step++) await map.getByRole('button', { name: 'Уменьшить карту' }).click();
  assert.equal((await current(alice)).revision, beforeNavigation.revision);

  async function clickAction(page, locator) {
    await expect(locator).toBeEnabled();
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/rooms/${roomId}/actions`) && response.request().method() === 'POST');
    await locator.click();
    const response = await responsePromise;
    const result = await response.json();
    assert.equal(response.status(), 200, `UI action failed: ${result.error?.code}`);
    acceptedUiActions++;
    return result.view;
  }
  let restarted = false;
  for (let turn = 0; turn < 90; turn++) {
    const state = await current(alice);
    if (state.phase === 'finished') break;
    if (state.round >= 3 && !restarted) {
      await pages[0].screenshot({ path: join(output, 'desktop.png'), fullPage: true });
      await contexts[0].setOffline(true);
      await stop(); await start();
      const restored = await current(alice);
      assert.equal(restored.matchId, state.matchId); assert.equal(restored.revision, state.revision);
      assert.deepEqual(restored.cells, state.cells); assert.deepEqual(restored.map, state.map);
      await contexts[0].setOffline(false); restarted = true;
    }
    for (let i = 0; i < 2; i++) {
      const view = await current(clients[i]), page = pages[i];
      if (view.phase === 'finished') break;
      if (view.phase === 'goals' && !view.legal.chooseGoal || view.phase === 'negotiation' && view.players.find(p => p.participantId === view.you.participantId).ready || view.phase === 'auction' && !view.legal.confirmBid || view.phase === 'development' && !view.legal.develop) continue;
      await page.reload();
      await expect(page.getByRole('region', { name: 'Игра Район' })).toBeVisible();
      if (view.phase === 'goals') await clickAction(page, page.locator('.district-goal-choices button').first());
      else if (view.phase === 'negotiation') await clickAction(page, page.locator('.district-negotiation').getByRole('button', { name: 'Готов', exact: true }));
      else if (view.phase === 'auction') {
        if (view.round === 1) {
          await page.locator('.district-auction').getByLabel('Участок', { exact: true }).selectOption(i === 0 ? 'A1' : 'E6');
          await page.getByLabel('Ваша ставка', { exact: true }).fill('1');
          await clickAction(page, page.getByRole('button', { name: 'Сохранить выбор', exact: true }));
          await clickAction(page, page.getByRole('button', { name: 'Подтвердить ставку', exact: true }));
        } else await clickAction(page, page.getByRole('button', { name: 'Подтвердить пропуск', exact: true }));
      } else if (view.phase === 'development') {
        const house = page.getByRole('button', { name: /^Построить дом/ });
        const upgrade = page.getByRole('button', { name: /^Улучшить до уровня 2/ });
        if (view.round === 1) await clickAction(page, house);
        else if (view.round === 2) await clickAction(page, upgrade);
        else await clickAction(page, page.getByRole('button', { name: 'Поработать · +2 монеты', exact: true }));
      }
    }
  }
  const result = await current(alice), peer = await current(bob);
  assert.equal(result.phase, 'finished'); assert.equal(result.outcome.reason, 'completed');
  assert.deepEqual(result.outcome, peer.outcome);
  assert.equal(result.history.filter(entry => entry.type === 'income').length, 6);
  assert.equal(result.cells.filter(cell => cell.building?.level === 2).length, 2);
  assert.equal(restarted, true);
  await pages[0].reload(); await expect(pages[0].locator('.district-results')).toBeVisible();
  await pages[0].screenshot({ path: join(output, 'result-desktop.png'), fullPage: true });
  await pages[1].setViewportSize({ width: 390, height: 844 }); await pages[1].reload();
  await pages[1].getByRole('button', { name: 'EN', exact: true }).click();
  await expect(pages[1].getByRole('region', { name: 'District game' })).toBeVisible();
  assert.equal(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow page overflow');
  await pages[1].screenshot({ path: join(output, 'result-mobile-en.png'), fullPage: true });
  assert.deepEqual((await current(alice)).outcome, result.outcome);
  assert.deepEqual(browserErrors, []);
  let acceptance;
  let showcase;
  const accept = process.argv.includes('--acceptance');
  const show = process.argv.includes('--showcase');
  if (accept || show) {
    await Promise.all(contexts.map(context => context.close()));
    mobileBrowser = await webkit.launch({ headless: true });
    let tableNumber = 0;
    async function makePlayers(seats) {
      const table = ++tableNumber;
      const players = [];
      for (let seat = 0; seat < seats; seat++) {
        const client = new Client();
        const user = await client.register(`district_mac_${table}_${seat}`);
        if (seat > 0) {
          const relation = await players[0].client.request('/friend-requests', { playerId: user.playerId });
          await client.request(`/friend-requests/${relation.requestId}/accept`, {});
        }
        const context = seat === 2 ? await mobileBrowser.newContext(devices['iPhone 13'])
          : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const separator = client.cookie.indexOf('=');
        await context.addCookies([{ name: client.cookie.slice(0, separator), value: client.cookie.slice(separator + 1), url: origin }]);
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        page.on('pageerror', error => browserErrors.push(error.message));
        page.on('response', response => {
          if (response.status() === 429) console.warn(`Unexpected rate limit on ${new URL(response.url()).pathname}`);
        });
        players.push({ client, page, context, id: user.playerId, name: user.displayName, seat });
      }
      return players;
    }
    if (accept) acceptance = await runDistrictAcceptance({ origin, makePlayers, createLegacyLobby, stop, start, output });
    if (show) {
      const { runDistrictShowcase } = await import('./district-browser-showcase.mjs');
      showcase = await runDistrictShowcase({ origin, makePlayers, createLegacyLobby, output });
    }
    assert.deepEqual(browserErrors, []);
  }
  const report = { builtDistrictBrowser: 'passed', independentBrowsers: 2, realHttp: true, mockedGameApi: false, acceptedUiActions, rounds: 6,
    currentDefaultRoom: { rulesVersion: latest.rulesVersion, contentVersion: latest.contentVersion, settings: latest.settings },
    savedLegacyLobbySetup: { synthetic: true, registration: 'DistrictRuntime.registration', count: savedLegacyLobbies,
      rulesVersion: 'district@0.3', resumedByCurrentBuiltServer: true, subsequentGameplay: 'real HTTP/UI' },
    map: 'azure-bay@1', selectionToSecondAnimationFrameMs: selectionFrameMs, keyboardEscapeAndZoomPanWithoutGameplay: true, builtHouses: 2, upgrades: 2, offlineAndServerRestart: 'passed', resultAfterReload: 'passed', narrowEnglish: 'passed', browserErrors: 0,
    humanPlaytest: false, externalMessages: 0, browserVersion: browser.version(), ...(acceptance ? { acceptance } : {}), ...(showcase ? { showcase } : {}) };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.info(JSON.stringify(report));
} catch (error) {
  const output = join(root, '.qa', 'district-browser'); await mkdir(output, { recursive: true });
  for (const [index, context] of [...(browser?.contexts() ?? []), ...(mobileBrowser?.contexts() ?? [])].entries()) {
    const page = context.pages()[0];
    if (page) {
      await page.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
      await writeFile(join(output, `failure-${index}.txt`), await page.locator('body').innerText().catch(() => 'Page not available'));
    }
  }
  throw error;
} finally { await cleanup(); }
