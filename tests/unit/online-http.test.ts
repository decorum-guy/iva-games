import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pieceAt } from '../../src/core'
import type { Move, Side } from '../../src/core'
import { ONLINE_PROTOCOL } from '../../src/online/protocol'
import type { CreateRoomResponse, OnlineCommand, OnlineCommandEnvelope, OnlineServerMessage, RoomSnapshot } from '../../src/online/protocol'
import { createOnlineServer } from '../../server/http'

const PORT = Number(process.env.ONLINE_TEST_PORT ?? 42911)
const origin = 'http://127.0.0.1:' + PORT
const move = (from: string, to: string): Move => ({ type: 'move', from, to })
let directory: string
let app: ReturnType<typeof createOnlineServer>
const peers: Peer[] = []

class Peer {
  readonly messages: OnlineServerMessage[] = []
  readonly ws: WebSocket
  private waiters = new Set<() => void>()
  constructor(readonly cookie: string, autoPong = true) {
    this.ws = new WebSocket(origin.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie, Origin: origin }, autoPong })
    this.ws.on('message', data => {
      this.messages.push(JSON.parse(data.toString()) as OnlineServerMessage)
      for (const wake of this.waiters) wake()
    })
    peers.push(this)
  }
  async open(roomId: string) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject) })
    }
    this.send({ type: 'hello', protocol: ONLINE_PROTOCOL, roomId })
    return this.wait(message => message.type === 'welcome')
  }
  send(message: unknown) { this.ws.send(JSON.stringify(message)) }
  get snapshot(): RoomSnapshot {
    const message = this.messages.findLast(item => item.type === 'welcome' || item.type === 'update')
    if (!message || (message.type !== 'welcome' && message.type !== 'update')) throw new Error('No room snapshot')
    return message.snapshot
  }
  wait(predicate: (message: OnlineServerMessage) => boolean, start = 0): Promise<OnlineServerMessage> {
    return new Promise((resolve, reject) => {
      const search = () => {
        const result = this.messages.slice(start).find(predicate)
        if (result) { clearTimeout(timer); this.waiters.delete(search); resolve(result) }
      }
      const timer = setTimeout(() => { this.waiters.delete(search); reject(new Error('WebSocket response timed out: ' + JSON.stringify(this.messages.slice(-2)))) }, 4000)
      this.waiters.add(search)
      search()
    })
  }
  envelope(command: OnlineCommand): OnlineCommandEnvelope {
    return { type: 'command', commandId: randomUUID(), gameId: this.snapshot.game.id,
      expectedRevision: this.snapshot.game.revision, command }
  }
  async command(command: OnlineCommand | OnlineCommandEnvelope) {
    const request = command.type === 'command' ? command : this.envelope(command)
    const start = this.messages.length
    this.send(request)
    const result = await this.wait(message => (message.type === 'ack' || message.type === 'error') && message.commandId === request.commandId, start)
    return { request, result }
  }
  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>(resolve => this.ws.once('close', () => resolve()))
    this.ws.close()
    await closed
  }
}

async function post(path: string, data: unknown, cookie = '', requestOrigin = origin) {
  return fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: cookie }, body: JSON.stringify(data) })
}
async function session() {
  const response = await post('/api/guest', {})
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')!
  expect(set).toContain('HttpOnly')
  expect(set).toContain('SameSite=Strict')
  expect(set).not.toContain('Domain=')
  return set.split(';')[0]
}
async function room() {
  const whiteCookie = await session()
  const blackCookie = await session()
  const created = await (await post('/api/rooms', { name: 'White', side: 'white', requestId: randomUUID() }, whiteCookie)).json() as CreateRoomResponse
  const joined = await post('/api/rooms/' + created.snapshot.id + '/join', { name: 'Black', invite: created.invite }, blackCookie)
  expect(joined.status).toBe(200)
  const white = new Peer(whiteCookie)
  const black = new Peer(blackCookie)
  await white.open(created.snapshot.id)
  await black.open(created.snapshot.id)
  await white.command({ type: 'ready', ready: true })
  await black.command({ type: 'ready', ready: true })
  await white.wait(message => message.type === 'update' && message.snapshot.status === 'playing')
  return { white, black, created, whiteCookie, blackCookie }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'remorse-online-'))
  app = createOnlineServer({ databasePath: join(directory, 'rooms.sqlite'), publicOrigin: origin, heartbeatMs: 100, die: () => 6 })
  await app.listen(PORT)
})
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.ws.terminate()
  await app.close()
  await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('real HTTP and two independent WebSocket guests', () => {
  it('plays a full ordinary game from the initial position through server checkmate with identical histories', async () => {
    const { white, black } = await room()
    const line = [move('f2', 'f3'), move('e7', 'e5'), move('g2', 'g4'), move('d8', 'h4')]
    for (const [index, command] of line.entries()) {
      const actor = index % 2 ? black : white
      const other = index % 2 ? white : black
      const { result } = await actor.command(command)
      expect(result.type).toBe('ack')
      await other.wait(message => message.type === 'update' && message.snapshot.game.revision === index + 1)
      expect(other.snapshot.game).toEqual(actor.snapshot.game)
    }
    expect(white.snapshot.status).toBe('finished')
    expect(white.snapshot.game.state.outcome).toEqual({ reason: 'checkmate', winner: 'black' })
    expect(black.snapshot.game.actions.at(-1)?.events).toContainEqual(expect.objectContaining({ type: 'outcome' }))
    expect(white.snapshot.game.actions.every(action => !action.roll)).toBe(true)
    const extra = await white.command(move('e1', 'e2'))
    expect(extra.result).toMatchObject({ type: 'error', code: 'finished' })
  })

  it('persists capture, bonus, identity and ACK across a real process-service restart without rerolling', async () => {
    const { white, black, created, whiteCookie, blackCookie } = await room()
    await white.command(move('e2', 'e4'))
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    await black.command(move('d7', 'd5'))
    await white.wait(message => message.type === 'update' && message.snapshot.game.revision === 2)
    const capture = await white.command(move('e4', 'd5'))
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 3)
    const reached = white.snapshot.game
    expect(reached.state.phase).toBe('bonus')
    expect(reached.actions[2].roll).toEqual({ face: 6, source: 'server' })
    await app.close()
    const die = vi.fn(() => 1 as const)
    app = createOnlineServer({ databasePath: join(directory, 'rooms.sqlite'), publicOrigin: origin, die })
    await app.listen(PORT)
    const resumedWhite = new Peer(whiteCookie)
    const resumedBlack = new Peer(blackCookie)
    await resumedWhite.open(created.snapshot.id)
    await resumedBlack.open(created.snapshot.id)
    expect(resumedWhite.snapshot.you).toBe('white')
    expect(resumedWhite.snapshot.game).toEqual(reached)
    expect((await resumedWhite.command(capture.request)).result).toEqual(capture.result)
    expect(die).not.toHaveBeenCalled()
    expect(resumedWhite.snapshot.game.actions).toHaveLength(3)
    const pass = await resumedWhite.command({ type: 'endTurn' })
    expect(pass.result).toMatchObject({ type: 'ack', revision: 4 })
    await resumedBlack.wait(message => message.type === 'update' && message.snapshot.game.revision === 4)
    expect(resumedBlack.snapshot.game.state).toMatchObject({ side: 'black', phase: 'primary', turnSerial: 3 })
    const beforeSync = resumedBlack.messages.length
    resumedBlack.send({ type: 'sync' })
    expect(await resumedBlack.wait(message => message.type === 'welcome', beforeSync)).toMatchObject({ snapshot: { game: { revision: 4 } } })
  })

  it('rejects foreign Origins, unauthenticated API reads, excessive bodies and forged protocol fields', async () => {
    expect((await post('/api/guest', {}, '', 'https://foreign.example')).status).toBe(403)
    expect((await post('/api/rooms', { name: 'x', side: 'white', requestId: randomUUID() })).status).toBe(401)
    const { white, created } = await room()
    const outsider = await session()
    const read = await fetch(origin + '/api/rooms/' + created.snapshot.id, { headers: { Cookie: outsider } })
    expect(read.status).toBe(403)
    const large = await post('/api/guest', { excess: 'a'.repeat(17_000) })
    expect(large.status).toBe(413)
    const start = white.messages.length
    white.send({ ...white.envelope(move('e2', 'e4')), actor: 'black', roll: { face: 6 } })
    expect(await white.wait(message => message.type === 'error', start)).toMatchObject({ code: 'invalidMessage' })
    expect(white.snapshot.game.revision).toBe(0)
    await expect(new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(origin.replace('http', 'ws') + '/ws', { headers: { Cookie: outsider, Origin: 'https://foreign.example' } })
      socket.on('open', () => { socket.close(); resolve() })
      socket.on('error', reject)
    })).rejects.toThrow('403')
  })

  it('replaces the old tab, exposes disconnect presence, and does not accept an off-turn move', async () => {
    const { white, black, whiteCookie, created } = await room()
    const replacement = new Peer(whiteCookie)
    await replacement.open(created.snapshot.id)
    expect(await white.wait(message => message.type === 'replaced')).toEqual({ type: 'replaced' })
    expect((await black.command(move('e7', 'e5'))).result).toMatchObject({ type: 'error', code: 'wrongSide' })
    await black.close()
    await replacement.wait(message => message.type === 'update' && !message.snapshot.players.black?.connected)
    expect((await replacement.command(move('e2', 'e4'))).result).toMatchObject({ type: 'error', code: 'opponentOffline' })
    expect(pieceAt(replacement.snapshot.game.state, 'e2')?.type).toBe('pawn')
    expect((await replacement.command({ type: 'resign' })).result.type).toBe('ack')
    expect(replacement.snapshot.game.state.outcome).toEqual({ reason: 'resignation', winner: 'black' })
  })

  it('lets two connected people agree a draw and a color-swapped rematch without sharing a browser save', async () => {
    const { white, black } = await room()
    await white.command({ type: 'offerDraw' })
    await black.wait(message => message.type === 'update' && Boolean(message.snapshot.drawOffer))
    await black.command({ type: 'answerDraw', offerId: black.snapshot.drawOffer!.id, accept: true })
    await white.wait(message => message.type === 'update' && message.snapshot.status === 'finished')
    const oldId = white.snapshot.game.id
    await white.command({ type: 'rematch', accept: true })
    await black.command({ type: 'rematch', accept: true })
    await white.wait(message => message.type === 'update' && message.snapshot.game.id !== oldId)
    expect(white.snapshot.you).toBe('black')
    expect(black.snapshot.you).toBe('white')
    const bySide: Record<Side, Peer> = { white: black, black: white }
    await bySide.white.command(move('e2', 'e4'))
    await bySide.black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    expect(white.snapshot.game).toEqual(black.snapshot.game)
    expect(white.snapshot.game.state.outcome).toBeNull()
  })

  it('terminates a silent socket by heartbeat and publishes offline state without changing the game', async () => {
    const { white, blackCookie, created } = await room()
    const silent = new Peer(blackCookie, false)
    await silent.open(created.snapshot.id)
    await white.wait(message => message.type === 'update' && !message.snapshot.players.black?.connected)
    expect(white.snapshot.game.revision).toBe(0)
    expect(white.snapshot.game.state.outcome).toBeNull()
  })
})
