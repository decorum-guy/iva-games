/** Exercise the built platform over HTTP with isolated data and no external delivery. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const path of ['dist-platform/main.js', 'apps/portal/dist/index.html']) {
  assert.ok((await stat(join(root, path)).catch(() => null))?.isFile(), 'Run npm run build:foundation first');
}
const directory = await mkdtemp(join(tmpdir(), 'iva-platform-smoke-'));
const mailbox = join(directory, 'mail');
let running = null;
let origin = '';
let port = 0;

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
      MAIL_MODE: 'file', MAIL_FILE_DIRECTORY: mailbox, TELEGRAM_ENABLED: 'false',
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
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(25);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    const killDeadline = Date.now() + 1500;
    while (child.exitCode === null && child.signalCode === null && Date.now() < killDeadline) await delay(25);
    throw new Error('Built platform did not stop gracefully');
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

async function cleanup() {
  try { await stop(); } finally { await rm(directory, { recursive: true, force: true }); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

try {
  port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  await start();
  const page = await request(origin + '/');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(html, await readFile(join(root, 'apps/portal/dist/index.html'), 'utf8'));
  for (const route of ['/chess', '/games']) {
    const cataloguePage = await request(origin + route);
    assert.equal(cataloguePage.status, 200, `Public route ${route}`);
    assert.equal(await cataloguePage.text(), html, `SPA entry for ${route}`);
  }
  const publicCatalogue = await request(origin + '/api/platform/v1/games');
  assert.equal(publicCatalogue.status, 200);
  const publicGames = (await publicCatalogue.json()).games;
  assert.deepEqual(publicGames.filter(game => game.collectionId === 'chess').map(game => game.gameId).sort(), ['colossus', 'overdrive', 'remorse']);
  const colossus = publicGames.find(game => game.gameId === 'colossus');
  assert.equal(colossus.minPlayers, 1);
  assert.equal(colossus.maxPlayers, 2);
  assert.ok(publicGames.some(game => game.gameId === 'platform-lab' && game.collectionId === 'other'));
  assert.ok(publicGames.filter(game => game.collectionId === 'chess').every(game => game.status === 'unavailable'));
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, 'Built portal must have a module entry');
  const assetResponse = await request(origin + asset);
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get('content-type') ?? '', /javascript/);
  assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), await readFile(join(root, 'apps/portal/dist', asset.slice(1))));

  const alice = new Client();
  const bob = new Client();
  const a = await alice.register('smoke_alice');
  const b = await bob.register('smoke_bob');
  const catalogue = await alice.request('/games');
  assert.equal(catalogue.games.find(game => game.gameId === 'platform-lab').maxPlayers, 6);
  assert.equal((await alice.request('/telegram')).available, false);
  const friendship = await alice.request('/friend-requests', { playerId: b.playerId }, 'smoke-friend-request');
  await bob.request(`/friend-requests/${friendship.requestId}/accept`, {}, 'smoke-accept-friend');
  assert.equal((await alice.request('/friends')).friends[0].playerId, b.playerId);

  const roomInput = { gameId: 'platform-lab', capacity: 3, title: 'Isolated built verification' };
  let room = (await alice.request('/rooms', roomInput, 'smoke-create-room')).room;
  const roomId = room.roomId;
  assert.equal((await alice.request('/rooms', roomInput, 'smoke-create-room')).room.roomId, roomId);
  const invite = (await alice.request(`/rooms/${roomId}/invitations`, { playerId: b.playerId }, 'smoke-create-invite')).invitation;
  await bob.request(`/invitations/${invite.invitationId}/accept`, {}, 'smoke-accept-invite');
  room = (await bob.request(`/rooms/${roomId}/join`, {}, 'smoke-join-room')).room;
  room = (await alice.request(`/rooms/${roomId}/bots`, { difficulty: 'normal', expectedRevision: room.revision }, 'smoke-add-bot')).room;
  assert.equal(room.members.length, 3);
  assert.equal(room.members.filter(member => member.controller.kind === 'bot').length, 1);
  await alice.request(`/rooms/${roomId}/ready`, { ready: true, expectedRevision: room.revision }, 'smoke-ready-alice');
  await bob.request(`/rooms/${roomId}/ready`, { ready: true, expectedRevision: room.revision }, 'smoke-ready-bob');
  room = (await alice.request(`/rooms/${roomId}/start`, { expectedRevision: room.revision }, 'smoke-start-room')).room;
  assert.equal(room.state, 'playing');
  const matchId = room.matchId;

  for (let round = 1; round <= 3; round++) {
    const initial = (await alice.request(`/rooms/${roomId}/match`)).view;
    const action = { actionId: `built-alice-round-${round}`, expectedRevision: initial.revision, payload: { type: 'choose', value: 2 } };
    const accepted = await alice.request(`/rooms/${roomId}/actions`, action);
    if (round === 1) {
      await stop();
      await start();
      assert.equal((await alice.request(`/rooms/${roomId}`)).room.matchId, matchId);
      assert.deepEqual(await alice.request(`/rooms/${roomId}/actions`, action), accepted);
    }
    const peer = (await bob.request(`/rooms/${roomId}/match`)).view;
    assert.equal(peer.you.choice, null);
    assert.equal(peer.history.length, round - 1);
    assert.equal(peer.players.find(player => player.displayName === a.displayName).submitted, true);
    assert.ok(peer.players.every(player => !Object.hasOwn(player, 'choice')), 'Opponent choices must remain private');
    await bob.request(`/rooms/${roomId}/actions`, {
      actionId: `built-bob-round-${round}`, expectedRevision: peer.revision, payload: { type: 'choose', value: 3 },
    });
  }
  const finished = (await alice.request(`/rooms/${roomId}/match`)).view;
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.history.length, 3);
  const reconcileDeadline = Date.now() + 5000;
  do {
    room = (await alice.request(`/rooms/${roomId}`)).room;
    if (room.state === 'finished') break;
    await delay(50);
  } while (Date.now() < reconcileDeadline);
  assert.equal(room.state, 'finished');
  await alice.request('/auth/logout', {});
  assert.equal((await alice.request('/session')).user, null);
  console.log(JSON.stringify({ builtHttpSmoke: 'passed', browser: false, independentClients: 2,
    botSeats: 1, rounds: 3, staticAssets: 'byte-matched', persistentRestart: 'passed',
    replayAfterRestart: 'passed', telegram: 'disabled', externalMessages: 0 }));
} finally {
  await cleanup();
}
