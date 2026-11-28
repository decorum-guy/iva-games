import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { decode, encode } from 'jpeg-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlatformConfig } from '../src/config.js';
import { createPlatformHttpServer } from '../src/http.js';
import { PlatformService } from '../src/service.js';
import { TelegramAuth } from '../src/telegram/auth.js';

const ORIGIN = 'https://games.example.test';
const SECRET = 'auth-fixture-secret-with-enough-entropy';
const BOT = { botId: '60000', botUsername: 'iva_fixture_bot', webhookSecret: SECRET, codeKey: Buffer.alloc(32, 12) };

describe('Telegram accounts and the private bot menu', () => {
  let platform: PlatformService;
  let server: ReturnType<typeof createPlatformHttpServer>;
  let base: string;
  let update = 0;
  let now = Date.now();

  beforeEach(async () => {
    platform = new PlatformService({ databasePath: ':memory:', publicOrigin: ORIGIN, now: () => now });
    server = createPlatformHttpServer(platform, {
      publicOrigin: ORIGIN, secureCookies: false,
      telegramAuth: new TelegramAuth(platform, BOT, () => now), telegramAuthWebhookSecret: SECRET,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.close();
    await once(server, 'close');
    platform.close();
  });

  async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; cookie?: string; cookies?: string[]; body: ReturnType<typeof JSON.parse> }>((resolve, reject) => {
      const req = httpRequest(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { host: 'games.example.test', origin: ORIGIN, 'content-type': 'application/json', ...headers },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode!, cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
          cookies: res.headers['set-cookie']?.map(value => value.split(';')[0]),
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  async function browser() {
    let cookie = '';
    let csrf = '';
    const jar = new Map<string, string>();
    const updateCookies = (cookies?: string[]) => {
      for (const value of cookies ?? []) jar.set(value.split('=')[0], value);
      cookie = [...jar.values()].join('; ');
    };
    return {
      async session() {
        const response = await call('/api/platform/v1/session', undefined, { cookie });
        updateCookies(response.cookies);
        csrf = response.body.csrfToken;
        return response.body;
      },
      async post(path: string, body: unknown) {
        const response = await call('/api/platform/v1' + path, body, { 'x-csrf-token': csrf, cookie });
        updateCookies(response.cookies);
        return response;
      },
      async get(path: string) {
        return call('/api/platform/v1' + path, undefined, { cookie });
      },
      async getPhoto(playerId: string) {
        return new Promise<{ status: number; type?: string; bytes: Buffer }>((resolve, reject) => {
          const req = httpRequest(`${base}/api/platform/v1/avatars/${playerId}`, {
            headers: { host: 'games.example.test', cookie },
          }, res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () => resolve({ status: res.statusCode!, type: res.headers['content-type'], bytes: Buffer.concat(chunks) }));
            res.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        });
      },
    };
  }

  const webhook = (data: unknown, secret = SECRET) =>
    call('/integrations/telegram/auth-webhook', data, { 'x-telegram-bot-api-secret-token': secret });
  const command = (id: number, text: string, extra = {}) => ({
    update_id: ++update, message: { text, chat: { id, type: 'private' },
      from: { id, is_bot: false, language_code: 'en' }, ...extra },
  });
  const callback = (id: number, data: string) => ({
    update_id: ++update, callback_query: { id: String(update), data, from: { id, is_bot: false, language_code: 'en' },
      message: { chat: { id, type: 'private' }, from: { id: Number(BOT.botId), is_bot: true } } },
  });
  type Browser = Awaited<ReturnType<typeof browser>>;
  async function challenge(client: Browser, id: number, locale = 'en') {
    await client.session();
    const issued = await client.post('/auth/telegram/start', { locale });
    expect(issued.status).toBe(201);
    const payload = new URL(issued.body.deepLink).searchParams.get('start');
    const sender = command(id, `/start ${payload}`);
    const response = await webhook(sender);
    expect(response.body).toMatchObject({ method: 'sendMessage', chat_id: String(id) });
    const code = /(?:code|Iva Games): ([A-Z2-7]{8})/.exec(response.body.text)![1];
    expect(response.body.protect_content).not.toBe(true);
    expect(response.body.entities).toEqual([{ type: 'code', offset: response.body.text.indexOf(code), length: code.length }]);
    expect(response.body.reply_markup.inline_keyboard).toEqual([[{
      text: locale === 'en' ? 'Copy code' : 'Скопировать код', copy_text: { text: code },
    }]]);
    return { attemptId: issued.body.attemptId as string, code, sender };
  }

  it('formats the Russian login code as copyable text with a native copy button', async () => {
    const client = await browser();
    const { attemptId, code } = await challenge(client, 72000, 'ru');
    expect((await client.post('/auth/telegram/finish', { attemptId, code })).body).toEqual({ profileRequired: true });
  });

  it('sends repeat login codes to the remembered chat and offers a fallback on delivery failure', async () => {
    const { user } = await register(72030, 'remembered');
    const messages: Array<{ chatId: string; text: string; copyCode?: { value: string } }> = [];
    const transport = { async sendMessage(message: { chatId: string; text: string; copyCode?: { value: string } }) {
      messages.push(message);
      return { outcome: 'accepted' as const, messageId: '1' };
    } };
    const auth = new TelegramAuth(platform, BOT, () => now, transport);
    const device = auth.rememberDevice(user.playerId, undefined)!;
    const session = platform.createSession(null).session;
    const sent = await auth.start(session, 'ru', device);
    expect(sent.delivery).toBe('sent');
    expect(messages[0].chatId).toBe('72030');
    expect(auth.finish(session, { attemptId: sent.attemptId, code: messages[0].copyCode!.value })).toMatchObject({ user: { playerId: user.playerId } });
    const failed = new TelegramAuth(platform, BOT, () => now, { sendMessage: async () => { throw new Error('blocked'); } });
    expect((await failed.start(platform.createSession(null).session, 'ru', device)).delivery).toBe('failed');
    expect((await auth.start(platform.createSession(null).session, 'ru', device, true)).delivery).toBe('open_bot');
  });

  async function register(id: number, handle: string) {
    const client = await browser();
    const { attemptId, code } = await challenge(client, id);
    const created = await client.post('/auth/telegram/finish', { attemptId, code, handle, displayName: handle });
    expect(created.status).toBe(200);
    await client.session();
    return { client, user: created.body.user };
  }

  it('registers and signs in with no mail, using the same account and a rotated session', async () => {
    const client = await browser();
    expect((await client.session()).auth).toEqual({ email: false, telegram: true });
    expect((await client.post('/auth/register', {})).status).toBe(503);
    const { attemptId, code, sender } = await challenge(client, 72001);
    const duplicate = await webhook(sender);
    expect(duplicate.body.text).toContain(code);
    expect((await webhook(sender, 'a wrong secret')).status).toBe(401);
    expect((await client.post('/auth/telegram/finish', { attemptId, code })).body).toEqual({ profileRequired: true });
    const created = await client.post('/auth/telegram/finish', { attemptId, code, handle: 'iva_user', displayName: 'Iva' });
    expect(created.body.user).toMatchObject({ email: '', emailVerified: false, telegramVerified: true, handle: 'iva_user' });
    expect(created.cookie).toBeTruthy();
    now += 11_000;
    const second = await browser();
    const next = await challenge(second, 72001);
    const loggedIn = await second.post('/auth/telegram/finish', { attemptId: next.attemptId, code: next.code });
    expect(loggedIn.body.user.playerId).toBe(created.body.user.playerId);
    expect(platform.db.prepare('SELECT count(*) AS n FROM players').get()).toEqual({ n: 1 });
  });

  it('rejects forwarded and group starts, another browser, and brute-force and expired codes', async () => {
    const owner = await browser();
    await owner.session();
    const issued = await owner.post('/auth/telegram/start', { locale: 'en' });
    const start = `/start ${new URL(issued.body.deepLink).searchParams.get('start')}`;
    expect((await webhook(command(72011, start, { chat: { id: 72011, type: 'group' } }))).body).toEqual({ ok: true });
    expect((await webhook(command(72011, start, { forward_origin: {} }))).body).toEqual({ ok: true });
    const legitimate = (await webhook(command(72011, start))).body;
    const code = /code: ([A-Z2-7]{8})/.exec(legitimate.text)![1];
    expect((await webhook(command(72012, start))).body).toEqual({ ok: true });
    const outsider = await browser();
    await outsider.session();
    expect((await outsider.post('/auth/telegram/finish', { attemptId: issued.body.attemptId, code })).body.error.code).toBe('TELEGRAM_AUTH_EXPIRED');
    const wrong = code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA';
    for (let i = 0; i < 5; i++) expect((await owner.post('/auth/telegram/finish', {
      attemptId: issued.body.attemptId, code: wrong,
    })).body.error.code).toBe('TELEGRAM_AUTH_INVALID');
    expect((await owner.post('/auth/telegram/finish', { attemptId: issued.body.attemptId, code })).body.error.code).toBe('TELEGRAM_AUTH_EXPIRED');
    now += 11_000;
    const second = await challenge(owner, 72011);
    now += 11 * 60_000;
    expect((await owner.post('/auth/telegram/finish', { attemptId: second.attemptId, code: second.code })).body.error.code).toBe('TELEGRAM_AUTH_EXPIRED');
  });

  it('shares profiles, avatars, search, incoming requests and decisions across the portal and bot', async () => {
    expect((await webhook(command(72021, '/start'))).body.reply_markup.inline_keyboard).toEqual([[
      { text: 'Iva Games', url: `${ORIGIN}/login`, style: 'primary' },
    ]]);
    const alice = await register(72021, 'alice');
    const boris = await register(72022, 'boris');
    const charlie = await register(72023, 'charlie');
    expect((await webhook(command(72022, '/start'))).body.reply_markup.keyboard).toEqual([[
      { text: '/profile' }, { text: '/friends' }, { text: '/requests', style: 'primary' },
    ]]);
    expect((await alice.client.get('/players?handle=bor')).body.players[0].handle).toBe('boris');
    expect((await alice.client.post('/profile', { displayName: 'Alice', avatar: 'queen' })).body.user.avatar).toBe('queen');
    expect((await webhook(command(72021, '/profile'))).body.text).toContain('♛ Alice');
    const inbound = await alice.client.post('/friend-requests', { playerId: boris.user.playerId });
    const requests = (await webhook(command(72022, '/requests'))).body;
    expect(requests.text).toContain('♛ Alice (@alice)');
    const accept = `fr:a:${inbound.body.requestId}`;
    expect(requests.reply_markup.inline_keyboard).toEqual([[
      { text: 'Accept @alice', callback_data: accept, style: 'success' },
      { text: 'Decline', callback_data: `fr:d:${inbound.body.requestId}`, style: 'danger' },
    ]]);
    expect((await webhook(callback(72023, accept))).body.text).toContain('no longer available');
    expect((await webhook(callback(72022, accept))).body.text).toContain('accepted');
    expect((await webhook(callback(72022, accept))).body.text).toContain('accepted');
    expect((await boris.client.get('/friends')).body.friends[0].avatar).toBe('queen');
    expect((await webhook(command(72022, '/friends'))).body.text).toContain('@alice');
    const other = await charlie.client.post('/friend-requests', { playerId: boris.user.playerId });
    const decline = `fr:d:${other.body.requestId}`;
    expect((await webhook(callback(72022, decline))).body.text).toContain('declined');
    expect((await boris.client.get('/friends')).body.incoming).toEqual([]);
    expect((await webhook(callback(72022, 'avatar:rook'))).body.text).toContain('Avatar saved');
    expect((await webhook(command(72022, '/name Boris'))).body.text).toContain('Boris');
    expect((await boris.client.session()).user).toMatchObject({ avatar: 'rook', displayName: 'Boris' });
  });

  it('stores a photo safely, shares it with players, and keeps old and new avatar choices compatible', async () => {
    const alice = await register(72031, 'photo_alice');
    const boris = await register(72032, 'photo_boris');
    const pixels = Buffer.alloc(256 * 256 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = (i / 4) % 256; pixels[i + 1] = 140; pixels[i + 2] = 80; pixels[i + 3] = 255;
    }
    const input = encode({ data: pixels, width: 256, height: 256, comments: ['private camera metadata'] }, 80).data;
    const avatarPhoto = `data:image/jpeg;base64,${input.toString('base64')}`;
    const saved = await alice.client.post('/profile', { displayName: 'Alice Photo', avatar: 'photo', avatarPhoto });
    expect(saved.status).toBe(200);
    expect(saved.body.user).toMatchObject({ displayName: 'Alice Photo', avatar: 'photo', avatarVersion: expect.any(String) });
    expect(JSON.stringify(saved.body)).not.toContain(avatarPhoto);
    const photo = await boris.client.getPhoto(alice.user.playerId);
    expect(photo).toMatchObject({ status: 200, type: 'image/jpeg' });
    expect(decode(photo.bytes).width).toBe(256);
    expect(photo.bytes.includes(Buffer.from('private camera metadata'))).toBe(false);
    const anonymous = await browser();
    expect((await anonymous.getPhoto(alice.user.playerId)).status).toBe(401);
    expect((await boris.client.get('/players?handle=photo_alice')).body.players[0]).toMatchObject({
      avatar: 'photo', avatarVersion: saved.body.user.avatarVersion,
    });
    expect((await webhook(command(72031, '/name Alice Again'))).body.text).toContain('Alice Again');
    expect((await alice.client.session()).user.avatar).toBe('photo');
    expect((await boris.client.post('/profile', { displayName: 'Boris', avatar: 'queen' })).status).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), 'iva-avatar-test-'));
    try {
      const path = join(dir, 'platform.sqlite');
      await platform.db.backup(path);
      const reopened = new PlatformService({ databasePath: path, publicOrigin: ORIGIN });
      try {
        expect(reopened.account(alice.user.playerId)).toMatchObject({ avatar: 'photo', avatarVersion: saved.body.user.avatarVersion });
        expect(reopened.avatarPhoto(alice.user.playerId)).toEqual(photo.bytes);
      } finally { reopened.close(); }
      const legacy = new Database(path);
      try { legacy.exec('DROP TABLE player_avatar_extra'); } finally { legacy.close(); }
      const migrated = new PlatformService({ databasePath: path, publicOrigin: ORIGIN });
      try { expect(migrated.account(boris.user.playerId)).toMatchObject({ displayName: 'Boris', avatar: 'queen' }); }
      finally { migrated.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }

    for (const invalid of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,AAAA', `data:image/jpeg;base64,${'A'.repeat(174_800)}`]) {
      expect((await alice.client.post('/profile', { displayName: 'Should not save', avatar: 'photo', avatarPhoto: invalid })).status).toBe(400);
    }
    expect((await alice.client.session()).user).toMatchObject({ displayName: 'Alice Again', avatar: 'photo' });
    expect((await boris.client.post('/blocks', { playerId: alice.user.playerId })).status).toBe(200);
    expect((await boris.client.getPhoto(alice.user.playerId)).status).toBe(404);
    expect((await alice.client.post('/profile', { displayName: 'Alice', avatar: 'fox' })).body.user.avatar).toBe('fox');
    expect((await alice.client.getPhoto(alice.user.playerId)).status).toBe(404);
    expect((await alice.client.post('/profile', { displayName: 'Alice', avatar: 'knight' })).body.user.avatar).toBe('knight');
    expect((await webhook(callback(72031, 'avatar:astronaut'))).body.text).toContain('Avatar saved');
    expect((await alice.client.session()).user.avatar).toBe('astronaut');
  });

  it('accepts complete bot settings while the previous email transport is disabled', () => {
    const config = loadPlatformConfig({
      NODE_ENV: 'production', PORTAL_ORIGIN: ORIGIN, MAIL_MODE: 'disabled',
      TELEGRAM_AUTH_ENABLED: 'true', TELEGRAM_AUTH_BOT_ID: BOT.botId, TELEGRAM_AUTH_BOT_USERNAME: BOT.botUsername,
      TELEGRAM_AUTH_WEBHOOK_SECRET: SECRET, TELEGRAM_AUTH_CODE_KEY_BASE64: BOT.codeKey.toString('base64'),
    });
    expect(config.mail).toBeUndefined();
    expect(config.telegramAuth?.botId).toBe(BOT.botId);
  });
});
