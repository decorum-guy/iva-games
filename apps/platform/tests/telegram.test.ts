import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPlatformDatabase } from '../src/database';
import { TelegramService } from '../src/telegram/index';
import type { TelegramDeliveryTransport, TelegramServiceOptions } from '../src/telegram/index';
import type { SessionRecord } from '../src/types';
import type { TelegramMessage } from '@iva-games/telegram-transport';

const SECRET = 'unit_test_webhook_secret_never_configured_in_telegram';
const KEY = new Uint8Array(32).fill(7);
const BOT_ID = '123456';
const ORIGIN = 'https://iva.example.test';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
type Failure = 'RETRY_LATER' | 'DELIVERY_UNKNOWN' | 'UNREACHABLE' | 'REJECTED';
class FakeTransport implements TelegramDeliveryTransport {
  messages: TelegramMessage[] = [];
  failures: Array<{ code: Failure; retryAfterSeconds?: number }> = [];
  handler?: (message: TelegramMessage) => Promise<{ outcome: 'accepted'; messageId: string }>;
  async sendMessage(message: TelegramMessage): Promise<{ outcome: 'accepted'; messageId: string }> {
    this.messages.push(structuredClone(message));
    if (this.handler) return this.handler(message);
    const failure = this.failures.shift();
    if (failure) throw Object.assign(new Error('Injected transport outcome'), failure);
    return { outcome: 'accepted', messageId: String(this.messages.length) };
  }
}
interface TelegramFixture {
  db: ReturnType<typeof openPlatformDatabase>;
  now: { value: number };
  transport: FakeTransport;
  options: TelegramServiceOptions;
  service: TelegramService;
}
const instances: TelegramFixture[] = [];
const temporary: string[] = [];
function fixture(path = ':memory:', overrides: Partial<TelegramServiceOptions> = {}): TelegramFixture {
  const now = { value: Date.now() };
  const db = openPlatformDatabase(path);
  const transport = new FakeTransport();
  const options: TelegramServiceOptions = { db, publicOrigin: ORIGIN, botUsername: 'IvaTestBot', botId: BOT_ID, webhookSecret: SECRET, proofEncryptionKey: KEY, transport, now: () => now.value, ...overrides };
  const service = new TelegramService(options);
  const value = { db, now, transport, options, service };
  instances.push(value); return value;
}
afterEach(() => {
  for (const f of instances) if (f.db.open) f.db.close();
  instances.length = 0;
  for (const path of temporary) rmSync(path, { recursive: true, force: true });
  temporary.length = 0;
});
function account(f: ReturnType<typeof fixture>, verified = true): SessionRecord {
  const playerId = randomUUID();
  f.db.prepare('INSERT INTO players VALUES (?,?,?,?,?,?,?)').run(playerId, 'h_' + playerId.replaceAll('-', '').slice(0, 10), 'Тестовый игрок', `${playerId}@example.test`, 'not-used-in-this-test', Number(verified), f.now.value);
  return session(f, playerId);
}
function session(f: ReturnType<typeof fixture>, playerId: string): SessionRecord {
  const value: SessionRecord = { sessionHash: hash(randomBytes(32).toString('hex')), playerId, csrfToken: randomBytes(32).toString('base64url'), createdAt: f.now.value, lastSeenAt: f.now.value, reauthenticatedAt: f.now.value, expiresAt: f.now.value + 30 * 86_400_000 };
  f.db.prepare('INSERT INTO web_sessions VALUES (?,?,?,?,?,?,?)').run(value.sessionHash, value.playerId, value.csrfToken, value.createdAt, value.lastSeenAt, value.expiresAt, value.reauthenticatedAt);
  return value;
}
let nextUpdate = 1;
function update(deepLink: string, userId = '987654321', chatId = userId, id = nextUpdate++) {
  return { update_id: id, message: { message_id: id, chat: { type: 'private', id: chatId }, from: { id: userId, is_bot: false, first_name: 'Артём', username: 'example_telegram' }, text: '/start ' + new URL(deepLink).searchParams.get('start') } };
}
function code(message: TelegramMessage): string { return message.text.match(/Код подключения: ([A-Z2-7]{8})/)![1]; }
async function link(f: ReturnType<typeof fixture>, owner: SessionRecord, consent = true, userId = '987654321') {
  const attempt = f.service.createAttempt(owner);
  f.service.handleUpdate(SECRET, update(attempt.deepLink, userId));
  await f.service.drain();
  const proof = code(f.transport.messages.at(-1)!);
  const status = f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: proof, consent });
  return { attempt, proof, status };
}
function invite(f: ReturnType<typeof fixture>, sender: SessionRecord, receiver: SessionRecord, extra: { capacity?: number; state?: string } = {}) {
  const [low, high] = [sender.playerId!, receiver.playerId!].sort();
  f.db.prepare("INSERT INTO friendships VALUES (?,?,?,?,'accepted',?) ON CONFLICT(low_id,high_id) DO UPDATE SET state='accepted'").run(randomUUID(), low, high, sender.playerId, f.now.value);
  const roomId = randomUUID();
  f.db.prepare("INSERT INTO rooms VALUES (?,?,?,?,'lobby',?,'lab-1','lab-1',1,'{}',?,NULL,NULL)").run(roomId, 'platform-lab', '<b>Комната без разметки</b>', sender.playerId, extra.capacity ?? 4, f.now.value);
  f.db.prepare('INSERT INTO room_members VALUES (?,?,?,?,0,?,?)').run(randomUUID(), roomId, sender.playerId, 0, JSON.stringify({ kind: 'human', playerId: sender.playerId }), 'Тестовый игрок');
  const invitationId = randomUUID();
  f.db.prepare('INSERT INTO invitations VALUES (?,?,?,?,?,?,?,NULL,NULL)').run(invitationId, roomId, sender.playerId, receiver.playerId, extra.state ?? 'pending', f.now.value, f.now.value + 30 * 60_000);
  f.db.prepare("INSERT INTO site_notifications VALUES (?,?,'game_invitation',?,?)").run(randomUUID(), receiver.playerId, invitationId, f.now.value);
  return { invitationId, roomId };
}
function job(f: ReturnType<typeof fixture>, kind: 'proof' | 'invitation' = 'proof') {
  return f.db.prepare('SELECT * FROM telegram_outbox WHERE kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(kind) as {
    job_id: string; state: string; secret_ciphertext: string | null; attempts: number; next_attempt_at: number | null; lease_token: string | null; last_error: string | null;
  };
}

describe('Telegram linking: real durable state, injected transport only', () => {
  it('links through a single-use payload and proof, with consent false, masked UI and no old invitations', async () => {
    const f = fixture(); const owner = account(f); const sender = account(f);
    const old = invite(f, sender, owner); f.now.value++;
    const attempt = f.service.createAttempt(owner);
    const payload = new URL(attempt.deepLink).searchParams.get('start')!;
    expect(payload).toMatch(/^l1_[A-Za-z0-9_-]{43}$/); expect(payload).toHaveLength(46);
    expect(JSON.stringify(f.db.prepare('SELECT * FROM telegram_link_attempts').all())).not.toContain(payload.slice(3));
    expect(f.service.getStatus(owner.playerId!)).toMatchObject({ linked: false, notificationsEnabled: false });
    expect(f.transport.messages).toHaveLength(0);
    f.service.handleUpdate(SECRET, update(attempt.deepLink));
    const pending = f.service.getAttemptStatus(owner, attempt.attemptId);
    expect(pending).toMatchObject({ state: 'awaiting_web_confirmation', candidate: { userIdSuffix: '4321' } });
    expect(JSON.stringify(pending)).not.toContain('987654321'); expect(JSON.stringify(pending)).not.toContain('deepLink');
    expect(f.transport.messages).toHaveLength(0);
    const ciphertext = job(f).secret_ciphertext;
    await f.service.drain(); const proof = code(f.transport.messages[0]);
    expect(ciphertext).not.toContain(proof); expect(job(f).secret_ciphertext).toBeNull();
    const result = f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: proof.toLowerCase(), consent: false });
    expect(result).toMatchObject({ linked: true, status: 'active', notificationsEnabled: false });
    expect(f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: proof, consent: false })).toEqual(result);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_bindings').get()).toEqual({ n: 1 });
    expect(f.service.enqueueInvitation(old.invitationId)).toBe(false);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM telegram_outbox WHERE kind='invitation'").get()).toEqual({ n: 0 });
  });

  it('requires verified, live, recently reauthenticated origin session and prevents forwarded-link completion', async () => {
    const f = fixture(); const unverified = account(f, false);
    expect(() => f.service.createAttempt(unverified)).toThrow(/подтвердите/);
    const owner = account(f); const otherUser = account(f); const otherBrowser = session(f, owner.playerId!);
    const attempt = f.service.createAttempt(owner);
    f.service.handleUpdate(SECRET, update(attempt.deepLink, '777123456'));
    await f.service.drain(); const proof = code(f.transport.messages[0]);
    for (const wrongSession of [otherUser, otherBrowser]) {
      expect(() => f.service.getAttemptStatus(wrongSession, attempt.attemptId)).toThrow(/этом браузере/);
      expect(() => f.service.confirm(wrongSession, { attemptId: attempt.attemptId, proofCode: proof, consent: true })).toThrow(/этом браузере/);
    }
    expect(f.service.getStatus(owner.playerId!).linked).toBe(false);
    f.db.prepare('UPDATE web_sessions SET reauthenticated_at=? WHERE session_hash=?').run(f.now.value - 600_001, owner.sessionHash);
    expect(() => f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: proof, consent: true })).toThrow(/пароль/);
    f.db.prepare('UPDATE web_sessions SET reauthenticated_at=? WHERE session_hash=?').run(f.now.value, owner.sessionHash);
    f.service.cancelAttempt(owner, attempt.attemptId);
    expect(() => f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: proof, consent: true })).toThrow();
    expect(f.service.getStatus(owner.playerId!).linked).toBe(false);
  });

  it('durably counts five wrong proofs and invalidates the encrypted proof job', () => {
    const f = fixture(); const owner = account(f); const attempt = f.service.createAttempt(owner);
    f.service.handleUpdate(SECRET, update(attempt.deepLink));
    for (let i = 1; i <= 5; i++) {
      expect(() => f.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: '!!!!!!!!', consent: true })).toThrow();
      expect(f.service.getAttemptStatus(owner, attempt.attemptId).proofAttemptsRemaining).toBe(5 - i);
    }
    expect(f.service.getAttemptStatus(owner, attempt.attemptId).state).toBe('rejected');
    expect(job(f)).toMatchObject({ state: 'skipped', secret_ciphertext: null });
    expect(f.service.getStatus(owner.playerId!).linked).toBe(false);
  });

  it('deduplicates updates durably, accepts out-of-order IDs and never replaces a candidate', async () => {
    const f = fixture(); const owner = account(f); const attempt = f.service.createAttempt(owner);
    const first = update(attempt.deepLink, '987654321', '987654321', 500);
    expect(f.service.handleUpdate(SECRET, first).duplicate).toBe(false);
    expect(f.service.handleUpdate(SECRET, first).duplicate).toBe(true);
    f.service.handleUpdate(SECRET, update(attempt.deepLink, '222222222', '222222222', 501));
    expect(f.service.getAttemptStatus(owner, attempt.attemptId).candidate?.userIdSuffix).toBe('4321');
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').get()).toEqual({ n: 1 });
    const second = f.service.createAttempt(owner);
    f.service.handleUpdate(SECRET, update(second.deepLink, '333333333', '333333333', 100));
    await f.service.drain();
    expect(f.transport.messages).toHaveLength(1); expect(f.transport.messages[0].chatId).toBe('333333333');
    expect(f.service.getAttemptStatus(owner, attempt.attemptId).state).toBe('cancelled');
  });

  it('rejects forged webhook and ignores groups, forwarded messages, bot senders and unrelated updates', () => {
    const f = fixture(); const owner = account(f); const attempt = f.service.createAttempt(owner);
    expect(() => f.service.handleUpdate('not_the_configured_secret', update(attempt.deepLink))).toThrow(/авторизован/);
    const grouped = update(attempt.deepLink); grouped.message.chat.type = 'group'; f.service.handleUpdate(SECRET, grouped);
    const fromBot = update(attempt.deepLink); fromBot.message.from.is_bot = true; f.service.handleUpdate(SECRET, fromBot);
    const forwarded = { ...update(attempt.deepLink), message: { ...update(attempt.deepLink).message, forward_origin: { type: 'user' } } }; f.service.handleUpdate(SECRET, forwarded);
    f.service.handleUpdate(SECRET, { update_id: nextUpdate++, callback_query: { data: 'fake_confirm' } });
    expect(f.service.getAttemptStatus(owner, attempt.attemptId).state).toBe('issued');
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').get()).toEqual({ n: 0 });
  });

  it('expires attempts and cancels pending proof delivery after revocation, cancellation or replacement', async () => {
    const f = fixture();
    const expired = account(f); const a = f.service.createAttempt(expired); f.service.handleUpdate(SECRET, update(a.deepLink));
    f.now.value += 600_001;
    expect(f.service.getAttemptStatus(expired, a.attemptId).state).toBe('expired');
    await f.service.drain(); expect(f.transport.messages).toHaveLength(0);
    const revoked = account(f); const b = f.service.createAttempt(revoked); f.service.handleUpdate(SECRET, update(b.deepLink));
    f.db.prepare('DELETE FROM web_sessions WHERE session_hash=?').run(revoked.sessionHash);
    await f.service.drain(); expect(f.transport.messages).toHaveLength(0); expect(job(f).last_error).toBe('session_revoked');
    const cancelled = account(f); const c = f.service.createAttempt(cancelled); f.service.handleUpdate(SECRET, update(c.deepLink));
    f.service.cancelAttempt(cancelled, c.attemptId); await f.service.drain(); expect(f.transport.messages).toHaveLength(0);
    const fresh = f.service.createAttempt(cancelled); f.service.handleUpdate(SECRET, update(fresh.deepLink));
    f.service.createAttempt(cancelled); await f.service.drain(); expect(f.transport.messages).toHaveLength(0);
  });

  it('restores inbox and encrypted proof after restart without changing platform schema version', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'iva-tg-test-')); temporary.push(directory);
    const f = fixture(join(directory, 'platform.sqlite')); const owner = account(f); const attempt = f.service.createAttempt(owner);
    const first = update(attempt.deepLink, '9007199254740993'); f.service.handleUpdate(SECRET, first);
    const tokenHash = f.db.prepare('SELECT token_hash FROM telegram_link_attempts').get();
    f.db.close();
    const g = fixture(join(directory, 'platform.sqlite'), { now: () => f.now.value });
    expect(g.db.pragma('user_version', { simple: true })).toBe(1);
    expect(g.db.prepare('SELECT token_hash FROM telegram_link_attempts').get()).toEqual(tokenHash);
    expect(g.service.handleUpdate(SECRET, first).duplicate).toBe(true);
    await g.service.drain(); expect(g.transport.messages).toHaveLength(1); expect(g.transport.messages[0].chatId).toBe('9007199254740993');
    const result = g.service.confirm(owner, { attemptId: attempt.attemptId, proofCode: code(g.transport.messages[0]), consent: true });
    expect(result.account?.userIdSuffix).toBe('0993');
    expect(g.db.prepare('SELECT CAST(telegram_user_id AS TEXT) AS id FROM telegram_bindings').get()).toEqual({ id: '9007199254740993' });
  });

  it('retains Telegram identity uniqueness while unreachable and only changes mute on explicit confirmation', async () => {
    const f = fixture(); const owner = account(f); await link(f, owner);
    f.service.setDelivery(owner, false);
    const reconnect = f.service.createAttempt(owner); f.service.handleUpdate(SECRET, update(reconnect.deepLink));
    expect(f.service.getStatus(owner.playerId!).notificationsEnabled).toBe(false);
    await f.service.drain();
    f.service.confirm(owner, { attemptId: reconnect.attemptId, proofCode: code(f.transport.messages.at(-1)!), consent: true });
    expect(f.service.getStatus(owner.playerId!).notificationsEnabled).toBe(true);
    f.db.prepare("UPDATE telegram_bindings SET status='unreachable'").run();
    const other = account(f); const attempt = f.service.createAttempt(other); f.service.handleUpdate(SECRET, update(attempt.deepLink)); await f.service.drain();
    expect(() => f.service.confirm(other, { attemptId: attempt.attemptId, proofCode: code(f.transport.messages.at(-1)!), consent: true })).toThrow(/уже подключён/);
    expect(f.service.getStatus(other.playerId!).linked).toBe(false);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM telegram_bindings WHERE status IN ('active','unreachable')").get()).toEqual({ n: 1 });
  });

  it('honours consent false when the same previously opted-in unreachable Telegram reconnects', async () => {
    const f = fixture(); const owner = account(f); const sender = account(f); await link(f, owner, true);
    const initial = f.db.prepare('SELECT binding_id,binding_version FROM telegram_bindings').get();
    const invitation = invite(f, sender, owner); f.service.enqueueInvitation(invitation.invitationId);
    f.db.prepare("UPDATE telegram_bindings SET status='unreachable'").run();
    const result = await link(f, owner, false);
    expect(result.status).toMatchObject({ linked: true, status: 'active', notificationsEnabled: false });
    expect(f.db.prepare('SELECT binding_id,binding_version FROM telegram_bindings').get()).toEqual(initial);
    expect(job(f, 'invitation').state).toBe('skipped');
    f.transport.messages.length = 0; f.service.setDelivery(owner, true); await f.service.drain();
    expect(f.transport.messages).toHaveLength(0);
  });
});

describe('Telegram invitation outbox: current website authority and bounded ambiguous delivery', () => {
  it('enqueues atomically, deduplicates and sends only a canonical invitation without accepting it', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    f.transport.messages.length = 0;
    let created!: ReturnType<typeof invite>;
    f.db.transaction(() => { created = invite(f, sender, receiver); expect(f.service.enqueueInvitation(created.invitationId)).toBe(true); }).immediate();
    expect(f.transport.messages).toHaveLength(0); expect(f.service.enqueueInvitation(created.invitationId)).toBe(false);
    await f.service.drain(); expect(f.transport.messages).toHaveLength(1);
    expect(f.transport.messages[0]).toMatchObject({ button: { text: 'Открыть приглашение', url: `${ORIGIN}/invitations/${created.invitationId}` } });
    expect(f.transport.messages[0]).not.toHaveProperty('parse_mode'); expect(f.transport.messages[0].text).not.toContain('@example.test');
    expect(f.db.prepare('SELECT state FROM invitations WHERE invitation_id=?').get(created.invitationId)).toEqual({ state: 'pending' });
    expect(job(f, 'invitation')).toMatchObject({ state: 'sent', attempts: 1 });
    await f.service.drain(); expect(f.transport.messages).toHaveLength(1);
    const count = f.db.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').get();
    expect(() => f.db.transaction(() => { const another = invite(f, sender, receiver); f.service.enqueueInvitation(another.invitationId); throw new Error('rollback'); }).immediate()).toThrow('rollback');
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM telegram_outbox').get()).toEqual(count);
  });

  it.each(['muted','revoked','accepted','blocked','closed','full','unlinked'] as const)('does not dispatch a queued invitation after %s', async reason => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    const created = invite(f, sender, receiver); expect(f.service.enqueueInvitation(created.invitationId)).toBe(true);
    f.transport.messages.length = 0;
    if (reason === 'muted') f.service.setDelivery(receiver, false);
    if (reason === 'unlinked') f.service.unlink(receiver);
    if (reason === 'revoked' || reason === 'accepted') f.db.prepare('UPDATE invitations SET state=? WHERE invitation_id=?').run(reason, created.invitationId);
    if (reason === 'closed') f.db.prepare("UPDATE rooms SET state='cancelled' WHERE room_id=?").run(created.roomId);
    if (reason === 'full') f.db.prepare('UPDATE rooms SET capacity=2 WHERE room_id=?').run(created.roomId);
    if (reason === 'full') f.db.prepare('INSERT INTO room_members VALUES (?,?,NULL,1,1,?,?)').run(randomUUID(), created.roomId, '{"kind":"bot"}', 'Bot');
    if (reason === 'blocked') f.db.prepare('INSERT INTO blocks VALUES (?,?,?)').run(receiver.playerId, sender.playerId, f.now.value);
    await f.service.drain(); expect(f.transport.messages).toHaveLength(0); expect(job(f, 'invitation').state).toBe('skipped');
  });

  it('pins binding version and never redirects old invitations to a newly linked chat', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver, true, '111111111');
    const old = invite(f, sender, receiver); f.service.enqueueInvitation(old.invitationId);
    const attempt = f.service.createAttempt(receiver); f.service.handleUpdate(SECRET, update(attempt.deepLink, '222222222'));
    // Send only the proof, keeping the old invitation pending for the rebind test.
    f.db.prepare("UPDATE telegram_outbox SET next_attempt_at=? WHERE kind='invitation'").run(f.now.value + 5000);
    await f.service.drain(); const proof = code(f.transport.messages.at(-1)!);
    f.service.confirm(receiver, { attemptId: attempt.attemptId, proofCode: proof, consent: true });
    f.transport.messages.length = 0; f.now.value += 6000; await f.service.drain();
    expect(f.transport.messages).toHaveLength(0); expect(job(f, 'invitation').state).toBe('skipped');
    expect(f.db.prepare('SELECT MAX(binding_version) AS v FROM telegram_bindings').get()).toEqual({ v: 2 });
  });

  it('honours retry_after and rechecks website state before another attempt', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    const created = invite(f, sender, receiver); f.service.enqueueInvitation(created.invitationId); f.transport.messages.length = 0;
    f.transport.failures.push({ code: 'RETRY_LATER', retryAfterSeconds: 120 });
    await f.service.drain(); expect(job(f, 'invitation')).toMatchObject({ state: 'retry_wait', attempts: 1, next_attempt_at: f.now.value + 120_000 });
    f.now.value += 119_000; await f.service.drain(); expect(f.transport.messages).toHaveLength(1);
    f.db.prepare("UPDATE invitations SET state='declined' WHERE invitation_id=?").run(created.invitationId);
    f.now.value += 2000; await f.service.drain(); expect(f.transport.messages).toHaveLength(1); expect(job(f, 'invitation').state).toBe('skipped');
  });

  it('retries the same proof after unknown delivery and clears ciphertext only after confirmed acceptance', async () => {
    const f = fixture(); const owner = account(f); const attempt = f.service.createAttempt(owner); f.service.handleUpdate(SECRET, update(attempt.deepLink));
    f.transport.failures.push({ code: 'DELIVERY_UNKNOWN' });
    await f.service.drain(); expect(job(f)).toMatchObject({ state: 'delivery_unknown', attempts: 1 }); expect(job(f).secret_ciphertext).not.toBeNull();
    f.now.value = job(f).next_attempt_at! + 1; await f.service.drain();
    expect(f.transport.messages).toHaveLength(2); expect(f.transport.messages[1]).toEqual(f.transport.messages[0]);
    expect(job(f)).toMatchObject({ state: 'sent', attempts: 2, secret_ciphertext: null });
  });

  it('limits unknown outcomes to five attempts without claiming certainly unsent', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    const created = invite(f, sender, receiver); f.service.enqueueInvitation(created.invitationId); f.transport.messages.length = 0;
    f.transport.failures.push(...Array.from({ length: 5 }, () => ({ code: 'DELIVERY_UNKNOWN' as const })));
    for (let i = 0; i < 5; i++) { await f.service.drain(); const next = job(f, 'invitation').next_attempt_at; if (next) f.now.value = next + 1; }
    expect(f.transport.messages).toHaveLength(5); expect(job(f, 'invitation')).toMatchObject({ state: 'delivery_unknown', attempts: 5, next_attempt_at: null });
    await f.service.drain(); expect(f.transport.messages).toHaveLength(5);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM invitations').get()).toEqual({ n: 1 });
  });

  it('marks forbidden delivery unreachable without releasing identity or retrying indefinitely', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    const created = invite(f, sender, receiver); f.service.enqueueInvitation(created.invitationId); f.transport.messages.length = 0;
    f.transport.failures.push({ code: 'UNREACHABLE' }); await f.service.drain();
    expect(f.service.getStatus(receiver.playerId!)).toMatchObject({ linked: true, status: 'unreachable' });
    expect(() => f.service.setDelivery(receiver, true)).toThrow(/заново/);
    await f.service.drain(); expect(f.transport.messages).toHaveLength(1);
    expect(job(f, 'invitation')).toMatchObject({ state: 'permanent_failure', attempts: 1 });
  });

  it('serializes drain calls and records late acceptance after mute without retrying it', async () => {
    const f = fixture(); const receiver = account(f); const sender = account(f); await link(f, receiver);
    const created = invite(f, sender, receiver); f.service.enqueueInvitation(created.invitationId); f.transport.messages.length = 0;
    let resolve!: (value: { outcome: 'accepted'; messageId: string }) => void;
    f.transport.handler = () => new Promise(done => { resolve = done; });
    const first = f.service.drain();
    expect(f.transport.messages).toHaveLength(1);
    expect(await f.service.drain()).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 });
    f.service.setDelivery(receiver, false);
    expect(job(f, 'invitation')).toMatchObject({ state: 'delivery_unknown', next_attempt_at: null });
    resolve({ outcome: 'accepted', messageId: '123' }); await first;
    expect(job(f, 'invitation').state).toBe('sent'); expect(f.service.getStatus(receiver.playerId!).notificationsEnabled).toBe(false);
    await f.service.drain(); expect(f.transport.messages).toHaveLength(1);
  });

  it('bounds a hung transport and recovers expired sending leases with unknown outcome', async () => {
    const f = fixture(':memory:', { sendTimeoutMs: 20 }); const owner = account(f); const attempt = f.service.createAttempt(owner); f.service.handleUpdate(SECRET, update(attempt.deepLink));
    let reject!: (error: Error) => void;
    f.transport.handler = () => new Promise((_resolve, fail) => { reject = fail; });
    await f.service.drain(); expect(job(f)).toMatchObject({ state: 'delivery_unknown', attempts: 1 });
    f.now.value = job(f).next_attempt_at! + 1;
    expect(await f.service.drain()).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 });
    expect(f.transport.messages).toHaveLength(1);
    reject(Object.assign(new Error('Underlying request finally terminated'), { code: 'DELIVERY_UNKNOWN' }));
    await Promise.resolve(); await Promise.resolve();
    f.transport.handler = undefined;
    f.db.prepare("UPDATE telegram_outbox SET state='sending',lease_token='lost_worker',lease_expires_at=?,next_attempt_at=NULL").run(f.now.value - 1);
    await f.service.drain(); expect(job(f)).toMatchObject({ state: 'sent', attempts: 2, secret_ciphertext: null });
    expect(f.transport.messages).toHaveLength(2);
  });
});
