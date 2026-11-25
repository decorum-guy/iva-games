import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../../src/core'
import { ONLINE_HTTP_TIMEOUT_MS, OnlineApiError, OnlineRoomClient, createOnlineRoom, ensureOnlineGuest, fetchOnlineRoom, joinOnlineRoom, refreshOnlineInvite, type OnlineClientEnvironment } from '../../src/online/client'
import { ONLINE_PROTOCOL, type OnlineCommand, type RoomSnapshot } from '../../src/online/protocol'

class MemoryStorage {
  readonly data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}
class FakeSocket {
  readyState = 0
  onopen: ((event: Event) => unknown) | null = null
  onmessage: ((event: MessageEvent) => unknown) | null = null
  onclose: ((event: CloseEvent) => unknown) | null = null
  onerror: ((event: Event) => unknown) | null = null
  readonly sent: string[] = []
  constructor(readonly url: string) {}
  open() { this.readyState = 1; this.onopen?.({} as Event) }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent) }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code } as CloseEvent) }
  send(value: string) { if (this.readyState !== 1) throw new Error('closed'); this.sent.push(value) }
  close() { this.readyState = 3 }
  messages() { return this.sent.map(value => JSON.parse(value)) }
}
function room(roomRevision = 1, gameRevision = 0): RoomSnapshot {
  const state = createInitialState()
  return {
    protocol: ONLINE_PROTOCOL, id: 'room-one', revision: roomRevision, status: 'playing', you: 'white',
    players: { white: { name: 'White', ready: true, connected: true }, black: { name: 'Black', ready: true, connected: true } },
    game: { id: 'game-one', revision: gameRevision, createdAt: 1, updatedAt: 1, root: state, state, actions: [] },
    drawOffer: null, rematchVotes: [], expiresAt: 100000, serverTime: 100,
  }
}
function harness(storage = new MemoryStorage(), overrides: Partial<OnlineClientEnvironment> = {}) {
  const sockets: FakeSocket[] = []
  const callbacks = { onSnapshot: vi.fn(), onTransport: vi.fn(), onError: vi.fn() }
  const client = new OnlineRoomClient('room-one', callbacks, {
    storage, location: 'https://overdrive.test/game?ignored=1', makeId: () => 'command-one', random: () => 0.5,
    heartbeatMs: 15_000, timeoutMs: 8_000,
    createSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket },
    ...overrides,
  })
  return { client, sockets, callbacks, storage }
}
function welcome(socket: FakeSocket, snapshot = room()) { socket.receive({ type: 'welcome', snapshot }) }
function connected() {
  const h = harness()
  h.client.connect(); h.sockets[0].open(); welcome(h.sockets[0])
  return h
}
const move = { type: 'move', mode: 'normal', pieceId: createInitialState().pieces.find(piece => piece.square === 'e2')!.id, to: 'e4' } as const
const ack = { type: 'ack', commandId: 'command-one', gameId: 'game-one', revision: 1 } as const

describe('Overdrive online HTTP transport', () => {
  it('uses same-origin cookie requests, relative endpoints, and the supplied creation id', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json({ snapshot: room(), invite: 'invite-one' }))
      .mockResolvedValueOnce(Response.json({ snapshot: room() }))
      .mockResolvedValueOnce(Response.json({ snapshot: room() }))
      .mockResolvedValueOnce(Response.json({ invite: 'invite-two' }))
    await ensureOnlineGuest(fetcher)
    expect((await createOnlineRoom({ name: 'Player', side: 'random', requestId: 'create-once' }, fetcher)).invite).toBe('invite-one')
    await joinOnlineRoom('room/a', { name: 'Second', invite: 'invite-one' }, fetcher)
    await fetchOnlineRoom('room/a', fetcher)
    await refreshOnlineInvite('room/a', fetcher)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/overdrive/guest', '/api/overdrive/rooms', '/api/overdrive/rooms/room%2Fa/join', '/api/overdrive/rooms/room%2Fa', '/api/overdrive/rooms/room%2Fa/invite'])
    expect(fetcher.mock.calls.every(call => call[1]?.credentials === 'same-origin' && call[1]?.cache === 'no-store')).toBe(true)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ name: 'Player', side: 'random', requestId: 'create-once' })
  })
  it('exposes structured server errors and rejects malformed successful responses', async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'inviteInvalid' }, { status: 403 }))
    await expect(joinOnlineRoom('one', { invite: 'bad', name: 'Player' }, denied)).rejects.toMatchObject({ code: 'inviteInvalid', status: 403 })
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ snapshot: {} }))
    await expect(fetchOnlineRoom('one', invalid)).rejects.toBeInstanceOf(OnlineApiError)
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))
    await expect(ensureOnlineGuest(offline)).rejects.toMatchObject({ code: 'serverError' })
  })
  it('accepts an idempotent creation retry after the returned room no longer needs an invite', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ snapshot: room(), invite: '' }))
    await expect(createOnlineRoom({ name: 'Player', side: 'white', requestId: 'same-request' }, fetcher)).resolves.toMatchObject({ invite: '', snapshot: { id: 'room-one' } })
  })
  it('aborts a lost HTTP response after the deadline and also accepts caller cancellation', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }))
      const attempt = expect(ensureOnlineGuest(fetcher)).rejects.toMatchObject({ code: 'serverError' })
      await vi.advanceTimersByTimeAsync(ONLINE_HTTP_TIMEOUT_MS)
      await attempt
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
      const abort = new AbortController()
      const cancelled = expect(ensureOnlineGuest(fetcher, abort.signal)).rejects.toMatchObject({ code: 'serverError' })
      abort.abort()
      await cancelled
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})

describe('Overdrive online room synchronization', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('requires a server snapshot before a command and permits only one pending command', () => {
    const { client, sockets } = harness()
    expect(client.send(move)).toBeNull()
    client.connect()
    expect(sockets[0].url).toBe('wss://overdrive.test/overdrive-online')
    sockets[0].open()
    expect(sockets[0].messages()).toEqual([{ type: 'hello', protocol: ONLINE_PROTOCOL, roomId: 'room-one' }])
    expect(client.send(move)).toBeNull()
    welcome(sockets[0])
    expect(client.send(move)).toBe('command-one')
    expect(client.send(move)).toBeNull()
    expect(client.getState()).toMatchObject({ status: 'connected', pending: true })
    sockets[0].receive({ type: 'update', snapshot: room(2, 1) })
    sockets[0].receive(ack)
    expect(client.getState()).toMatchObject({ status: 'connected', pending: false })
    client.destroy()
  })

  it('reconnects after a lost ACK and replays the identical id, revision, game and copied command', () => {
    const { client, sockets, callbacks, storage } = connected()
    const input: OnlineCommand = { type: 'move', mode: 'normal', pieceId: createInitialState().pieces.find(piece => piece.square === 'e2')!.id, to: 'e4' }
    client.send(input)
    const original = sockets[0].sent[1]
    Object.assign(input, { to: 'e3' })
    sockets[0].receive({ type: 'update', snapshot: room(2, 1) })
    sockets[0].drop()
    expect(client.send(move)).toBeNull()
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    expect(sockets[1].sent).toHaveLength(1)
    welcome(sockets[1], room(3, 1))
    expect(sockets[1].sent[1]).toBe(original)
    expect(callbacks.onSnapshot.mock.calls.at(-1)?.[1]).toBe('welcome')
    sockets[1].receive(ack)
    expect(storage.data.size).toBe(0)
    expect(client.getState().pending).toBe(false)
    client.destroy()
  })

  it('restores a pending envelope across reload without sending before welcome', () => {
    const first = connected()
    first.client.send(move)
    const original = first.sockets[0].sent[1]
    first.client.destroy()
    const second = harness(first.storage)
    expect(second.client.getState().pending).toBe(true)
    second.client.connect(); second.sockets[0].open()
    expect(second.sockets[0].sent).toHaveLength(1)
    welcome(second.sockets[0], room(2, 1))
    expect(second.sockets[0].sent[1]).toBe(original)
    second.sockets[0].receive(ack)
    expect(second.client.getState().pending).toBe(false)
    second.client.destroy()
  })

  it('syncs on a lost ACK before idempotent replay and does not rewrite expectedRevision', () => {
    const { client, sockets } = connected()
    client.send(move)
    const original = sockets[0].sent[1]
    sockets[0].receive({ type: 'update', snapshot: room(2, 1) })
    vi.advanceTimersByTime(8_000)
    expect(sockets[0].messages().at(-1)).toEqual({ type: 'sync' })
    expect(client.getState().status).toBe('syncing')
    welcome(sockets[0], room(2, 1))
    expect(sockets[0].sent.at(-1)).toBe(original)
    sockets[0].receive(ack)
    expect(client.getState().pending).toBe(false)
    client.destroy()
  })

  it('does not replay if a delayed ACK arrives while the full synchronization is pending', () => {
    const { client, sockets } = connected()
    client.send(move)
    sockets[0].receive({ type: 'update', snapshot: room(2, 1) })
    vi.advanceTimersByTime(8_000)
    sockets[0].receive(ack)
    expect(client.getState()).toMatchObject({ pending: false, status: 'syncing' })
    welcome(sockets[0], room(2, 1))
    expect(sockets[0].messages().filter(value => value.type === 'command')).toHaveLength(1)
    client.destroy()
  })

  it('refreshes after staleRevision, clears the rejected command, and gates commands until synced', () => {
    const { client, sockets, storage, callbacks } = connected()
    client.send(move)
    sockets[0].receive({ type: 'error', code: 'staleRevision', commandId: 'command-one' })
    expect(storage.data.size).toBe(0)
    expect(client.getState()).toMatchObject({ status: 'syncing', pending: false })
    expect(client.send(move)).toBeNull()
    expect(callbacks.onError).toHaveBeenCalledWith('staleRevision', 'command-one')
    welcome(sockets[0], room(2, 1))
    expect(client.getState().status).toBe('connected')
    expect(sockets[0].messages().filter(value => value.type === 'command')).toHaveLength(1)
    client.destroy()
  })

  it('waits for a newer full snapshot if an ACK overtakes its update', () => {
    const { client, sockets } = connected()
    client.send(move)
    sockets[0].receive(ack)
    expect(client.getState()).toMatchObject({ status: 'syncing', pending: false })
    expect(client.send(move)).toBeNull()
    welcome(sockets[0], room())
    expect(client.getState().status).toBe('syncing')
    welcome(sockets[0], room(2, 1))
    expect(client.getState().status).toBe('connected')
    client.destroy()
  })

  it('labels heartbeat snapshots live, so they do not reset a running effects queue', () => {
    const { client, sockets, callbacks } = connected()
    expect(callbacks.onSnapshot.mock.calls[0][1]).toBe('welcome')
    vi.advanceTimersByTime(15_000)
    expect(sockets[0].messages().at(-1)).toEqual({ type: 'sync' })
    welcome(sockets[0])
    expect(callbacks.onSnapshot.mock.calls[1][1]).toBe('live')
    expect(client.getState().status).toBe('connected')
    client.destroy()
  })

  it('reconnects a silent socket using bounded exponential delays with jitter', () => {
    const { client, sockets } = connected()
    vi.advanceTimersByTime(23_000)
    expect(client.getState().status).toBe('reconnecting')
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    sockets[1].drop()
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)
    expect(client.getState().attempt).toBe(2)
    client.destroy()
  })

  it.each(['message', 'close'] as const)('stops automatic retries after seat takeover but allows an explicit reconnect (%s)', kind => {
    const { client, sockets } = connected()
    if (kind === 'message') sockets[0].receive({ type: 'replaced' })
    else sockets[0].drop(4001)
    expect(client.getState().status).toBe('replaced')
    vi.advanceTimersByTime(120_000)
    expect(sockets).toHaveLength(1)
    expect(client.send(move)).toBeNull()
    client.connect()
    expect(sockets).toHaveLength(2)
    sockets[1].open(); welcome(sockets[1], room(2))
    expect(client.getState().status).toBe('connected')
    client.destroy()
  })

  it('ignores stale snapshots and rejects a snapshot for another room', () => {
    const { client, sockets, callbacks } = connected()
    sockets[0].receive({ type: 'update', snapshot: room(3, 2) })
    sockets[0].receive({ type: 'update', snapshot: room(2, 1) })
    expect(callbacks.onSnapshot).toHaveBeenCalledTimes(2)
    sockets[0].receive({ type: 'welcome', snapshot: { ...room(4, 2), id: 'other-room' } })
    expect(client.getState()).toMatchObject({ status: 'error', error: 'invalidMessage' })
    client.destroy()
  })

  it('cancels all timers and stale event handlers on destroy, while preserving pending intent', () => {
    const { client, sockets, callbacks, storage } = connected()
    client.send(move)
    const oldHandler = sockets[0].onmessage
    const count = callbacks.onSnapshot.mock.calls.length
    client.destroy()
    oldHandler?.({ data: JSON.stringify({ type: 'welcome', snapshot: room(2, 1) }) } as MessageEvent)
    vi.advanceTimersByTime(120_000)
    expect(sockets).toHaveLength(1)
    expect(callbacks.onSnapshot).toHaveBeenCalledTimes(count)
    expect(storage.data.size).toBe(1)
  })

  it('drops corrupt stored commands and reports invalid server messages without throwing', () => {
    const storage = new MemoryStorage()
    storage.setItem('overdrive:online:pending:v1:room-one', JSON.stringify({ type: 'command', commandId: 'bad', gameId: 'game-one', expectedRevision: 0, command: { type: 'agreeDraw' } }))
    const { client, sockets } = harness(storage)
    expect(client.getState().pending).toBe(false)
    client.connect(); sockets[0].open()
    expect(() => sockets[0].receive({ type: 'welcome', snapshot: {} })).not.toThrow()
    expect(client.getState()).toMatchObject({ status: 'error', error: 'invalidMessage' })
    client.destroy()
  })
})
