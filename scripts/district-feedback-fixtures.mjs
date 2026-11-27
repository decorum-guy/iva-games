/**
 * Real HTTP/SQLite acceptance fixtures, on loopback only. No API mocking.
 * npm run build:portal
 * node scripts/district-feedback-fixtures.mjs --verify
 * node scripts/district-feedback-fixtures.mjs --serve
 * Browser runners may import createFeedbackHarness(), use manifest/accounts storageState,
 * call reset(scenarioId) before a case, and dispose() afterwards.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import Database from 'better-sqlite3';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function availablePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  return address.port;
}

export async function createFeedbackHarness() {
  process.umask(0o077);
  assert.ok((await stat(join(root, 'apps/portal/dist/index.html')).catch(() => null))?.isFile(), 'Run npm run build:portal first');
  const parent = join(root, '.qa', 'district-feedback');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'run-'));
  const runtimeDatabase = join(directory, 'runtime.sqlite');
  const mailbox = join(directory, 'mail');
  const serverDirectory = join(directory, 'server');
  const portalDirectory = join(directory, 'portal');
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  let running;
  const logPath = join(directory, 'server.log');
  const manifestPath = join(directory, 'manifest.json');
  const manifest = { synthetic: true, production: false, origin, directory,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    gitStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    buildHashes: {}, accounts: [], scenarios: [], apiVerified: false, browserAccepted: false };
  await writeFile(join(directory, 'TEST_FIXTURES_ONLY'), 'Isolated synthetic positions. Never use this database in production.\n');
  await cp(join(root, 'apps/portal/dist'), portalDirectory, { recursive: true });
  // Compile the real server into this run, keeping its bytes independent of parallel builds.
  await build({ root, configFile: join(root, 'vite.platform.config.ts'), logLevel: 'error',
    build: { outDir: serverDirectory, emptyOutDir: true } });
  await build({ root, configFile: false, logLevel: 'error', build: {
    ssr: 'games/district/tests/fixtures/territorial-feedback.ts', outDir: join(directory, 'fixtures'), target: 'node22',
    rollupOptions: { output: { entryFileNames: 'fixtures.mjs' } },
  } });
  const fixture = await import(pathToFileURL(join(directory, 'fixtures/fixtures.mjs')).href);
  manifest.buildHashes.server = digest(await readFile(join(serverDirectory, 'main.js')));
  manifest.buildHashes.portalIndex = digest(await readFile(join(portalDirectory, 'index.html')));
  manifest.buildHashes.fixture = digest(await readFile(join(directory, 'fixtures/fixtures.mjs')));
  const saveManifest = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  async function start() {
    assert.ok(!running, 'This harness server is already running');
    const child = spawn(process.execPath, [join(serverDirectory, 'main.js')], { cwd: root,
      env: { ...process.env, NODE_ENV: 'development', PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: String(port),
        PORTAL_ORIGIN: origin, PLATFORM_ALLOWED_HOSTS: `127.0.0.1:${port}`, PLATFORM_ALLOWED_ORIGINS: origin,
        PLATFORM_DATABASE_PATH: join(directory, 'platform.sqlite'), PLATFORM_LAB_DATABASE_PATH: runtimeDatabase,
        PORTAL_DIST_DIRECTORY: portalDirectory, MAIL_MODE: 'file', MAIL_FILE_DIRECTORY: mailbox,
        DISTRICT_TERRITORIAL_ENABLED: 'true', TELEGRAM_ENABLED: 'false', TELEGRAM_AUTH_ENABLED: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    const current = { child, output: '', error: null }; running = current;
    const collect = bytes => { current.output += String(bytes); };
    child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', error => { current.error = error; });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (current.error) throw current.error;
      assert.equal(child.exitCode, null, 'Harness server exited: ' + current.output);
      if (current.output.split(/\r?\n/).includes(`Iva Games platform listening on 127.0.0.1:${port}`)) {
        assert.equal((await fetch(origin + '/health/ready', { signal: AbortSignal.timeout(3_000) })).status, 200); return;
      }
      await delay(25);
    }
    throw new Error('Harness startup timed out: ' + current.output);
  }
  async function stop() {
    const current = running; if (!current) return; running = undefined;
    if (current.child.exitCode === null && current.child.signalCode === null) {
      current.child.kill('SIGTERM');
      const deadline = Date.now() + 35_000;
      while (current.child.exitCode === null && current.child.signalCode === null && Date.now() < deadline) await delay(25);
      if (current.child.exitCode === null && current.child.signalCode === null) { current.child.kill('SIGKILL'); throw new Error('Isolated fixture server failed graceful shutdown'); }
    }
    await writeFile(logPath, current.output, { flag: 'a' });
  }

  class Client {
    cookie = ''; csrf = ''; user;
    async request(path, body) {
      const response = await fetch(origin + '/api/platform/v1' + path, {
        method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5_000),
        headers: { Cookie: this.cookie, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrf, 'Idempotency-Key': randomUUID() }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const session = response.headers.getSetCookie().find(value => value.startsWith('iva_dev_session='));
      if (session) this.cookie = session.split(';')[0];
      const data = await response.json();
      assert.ok(response.ok, `${path}: ${response.status} ${data.error?.code ?? ''}`);
      if (data.csrfToken) this.csrf = data.csrfToken;
      return data;
    }
    async register(index) {
      const account = { handle: 'feedback_' + index, email: `feedback_${index}@example.test`,
        displayName: 'Тестовый игрок ' + (index + 1), password: randomBytes(24).toString('hex') };
      await this.request('/session'); this.user = (await this.request('/auth/register', account)).user;
      await this.request('/session');
      let token;
      for (const name of await readdir(mailbox)) {
        const contents = await readFile(join(mailbox, name), 'utf8');
        if (!contents.startsWith(`To: ${account.email}\n`)) continue;
        const url = contents.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
        if (url) token = new URL(url).searchParams.get('token');
      }
      assert.ok(token, 'Expected verification in isolated file mailbox');
      await this.request('/auth/verify', { token });
      await this.request('/session');
      const credentials = join(directory, `account-${index}.json`);
      await writeFile(credentials, JSON.stringify(account, null, 2));
      const cookieSeparator = this.cookie.indexOf('=');
      const storageState = join(directory, `browser-${index}.json`);
      await writeFile(storageState, JSON.stringify({ cookies: [{ name: this.cookie.slice(0, cookieSeparator), value: this.cookie.slice(cookieSeparator + 1),
        domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }, null, 2));
      manifest.accounts.push({ index, handle: account.handle, playerId: this.user.playerId, credentials, storageState });
    }
  }

  const clients = [new Client(), new Client()];
  const baselines = new Map();
  async function reset(id) {
    const entry = manifest.scenarios.find(item => item.id === id);
    assert.ok(entry, 'Unknown fixture: ' + id);
    await stop();
    // This path is allocated by this harness, never accepted from an external argument.
    assert.equal(await readFile(join(directory, 'TEST_FIXTURES_ONLY'), 'utf8'), 'Isolated synthetic positions. Never use this database in production.\n');
    const sample = fixture.prepareFeedbackFixture(baselines.get(id), id, Date.now());
    const db = new Database(runtimeDatabase);
    try {
      db.transaction(() => {
        db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(sample.state), entry.matchId);
        db.prepare('DELETE FROM district_territorial_receipts WHERE match_id=?').run(entry.matchId);
      }).immediate();
    } finally { db.close(); }
    entry.expected = sample.metadata; entry.resetAt = new Date().toISOString();
    await saveManifest(); await start(); return entry;
  }

  try {
    await start();
    for (const [index, client] of clients.entries()) await client.register(index);
    const friendship = await clients[0].request('/friend-requests', { playerId: clients[1].user.playerId });
    await clients[1].request(`/friend-requests/${friendship.requestId}/accept`, {});
    for (const [index, scenario] of fixture.feedbackScenarios.entries()) {
      const hostIndex = index % 2, guestIndex = 1 - hostIndex, host = clients[hostIndex], guest = clients[guestIndex];
      let room = (await host.request('/rooms', { gameId: 'district', capacity: 2, title: scenario.title,
        settings: { mapId: 'two-shores', mapVersion: '2', newsPreset: 'medium' } })).room;
      const path = '/rooms/' + room.roomId;
      const invitation = (await host.request(path + '/invitations', { playerId: guest.user.playerId })).invitation;
      await guest.request('/invitations/' + invitation.invitationId + '/accept', {});
      room = (await guest.request(path + '/join', {})).room;
      for (const client of [host, guest]) await client.request(path + '/ready', { ready: true, expectedRevision: room.revision });
      room = (await host.request(path + '/start', { expectedRevision: room.revision })).room;
      manifest.scenarios.push({ ...scenario, hostIndex, guestIndex, roomId: room.roomId, matchId: room.matchId, url: origin + path });
    }
    await stop();
    const db = new Database(runtimeDatabase);
    try {
      for (const entry of manifest.scenarios) {
        const baseline = JSON.parse(db.prepare('SELECT state_json FROM district_territorial_matches WHERE match_id=?').pluck().get(entry.matchId));
        baselines.set(entry.id, baseline);
        const sample = fixture.prepareFeedbackFixture(baseline, entry.id, Date.now());
        db.prepare('UPDATE district_territorial_matches SET state_json=? WHERE match_id=?').run(JSON.stringify(sample.state), entry.matchId);
        entry.expected = sample.metadata;
      }
    } finally { db.close(); }
    await start();
    for (const entry of manifest.scenarios) {
      const views = await Promise.all(clients.map(async client => (await client.request(`/rooms/${entry.roomId}/match`)).view));
      assert.equal(views[0].rulesVersion, 'district@0.4'); assert.equal(views[0].revision, entry.expected.revision);
      assert.deepEqual(views[0].news, views[1].news);
      const ownerView = views.find(view => view.you.participantId === entry.expected.ownerId);
      assert.ok(ownerView);
      if (entry.id === 'seven-discard') assert.equal(ownerView.phase, 'roll');
      if (entry.id === 'patrol') assert.deepEqual(ownerView.you.cards.map(card => card.kind), ['patrol', 'survey', 'supply', 'charter']);
      if (entry.id === 'coupon-free' || entry.id === 'coupon-surcharge') {
        const road = ownerView.legal.options.find(option => option.kind === 'route' && option.id === entry.expected.land);
        const neighbour = ownerView.legal.options.find(option => option.kind === 'route' && option.id === entry.expected.adjacent);
        const sea = ownerView.legal.options.find(option => option.kind === 'route' && option.id === entry.expected.sea);
        assert.ok(road?.pricing.couponId && neighbour && sea);
        assert.equal(road.cost.wood, entry.id === 'coupon-surcharge' ? 1 : 0); assert.equal(road.cost.brick, 0);
        assert.equal(neighbour.cost.brick, 1); assert.equal(sea.cost.wool, 1);
      }
      if (entry.id === 'epidemic-risk') assert.ok(ownerView.news.some(message => message.stage === 'forecast' && message.zone === null && !('changes' in message)));
      if (entry.id === 'epidemic-applied') assert.ok(ownerView.news.some(message => message.stage === 'success' && message.zone === null && 'changes' in message));
      if (entry.id === 'long-news') assert.ok(ownerView.news.some(message => message.description?.ru.endsWith(entry.expected.lastParagraph)));
      if (entry.id === 'trade-draft') assert.equal(ownerView.offers[0]?.id, entry.expected.offerId);
      for (const view of views) {
        assert.equal(view.you.participantId, entry.expected.owners.find(owner => owner.playerId === clients[views.indexOf(view)].user.playerId).participantId);
        for (const message of view.news.filter(item => ['forecast', 'update', 'confirmed'].includes(item.stage))) {
          assert.deepEqual(Object.keys(message).filter(key => !['messageId', 'templateId', 'eventInstanceId', 'chainId', 'headline', 'round', 'stage', 'zone', 'dueRound'].includes(key)), []);
        }
        assert.ok(!JSON.stringify(view).includes('privateByParticipantId'));
      }
      entry.apiCheck = 'snapshot and privacy passed';
    }
    manifest.apiVerified = true; await saveManifest();
    return { origin, directory, manifest, clients, reset, start, stop, dispose: stop };
  } catch (error) { await stop(); await saveManifest(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? '--verify';
  assert.ok(['--verify', '--serve'].includes(mode), 'Use --verify or --serve');
  const harness = await createFeedbackHarness();
  console.log(JSON.stringify({ synthetic: true, origin: harness.origin, directory: harness.directory,
    scenarios: harness.manifest.scenarios.map(({ id, url, apiCheck }) => ({ id, url, apiCheck })) }, null, 2));
  if (mode === '--serve') {
    await new Promise(resolve => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void harness.dispose().finally(resolve); });
    });
  } else await harness.dispose();
}
