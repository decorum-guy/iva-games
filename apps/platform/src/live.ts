import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { LiveGameSession } from '@iva-games/session-kit';
import { PlatformService } from './service.js';
import type { HttpOptions } from './http.js';

const PREFIX = '/api/platform/v1/rooms/';
const MAX_BUFFER = 256 * 1024;
const INPUT_RATE = 30;
const INPUT_BURST = 6;
function sessionCookie(request: IncomingMessage, name: string): string | undefined {
  const values = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
function deny(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
function code(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'LIVE_UNAVAILABLE';
}

/** Shared transport only. Sessions and membership remain owned by PlatformService. */
export function attachPlatformLive(server: Server, service: PlatformService, options: HttpOptions): { close(): void } {
  const origin = new URL(options.publicOrigin).origin;
  const hosts = new Set(options.allowedHosts ?? [new URL(origin).host]);
  const origins = new Set(options.allowedOrigins ?? [origin]);
  const secure = options.secureCookies ?? origin.startsWith('https:');
  const cookieName = secure ? '__Host-iva_session' : 'iva_dev_session';
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  const teardowns = new Set<() => void>();
  let stopping = false;
  server.on('upgrade', (request, socket, head) => {
    let lease: LiveGameSession | undefined;
    let release: (() => void) | undefined;
    try {
      if (stopping || request.method !== 'GET') { deny(socket, 503); return; }
      if (request.headers.upgrade?.toLowerCase() !== 'websocket' || request.headers['sec-websocket-version'] !== '13' || typeof request.headers['sec-websocket-key'] !== 'string' || !/^[+/0-9A-Za-z]{22}==$/.test(request.headers['sec-websocket-key'])) { deny(socket, 400); return; }
      if (!request.headers.host || !hosts.has(request.headers.host) || typeof request.headers.origin !== 'string' || !origins.has(request.headers.origin)) { deny(socket, 403); return; }
      if (!request.url?.startsWith(PREFIX) || request.url.startsWith('//')) { deny(socket, 404); return; }
      const url = new URL(request.url, origin);
      const path = url.pathname.match(/^\/api\/platform\/v1\/rooms\/([\w-]+)\/live$/);
      if (!path) { deny(socket, 404); return; }
      const token = sessionCookie(request, cookieName);
      const session = service.getSession(token);
      if (!session?.playerId) { deny(socket, 401); return; }
      service.rateLimit(`live-connect:${session.playerId}`, 40);
      const roomId = path[1], matchId = url.searchParams.get('matchId') ?? '', version = url.searchParams.get('version') ?? '';
      if (matchId.length > 128 || version.length > 64) { deny(socket, 400); return; }
      const actor = session.playerId;
      // Validate before the upgrade; this is also the only place a lease epoch changes.
      lease = service.openLiveSession(actor, roomId, matchId, version);
      const controller = lease;
      let closed = false, timer: ReturnType<typeof setInterval> | undefined;
      const close = (): void => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        teardowns.delete(close);
        controller.close();
      };
      release = close;
      teardowns.add(close);
      // Also releases a lease if ws rejects a later handshake field before its
      // connection callback. Closing an HTTP server alone does not drain WS.
      socket.once('close', close);
      let lastTouch = Date.now();
      const authorizationFailure = (): number | null => {
        const touch = Date.now() - lastTouch >= 30_000;
        if (touch) lastTouch = Date.now();
        if (service.getSession(token, touch)?.playerId !== actor) return 4003;
        if (!controller.isCurrent()) return 4001;
        return service.isLiveMember(actor, roomId, matchId) ? null : 4004;
      };
      wss.handleUpgrade(request, socket, head, ws => {
        const scope = { version, matchId, controllerEpoch: controller.controllerEpoch };
        let pending = 0, finalSnapshotSent = false;
        let inputBudget = INPUT_BURST, inputBudgetAt = performance.now(), commandWindow = 0, commands = 0;
        const send = (frame: unknown, disposable = false): boolean => {
          if (stopping || closed || ws.readyState !== WebSocket.OPEN) return false;
          if (ws.bufferedAmount > MAX_BUFFER * 4) { ws.close(1013, 'Slow connection'); return false; }
          if (disposable && ws.bufferedAmount > MAX_BUFFER) return false;
          ws.send(JSON.stringify(frame));
          return true;
        };
        const snapshot = (): void => {
          if (stopping || closed || ws.readyState !== WebSocket.OPEN) return;
          try {
            const denied = authorizationFailure();
            if (denied) { ws.close(denied, 'Session changed'); return; }
            // Retain permission/epoch checks after the immutable result, without
            // repeatedly constructing and transmitting its recap and journal.
            if (finalSnapshotSent) return;
            const current = controller.snapshot();
            const sent = send({ type: 'snapshot', ...scope, tick: current.tick, view: current.view }, !current.finished);
            if (sent && current.finished) finalSnapshotSent = true;
          } catch (error) {
            send({ type: 'error', ...scope, code: code(error) });
            close(); ws.close(1011, 'Live unavailable');
          }
        };
        ws.once('close', close);
        ws.once('error', close);
        // Queueing keeps the first snapshot ahead of all client commands.
        snapshot();
        if (!closed && !stopping && ws.readyState === WebSocket.OPEN) {
          timer = setInterval(snapshot, 1000 / 15);
          timer.unref();
        }
        ws.on('message', (data, binary) => {
          if (stopping || closed || ws.readyState !== WebSocket.OPEN) return;
          try {
            const denied = authorizationFailure();
            if (denied) { ws.close(denied, 'Session changed'); return; }
          } catch {
            close(); ws.close(1011, 'Session unavailable'); return;
          }
          if (binary) { ws.close(1003, 'JSON required'); return; }
          let frame: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(data.toString());
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('frame');
            frame = parsed as Record<string, unknown>;
          } catch { ws.close(1007, 'Invalid frame'); return; }
          if (frame.version !== version) { send({ type: 'error', ...scope, code: 'INCOMPATIBLE_VERSION' }); return; }
          const now = Date.now();
          try {
            if (frame.type === 'input') {
              const inputNow = performance.now();
              // Network delivery can bunch several ordinary 30 Hz inputs. The
              // runtime coalesces them to one latest input per authoritative tick.
              inputBudget = Math.min(INPUT_BURST, inputBudget + Math.max(0, inputNow - inputBudgetAt) * INPUT_RATE / 1000);
              inputBudgetAt = inputNow;
              if (inputBudget < 1) { send({ type: 'error', ...scope, code: 'INPUT_RATE' }); return; }
              inputBudget--;
              controller.input(frame.payload);
            } else if (frame.type === 'command') {
              if (typeof frame.actionId !== 'string' || !/^[A-Za-z0-9:_-]{8,100}$/.test(frame.actionId)) throw new Error('action');
              if (now - commandWindow >= 1000) { commandWindow = now; commands = 0; }
              if (++commands > 12 || pending >= 8) { send({ type: 'error', ...scope, actionId: frame.actionId, code: 'COMMAND_RATE' }); return; }
              pending++;
              const actionId = frame.actionId;
              void controller.command(actionId, frame.payload).then(
                result => send({ type: 'receipt', ...scope, actionId, result }),
                error => send({ type: 'error', ...scope, actionId, code: code(error) }),
              ).finally(() => { pending--; });
            } else send({ type: 'error', ...scope, code: 'UNKNOWN_FRAME' });
          } catch (error) { send({ type: 'error', ...scope, code: code(error) }); }
        });
      });
    } catch (error) {
      if (release) release(); else lease?.close();
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 403;
      deny(socket, status);
    }
  });
  return { close() {
    if (stopping) return;
    stopping = true;
    let failure: unknown;
    // Clear every timer and release every lease synchronously, before the owner
    // can close PlatformService or runtime databases. WS close events are async.
    for (const release of [...teardowns]) { try { release(); } catch (error) { failure ??= error; } }
    // Every accepted command remains owned by its runtime until its durable receipt.
    for (const socket of wss.clients) { socket.close(1012, 'Server restart'); socket.terminate(); }
    wss.close();
    if (failure) throw failure;
  } };
}
