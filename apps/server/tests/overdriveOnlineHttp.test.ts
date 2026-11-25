import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInitialState, createPosition, legalCommands } from '@chess-2/overdrive/core'
import type { Action, GameState, PieceInput, Side } from '@chess-2/overdrive/core'
import { ONLINE_PROTOCOL } from '@chess-2/overdrive/online/protocol'
import type { CreateRoomResponse, OnlineCommand, OnlineCommandEnvelope, OnlineServerMessage, RoomSnapshot } from '@chess-2/overdrive/online/protocol'
import { createOnlineServer } from '../src/http'

let origin: string
let directory: string
let app: ReturnType<typeof createOnlineServer>
const peers: Peer[] = []

class Peer {
  readonly messages: OnlineServerMessage[] = []
  readonly ws: WebSocket
  private waiters = new Set<() => void>()
  constructor(readonly cookie: string, autoPong = true) {
    this.ws = new WebSocket(origin.replace('http', 'ws') + '/overdrive-online', { headers: { Cookie: cookie, Origin: origin }, autoPong })
    this.ws.on('message', data => {
      this.messages.push(JSON.parse(data.toString()) as OnlineServerMessage)
      for (const wake of this.waiters) wake()
    })
    peers.push(this)
  }
  async open(roomId: string, protocol: string = ONLINE_PROTOCOL) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise<void>((resolve, reject) => { this.ws.once('open', resolve); this.ws.once('error', reject) })
    }
    this.send({ type: 'hello', protocol, roomId })
    return this.wait(message => message.type === 'welcome' || message.type === 'error')
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
      const timer = setTimeout(() => { this.waiters.delete(search); reject(new Error('WebSocket response timed out: ' + JSON.stringify(this.messages.slice(-1)))) }, 4000)
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
  move(from: string, to: string) {
    const pieceId = this.snapshot.game.state.pieces.find(piece => piece.square === from)?.id
    if (!pieceId) throw new Error('Missing mover ' + from)
    return this.command({ type: 'move', mode: 'normal', pieceId, to })
  }
  async sync() {
    const start = this.messages.length
    this.send({ type: 'sync' })
    await this.wait(message => message.type === 'welcome', start)
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
  const response = await post('/api/overdrive/guest', {})
  expect(response.status).toBe(200)
  const set = response.headers.get('set-cookie')!
  expect(set).toContain('overdrive_guest=')
  expect(set).toContain('HttpOnly')
  expect(set).toContain('SameSite=Strict')
  expect(set).not.toContain('Domain=')
  return set.split(';')[0]
}
async function room() {
  const whiteCookie = await session()
  const blackCookie = await session()
  const created = await (await post('/api/overdrive/rooms', { name: 'White', side: 'white', requestId: randomUUID() }, whiteCookie)).json() as CreateRoomResponse
  const joined = await post('/api/overdrive/rooms/' + created.snapshot.id + '/join', { name: 'Black', invite: created.invite }, blackCookie)
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

/** Controlled server fixture; never exposed as an HTTP endpoint. */
async function installRoot(id: string, state: GameState, white: Peer, black: Peer) {
  const stored = app.overdrive.store.load(id)!
  stored.game = { ...stored.game, id: randomUUID(), root: state, state, revision: 0, actions: [] }
  app.overdrive.store.save(stored)
  await white.sync()
  await black.sync()
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'overdrive-online-'))
  await mkdir(join(directory, 'dist', 'overdrive'), { recursive: true })
  await mkdir(join(directory, 'dist', 'assets'))
  await writeFile(join(directory, 'dist', 'index.html'), '<!doctype html><title>REMORSE fixture</title>')
  await writeFile(join(directory, 'dist', 'overdrive', 'index.html'), '<!doctype html><title>OVERDRIVE fixture</title>')
  await writeFile(join(directory, 'dist', 'assets', 'test.js'), 'export const fixture = true;')
  app = createOnlineServer({ databasePath: join(directory, 'remorse.sqlite'), staticDir: join(directory, 'dist'), heartbeatMs: 500 })
  const address = await app.listen(0)
  origin = 'http://127.0.0.1:' + address.port
})
afterEach(async () => {
  for (const peer of peers.splice(0)) peer.ws.terminate()
  await app.close()
  await rm(directory, { recursive: true, force: true })
})

describe('Overdrive real HTTP and independent WebSocket guests', () => {
  it('serves the separate Overdrive entry on both paths while preserving Remorse and asset 404s', async () => {
    expect(await (await fetch(origin + '/')).text()).toContain('REMORSE fixture')
    for (const path of ['/overdrive', '/overdrive/', '/overdrive/index.html']) {
      const response = await fetch(origin + path)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('OVERDRIVE fixture')
    }
    const asset = await fetch(origin + '/assets/test.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    for (const path of ['/assets/missing.js', '/assets/missing', '/overdrive/assets/missing.js']) {
      const missing = await fetch(origin + path)
      expect(missing.status).toBe(404)
      expect(missing.headers.get('content-type')).toContain('application/json')
    }
    const head = await fetch(origin + '/overdrive/', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await head.text()).toBe('')
  })

  it('plays a complete initial-position game through checkmate, with identical events and energy', async () => {
    const { white, black } = await room()
    const line = [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]
    for (const [index, [from, to]] of line.entries()) {
      const actor = index % 2 ? black : white
      const other = index % 2 ? white : black
      expect((await actor.move(from, to)).result.type).toBe('ack')
      await other.wait(message => message.type === 'update' && message.snapshot.game.revision === index + 1)
      expect(other.snapshot.game).toEqual(actor.snapshot.game)
    }
    expect(white.snapshot.status).toBe('finished')
    expect(white.snapshot.game.state.outcome).toEqual({ reason: 'checkmate', winner: 'black' })
    expect(white.snapshot.game.state.energy.black).toBe(2)
    expect(black.snapshot.game.actions.at(-1)?.events).toContainEqual(expect.objectContaining({ type: 'outcome' }))
    expect((await white.command({ type: 'resign' })).result).toMatchObject({ type: 'error', code: 'finished' })
  })

  it('persists capture energy, history, seat and exact ACK across a closed-and-reopened SQLite service', async () => {
    const { white, black, created, whiteCookie, blackCookie } = await room()
    await white.move('e2', 'e4')
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    await black.move('d7', 'd5')
    await white.wait(message => message.type === 'update' && message.snapshot.game.revision === 2)
    const capture = await white.move('e4', 'd5')
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 3)
    const reached = white.snapshot.game
    expect(reached.state.energy.white).toBe(1)
    const port = Number(new URL(origin).port)
    await app.close()
    app = createOnlineServer({ databasePath: join(directory, 'remorse.sqlite') })
    await app.listen(port)
    const resumedWhite = new Peer(whiteCookie)
    const resumedBlack = new Peer(blackCookie)
    await resumedWhite.open(created.snapshot.id)
    await resumedBlack.open(created.snapshot.id)
    expect(resumedWhite.snapshot.you).toBe('white')
    expect(resumedWhite.snapshot.game).toEqual(reached)
    expect((await resumedWhite.command(capture.request)).result).toEqual(capture.result)
    expect(resumedWhite.snapshot.game.actions).toHaveLength(3)
    expect(resumedWhite.snapshot.game.state.energy.white).toBe(1)
    expect((await resumedBlack.move('d8', 'd5')).result).toMatchObject({ type: 'ack', revision: 4 })
    await resumedWhite.wait(message => message.type === 'update' && message.snapshot.game.revision === 4)
    expect(resumedWhite.snapshot.game.state.energy.black).toBe(1)
  })

  const specialFixtures: { name: string; pieces: PieceInput[]; landing?: string }[] = [
    { name: 'sweep', pieces: [{ id: 'focus-piece', type: 'pawn', side: 'white', square: 'e4' }, { id: 'target-piece', type: 'knight', side: 'black', square: 'f5' }] },
    { name: 'raid', landing: 'e4', pieces: [{ id: 'focus-piece', type: 'knight', side: 'white', square: 'c3' }, { id: 'target-piece', type: 'rook', side: 'black', square: 'd4' }] },
    { name: 'battery', pieces: [{ id: 'focus-piece', type: 'bishop', side: 'white', square: 'c1' }, { type: 'pawn', side: 'white', square: 'd2' }, { id: 'target-piece', type: 'rook', side: 'black', square: 'h6' }] },
    { name: 'ram', pieces: [{ id: 'focus-piece', type: 'rook', side: 'white', square: 'b1' }, { id: 'target-piece', type: 'knight', side: 'black', square: 'd1' }] },
    { name: 'rotation', pieces: [{ id: 'focus-piece', type: 'queen', side: 'white', square: 'd4' }, { id: 'target-piece', type: 'rook', side: 'white', square: 'a4' }] },
    { name: 'cover', landing: 'd1', pieces: [{ id: 'focus-piece', type: 'king', side: 'white', square: 'c1' }, { id: 'target-piece', type: 'knight', side: 'white', square: 'd2' }, { type: 'rook', side: 'black', square: 'a1' }] },
  ]
  it.each(specialFixtures)('authoritatively resolves $name and broadcasts the same special action to both seats', async ({ name, pieces, landing }) => {
    const { white, black, created } = await room()
    const state = createPosition({ pieces: [
      ...pieces, ...(name === 'cover' ? [] : [{ type: 'king' as const, side: 'white' as const, square: 'h1' }]),
      { type: 'king', side: 'black', square: 'h8' },
    ], energy: { white: 5 } })
    await installRoot(created.snapshot.id, state, white, black)
    const command = legalCommands(state).find((item): item is Action => item.type === 'ability' && item.pieceId === 'focus-piece' &&
      item.mode === 'impulse' && item.targetId === 'target-piece' && (!landing || item.to === landing))
    expect(command).toBeDefined()
    expect((await white.command(command!)).result.type).toBe('ack')
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    expect(white.snapshot.game).toEqual(black.snapshot.game)
    expect(white.snapshot.game.actions[0].events).toContainEqual(expect.objectContaining({ type: 'ability', ability: name }))
    expect(white.snapshot.game.actions[0].events).toContainEqual(expect.objectContaining({ type: 'energy', spent: 5 }))
    expect(white.snapshot.game.state.energy.white).toBeLessThan(5)
  })

  it('keeps form activation and duration authoritative when a client reconnects', async () => {
    const { white, black, created, whiteCookie } = await room()
    const initial = createInitialState()
    const state = createPosition({ pieces: initial.pieces, energy: { white: 10 } })
    await installRoot(created.snapshot.id, state, white, black)
    const command = legalCommands(state).find((item): item is Action => item.type === 'move' && item.mode === 'activate' && item.to === 'e4')!
    expect(command).toBeDefined()
    const result = await white.command(command)
    expect(result.result.type).toBe('ack')
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    expect(black.snapshot.game.state.forms.white).toEqual({ pieceId: command.pieceId, remainingTurns: 2 })
    await white.close()
    const replacement = new Peer(whiteCookie)
    await replacement.open(created.snapshot.id)
    expect(replacement.snapshot.game.state.forms.white?.remainingTurns).toBe(2)
    expect((await replacement.command(result.request)).result).toEqual(result.result)
    expect(replacement.snapshot.game.state.forms.white?.remainingTurns).toBe(2)
  })

  it('rejects stale revision, changed duplicate payload and attempts to submit foreign state fields', async () => {
    const { white, black } = await room()
    const pawn = white.snapshot.game.state.pieces.find(piece => piece.square === 'e2')!
    const old = white.envelope({ type: 'move', mode: 'normal', pieceId: pawn.id, to: 'e4' })
    expect((await white.command(old)).result.type).toBe('ack')
    await black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    expect((await white.command({ ...old, commandId: randomUUID() })).result).toMatchObject({ type: 'error', code: 'staleRevision' })
    expect((await white.command({ ...old, command: { type: 'resign' } })).result).toMatchObject({ type: 'error', code: 'commandConflict' })
    const start = black.messages.length
    black.send({ ...black.envelope({ type: 'resign' }), state: { energy: { black: 10 } }, actor: 'white' })
    expect(await black.wait(message => message.type === 'error', start)).toMatchObject({ code: 'invalidMessage' })
    expect(black.snapshot.game.revision).toBe(1)
    const malformed = black.messages.length
    black.send({ ...black.envelope({ type: 'resign' }), command: { type: 'move', mode: 'normal', pieceId: 'a1', to: 'z99' } })
    expect(await black.wait(message => message.type === 'error', malformed)).toMatchObject({ code: 'invalidMessage' })
  })

  it('rejects foreign origin, invalid names, oversized body, outsider and Remorse cookie/protocol', async () => {
    expect((await post('/api/overdrive/guest', {}, '', 'https://foreign.example')).status).toBe(403)
    const remorseGuest = await post('/api/guest', {})
    const remorseCookie = remorseGuest.headers.get('set-cookie')!.split(';')[0]
    expect((await post('/api/overdrive/rooms', { name: 'x', side: 'white', requestId: randomUUID() }, remorseCookie)).status).toBe(401)
    const cookie = await session()
    expect((await post('/api/rooms', { name: 'x', side: 'white', requestId: randomUUID() }, cookie)).status).toBe(401)
    for (const name of ['', 'x'.repeat(25), '\u202Ehidden', 'bad\nname']) {
      expect((await post('/api/overdrive/rooms', { name, side: 'white', requestId: randomUUID() }, cookie)).status).toBe(400)
    }
    expect((await post('/api/overdrive/guest', { extra: 'x'.repeat(17_000) })).status).toBe(413)
    const { created, whiteCookie } = await room()
    const outsider = await session()
    const read = await fetch(origin + '/api/overdrive/rooms/' + created.snapshot.id, { headers: { Cookie: outsider } })
    expect(read.status).toBe(403)
    const wrongProtocol = new Peer(whiteCookie)
    expect(await wrongProtocol.open(created.snapshot.id, 'remorse-online-v1')).toMatchObject({ type: 'error', code: 'protocolMismatch' })
    await expect(new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(origin.replace('http', 'ws') + '/overdrive-online', { headers: { Cookie: outsider, Origin: 'https://foreign.example' } })
      socket.on('open', () => { socket.close(); resolve() })
      socket.on('error', reject)
    })).rejects.toThrow('403')
  })

  it('replaces the prior tab, pauses moves on disconnection and permits out-of-turn surrender', async () => {
    const { white, black, whiteCookie, created } = await room()
    const replacement = new Peer(whiteCookie)
    await replacement.open(created.snapshot.id)
    expect(await white.wait(message => message.type === 'replaced')).toEqual({ type: 'replaced' })
    expect((await black.move('e7', 'e5')).result).toMatchObject({ type: 'error', code: 'wrongSide' })
    await replacement.close()
    await black.wait(message => message.type === 'update' && !message.snapshot.players.white?.connected)
    expect((await black.command({ type: 'offerDraw' })).result).toMatchObject({ type: 'error', code: 'opponentOffline' })
    expect((await black.command({ type: 'resign' })).result.type).toBe('ack')
    expect(black.snapshot.game.state.outcome).toEqual({ reason: 'resignation', winner: 'white' })
  })

  it('requires current mutual draw consent and starts a fresh rematch with swapped colors', async () => {
    const { white, black } = await room()
    const start = white.messages.length
    white.send({ ...white.envelope({ type: 'resign' }), command: { type: 'agreeDraw' } })
    expect(await white.wait(message => message.type === 'error', start)).toMatchObject({ code: 'invalidMessage' })
    await white.command({ type: 'offerDraw' })
    await black.wait(message => message.type === 'update' && Boolean(message.snapshot.drawOffer))
    const offered = black.snapshot.drawOffer!
    expect((await white.command({ type: 'answerDraw', offerId: offered.id, accept: true })).result).toMatchObject({ type: 'error', code: 'drawOfferMissing' })
    await black.command({ type: 'answerDraw', offerId: offered.id, accept: true })
    await white.wait(message => message.type === 'update' && message.snapshot.status === 'finished')
    expect(white.snapshot.game.state.outcome).toEqual({ reason: 'agreement', winner: null })
    const oldId = white.snapshot.game.id
    await white.command({ type: 'rematch', accept: true })
    await black.command({ type: 'rematch', accept: true })
    await white.wait(message => message.type === 'update' && message.snapshot.game.id !== oldId)
    expect(white.snapshot.you).toBe('black')
    expect(black.snapshot.you).toBe('white')
    const bySide: Record<Side, Peer> = { white: black, black: white }
    expect(bySide.white.snapshot.game.state.energy).toEqual({ white: 0, black: 0 })
    expect(bySide.white.snapshot.game.state.forms).toEqual({ white: null, black: null })
    await bySide.white.move('e2', 'e4')
    await bySide.black.wait(message => message.type === 'update' && message.snapshot.game.revision === 1)
    expect(white.snapshot.game).toEqual(black.snapshot.game)
    expect(app.overdrive.store.previousGame(oldId)?.state.outcome?.reason).toBe('agreement')
  })
})
