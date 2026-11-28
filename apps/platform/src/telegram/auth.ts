import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { digest, PlatformService } from '../service.js';
import type { AuthenticationResult } from '../service.js';
import { PlatformError } from '../types.js';
import type { SessionRecord } from '../types.js';
import { TelegramAccountBot } from './account-bot.js';
import type { BotReply } from './account-bot.js';
import type { TelegramMessage } from '@iva-games/telegram-transport';

const TTL = 10 * 60_000;
const MAX_FAILURES = 5;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const START = /^\/start(?:@([a-zA-Z0-9_]+))? a1_([a-zA-Z0-9_-]{43})$/;

type Attempt = {
  id: string;
  session_hash: string;
  expires_at: number;
  telegram_user_id: string | null;
  first_update: number | null;
  failures: number;
  used_at: number | null;
  locale: string;
};

export type TelegramAuthConfig = { botId: string; botUsername: string; webhookSecret: string; codeKey: Uint8Array;
  botToken?: string; proxyUrl?: string };

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function language(from: Record<string, unknown>): (ru: string, en: string) => string {
  return String(from.language_code ?? 'ru').startsWith('ru') ? ru => ru : (_ru, en) => en;
}
function privateSender(chat: Record<string, unknown> | undefined, from: Record<string, unknown> | undefined): from is Record<string, unknown> {
  return chat?.type === 'private' && !!from && from.is_bot === false &&
    Number.isSafeInteger(from.id) && Number(from.id) > 0 && chat.id === from.id;
}

export class TelegramAuth {
  private readonly bot: TelegramAccountBot;
  constructor(
    private readonly platform: PlatformService,
    private readonly config: TelegramAuthConfig,
    private readonly now: () => number = Date.now,
    private readonly transport?: { sendMessage(message: TelegramMessage): Promise<{ outcome: 'accepted'; messageId: string }> },
  ) { this.bot = new TelegramAccountBot(platform, config.botId, config.botUsername); }

  rememberDevice(playerId: string, previous: string | undefined): string | undefined {
    const db = this.platform.db;
    const account = db.prepare('SELECT telegram_user_id FROM telegram_login_accounts WHERE bot_id=? AND player_id=?')
      .get(this.config.botId, playerId) as { telegram_user_id: string } | undefined;
    if (!account) return undefined;
    if (previous && /^[A-Za-z0-9_-]{43}$/.test(previous) && db.prepare(
      'SELECT 1 FROM telegram_auth_devices WHERE token_hash=? AND bot_id=? AND telegram_user_id=? AND expires_at>?',
    ).get(digest(previous), this.config.botId, account.telegram_user_id, this.now())) return undefined;
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM telegram_auth_devices WHERE expires_at<=?').run(this.now());
    db.prepare('INSERT INTO telegram_auth_devices VALUES (?,?,?,?)').run(digest(token), this.config.botId, account.telegram_user_id, this.now() + 180 * 86400_000);
    return token;
  }

  async start(session: SessionRecord, locale: unknown, device?: string, otherAccount = false): Promise<{ attemptId: string; deepLink: string; delivery: 'sent' | 'open_bot' | 'failed' }> {
    if (session.playerId) throw new PlatformError('AUTH_ALREADY_SIGNED_IN', 'Вы уже вошли', 409);
    const attemptId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const remembered = !otherAccount && device && /^[A-Za-z0-9_-]{43}$/.test(device)
      ? this.platform.db.prepare(`SELECT d.telegram_user_id FROM telegram_auth_devices d JOIN telegram_login_accounts a
          ON a.bot_id=d.bot_id AND a.telegram_user_id=d.telegram_user_id WHERE d.token_hash=? AND d.bot_id=? AND d.expires_at>?`)
        .get(digest(device), this.config.botId, now) as { telegram_user_id: string } | undefined : undefined;
    const pending = !otherAccount ? this.platform.db.prepare(`SELECT telegram_user_id FROM telegram_auth_attempts
      WHERE session_hash=? AND bot_id=? AND telegram_user_id IS NOT NULL AND expires_at>? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1`)
      .get(session.sessionHash, this.config.botId, now) as { telegram_user_id: string } | undefined : undefined;
    const telegramId = remembered?.telegram_user_id ?? pending?.telegram_user_id;
    this.platform.db.transaction(() => {
      this.platform.db.prepare('DELETE FROM telegram_auth_attempts WHERE expires_at<=? OR (session_hash=? AND used_at IS NULL)').run(now, session.sessionHash);
      this.platform.db.prepare(`INSERT INTO telegram_auth_attempts (id,session_hash,bot_id,token_hash,expires_at,locale,telegram_user_id)
        VALUES (?,?,?,?,?,?,?)`).run(attemptId, session.sessionHash, this.config.botId, digest(token), now + TTL, locale === 'en' ? 'en' : 'ru', telegramId ?? null);
    }).immediate();
    const result = { attemptId, deepLink: `https://t.me/${this.config.botUsername}?start=a1_${token}` };
    if (!telegramId) return { ...result, delivery: 'open_bot' };
    if (!this.transport) return { ...result, delivery: 'failed' };
    this.platform.rateLimit(`telegram-auth-recipient:${this.config.botId}:${telegramId}`, 3, 60_000);
    const attempt = this.platform.db.prepare('SELECT * FROM telegram_auth_attempts WHERE id=?').get(attemptId) as Attempt;
    const reply = this.codeReply(attempt, telegramId);
    try {
      await this.transport.sendMessage({ chatId: telegramId, text: reply.text,
        copyCode: { value: this.code(attempt), offset: reply.entities![0].offset,
          buttonText: locale === 'en' ? 'Copy code' : 'Скопировать код' } });
      return { ...result, delivery: 'sent' };
    } catch { return { ...result, delivery: 'failed' }; }
  }

  private code(attempt: Attempt): string {
    // Stable on webhook retries, with a distinct purpose and 40 bits of entropy.
    const bytes = createHmac('sha256', this.config.codeKey)
      .update(`telegram-auth-v1:${this.config.botId}:${attempt.id}:${attempt.telegram_user_id}`).digest();
    return [...bytes.subarray(0, 8)].map(byte => ALPHABET[byte & 31]).join('');
  }

  private codeReply(attempt: Attempt, telegramId: string): Extract<BotReply, { method: 'sendMessage' }> {
    const code = this.code(attempt);
    const prefix = attempt.locale === 'en' ? 'Iva Games code: ' : 'Код Iva Games: ';
    return {
      method: 'sendMessage', chat_id: telegramId,
      text: `${prefix}${code}\n${attempt.locale === 'en'
        ? 'Enter it on iva-games.pro in the browser where you requested it. Never share this code.'
        : 'Введите его на iva-games.pro в браузере, где вы запросили код. Никому его не сообщайте.'}`,
      entities: [{ type: 'code', offset: prefix.length, length: code.length }],
      reply_markup: { inline_keyboard: [[{
        text: attempt.locale === 'en' ? 'Copy code' : 'Скопировать код', copy_text: { text: code },
      }]] },
    };
  }

  webhook(input: unknown): BotReply {
    const update = object(input);
    if (!Number.isSafeInteger(update?.update_id) || Number(update?.update_id) < 0) return { ok: true };
    const callback = object(update?.callback_query);
    if (callback) {
      const from = object(callback.from);
      const callbackMessage = object(callback.message);
      const author = object(callbackMessage?.from);
      if (!privateSender(object(callbackMessage?.chat), from) || String(author?.id) !== this.config.botId ||
        typeof callback.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(callback.id) ||
        typeof callback.data !== 'string' || Buffer.byteLength(callback.data) > 64) return { ok: true };
      return this.bot.action(String(from.id), callback.id, callback.data, language(from));
    }
    const message = object(update?.message);
    const chat = object(message?.chat);
    const from = object(message?.from);
    const updateId = update?.update_id;
    if (!message || !privateSender(chat, from) ||
      message.forward_origin || message.forward_from || message.forward_date ||
      message.via_bot || message.sender_chat || message.business_connection_id || message.is_automatic_forward
    ) return { ok: true };
    if (typeof message.text !== 'string' || message.text.length > 220) return { ok: true };
    const text = message.text.trim();
    const match = START.exec(text);
    const telegramId = String(from.id);
    if (!match) return this.bot.command(telegramId, text, language(from));
    if (match[1] && match[1].toLowerCase() !== this.config.botUsername.toLowerCase()) return { ok: true };
    const now = this.now();
    const attempt = this.platform.db.transaction(() => {
      const db = this.platform.db;
      const row = db.prepare(`SELECT a.* FROM telegram_auth_attempts a JOIN web_sessions s ON s.session_hash=a.session_hash
        WHERE a.bot_id=? AND a.token_hash=? AND a.expires_at>? AND a.used_at IS NULL AND a.failures<?
        AND s.player_id IS NULL AND s.expires_at>?`).get(this.config.botId, digest(match[2]), now, MAX_FAILURES, now) as Attempt | undefined;
      if (!row || (row.telegram_user_id && row.telegram_user_id !== telegramId)) return undefined;
      if (row.first_update === updateId) return row;
      const recentlySent = db.prepare(`SELECT 1 FROM telegram_auth_attempts
        WHERE bot_id=? AND telegram_user_id=? AND reply_at>?`).get(this.config.botId, telegramId, now - 10_000);
      if (recentlySent) return undefined;
      db.prepare('UPDATE telegram_auth_attempts SET telegram_user_id=?,first_update=?,reply_at=? WHERE id=?')
        .run(telegramId, updateId as number, now, row.id);
      return { ...row, telegram_user_id: telegramId };
    }).immediate();
    if (!attempt) return { ok: true };
    return this.codeReply(attempt, telegramId);
  }

  finish(session: SessionRecord, input: Record<string, unknown>): AuthenticationResult | { profileRequired: true } {
    if (session.playerId) throw new PlatformError('AUTH_ALREADY_SIGNED_IN', 'Вы уже вошли', 409);
    const { attemptId, handle, displayName } = input;
    const supplied = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    const db = this.platform.db;
    const now = this.now();
    const result = db.transaction(() => {
      const row = typeof attemptId === 'string' && attemptId.length === 36 ? db.prepare(`SELECT a.*
        FROM telegram_auth_attempts a JOIN web_sessions s ON s.session_hash=a.session_hash
        WHERE a.id=? AND a.session_hash=? AND a.bot_id=? AND a.expires_at>? AND a.used_at IS NULL
        AND a.failures<? AND s.player_id IS NULL AND s.expires_at>?`).get(attemptId, session.sessionHash, this.config.botId, now, MAX_FAILURES, now) as Attempt | undefined : undefined;
      if (!row) throw new PlatformError('TELEGRAM_AUTH_EXPIRED', 'Запросите новый код');
      if (!row.telegram_user_id) throw new PlatformError('TELEGRAM_AUTH_PENDING', 'Откройте бота и нажмите «Старт»');
      if (!/^[A-Z2-7]{8}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.code(row)))) {
        db.prepare('UPDATE telegram_auth_attempts SET failures=failures+1 WHERE id=?').run(row.id);
        return null;
      }
      const identity = db.prepare('SELECT player_id FROM telegram_login_accounts WHERE bot_id=? AND telegram_user_id=?')
        .get(this.config.botId, row.telegram_user_id) as { player_id: string } | undefined;
      if (!identity && handle === undefined && displayName === undefined) return { profileRequired: true as const };
      const playerId = identity?.player_id ?? this.platform.createTelegramAccount({ handle, displayName });
      if (!identity) db.prepare('INSERT INTO telegram_login_accounts VALUES (?,?,?)').run(this.config.botId, row.telegram_user_id, playerId);
      db.prepare('UPDATE telegram_auth_attempts SET used_at=? WHERE id=?').run(now, row.id);
      this.platform.revokeSession(session.sessionHash);
      return { user: this.platform.account(playerId), ...this.platform.createSession(playerId) };
    }).immediate();
    if (!result) throw new PlatformError('TELEGRAM_AUTH_INVALID', 'Проверьте код');
    return result;
  }
}
