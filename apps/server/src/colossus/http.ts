import type { IncomingMessage, ServerResponse } from 'node:http';
import { RULES_VERSION } from '@chess-2/colossus/core';
import { ONLINE_PROTOCOL } from '@chess-2/colossus/online/protocol';
import { ColossusRooms } from './rooms';
import type { ServiceOptions } from './rooms';
import { ColossusStore } from './store';
import { ColossusError, commandRequest, createRequest, emptyRequest, identifier, joinRequest, presenceRequest } from './validation';

const COOKIE = 'colossus_guest';
const MAX_BODY = 16_384;
interface GatewayOptions extends ServiceOptions {
  databasePath: string; secureCookies: boolean; validOrigin(request: IncomingMessage): boolean;
  clientAddress(request: IncomingMessage): string;
}
function cookie(request: IncomingMessage) {
  return request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ColossusError('invalidMessage', 415);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length;
    if (size > MAX_BODY) throw new ColossusError('invalidMessage', 413); chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ColossusError('invalidMessage'); }
}
export function createColossusGateway(options: GatewayOptions) {
  const store = new ColossusStore(options.databasePath);
  const service = new ColossusRooms(store, options);
  let closing = false;
  const counts = new Map<string, { at: number; count: number }>();
  const allow = (key: string, maximum: number) => {
    const now = Date.now(); const previous = counts.get(key);
    if (previous && now - previous.at < 60_000) return ++previous.count <= maximum;
    if (counts.size >= 8192) {
      for (const [id, item] of counts) if (now - item.at >= 60_000) counts.delete(id);
      if (counts.size >= 8192) return false;
    }
    counts.set(key, { at: now, count: 1 }); return true;
  };
  const cleanup = setInterval(() => { try { service.cleanup(); } catch { /* Durable state is retained; next sweep retries. */ } }, 5000);
  cleanup.unref();
  return {
    service, store,
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
      if (pathname !== '/api/colossus' && !pathname.startsWith('/api/colossus/')) return false;
      try {
        if (closing) throw new ColossusError('serverError', 503);
        if (!allow('ip/' + options.clientAddress(request), 600)) throw new ColossusError('rateLimited', 429);
        if (pathname === '/api/colossus/health' && request.method === 'GET') {
          store.health(); json(response, 200, { ok: true, protocol: ONLINE_PROTOCOL, rulesVersion: RULES_VERSION }); return true;
        }
        if (request.method === 'POST' && !options.validOrigin(request)) throw new ColossusError('notYourSeat', 403);
        if (pathname === '/api/colossus/guest' && request.method === 'POST') {
          emptyRequest(await body(request), false);
          const session = service.ensureGuest(cookie(request));
          response.setHeader('Set-Cookie', COOKIE + '=' + session.token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' + (options.secureCookies ? '; Secure' : ''));
          json(response, 200, { protocol: ONLINE_PROTOCOL }); return true;
        }
        const guest = service.authenticate(cookie(request)); if (!guest) throw new ColossusError('guestRequired', 401);
        if (!allow('guest/' + guest, 240)) throw new ColossusError('rateLimited', 429);
        if (pathname === '/api/colossus/rooms' && request.method === 'POST') {
          if (!allow('create/' + guest, 12)) throw new ColossusError('rateLimited', 429);
          json(response, 201, service.create(guest, createRequest(await body(request)))); return true;
        }
        const match = /^\/api\/colossus\/rooms\/([a-zA-Z0-9_-]+)(?:\/(join|presence|commands|invite))?$/.exec(pathname);
        if (!match) throw new ColossusError('roomMissing', 404);
        const id = identifier(match[1]);
        if (!match[2] && request.method === 'GET') json(response, 200, { snapshot: service.snapshot(id, guest) });
        else if (match[2] === 'join' && request.method === 'POST') json(response, 200, { snapshot: service.join(id, guest, joinRequest(await body(request))) });
        else if (match[2] === 'presence' && request.method === 'POST') json(response, 200, { snapshot: service.presence(id, guest, presenceRequest(await body(request))) });
        else if (match[2] === 'commands' && request.method === 'POST') json(response, 200, service.execute(id, guest, commandRequest(await body(request))));
        else if (match[2] === 'invite' && request.method === 'POST') { emptyRequest(await body(request)); json(response, 200, { invite: service.invite(id, guest) }); }
        else throw new ColossusError('invalidMessage', 405);
      } catch (error) {
        if (!response.headersSent && !response.destroyed) {
          const failure = error instanceof ColossusError ? error : new ColossusError('serverError', 500);
          json(response, failure.status, { error: failure.code });
        }
      }
      return true;
    },
    async close() { if (closing) return; closing = true; clearInterval(cleanup); service.close(); },
  };
}
