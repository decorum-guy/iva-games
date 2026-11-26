import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { RULES_VERSION } from '@chess-2/overdrive/core'
import { ONLINE_PROTOCOL } from '@chess-2/overdrive/online/protocol'
import type { OnlineServerMessage } from '@chess-2/overdrive/online/protocol'
import { RoomService } from './rooms'
import type { RoomOptions } from './rooms'
import { RoomStore } from './store'
import { clientMessage, createRequest, emptyRequest, identifier, joinRequest, OnlineError } from './validation'

const MAX_BODY = 16_384
const COOKIE = 'overdrive_guest'

interface GatewayOptions extends RoomOptions {
  databasePath: string
  secureCookies: boolean
  validOrigin(request: IncomingMessage): boolean
  clientAddress(request: IncomingMessage): string
  heartbeatMs?: number
}

class RateLimit {
  private readonly entries = new Map<string, { start: number; count: number }>()
  allow(key: string, limit: number, duration = 60_000) {
    const now = Date.now()
    const entry = this.entries.get(key)
    if (!entry || now - entry.start >= duration) {
      if (this.entries.size >= 8192) {
        for (const [id, item] of this.entries) if (now - item.start >= 60_000) this.entries.delete(id)
        if (this.entries.size >= 8192) return false
      }
      this.entries.set(key, { start: now, count: 1 })
      return true
    }
    entry.count++
    return entry.count <= limit
  }
}

function cookie(request: IncomingMessage): string | undefined {
  return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1)
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new OnlineError('invalidMessage', 415)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) throw new OnlineError('invalidMessage', 413)
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new OnlineError('invalidMessage') }
}

/** Mounted beside Remorse; owns a distinct protocol, cookie, database and socket path. */
export function createOverdriveGateway(options: GatewayOptions) {
  const store = new RoomStore(options.databasePath)
  const service = new RoomService(store, options)
  const limits = new RateLimit()
  let closing = false
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY, perMessageDeflate: false })
  const identities = new WeakMap<WebSocket, string>()
  const alive = new WeakSet<WebSocket>()

  function guest(request: IncomingMessage): string {
    const identity = service.authenticate(cookie(request))
    if (!identity) throw new OnlineError('guestRequired', 401)
    return identity
  }

  async function handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== '/api/overdrive' && !pathname.startsWith('/api/overdrive/')) return false
    try {
      if (closing) throw new OnlineError('serverError', 503)
      if (!limits.allow('http/' + options.clientAddress(request), 180)) throw new OnlineError('rateLimited', 429)
      if (pathname === '/api/overdrive/health' && request.method === 'GET') {
        store.health()
        json(response, 200, { ok: true, protocol: ONLINE_PROTOCOL, rulesVersion: RULES_VERSION })
        return true
      }
      if (request.method === 'POST' && !options.validOrigin(request)) throw new OnlineError('notYourSeat', 403)
      if (pathname === '/api/overdrive/guest' && request.method === 'POST') {
        emptyRequest(await body(request))
        const session = service.ensureGuest(cookie(request))
        response.setHeader('Set-Cookie', COOKIE + '=' + session.token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' +
          (options.secureCookies ? '; Secure' : ''))
        json(response, 200, { protocol: ONLINE_PROTOCOL })
        return true
      }
      const identity = guest(request)
      if (pathname === '/api/overdrive/rooms' && request.method === 'POST') {
        if (!limits.allow('create/' + identity, 12)) throw new OnlineError('rateLimited', 429)
        json(response, 201, service.create(identity, createRequest(await body(request))))
        return true
      }
      const match = /^\/api\/overdrive\/rooms\/([a-zA-Z0-9_-]+)(?:\/(join|invite))?$/.exec(pathname)
      if (!match) throw new OnlineError('roomMissing', 404)
      const roomId = identifier(match[1])
      if (!match[2] && request.method === 'GET') json(response, 200, { snapshot: service.snapshot(roomId, identity) })
      else if (match[2] === 'join' && request.method === 'POST') {
        json(response, 200, { snapshot: service.join(roomId, identity, joinRequest(await body(request))) })
      } else if (match[2] === 'invite' && request.method === 'POST') {
        emptyRequest(await body(request))
        json(response, 200, { invite: service.invite(roomId, identity) })
      } else throw new OnlineError('invalidMessage', 405)
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const failure = error instanceof OnlineError ? error : new OnlineError('serverError', 500)
        json(response, failure.status, { error: failure.code })
      }
    }
    return true
  }

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      if (closing || !options.validOrigin(request)) throw new OnlineError('notYourSeat', 403)
      if (sockets.clients.size >= 1000 || !limits.allow('upgrade/' + options.clientAddress(request), 60)) throw new OnlineError('rateLimited', 429)
      const identity = guest(request)
      sockets.handleUpgrade(request, socket, head, ws => {
        identities.set(ws, identity)
        sockets.emit('connection', ws, request)
      })
    } catch (error) {
      const failure = error instanceof OnlineError ? error : new OnlineError('serverError', 500)
      socket.write('HTTP/1.1 ' + failure.status + ' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
    }
  }

  sockets.on('connection', ws => {
    const identity = identities.get(ws)!
    const connectionId = randomUUID()
    let roomId: string | null = null
    const send = (message: OnlineServerMessage) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'slow receiver'); return }
      ws.send(JSON.stringify(message))
    }
    alive.add(ws)
    ws.on('pong', () => alive.add(ws))
    const handshake = setTimeout(() => ws.close(1008, 'hello required'), 5000)
    handshake.unref()
    ws.on('message', (data, binary) => {
      let commandId: string | undefined
      try {
        if (binary) throw new OnlineError('invalidMessage')
        if (!limits.allow('message/' + identity, 60, 10_000)) throw new OnlineError('rateLimited', 429)
        const input = clientMessage(JSON.parse(data.toString()))
        if (input.type === 'hello') {
          if (roomId) throw new OnlineError('invalidMessage')
          const snapshot = service.connect(input.roomId, identity, { id: connectionId, send,
            replace: () => { send({ type: 'replaced' }); ws.close(4001, 'seat replaced') } })
          roomId = input.roomId
          clearTimeout(handshake)
          send({ type: 'welcome', snapshot })
          return
        }
        if (!roomId) throw new OnlineError('notReady')
        if (input.type === 'sync') send({ type: 'welcome', snapshot: service.snapshot(roomId, identity) })
        else {
          commandId = input.commandId
          send(service.execute(roomId, identity, connectionId, input))
        }
      } catch (error) {
        const failure = error instanceof OnlineError ? error : new OnlineError(error instanceof SyntaxError ? 'invalidMessage' : 'serverError', error instanceof SyntaxError ? 400 : 500)
        send({ type: 'error', code: failure.code, ...(commandId ? { commandId } : {}) })
        if (failure.code === 'protocolMismatch' || failure.code === 'replaced') ws.close(4001, failure.code)
      }
    })
    ws.on('error', () => { /* Close cleans up presence without logging private payloads. */ })
    ws.on('close', () => {
      clearTimeout(handshake)
      if (roomId) service.disconnect(roomId, identity, connectionId)
    })
  })

  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue }
      alive.delete(ws)
      ws.ping()
    }
  }, options.heartbeatMs ?? 15_000)
  heartbeat.unref()
  const cleanup = setInterval(() => { try { service.cleanup() } catch { /* Retry the next bounded sweep. */ } }, 60_000)
  cleanup.unref()

  return {
    service, store, handle, upgrade,
    async close() {
      if (closing) return
      closing = true
      clearInterval(heartbeat)
      clearInterval(cleanup)
      for (const ws of sockets.clients) ws.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      service.close()
    },
  }
}
