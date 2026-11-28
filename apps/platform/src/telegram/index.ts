import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { TelegramMessage } from '@iva-games/telegram-transport';
import { PlatformError } from '../types.js';
import type { SessionRecord } from '../types.js';
import { ensureTelegramSchema } from './schema.js';

const ATTEMPT_TTL = 10 * 60_000;
const RECENT_AUTH = 10 * 60_000;
const MAX_FAILURES = 5;
const MAX_SEND_ATTEMPTS = 5;
const LEASE_MS = 45_000;
const DAY = 86_400_000;
const ACTIVE_ATTEMPTS = "('issued','awaiting_web_confirmation')";
type SqlValue = string | number | bigint | null;
type AttemptState = 'issued' | 'awaiting_web_confirmation' | 'confirmed' | 'expired' | 'cancelled' | 'rejected';
type BindingState = 'active' | 'unreachable' | 'revoked';
type JobState = 'queued' | 'sending' | 'sent' | 'retry_wait' | 'delivery_unknown' | 'permanent_failure' | 'skipped';
interface DisplaySnapshot { name: string; username: string | null }
export interface MaskedTelegramAccount { displayNameMasked: string; usernameMasked: string | null; userIdSuffix: string }
export interface TelegramStatus {
  available: true; linked: boolean; status: 'unlinked' | 'active' | 'unreachable';
  notificationsEnabled: boolean; botUsername: string; account: MaskedTelegramAccount | null;
}
export interface TelegramAttemptStatus {
  attemptId: string; state: AttemptState; expiresAt: number;
  candidate: MaskedTelegramAccount | null; proofAttemptsRemaining: number;
}
export interface TelegramDeliveryTransport {
  sendMessage(message: TelegramMessage): Promise<{ outcome: 'accepted'; messageId: string }>;
}
export interface TelegramServiceOptions {
  db: Database.Database; publicOrigin: string; botUsername: string; botId: string;
  webhookSecret: string; proofEncryptionKey: Uint8Array; transport: TelegramDeliveryTransport;
  now?: () => number; sendTimeoutMs?: number;
}
interface AttemptRow {
  attempt_id: string; bot_id: string; player_id: string; session_hash: string; token_hash: string;
  state: AttemptState; created_at: number; expires_at: number;
  candidate_user_id: string | null; candidate_chat_id: string | null; candidate_display_json: string | null;
  proof_hash: string | null; proof_failures: number; binding_id: string | null; confirmed_consent: number | null;
}
interface BindingRow {
  binding_id: string; bot_id: string; player_id: string; telegram_user_id: string; private_chat_id: string;
  display_json: string; binding_version: number; status: BindingState; notifications_enabled: number;
  consented_at: number | null; linked_at: number; last_delivery_error: string | null;
}
interface JobRow {
  job_id: string; bot_id: string; kind: 'proof' | 'invitation'; player_id: string;
  attempt_id: string | null; invitation_id: string | null; binding_id: string | null; binding_version: number | null;
  chat_id: string; secret_ciphertext: string | null; state: JobState;
  created_at: number; expires_at: number; next_attempt_at: number | null; attempts: number;
  lease_token: string | null; lease_expires_at: number | null;
}
interface InvitationRow {
  invitation_id: string; room_id: string; inviter_id: string; invitee_id: string; state: string;
  created_at: number; expires_at: number; room_state: string; host_player_id: string;
  title: string; game_id: string; capacity: number; inviter_name: string;
}
const ATTEMPT_SELECT = 'SELECT a.*, CAST(candidate_user_id AS TEXT) AS candidate_user_id, CAST(candidate_chat_id AS TEXT) AS candidate_chat_id FROM telegram_link_attempts a';
const BINDING_SELECT = 'SELECT b.*, CAST(telegram_user_id AS TEXT) AS telegram_user_id, CAST(private_chat_id AS TEXT) AS private_chat_id FROM telegram_bindings b';
const JOB_SELECT = 'SELECT j.*, CAST(chat_id AS TEXT) AS chat_id FROM telegram_outbox j';
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
function fail(code: string, message: string, status = 400): never { throw new PlatformError(code, message, status); }
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function telegramId(value: unknown): string | null {
  const string = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : '';
  if (!/^[1-9]\d{0,18}$/.test(string)) return null;
  try { return BigInt(string) <= 9_223_372_036_854_775_807n ? string : null; } catch { return null; }
}
function masked(userId: string, snapshot: string): MaskedTelegramAccount {
  const value = JSON.parse(snapshot) as DisplaySnapshot;
  const hide = (text: string): string => [...text].slice(0, 2).join('') + '•••';
  return { displayNameMasked: hide(value.name || 'Telegram'), usernameMasked: value.username ? '@' + hide(value.username) : null, userIdSuffix: userId.slice(-4) };
}
function stripControls(text: string): string {
  return [...text].filter(character => {
    const point = character.codePointAt(0)!;
    return point >= 32 && point !== 127;
  }).join('');
}
function displayOf(from: Record<string, unknown>): string {
  const clean = (value: unknown, max: number): string => typeof value === 'string' ? stripControls(value).slice(0, max) : '';
  const username = clean(from.username, 32);
  return JSON.stringify({ name: [clean(from.first_name, 40), clean(from.last_name, 40)].filter(Boolean).join(' ') || 'Telegram', username: /^[A-Za-z0-9_]+$/.test(username) ? username : null } satisfies DisplaySnapshot);
}
function proofCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Each byte contributes five uniformly distributed bits; 8 symbols = 40 random bits.
  return [...randomBytes(8)].map(byte => alphabet[byte & 31]).join('');
}

/** Server-only linking and durable outbox. Constructing this service never sends a message. */
export class TelegramService {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private readonly encryptionKey: Buffer;
  private readonly publicOrigin: string;
  private readonly sendTimeoutMs: number;
  private draining = false;
  private transportPending = false;

  constructor(private readonly options: TelegramServiceOptions) {
    this.db = options.db; this.now = options.now ?? Date.now;
    if (!telegramId(options.botId) || !/^[A-Za-z0-9_]{5,32}$/.test(options.botUsername) || options.webhookSecret.length < 32 || options.webhookSecret.length > 256) {
      throw new Error('Invalid Telegram integration configuration');
    }
    if (!(options.proofEncryptionKey instanceof Uint8Array) || options.proofEncryptionKey.byteLength !== 32) throw new Error('Telegram proof encryption requires 32 bytes');
    this.encryptionKey = Buffer.from(options.proofEncryptionKey);
    const portal = new URL(options.publicOrigin);
    if (!['http:', 'https:'].includes(portal.protocol) || portal.username || portal.password || portal.pathname !== '/' || portal.hash || portal.search) throw new Error('Invalid portal origin');
    this.publicOrigin = portal.origin;
    this.sendTimeoutMs = options.sendTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.sendTimeoutMs) || this.sendTimeoutMs < 10 || this.sendTimeoutMs > 30_000) throw new Error('Invalid Telegram transport deadline');
    ensureTelegramSchema(this.db);
  }

  private row<T>(sql: string, ...args: SqlValue[]): T | undefined { return this.db.prepare(sql).get(...args) as T | undefined; }
  private run(sql: string, ...args: SqlValue[]): void { this.db.prepare(sql).run(...args); }
  private attempt(id: string): AttemptRow | undefined { return this.row<AttemptRow>(`${ATTEMPT_SELECT} WHERE attempt_id=? AND bot_id=?`, id, this.options.botId); }
  private binding(playerId: string): BindingRow | undefined {
    return this.row<BindingRow>(`${BINDING_SELECT} WHERE player_id=? AND bot_id=? AND status IN ('active','unreachable')`, playerId, this.options.botId);
  }
  private liveSession(sessionHash: string, playerId: string): boolean {
    const row = this.row<{ player_id: string | null; created_at: number; expires_at: number; last_seen_at: number }>('SELECT * FROM web_sessions WHERE session_hash=?', sessionHash);
    return !!row && row.player_id === playerId && row.expires_at > this.now() && row.last_seen_at + 7 * DAY > this.now();
  }
  private requireSession(session: SessionRecord, recent = false): string {
    if (!session?.playerId || !this.liveSession(session.sessionHash, session.playerId)) fail('UNAUTHENTICATED', 'Войдите снова', 401);
    const player = this.row<{ email_verified: number }>('SELECT email_verified FROM players WHERE player_id=?', session.playerId);
    if (!player?.email_verified) fail('EMAIL_NOT_VERIFIED', 'Сначала подтвердите электронную почту', 403);
    const stored = this.row<{ reauthenticated_at: number }>('SELECT reauthenticated_at FROM web_sessions WHERE session_hash=?', session.sessionHash)!;
    if (recent && (stored.reauthenticated_at > this.now() || stored.reauthenticated_at + RECENT_AUTH <= this.now())) fail('REAUTH_REQUIRED', 'Подтвердите пароль ещё раз', 401);
    return session.playerId;
  }
  private ownAttempt(session: SessionRecord, attemptId: string, recent = false): AttemptRow {
    const playerId = this.requireSession(session, recent);
    const attempt = this.attempt(attemptId);
    if (!attempt || attempt.player_id !== playerId || attempt.session_hash !== session.sessionHash) fail('LINK_SESSION_MISMATCH', 'Начните подключение Telegram в этом браузере', 403);
    return attempt;
  }
  private skipJobs(where: string, args: SqlValue[], reason: string): void {
    // A request already dispatched (or with a lost response) might have been delivered.
    // Stop retries without falsely describing it as certainly unsent. Keep the current
    // lease token so a late, definitive acceptance can still be recorded as sent.
    this.run(`UPDATE telegram_outbox SET state='delivery_unknown',secret_ciphertext=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_error=? WHERE ${where} AND state IN ('sending','delivery_unknown')`, reason, ...args);
    this.run(`UPDATE telegram_outbox SET state='skipped',secret_ciphertext=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_error=? WHERE ${where} AND state IN ('queued','retry_wait')`, reason, ...args);
  }
  private expire(): void {
    this.run(`UPDATE telegram_link_attempts SET state='expired' WHERE state IN ${ACTIVE_ATTEMPTS} AND expires_at<=?`, this.now());
    this.skipJobs("kind='proof' AND attempt_id IN (SELECT attempt_id FROM telegram_link_attempts WHERE state<>'awaiting_web_confirmation')", [], 'attempt_closed');
    this.skipJobs('expires_at<=?', [this.now()], 'expired');
    // A process may have died after sending but before recording the response.
    this.run("UPDATE telegram_outbox SET state='delivery_unknown',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,last_error='DELIVERY_UNKNOWN' WHERE state='sending' AND lease_expires_at<=?", this.now(), this.now());
  }
  private attemptView(row: AttemptRow): TelegramAttemptStatus {
    return { attemptId: row.attempt_id, state: row.state, expiresAt: row.expires_at,
      candidate: row.candidate_user_id && row.candidate_display_json ? masked(row.candidate_user_id, row.candidate_display_json) : null,
      proofAttemptsRemaining: Math.max(0, MAX_FAILURES - row.proof_failures) };
  }

  getStatus(playerId: string): TelegramStatus {
    const binding = this.binding(playerId);
    return { available: true, linked: !!binding, status: binding ? binding.status as 'active' | 'unreachable' : 'unlinked',
      notificationsEnabled: !!binding?.notifications_enabled, botUsername: this.options.botUsername,
      account: binding ? masked(binding.telegram_user_id, binding.display_json) : null };
  }
  createAttempt(session: SessionRecord): TelegramAttemptStatus & { deepLink: string } {
    return this.db.transaction(() => {
      this.expire();
      const playerId = this.requireSession(session, true);
      this.run(`UPDATE telegram_link_attempts SET state='cancelled' WHERE player_id=? AND state IN ${ACTIVE_ATTEMPTS}`, playerId);
      this.skipJobs("player_id=? AND kind='proof'", [playerId], 'replaced_attempt');
      const attemptId = randomUUID(); const token = randomBytes(32).toString('base64url');
      this.run("INSERT INTO telegram_link_attempts (attempt_id,bot_id,player_id,session_hash,token_hash,state,created_at,expires_at) VALUES (?,?,?,?,?,'issued',?,?)", attemptId, this.options.botId, playerId, session.sessionHash, digest(token), this.now(), this.now() + ATTEMPT_TTL);
      return { ...this.attemptView(this.attempt(attemptId)!), deepLink: `https://t.me/${this.options.botUsername}?start=l1_${token}` };
    }).immediate();
  }
  getAttemptStatus(session: SessionRecord, attemptId: string): TelegramAttemptStatus {
    return this.db.transaction(() => { this.expire(); return this.attemptView(this.ownAttempt(session, attemptId)); }).immediate();
  }
  cancelAttempt(session: SessionRecord, attemptId: string): TelegramAttemptStatus {
    return this.db.transaction(() => {
      this.expire(); const row = this.ownAttempt(session, attemptId);
      if (row.state === 'issued' || row.state === 'awaiting_web_confirmation') this.run("UPDATE telegram_link_attempts SET state='cancelled' WHERE attempt_id=?", attemptId);
      this.skipJobs('attempt_id=?', [attemptId], 'cancelled_attempt');
      return this.attemptView(this.attempt(attemptId)!);
    }).immediate();
  }
  confirm(session: SessionRecord, input: { attemptId: string; proofCode: string; consent: boolean }): TelegramStatus {
    if (!input || typeof input.attemptId !== 'string' || typeof input.proofCode !== 'string' || typeof input.consent !== 'boolean') fail('INVALID_INPUT', 'Проверьте код и настройку приглашений');
    // Failure counters must commit even though the API returns an error afterward.
    const result = this.db.transaction((): TelegramStatus | { error: PlatformError } => {
      this.expire(); const row = this.ownAttempt(session, input.attemptId, true);
      if (row.state === 'expired') return { error: new PlatformError('LINK_EXPIRED', 'Ссылка подключения устарела') };
      if (row.state === 'rejected') return { error: new PlatformError('LINK_PROOF_LOCKED', 'Начните подключение заново') };
      const code = input.proofCode.trim().toUpperCase();
      if (row.state === 'confirmed') {
        if (!row.proof_hash || !sameSecret(digest(code), row.proof_hash) || Number(input.consent) !== row.confirmed_consent) return { error: new PlatformError('LINK_ALREADY_USED', 'Подключение уже завершено', 409) };
        return this.getStatus(row.player_id);
      }
      if (row.state !== 'awaiting_web_confirmation' || !row.candidate_user_id || !row.candidate_chat_id || !row.candidate_display_json || !row.proof_hash) return { error: new PlatformError('LINK_ALREADY_USED', 'Откройте бота по новой ссылке', 409) };
      if (!/^[A-Z2-7]{8}$/.test(code) || !sameSecret(digest(code), row.proof_hash)) {
        const failures = row.proof_failures + 1;
        this.run('UPDATE telegram_link_attempts SET proof_failures=?,state=? WHERE attempt_id=?', failures, failures >= MAX_FAILURES ? 'rejected' : row.state, row.attempt_id);
        if (failures >= MAX_FAILURES) this.skipJobs('attempt_id=?', [row.attempt_id], 'proof_locked');
        return { error: new PlatformError(failures >= MAX_FAILURES ? 'LINK_PROOF_LOCKED' : 'LINK_PROOF_INVALID', failures >= MAX_FAILURES ? 'Начните подключение заново' : 'Неверный код подтверждения') };
      }
      const identity = this.row<BindingRow>(`${BINDING_SELECT} WHERE bot_id=? AND telegram_user_id=? AND status IN ('active','unreachable')`, this.options.botId, BigInt(row.candidate_user_id));
      if (identity && identity.player_id !== row.player_id) return { error: new PlatformError('TELEGRAM_ALREADY_LINKED', 'Этот Telegram уже подключён', 409) };
      let bindingId: string;
      if (identity) {
        // Preserve the binding identity/version, but honour the explicit checkbox in this
        // confirmation. Merely receiving /start never changes an existing preference.
        bindingId = identity.binding_id;
        this.run("UPDATE telegram_bindings SET status='active',private_chat_id=?,display_json=?,notifications_enabled=?,consented_at=?,last_delivery_error=NULL WHERE binding_id=?", BigInt(row.candidate_chat_id), row.candidate_display_json, Number(input.consent), input.consent ? this.now() : identity.consented_at, bindingId);
        if (!input.consent) this.skipJobs('binding_id=?', [bindingId], 'muted');
      } else {
        const nextVersion = Number(this.row<{ version: number | null }>('SELECT MAX(binding_version) AS version FROM telegram_bindings WHERE player_id=?', row.player_id)?.version ?? 0) + 1;
        this.run("UPDATE telegram_bindings SET status='revoked',notifications_enabled=0,revoked_at=? WHERE player_id=? AND status IN ('active','unreachable')", this.now(), row.player_id);
        this.skipJobs("player_id=? AND kind='invitation'", [row.player_id], 'binding_replaced');
        bindingId = randomUUID();
        this.run("INSERT INTO telegram_bindings VALUES (?,?,?,?,?,?,?,'active',?,?,?,NULL,NULL)", bindingId, this.options.botId, row.player_id, BigInt(row.candidate_user_id), BigInt(row.candidate_chat_id), row.candidate_display_json, nextVersion, Number(input.consent), input.consent ? this.now() : null, this.now());
      }
      this.run("UPDATE telegram_link_attempts SET state='confirmed',binding_id=?,confirmed_consent=?,consumed_at=? WHERE attempt_id=?", bindingId, Number(input.consent), this.now(), row.attempt_id);
      this.skipJobs('attempt_id=?', [row.attempt_id], 'confirmed');
      return this.getStatus(row.player_id);
    }).immediate();
    if ('error' in result) throw result.error;
    return result;
  }
  setDelivery(session: SessionRecord, enabled: boolean): TelegramStatus {
    if (typeof enabled !== 'boolean') fail('INVALID_INPUT', 'Выберите настройку приглашений');
    return this.db.transaction(() => {
      const playerId = this.requireSession(session); const binding = this.binding(playerId);
      if (!binding) fail('TELEGRAM_NOT_LINKED', 'Сначала подключите Telegram', 409);
      if (enabled && binding.status !== 'active') fail('TELEGRAM_UNREACHABLE', 'Подключите Telegram заново', 409);
      this.run('UPDATE telegram_bindings SET notifications_enabled=?,consented_at=? WHERE binding_id=?', Number(enabled), enabled ? this.now() : binding.consented_at, binding.binding_id);
      if (!enabled) this.skipJobs('binding_id=?', [binding.binding_id], 'muted');
      return this.getStatus(playerId);
    }).immediate();
  }
  unlink(session: SessionRecord): TelegramStatus {
    return this.db.transaction(() => {
      const playerId = this.requireSession(session, true);
      this.run("UPDATE telegram_bindings SET status='revoked',notifications_enabled=0,revoked_at=? WHERE player_id=? AND bot_id=? AND status IN ('active','unreachable')", this.now(), playerId, this.options.botId);
      this.run(`UPDATE telegram_link_attempts SET state='cancelled' WHERE player_id=? AND bot_id=? AND state IN ${ACTIVE_ATTEMPTS}`, playerId, this.options.botId);
      this.skipJobs('player_id=? AND bot_id=?', [playerId, this.options.botId], 'unlinked');
      return this.getStatus(playerId);
    }).immediate();
  }

  private encryptProof(jobId: string, attemptId: string, code: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${jobId}:${attemptId}`));
    const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') });
  }
  private decryptProof(job: JobRow): string {
    const envelope = JSON.parse(job.secret_ciphertext!) as { v: number; iv: string; tag: string; data: string };
    if (envelope.v !== 1) throw new Error('Unsupported proof envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAAD(Buffer.from(`${job.job_id}:${job.attempt_id}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()]).toString('utf8');
  }
  handleUpdate(secretHeader: unknown, body: unknown): { accepted: true; duplicate: boolean } {
    if (typeof secretHeader !== 'string' || secretHeader.length > 256 || !sameSecret(secretHeader, this.options.webhookSecret)) fail('WEBHOOK_FORBIDDEN', 'Запрос не авторизован', 403);
    const update = record(body);
    if (!update || !Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0 || Buffer.byteLength(JSON.stringify(update)) > 65_536) fail('WEBHOOK_INVALID', 'Некорректное обновление');
    return this.db.transaction(() => {
      this.expire();
      if (this.row('SELECT 1 FROM telegram_inbox WHERE bot_id=? AND update_id=?', this.options.botId, Number(update.update_id))) return { accepted: true as const, duplicate: true };
      const outcome = this.processUpdate(update);
      this.run('INSERT INTO telegram_inbox VALUES (?,?,?,?,?)', this.options.botId, Number(update.update_id), this.now(), digest(JSON.stringify(update)), outcome);
      return { accepted: true as const, duplicate: false };
    }).immediate();
  }
  private processUpdate(update: Record<string, unknown>): string {
    const memberUpdate = record(update.my_chat_member);
    if (memberUpdate) {
      const chat = record(memberUpdate.chat); const member = record(memberUpdate.new_chat_member); const bot = record(member?.user);
      const chatId = telegramId(chat?.id);
      if (chat?.type === 'private' && chatId && telegramId(bot?.id) === this.options.botId && ['kicked', 'left'].includes(String(member?.status))) {
        const binding = this.row<BindingRow>(`${BINDING_SELECT} WHERE bot_id=? AND private_chat_id=? AND status IN ('active','unreachable')`, this.options.botId, BigInt(chatId));
        if (binding) this.unreachable(binding.binding_id);
      }
      return 'membership_processed';
    }
    const message = record(update.message); const chat = record(message?.chat); const from = record(message?.from);
    const userId = telegramId(from?.id); const chatId = telegramId(chat?.id);
    if (!message || chat?.type !== 'private' || !from || from.is_bot !== false || !userId || !chatId ||
      message.forward_origin || message.forward_from || message.forward_date || message.sender_chat || message.via_bot || message.business_connection_id || message.is_automatic_forward) return 'ignored';
    if (typeof message.text !== 'string' || message.text.length > 256) return 'ignored';
    const command = message.text.trim().match(/^\/(start|stop|mute)(?:@([A-Za-z0-9_]+))?(?:\s+([^\s]+))?$/);
    if (!command || (command[2] && command[2].toLowerCase() !== this.options.botUsername.toLowerCase())) return 'ignored';
    if (command[1] === 'stop' || command[1] === 'mute') {
      const binding = this.row<BindingRow>(`${BINDING_SELECT} WHERE bot_id=? AND telegram_user_id=? AND private_chat_id=? AND status IN ('active','unreachable')`, this.options.botId, BigInt(userId), BigInt(chatId));
      if (binding) { this.run('UPDATE telegram_bindings SET notifications_enabled=0 WHERE binding_id=?', binding.binding_id); this.skipJobs('binding_id=?', [binding.binding_id], 'muted'); }
      return 'mute_processed';
    }
    const payload = command[3];
    if (!payload || !/^l1_[A-Za-z0-9_-]{43}$/.test(payload)) return 'start_ignored';
    const attempt = this.row<AttemptRow>(`${ATTEMPT_SELECT} WHERE bot_id=? AND token_hash=?`, this.options.botId, digest(payload.slice(3)));
    if (!attempt || attempt.state !== 'issued' || attempt.expires_at <= this.now() || !this.liveSession(attempt.session_hash, attempt.player_id)) return 'start_ignored';
    const code = proofCode(); const jobId = randomUUID();
    this.run("UPDATE telegram_link_attempts SET state='awaiting_web_confirmation',candidate_user_id=?,candidate_chat_id=?,candidate_display_json=?,proof_hash=? WHERE attempt_id=?", BigInt(userId), BigInt(chatId), displayOf(from), digest(code), attempt.attempt_id);
    this.run("INSERT INTO telegram_outbox (job_id,bot_id,dedupe_key,kind,player_id,attempt_id,chat_id,secret_ciphertext,state,created_at,expires_at,next_attempt_at) VALUES (?,?,?,'proof',?,?,?,?,'queued',?,?,?)", jobId, this.options.botId, `proof:${this.options.botId}:${attempt.attempt_id}`, attempt.player_id, attempt.attempt_id, BigInt(chatId), this.encryptProof(jobId, attempt.attempt_id, code), this.now(), attempt.expires_at, this.now());
    return 'candidate_recorded';
  }

  private invitation(id: string): InvitationRow | undefined {
    return this.row<InvitationRow>(`SELECT i.*,r.state AS room_state,r.host_player_id,r.title,r.game_id,r.capacity,p.display_name AS inviter_name
      FROM invitations i JOIN rooms r ON r.room_id=i.room_id JOIN players p ON p.player_id=i.inviter_id WHERE i.invitation_id=?`, id);
  }
  private invitationInvalid(invite: InvitationRow | undefined, playerId: string): string | null {
    if (!invite || invite.invitee_id !== playerId || invite.state !== 'pending' || invite.expires_at <= this.now()) return 'invitation_closed';
    if (invite.room_state !== 'lobby' || invite.host_player_id !== invite.inviter_id) return 'room_closed';
    const [low, high] = [invite.inviter_id, playerId].sort();
    if (!this.row("SELECT 1 FROM friendships WHERE low_id=? AND high_id=? AND state='accepted'", low, high)) return 'relationship_changed';
    if (this.row('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)', invite.inviter_id, playerId, playerId, invite.inviter_id)) return 'blocked';
    if (this.row(`SELECT 1 FROM room_members m JOIN blocks b ON (b.blocker_id=m.player_id AND b.blocked_id=?) OR (b.blocker_id=? AND b.blocked_id=m.player_id) WHERE m.room_id=?`, playerId, playerId, invite.room_id)) return 'blocked';
    if (this.row('SELECT 1 FROM room_members WHERE room_id=? AND player_id=?', invite.room_id, playerId)) return 'already_joined';
    const count = Number(this.row<{ n: number }>('SELECT COUNT(*) AS n FROM room_members WHERE room_id=?', invite.room_id)?.n ?? 0)
      + Number(this.row<{ n: number }>('SELECT COUNT(*) AS n FROM seat_reservations WHERE room_id=? AND expires_at>?', invite.room_id, this.now())?.n ?? 0);
    if (count >= invite.capacity) return 'room_full';
    return null;
  }
  /** Called in the same outer transaction that creates the website invitation. No network I/O. */
  enqueueInvitation(invitationId: string): boolean {
    return this.db.transaction(() => {
      this.expire(); const invite = this.invitation(invitationId);
      if (!invite || this.invitationInvalid(invite, invite.invitee_id)) return false;
      const binding = this.binding(invite.invitee_id);
      if (!binding || binding.status !== 'active' || !binding.notifications_enabled || binding.consented_at === null || binding.linked_at > invite.created_at || binding.consented_at > invite.created_at) return false;
      const notification = this.row<{ event_id: string }>("SELECT event_id FROM site_notifications WHERE invitation_id=? AND player_id=? AND kind='game_invitation' ORDER BY created_at LIMIT 1", invitationId, invite.invitee_id);
      if (!notification) return false;
      const dedupe = `invitation:${this.options.botId}:${notification.event_id}:${binding.binding_version}`;
      if (this.row('SELECT 1 FROM telegram_outbox WHERE dedupe_key=?', dedupe)) return false;
      this.run("INSERT INTO telegram_outbox (job_id,bot_id,dedupe_key,kind,player_id,invitation_id,binding_id,binding_version,chat_id,state,created_at,expires_at,next_attempt_at) VALUES (?,?,?,'invitation',?,?,?,?,?,'queued',?,?,?)", randomUUID(), this.options.botId, dedupe, invite.invitee_id, invitationId, binding.binding_id, binding.binding_version, BigInt(binding.private_chat_id), this.now(), invite.expires_at, this.now());
      return true;
    }).immediate();
  }
  private jobInvalid(job: JobRow): string | null {
    if (job.expires_at <= this.now()) return 'expired';
    if (job.kind === 'proof') {
      const attempt = job.attempt_id ? this.attempt(job.attempt_id) : undefined;
      if (!attempt || attempt.state !== 'awaiting_web_confirmation' || attempt.expires_at <= this.now() || !job.secret_ciphertext || attempt.candidate_chat_id !== job.chat_id) return 'attempt_closed';
      if (!this.liveSession(attempt.session_hash, attempt.player_id)) return 'session_revoked';
      return null;
    }
    const binding = this.binding(job.player_id);
    if (!binding || binding.binding_id !== job.binding_id || binding.binding_version !== job.binding_version || binding.private_chat_id !== job.chat_id || binding.status !== 'active' || !binding.notifications_enabled) return 'binding_changed';
    return this.invitationInvalid(job.invitation_id ? this.invitation(job.invitation_id) : undefined, job.player_id);
  }
  private claim(): JobRow | null {
    return this.db.transaction(() => {
      this.expire();
      for (const row of this.db.prepare(`${JOB_SELECT} WHERE bot_id=? AND state IN ('queued','retry_wait','delivery_unknown') AND attempts<? AND next_attempt_at<=? ORDER BY created_at,job_id LIMIT 100`).all(this.options.botId, MAX_SEND_ATTEMPTS, this.now()) as JobRow[]) {
        const invalid = this.jobInvalid(row);
        if (invalid) { this.skipJobs('job_id=?', [row.job_id], invalid); continue; }
        const lease = randomUUID();
        this.run("UPDATE telegram_outbox SET state='sending',attempts=attempts+1,lease_token=?,lease_expires_at=? WHERE job_id=?", lease, this.now() + LEASE_MS, row.job_id);
        return this.row<JobRow>(`${JOB_SELECT} WHERE job_id=?`, row.job_id)!;
      }
      return null;
    }).immediate();
  }
  private unreachable(bindingId: string): void {
    this.run("UPDATE telegram_bindings SET status='unreachable',last_delivery_error='UNREACHABLE' WHERE binding_id=? AND status<>'revoked'", bindingId);
    this.skipJobs('binding_id=?', [bindingId], 'unreachable');
  }
  private message(job: JobRow): TelegramMessage {
    if (job.kind === 'proof') {
      const prefix = 'Код подключения: ';
      const code = this.decryptProof(job);
      return { chatId: job.chat_id, text: `${prefix}${code}\n\nВведите его на сайте Iva Games.`,
        copyCode: { value: code, offset: prefix.length, buttonText: 'Скопировать код' } };
    }
    const invite = this.invitation(job.invitation_id!)!;
    const name = stripControls(invite.inviter_name).slice(0, 40);
    const title = stripControls(invite.title).slice(0, 60);
    return { chatId: job.chat_id, text: `${name} зовёт вас играть!\nКомната: ${title}`, button: { text: 'Открыть приглашение', url: `${this.publicOrigin}/invitations/${invite.invitation_id}` } };
  }
  private async sendBounded(message: TelegramMessage): Promise<{ outcome: 'accepted'; messageId: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.transportPending = true;
    let pending: Promise<{ outcome: 'accepted'; messageId: string }>;
    try { pending = this.options.transport.sendMessage(message); }
    catch (error) { this.transportPending = false; throw error; }
    // A caller-side timeout cannot cancel an arbitrary injected transport. Keep the
    // single-flight latch until it really settles, rather than accumulating requests.
    // The production transport destroys its underlying request at its own deadline.
    const settled = pending.finally(() => { this.transportPending = false; });
    try {
      return await Promise.race([settled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Telegram response deadline'), { code: 'DELIVERY_UNKNOWN' })), this.sendTimeoutMs); timer.unref();
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  /** At most one drain per instance, one in-flight send, bounded batch and request deadline. */
  async drain(options: { limit?: number } = {}): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
    const result = { processed: 0, sent: 0, skipped: 0, failed: 0 };
    if (this.draining || this.transportPending || !this.db.open) return result;
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_INPUT', 'Некорректный размер очереди');
    this.draining = true;
    try {
      for (let i = 0; i < limit; i++) {
        if (this.transportPending) break;
        const job = this.claim(); if (!job) break;
        result.processed++;
        try {
          const message = this.message(job);
          const response = await this.sendBounded(message);
          if (response.outcome !== 'accepted' || !/^\d+$/.test(response.messageId)) throw Object.assign(new Error('Unknown delivery response'), { code: 'DELIVERY_UNKNOWN' });
          // A mute/unlink stops retries; a definitive late acceptance can still be recorded.
          const updated = this.db.prepare("UPDATE telegram_outbox SET state='sent',message_id=?,secret_ciphertext=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,last_error=NULL WHERE job_id=? AND state IN ('sending','delivery_unknown') AND lease_token=?").run(response.messageId, job.job_id, job.lease_token);
          if (updated.changes) result.sent++; else result.skipped++;
        } catch (caught) {
          const code = record(caught)?.code;
          const known = ['RETRY_LATER','DELIVERY_UNKNOWN','UNREACHABLE','REJECTED','INVALID_CONFIGURATION','PROXY_REQUIRED'].includes(String(code)) ? String(code) : 'DELIVERY_UNKNOWN';
          const retryAfter = Number(record(caught)?.retryAfterSeconds);
          this.db.transaction(() => {
            const current = this.row<JobRow>(`${JOB_SELECT} WHERE job_id=? AND state='sending' AND lease_token=?`, job.job_id, job.lease_token);
            if (!current) { result.skipped++; return; }
            const invalid = this.jobInvalid(current);
            if (invalid) { this.skipJobs('job_id=?', [job.job_id], invalid); result.skipped++; return; }
            if (known === 'UNREACHABLE') {
              if (job.binding_id) this.unreachable(job.binding_id);
              if (job.attempt_id) this.run("UPDATE telegram_link_attempts SET state='rejected' WHERE attempt_id=? AND state='awaiting_web_confirmation'", job.attempt_id);
              this.run("UPDATE telegram_outbox SET state='permanent_failure',secret_ciphertext=NULL,next_attempt_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=? WHERE job_id=?", known, job.job_id);
              result.failed++; return;
            }
            const retryable = known === 'RETRY_LATER' || known === 'DELIVERY_UNKNOWN';
            const delay = known === 'RETRY_LATER' && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter * 1000) : Math.min(30_000, 1000 * 2 ** (job.attempts - 1)) + randomInt(0, 501);
            const next = this.now() + delay;
            if (!retryable || job.attempts >= MAX_SEND_ATTEMPTS || next >= job.expires_at) {
              // Exhausted unknown outcomes stay unknown: no claim of certainly unsent delivery.
              const state = known === 'DELIVERY_UNKNOWN' ? 'delivery_unknown' : 'permanent_failure';
              this.run('UPDATE telegram_outbox SET state=?,secret_ciphertext=NULL,next_attempt_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=? WHERE job_id=?', state, known, job.job_id);
              result.failed++; return;
            }
            this.run('UPDATE telegram_outbox SET state=?,next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL,last_error=? WHERE job_id=?', known === 'DELIVERY_UNKNOWN' ? 'delivery_unknown' : 'retry_wait', next, known, job.job_id);
            result.failed++;
          }).immediate();
        }
      }
    } finally { this.draining = false; }
    return result;
  }
}
