import {
  ONLINE_PROTOCOL,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type InviteResponse,
  type JoinRoomRequest,
  type OnlineAction,
  type OnlineCommand,
  type OnlineCommandEnvelope,
  type OnlineErrorCode,
  type OnlineServerMessage,
  type RoomResponse,
  type RoomSnapshot,
} from './protocol'
import { newId } from '../session/random'

export type OnlineTransportStatus = 'idle' | 'connecting' | 'syncing' | 'connected' | 'reconnecting' | 'replaced' | 'error' | 'closed'
export type OnlineSnapshotKind = 'welcome' | 'live'
export interface OnlineTransportState {
  readonly status: OnlineTransportStatus
  readonly pending: boolean
  readonly attempt: number
  readonly error?: OnlineErrorCode
}
export interface OnlineRoomCallbacks {
  onSnapshot(snapshot: RoomSnapshot, kind: OnlineSnapshotKind, action?: OnlineAction): void
  onTransport(state: OnlineTransportState): void
  onError?(code: OnlineErrorCode, commandId?: string): void
}

type OnlineSocket = Pick<WebSocket, 'readyState' | 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>
type Timer = ReturnType<typeof setTimeout>
type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface OnlineClientEnvironment {
  createSocket(url: string): OnlineSocket
  storage: PendingStorage | null
  location: string
  makeId(): string
  random(): number
  setTimer(callback: () => void, ms: number): Timer
  clearTimer(timer: Timer): void
  heartbeatMs: number
  timeoutMs: number
}
export class OnlineApiError extends Error {
  constructor(readonly code: OnlineErrorCode, readonly status = 0) {
    super(code)
    this.name = 'OnlineApiError'
  }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const side = (value: unknown) => value === 'white' || value === 'black'
function roomSnapshot(value: unknown): value is RoomSnapshot {
  if (!object(value) || value.protocol !== ONLINE_PROTOCOL || !text(value.id) || !integer(value.revision) || !side(value.you) ||
    !['waiting', 'playing', 'finished', 'expired'].includes(String(value.status)) || !object(value.players) || !object(value.game)) return false
  const game = value.game
  return text(game.id) && integer(game.revision) && object(game.root) && object(game.state) && Array.isArray(game.actions) &&
    Array.isArray(value.rematchVotes) && typeof value.expiresAt === 'number' && typeof value.serverTime === 'number'
}
function serverMessage(value: unknown): value is OnlineServerMessage {
  if (!object(value)) return false
  if (value.type === 'welcome' || value.type === 'update') return roomSnapshot(value.snapshot)
  if (value.type === 'ack') return text(value.commandId) && text(value.gameId) && integer(value.revision)
  if (value.type === 'error') return text(value.code) && (value.commandId === undefined || text(value.commandId))
  return value.type === 'replaced'
}
function command(value: unknown): value is OnlineCommand {
  if (!object(value)) return false
  switch (value.type) {
    case 'move': return /^[a-h][1-8]$/.test(String(value.from)) && /^[a-h][1-8]$/.test(String(value.to)) &&
      (value.promotion === undefined || ['queen', 'rook', 'bishop', 'knight'].includes(String(value.promotion)))
    case 'ready': return typeof value.ready === 'boolean'
    case 'answerDraw': return text(value.offerId) && typeof value.accept === 'boolean'
    case 'rematch': return typeof value.accept === 'boolean'
    case 'endTurn': case 'resign': case 'claimRepetitionDraw': case 'offerDraw': return true
    default: return false
  }
}
function envelope(value: unknown): value is OnlineCommandEnvelope {
  return object(value) && value.type === 'command' && text(value.commandId) && text(value.gameId) && integer(value.expectedRevision) && command(value.command)
}

type Fetcher = typeof fetch
export const ONLINE_HTTP_TIMEOUT_MS = 10_000
async function request(path: string, body: unknown | undefined, fetcher: Fetcher, signal?: AbortSignal): Promise<unknown> {
  const abort = new AbortController()
  const cancel = () => abort.abort()
  const timeout = setTimeout(cancel, ONLINE_HTTP_TIMEOUT_MS)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    const response = await fetcher(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      signal: abort.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let result: unknown
    try { result = await response.json() } catch { throw new OnlineApiError(abort.signal.aborted ? 'serverError' : 'invalidMessage', response.status) }
    if (!response.ok) throw new OnlineApiError(object(result) && text(result.error) ? result.error as OnlineErrorCode : 'serverError', response.status)
    return result
  } catch (error) {
    throw error instanceof OnlineApiError ? error : new OnlineApiError('serverError')
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}
function responseRoom(value: unknown): RoomResponse {
  if (!object(value) || !roomSnapshot(value.snapshot)) throw new OnlineApiError('invalidMessage')
  return { snapshot: value.snapshot }
}
export async function ensureOnlineGuest(fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<void> {
  await request('/api/guest', {}, fetcher, signal)
}
export async function createOnlineRoom(input: CreateRoomRequest, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<CreateRoomResponse> {
  const result = await request('/api/rooms', input, fetcher, signal)
  const room = responseRoom(result)
  // Retrying an already joined/finished room returns its snapshot with no new invitation.
  if (!object(result) || typeof result.invite !== 'string' || result.invite.length > 256) throw new OnlineApiError('invalidMessage')
  return { ...room, invite: result.invite }
}
export async function joinOnlineRoom(roomId: string, input: JoinRoomRequest, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<RoomResponse> {
  return responseRoom(await request(`/api/rooms/${encodeURIComponent(roomId)}/join`, input, fetcher, signal))
}
export async function fetchOnlineRoom(roomId: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<RoomResponse> {
  return responseRoom(await request(`/api/rooms/${encodeURIComponent(roomId)}`, undefined, fetcher, signal))
}
export async function refreshOnlineInvite(roomId: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<InviteResponse> {
  const result = await request(`/api/rooms/${encodeURIComponent(roomId)}/invite`, {}, fetcher, signal)
  if (!object(result) || !text(result.invite)) throw new OnlineApiError('invalidMessage')
  return { invite: result.invite }
}

function browserEnvironment(): OnlineClientEnvironment {
  let storage: PendingStorage | null = null
  try { storage = globalThis.sessionStorage ?? null } catch { /* Memory still preserves an in-session reconnect. */ }
  return {
    createSocket: url => new WebSocket(url), storage,
    location: typeof location === 'undefined' ? 'http://localhost/' : location.href,
    makeId: newId, random: Math.random,
    setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: timer => clearTimeout(timer),
    heartbeatMs: 15_000, timeoutMs: 8_000,
  }
}

const FATAL = new Set<OnlineErrorCode>(['guestRequired', 'roomMissing', 'roomExpired', 'notYourSeat', 'protocolMismatch', 'invalidMessage'])

/** Server snapshots are authoritative; this transport never predicts moves or rolls. */
export class OnlineRoomClient {
  private readonly env: OnlineClientEnvironment
  private readonly storageKey: string
  private socket: OnlineSocket | null = null
  private snapshot: RoomSnapshot | null = null
  private state: OnlineTransportState = { status: 'idle', pending: false, attempt: 0 }
  private pending: OnlineCommandEnvelope | null = null
  private stopped = true
  private destroyed = false
  private greeted = false
  private synchronized = false
  private replayPending = false
  private acknowledged: { gameId: string; revision: number } | null = null
  private reconnectTimer: Timer | null = null
  private heartbeatTimer: Timer | null = null
  private responseTimer: Timer | null = null
  private commandTimer: Timer | null = null

  constructor(readonly roomId: string, private readonly callbacks: OnlineRoomCallbacks, env: Partial<OnlineClientEnvironment> = {}) {
    this.env = { ...browserEnvironment(), ...env }
    this.storageKey = `remorse:online:pending:v1:${roomId}`
    try {
      const saved: unknown = JSON.parse(this.env.storage?.getItem(this.storageKey) ?? 'null')
      if (envelope(saved)) this.pending = saved
      else this.env.storage?.removeItem(this.storageKey)
    } catch { /* A corrupt/blocked session store must not prevent joining a room. */ }
    this.state = { ...this.state, pending: this.pending !== null }
  }

  getState(): OnlineTransportState { return this.state }

  connect(): void {
    if (this.destroyed || !this.stopped) return
    // Only an explicit user reconnect may take a seat back after replacement.
    this.state = { ...this.state, attempt: 0 }
    this.stopped = false
    this.open()
  }

  send(value: OnlineCommand): string | null {
    if (this.destroyed || this.stopped || !this.synchronized || this.state.status !== 'connected' || !this.snapshot || this.pending || !command(value)) return null
    // Copy once: mutating a caller's object cannot change a retransmitted command.
    this.pending = JSON.parse(JSON.stringify({
      type: 'command', commandId: this.env.makeId(), gameId: this.snapshot.game.id,
      expectedRevision: this.snapshot.game.revision, command: value,
    })) as OnlineCommandEnvelope
    this.persist()
    this.emit(this.state.status)
    const id = this.pending.commandId
    this.transmitPending()
    return id
  }

  sync(): void {
    if (this.destroyed || this.stopped || this.socket?.readyState !== 1) return
    this.synchronized = false
    this.emit('syncing')
    this.clearTimer('heartbeatTimer')
    this.watchResponse()
    this.write({ type: 'sync' })
  }

  disconnect(): void {
    if (this.destroyed) return
    this.stop('closed')
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop('closed')
  }

  private emit(status: OnlineTransportStatus, error?: OnlineErrorCode): void {
    this.state = { status, pending: this.pending !== null, attempt: this.state.attempt, ...(error ? { error } : {}) }
    if (!this.destroyed) this.callbacks.onTransport(this.state)
  }

  private persist(): void {
    try {
      if (this.pending) this.env.storage?.setItem(this.storageKey, JSON.stringify(this.pending))
      else this.env.storage?.removeItem(this.storageKey)
    } catch { /* Retain the exact envelope in memory even if browser storage is unavailable. */ }
  }

  private open(): void {
    if (this.stopped || this.destroyed) return
    this.greeted = false
    this.synchronized = false
    this.replayPending = this.pending !== null
    this.emit(this.state.attempt ? 'reconnecting' : 'connecting')
    let socket: OnlineSocket
    try {
      const url = new URL('/ws', this.env.location)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = this.env.createSocket(url.href)
    } catch { this.lost(); return }
    this.socket = socket
    this.watchResponse()
    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return
      this.emit('syncing')
      this.watchResponse()
      this.write({ type: 'hello', protocol: ONLINE_PROTOCOL, roomId: this.roomId })
    }
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return
      let message: unknown
      try { message = JSON.parse(String(event.data)) } catch { this.fail('invalidMessage'); return }
      if (!serverMessage(message)) { this.fail('invalidMessage'); return }
      this.receive(message)
    }
    socket.onclose = event => {
      if (this.socket !== socket || this.stopped) return
      if (event.code === 4001) this.stop('replaced', 'replaced')
      else this.lost()
    }
    socket.onerror = () => { if (this.socket === socket && !this.stopped) this.lost() }
  }

  private receive(message: OnlineServerMessage): void {
    if (message.type === 'replaced') { this.stop('replaced', 'replaced'); return }
    if (message.type === 'error') {
      if (message.code === 'replaced') { this.stop('replaced', 'replaced'); return }
      if (FATAL.has(message.code)) { this.fail(message.code); return }
      if (message.commandId === this.pending?.commandId) {
        this.pending = null
        this.persist()
        this.clearTimer('commandTimer')
        this.callbacks.onError?.(message.code, message.commandId)
        this.sync()
      } else {
        this.callbacks.onError?.(message.code, message.commandId)
        if (!message.commandId) this.lost()
      }
      return
    }
    if (message.type === 'ack') {
      if (message.commandId !== this.pending?.commandId || message.gameId !== this.pending.gameId) return
      this.pending = null
      this.persist()
      this.clearTimer('commandTimer')
      this.replayPending = false
      if (this.snapshot?.game.id !== message.gameId || this.snapshot.game.revision < message.revision) {
        this.acknowledged = { gameId: message.gameId, revision: message.revision }
        this.sync()
      }
      else this.emit(this.synchronized ? 'connected' : 'syncing')
      return
    }
    const next = message.snapshot
    if (next.id !== this.roomId) { this.fail('invalidMessage'); return }
    if (this.snapshot && (next.revision < this.snapshot.revision ||
      (next.game.id === this.snapshot.game.id && next.game.revision < this.snapshot.game.revision))) return
    if (this.acknowledged?.gameId === next.game.id && next.game.revision < this.acknowledged.revision) return
    this.acknowledged = null
    const kind: OnlineSnapshotKind = this.greeted ? 'live' : 'welcome'
    this.greeted = true
    this.snapshot = next
    this.synchronized = true
    this.state = { ...this.state, attempt: 0 }
    this.clearTimer('responseTimer')
    this.emit('connected')
    this.callbacks.onSnapshot(next, kind, message.type === 'update' ? message.action : undefined)
    if (this.destroyed || this.stopped) return
    this.scheduleHeartbeat()
    if (this.replayPending && this.pending) {
      this.replayPending = false
      this.transmitPending()
    }
  }

  private transmitPending(): void {
    if (!this.pending || !this.synchronized || this.stopped) return
    this.clearTimer('commandTimer')
    this.commandTimer = this.env.setTimer(() => {
      this.commandTimer = null
      if (!this.pending || this.stopped) return
      // A snapshot settles the uncertainty; replay keeps the original id and payload.
      this.replayPending = true
      this.sync()
    }, this.env.timeoutMs)
    this.write(this.pending)
  }

  private write(value: unknown): void {
    if (this.socket?.readyState !== 1) { this.lost(); return }
    try { this.socket.send(JSON.stringify(value)) } catch { this.lost() }
  }

  private scheduleHeartbeat(): void {
    this.clearTimer('heartbeatTimer')
    this.heartbeatTimer = this.env.setTimer(() => {
      this.heartbeatTimer = null
      this.sync()
    }, this.env.heartbeatMs)
  }

  private watchResponse(): void {
    this.clearTimer('responseTimer')
    this.responseTimer = this.env.setTimer(() => {
      this.responseTimer = null
      this.lost()
    }, this.env.timeoutMs)
  }

  private detachSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try { socket.close(1000, 'client disconnect') } catch { /* Already closed. */ }
  }

  private lost(): void {
    if (this.stopped || this.destroyed || this.reconnectTimer !== null) return
    this.synchronized = false
    this.clearTimer('responseTimer')
    this.clearTimer('commandTimer')
    this.clearTimer('heartbeatTimer')
    this.detachSocket()
    const attempt = this.state.attempt + 1
    this.state = { ...this.state, attempt }
    this.emit('reconnecting')
    const delay = Math.min(15_000, 500 * 2 ** Math.min(8, attempt - 1)) * (0.8 + 0.4 * this.env.random())
    this.reconnectTimer = this.env.setTimer(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }

  private fail(code: OnlineErrorCode): void {
    this.callbacks.onError?.(code)
    this.stop('error', code)
  }

  private stop(status: 'closed' | 'replaced' | 'error', error?: OnlineErrorCode): void {
    this.stopped = true
    this.synchronized = false
    for (const name of ['heartbeatTimer', 'responseTimer', 'commandTimer', 'reconnectTimer'] as const) this.clearTimer(name)
    this.detachSocket()
    this.emit(status, error)
  }

  private clearTimer(name: 'heartbeatTimer' | 'responseTimer' | 'commandTimer' | 'reconnectTimer'): void {
    const timer = this[name]
    if (timer !== null) this.env.clearTimer(timer)
    this[name] = null
  }
}
