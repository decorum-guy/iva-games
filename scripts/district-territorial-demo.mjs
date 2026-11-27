/** Prepare a local-only account and open a dedicated browser profile. */
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

process.umask(0o077);
const [operation, origin, directory] = process.argv.slice(2);
const url = new URL(origin);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Demo requires a loopback origin.');

const file = join(directory, 'account.json');
const saved = await readFile(file, 'utf8').then(JSON.parse, error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const account = saved ?? { email: 'district-demo@example.test', handle: 'district_demo', displayName: 'Артём', password: randomBytes(24).toString('hex') };
let csrf = '', cookie = '';
async function request(path, body) {
  const res = await fetch(origin + '/api/platform/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, ...(body === undefined ? {} : {
      Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID(),
    }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const session = res.headers.getSetCookie().find(item => item.startsWith('iva_dev_session='));
  if (session) cookie = session.split(';', 1)[0];
  const data = await res.json();
  if (!res.ok) throw new Error(path + ' failed (' + (data.error?.code ?? res.status) + ')');
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}
await request('/session');
if (saved) await request('/auth/login', { email: account.email, password: account.password });
else {
  // Persist the generated local credential before the first durable side effect.
  await writeFile(file, JSON.stringify(account), { mode: 0o600 });
  await request('/auth/register', account);
}
const session = await request('/session');
if (!session.user.emailVerified) {
  for (let attempt = 0; attempt < 15; attempt++) {
    let token;
    for (const name of await readdir(join(directory, 'mail'))) {
      const contents = await readFile(join(directory, 'mail', name), 'utf8');
      if (!contents.startsWith('To: ' + account.email + '\n')) continue;
      const link = contents.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
      if (link) token = new URL(link).searchParams.get('token');
    }
    if (token) { await request('/auth/verify', { token }); break; }
    await delay(150);
  }
  if (!(await request('/session')).user.emailVerified) throw new Error('Local demo account verification is pending.');
}
const { rooms } = await request('/rooms');
let room = rooms.find(item => item.title === 'Район · Лазурная бухта' && item.rulesVersion === 'district@0.4' && ['lobby', 'playing'].includes(item.state));
if (!room) room = (await request('/rooms', { gameId: 'district', title: 'Район · Лазурная бухта', capacity: 2,
  settings: { mapId: 'azure-bay', mapVersion: '2', newsPreset: 'medium' } })).room;
const path = '/rooms/' + room.roomId;
if (room.state === 'lobby') {
  if (!room.members.some(item => item.controller.kind === 'bot')) room = (await request(path + '/bots', { difficulty: 'normal', expectedRevision: room.revision })).room;
  if (!room.members.find(item => item.playerId === session.user.playerId)?.ready)
    await request(path + '/ready', { ready: true, expectedRevision: room.revision });
}
const roomUrl = origin + path;
console.log(roomUrl);
if (operation === 'open') {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launchPersistentContext(join(directory, 'chrome'), { headless: false, channel: 'chrome', viewport: null,
    args: ['--no-first-run', '--window-size=1440,900'] });
  const separator = cookie.indexOf('=');
  await browser.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), httpOnly: true, url: origin }]);
  await (browser.pages()[0] ?? await browser.newPage()).goto(roomUrl);
  await new Promise(resolve => {
    browser.once('close', resolve);
    process.once('SIGTERM', () => { void browser.close().finally(resolve); });
  });
} else if (operation !== 'prepare') throw new Error('Expected prepare or open.');
