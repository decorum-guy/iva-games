import { request as httpsRequest } from 'node:https';
import type { Agent } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class TelegramTransportError extends Error {
  constructor(
    public readonly code: 'PROXY_REQUIRED' | 'INVALID_CONFIGURATION' | 'REJECTED' | 'UNREACHABLE' | 'RETRY_LATER' | 'DELIVERY_UNKNOWN',
    message: string,
    public readonly retryAfterSeconds?: number,
  ) { super(message); this.name = 'TelegramTransportError'; }
}

/** No fallback to environment proxies or a direct connection, including NO_PROXY. */
export function requiredProxyAgent(proxyUrl: string | undefined): Agent {
  if (!proxyUrl) throw new TelegramTransportError('PROXY_REQUIRED', 'Для Telegram требуется настроенный маршрут через kz-bot.');
  let parsed: URL;
  try { parsed = new URL(proxyUrl); } catch { throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректная конфигурация прокси.'); }
  if (!parsed.hostname || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/') || !['http:', 'https:', 'socks5h:'].includes(parsed.protocol)) {
    throw new TelegramTransportError('INVALID_CONFIGURATION', 'Поддерживаются HTTP CONNECT, HTTPS CONNECT и SOCKS5 с удалённым DNS.');
  }
  return parsed.protocol === 'socks5h:' ? new SocksProxyAgent(parsed) : new HttpsProxyAgent(parsed);
}

export interface TelegramMessage {
  chatId: string;
  text: string;
  button?: { text: string; url: string };
  copyCode?: { value: string; offset: number; buttonText: string };
}
interface HttpResult { status: number; body: string }
export type TelegramHttpRequest = (input: { path: string; body: string; agent: Agent; timeoutMs: number }) => Promise<HttpResult>;

const throughProxy: TelegramHttpRequest = ({ path, body, agent, timeoutMs }) => new Promise((resolve, reject) => {
  let bytes = 0;
  const request = httpsRequest({ hostname: 'api.telegram.org', port: 443, path, method: 'POST', agent,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) { request.destroy(new Error('Response limit')); return; }
      chunks.push(chunk);
    });
    response.on('end', () => { clearTimeout(deadline); resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }); });
    response.on('error', () => { clearTimeout(deadline); reject(new Error('Transport interrupted')); });
  });
  const deadline = setTimeout(() => request.destroy(new Error('Request deadline')), timeoutMs);
  deadline.unref();
  request.on('error', () => { clearTimeout(deadline); reject(new Error('Transport failed')); });
  request.end(body);
});

/** Caller must recheck website invitation, binding version and opt-in before each send. */
export function createTelegramTransport(options: { botToken: string; proxyUrl: string | undefined; portalOrigin: string; timeoutMs?: number; request?: TelegramHttpRequest }) {
  if (!/^\d{4,}:[A-Za-z0-9_-]{20,}$/.test(options.botToken)) throw new TelegramTransportError('INVALID_CONFIGURATION', 'Не задан корректный токен бота.');
  let portal: URL;
  try { portal = new URL(options.portalOrigin); } catch { throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректный адрес портала.'); }
  if (!['https:', 'http:'].includes(portal.protocol) || portal.username || portal.password || portal.pathname !== '/' || portal.search || portal.hash) throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректный адрес портала.');
  const agent = requiredProxyAgent(options.proxyUrl);
  const send = options.request ?? throughProxy;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) { agent.destroy(); throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректный срок ожидания Telegram.'); }
  return {
    close() { agent.destroy(); },
    async sendMessage(message: TelegramMessage): Promise<{ outcome: 'accepted'; messageId: string }> {
      if (!/^[1-9]\d{0,18}$/.test(message.chatId) || !message.text || message.text.length > 4096) throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректное сообщение.');
      let markup: { inline_keyboard: Array<Array<{ text: string; url: string } | { text: string; copy_text: { text: string } }>> } | undefined;
      let entities: Array<{ type: 'code'; offset: number; length: number }> | undefined;
      if (message.copyCode) {
        const { value, offset, buttonText } = message.copyCode;
        if (message.button || !value || value.length > 256 || !buttonText || buttonText.length > 100 ||
          !Number.isSafeInteger(offset) || offset < 0 || message.text.slice(offset, offset + value.length) !== value) {
          throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректный код для копирования.');
        }
        entities = [{ type: 'code', offset, length: value.length }];
        markup = { inline_keyboard: [[{ text: buttonText, copy_text: { text: value } }]] };
      }
      if (message.button) {
        let target: URL;
        try { target = new URL(message.button.url); } catch { throw new TelegramTransportError('INVALID_CONFIGURATION', 'Некорректная ссылка приглашения.'); }
        if (target.origin !== portal.origin || target.username || target.password || !/^\/invitations\/[A-Za-z0-9_-]+$/.test(target.pathname) || target.search || target.hash || !message.button.text || message.button.text.length > 100) throw new TelegramTransportError('INVALID_CONFIGURATION', 'Ссылка должна вести к приглашению на портале.');
        markup = { inline_keyboard: [[{ text: message.button.text, url: target.href }]] };
      }
      let response: HttpResult;
      try {
        response = await send({ path: `/bot${options.botToken}/sendMessage`, agent, timeoutMs,
          body: JSON.stringify({ chat_id: message.chatId, text: message.text, link_preview_options: { is_disabled: true },
            ...(entities ? { entities } : {}), ...(markup ? { reply_markup: markup } : {}) }) });
      } catch {
        // Request may have reached Telegram; never label a timeout as certainly unsent.
        throw new TelegramTransportError('DELIVERY_UNKNOWN', 'Результат доставки не подтверждён.');
      }
      let data: { ok?: boolean; result?: { message_id?: unknown }; error_code?: number; parameters?: { retry_after?: number } };
      try { data = JSON.parse(response.body) as typeof data; } catch { throw new TelegramTransportError('DELIVERY_UNKNOWN', 'Результат доставки не подтверждён.'); }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new TelegramTransportError('DELIVERY_UNKNOWN', 'Результат доставки не подтверждён.');
      if (response.status === 200 && data.ok === true && Number.isSafeInteger(data.result?.message_id)) return { outcome: 'accepted', messageId: String(data.result!.message_id) };
      if (response.status === 429 || data.error_code === 429) {
        const wait = Number(data.parameters?.retry_after);
        throw new TelegramTransportError('RETRY_LATER', 'Telegram просит повторить позже.', Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 30);
      }
      if (response.status === 403 || data.error_code === 403) throw new TelegramTransportError('UNREACHABLE', 'Доставка в этот чат недоступна.');
      if ([400, 401, 404].includes(response.status)) throw new TelegramTransportError('REJECTED', 'Telegram отклонил сообщение.');
      throw new TelegramTransportError('DELIVERY_UNKNOWN', 'Результат доставки не подтверждён.');
    },
  };
}
