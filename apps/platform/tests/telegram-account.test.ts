import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    return new Promise<{ status: number; cookie?: string; body: ReturnType<typeof JSON.parse> }>((resolve, reject) => {
      const req = httpRequest(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { host: 'games.example.test', origin: ORIGIN, 'content-type': 'application/json', ...headers },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ status: res.statusCode!, cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
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
    return {
      async session() {
        const response = await call('/api/platform/v1/session', undefined, { cookie });
        if (response.cookie) cookie = response.cookie;
        csrf = response.body.csrfToken;
        return response.body;
      },
      async post(path: string, body: unknown) {
        const response = await call('/api/platform/v1' + path, body, { 'x-csrf-token': csrf, cookie });
        if (response.cookie) cookie = response.cookie;
        return response;
      },
      async get(path: string) {
        return call('/api/platform/v1' + path, undefined, { cookie });
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
  async function challenge(client: Browser, id: number) {
    await client.session();
    const issued = await client.post('/auth/telegram/start', { locale: 'en' });
    expect(issued.status).toBe(201);
    const payload = new URL(issued.body.deepLink).searchParams.get('start');
    const sender = command(id, `/start ${payload}`);
    const response = await webhook(sender);
    expect(response.body).toMatchObject({ method: 'sendMessage', chat_id: String(id), protect_content: true });
    const code = /code: ([A-Z2-7]{8})/.exec(response.body.text)![1];
    return { attemptId: issued.body.attemptId as string, code, sender };
  }

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
