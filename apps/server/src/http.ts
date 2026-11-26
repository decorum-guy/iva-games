import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { createClientAddressReader } from '@iva-games/session-kit/http'
import { RULES_VERSION } from '@chess-2/remorse/core'
import { ONLINE_PROTOCOL } from '@chess-2/remorse/online/protocol'
import type { OnlineServerMessage } from '@chess-2/remorse/online/protocol'
import { RoomService } from './rooms'
import type { RoomOptions } from './rooms'
import { RoomStore } from './store'
import { clientMessage, createRequest, emptyRequest, identifier, joinRequest, OnlineError } from './validation'
import { createOverdriveGateway } from './overdrive/http'
import { createColossusGateway } from './colossus/http'

const MAX_BODY = 16_384
const COOKIE = 'remorse_guest'

export interface OnlineServerOptions extends RoomOptions {
  databasePath: string
  staticDir?: string
  publicOrigin?: string
  allowedOrigins?: readonly string[]
  secureCookies?: boolean
  trustedProxyIps?: readonly string[]
  heartbeatMs?: number
  overdriveDatabasePath?: string
  colossusDatabasePath?: string
  colossusPresenceTimeoutMs?: number
}

class RateLimit {
  private readonly entries = new Map<string, { start: number; count: number }>()
  allow(key: string, limit: number, duration = 60_000) {
    const now = Date.now()
    const entry = this.entries.get(key)
    if (!entry || now - entry.start >= duration) {
      if (this.entries.size >= 8192) {
        for (const [id, item] of this.entries) if (now - item.start >= duration) this.entries.delete(id)
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

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(body))
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

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
}

export function createOnlineServer(options: OnlineServerOptions) {
  const store = new RoomStore(options.databasePath)
  const service = new RoomService(store, options)
  const limits = new RateLimit()
  const clientAddress = createClientAddressReader(options.trustedProxyIps)
  const origin = options.publicOrigin ? new URL(options.publicOrigin).origin : null
  const allowed = new Set([...(origin ? [origin] : []), ...(options.allowedOrigins ?? []).map(value => new URL(value).origin)])
  const secure = options.secureCookies ?? origin?.startsWith('https:') ?? false
  const root = options.staticDir ? resolve(options.staticDir) : null
  let closing = false

  function validOrigin(request: IncomingMessage): boolean {
    const supplied = request.headers.origin
    if (!supplied || supplied === 'null') return false
    if (allowed.size > 0) return allowed.has(supplied)
    return supplied === 'http://' + request.headers.host
  }
  function guest(request: IncomingMessage): string {
    const value = service.authenticate(cookie(request))
    if (!value) throw new OnlineError('guestRequired', 401)
    return value
  }

  const overdrive = createOverdriveGateway({
    databasePath: options.overdriveDatabasePath ?? (options.databasePath === ':memory:' ? ':memory:' : options.databasePath + '.overdrive.sqlite'),
    secureCookies: secure, validOrigin, clientAddress, heartbeatMs: options.heartbeatMs,
    now: options.now, inactiveMs: options.inactiveMs, finishedMs: options.finishedMs,
  })
  const colossus = createColossusGateway({
    databasePath: options.colossusDatabasePath ?? (options.databasePath === ':memory:' ? ':memory:' : options.databasePath + '.colossus.sqlite'),
    secureCookies: secure, validOrigin, clientAddress, now: options.now, inactiveMs: options.inactiveMs, finishedMs: options.finishedMs,
    presenceTimeoutMs: options.colossusPresenceTimeoutMs,
  })

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'DENY')
    try {
      if (closing) throw new OnlineError('serverError', 503)
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (await overdrive.handle(request, response, pathname)) return
      if (await colossus.handle(request, response, pathname)) return
      if (pathname === '/api/health' && request.method === 'GET') {
        store.health()
        json(response, 200, { ok: true, protocol: ONLINE_PROTOCOL, rulesVersion: RULES_VERSION })
        return
      }
      if (pathname.startsWith('/api/')) {
        const address = clientAddress(request)
        if (!limits.allow('http/' + address, 180)) throw new OnlineError('rateLimited', 429)
        if (request.method === 'POST' && !validOrigin(request)) throw new OnlineError('notYourSeat', 403)
        if (pathname === '/api/guest' && request.method === 'POST') {
          emptyRequest(await body(request))
          const session = service.ensureGuest(cookie(request))
          response.setHeader('Set-Cookie', COOKIE + '=' + session.token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' + (secure ? '; Secure' : ''))
          json(response, 200, { protocol: ONLINE_PROTOCOL })
          return
        }
        const identity = guest(request)
        if (pathname === '/api/rooms' && request.method === 'POST') {
          if (!limits.allow('create/' + identity, 12)) throw new OnlineError('rateLimited', 429)
          const created = service.create(identity, createRequest(await body(request)))
          json(response, 201, created)
          return
        }
        const match = /^\/api\/rooms\/([a-zA-Z0-9_-]+)(?:\/(join|invite))?$/.exec(pathname)
        if (!match) throw new OnlineError('roomMissing', 404)
        const roomId = identifier(match[1])
        if (!match[2] && request.method === 'GET') {
          json(response, 200, { snapshot: service.snapshot(roomId, identity) })
          return
        }
        if (match[2] === 'join' && request.method === 'POST') {
          json(response, 200, { snapshot: service.join(roomId, identity, joinRequest(await body(request))) })
          return
        }
        if (match[2] === 'invite' && request.method === 'POST') {
          emptyRequest(await body(request))
          json(response, 200, { invite: service.invite(roomId, identity) })
          return
        }
        throw new OnlineError('invalidMessage', 405)
      }
      if (!root || (request.method !== 'GET' && request.method !== 'HEAD')) {
        json(response, 404, { error: 'roomMissing' })
        return
      }
      const decoded = decodeURIComponent(pathname)
      if (decoded.includes('\0')) throw new OnlineError('invalidMessage')
      let file = resolve(root, '.' + decoded)
      if (file !== root && !file.startsWith(root + sep)) throw new OnlineError('notYourSeat', 403)
      let info = await stat(file).catch(() => null)
      if (!info?.isFile()) {
        if (extname(decoded) || decoded.startsWith('/assets/') || decoded.startsWith('/colossus/assets/')) { json(response, 404, { error: 'roomMissing' }); return }
        const overdriveRoute = decoded === '/overdrive' || decoded.startsWith('/overdrive/')
        const colossusRoute = decoded === '/colossus' || decoded.startsWith('/colossus/')
        file = resolve(root, colossusRoute ? 'colossus/index.html' : overdriveRoute ? 'overdrive/index.html' : 'index.html')
        info = await stat(file).catch(() => null)
        // A separately built game has its entry at the static root. The combined
        // build retains the dedicated game entries, which take precedence.
        if ((overdriveRoute || colossusRoute) && !info?.isFile()) {
          file = resolve(root, 'index.html')
          info = await stat(file).catch(() => null)
        }
      }
      if (!info?.isFile()) { json(response, 503, { error: 'serverError' }); return }
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
      if (request.method === 'HEAD') response.end()
      else createReadStream(file).on('error', () => response.destroy()).pipe(response)
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const failure = error instanceof OnlineError ? error : new OnlineError('serverError', 500)
        json(response, failure.status, { error: failure.code })
      }
    }
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY, perMessageDeflate: false })
  const identities = new WeakMap<WebSocket, string>()
  const alive = new WeakSet<WebSocket>()
  server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname === '/overdrive-online') {
      overdrive.upgrade(request, socket, head)
      return
    }
    try {
      if (closing || new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws' || !validOrigin(request)) {
        throw new OnlineError('notYourSeat', 403)
      }
      if (sockets.clients.size >= 1000 || !limits.allow('upgrade/' + clientAddress(request), 60)) throw new OnlineError('rateLimited', 429)
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
  })

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
        const failure = error instanceof OnlineError ? error : new OnlineError(error instanceof SyntaxError ? 'invalidMessage' : 'serverError', 500)
        send({ type: 'error', code: failure.code, ...(commandId ? { commandId } : {}) })
        if (failure.code === 'protocolMismatch' || failure.code === 'replaced') ws.close(4001, failure.code)
      }
    })
    ws.on('error', () => { /* close performs the seat cleanup; no sensitive payloads are logged. */ })
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
  const cleanup = setInterval(() => { try { service.cleanup() } catch { /* Retry on the next bounded sweep. */ } }, 60_000)
  cleanup.unref()

  return {
    server, service, store, overdrive, colossus,
    async listen(port = 4173, host = '127.0.0.1') {
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => { server.off('error', reject); resolveListen() })
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing HTTP listener')
      return { host, port: address.port }
    },
    async close() {
      if (closing) return
      closing = true
      clearInterval(heartbeat)
      clearInterval(cleanup)
      for (const ws of sockets.clients) ws.terminate()
      await new Promise<void>(resolveClose => sockets.close(() => resolveClose()))
      await overdrive.close()
      await colossus.close()
      if (server.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
      service.close()
    },
  }
}
