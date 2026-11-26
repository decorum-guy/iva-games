import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPosition, pieceAt } from '@chess-2/remorse/core'
import type { DieFace, GameState, Move, PieceInput, Side } from '@chess-2/remorse/core'
import type { OnlineCommand, OnlineCommandEnvelope, OnlineServerMessage } from '@chess-2/remorse/online/protocol'
import { RoomService } from '../src/rooms'
import type { RoomOptions } from '../src/rooms'
import { RoomStore } from '../src/store'
import { clientMessage, createRequest, playerName } from '../src/validation'

const open: RoomService[] = []
afterEach(() => { for (const service of open.splice(0)) service.close(); vi.restoreAllMocks() })
const move = (from: string, to: string): Move => ({ type: 'move', from, to })
const piece = (side: Side, type: PieceInput['type'], square: string, properties: Partial<PieceInput> = {}): PieceInput => ({ side, type, square, ...properties })
const position = (pieces: PieceInput[], extra: Partial<GameState> = {}) => createPosition({ pieces: [
  piece('white', 'king', 'a1'), piece('black', 'king', 'h8'), ...pieces,
], ...extra })

function setup(root?: GameState, options: RoomOptions = {}) {
  const store = new RoomStore(':memory:')
  const service = new RoomService(store, options)
  open.push(service)
  const white = service.ensureGuest()
  const black = service.ensureGuest()
  const created = service.create(white.guest, { name: 'Аня', side: 'white', requestId: randomUUID() })
  const id = created.snapshot.id
  if (root) {
    const room = store.load(id)!
    room.game = { ...room.game, id: randomUUID(), root, state: root }
    store.save(room)
  }
  service.join(id, black.guest, { name: 'Ben', invite: created.invite })
  const messages = { white: [] as OnlineServerMessage[], black: [] as OnlineServerMessage[] }
  const replaced = { white: vi.fn(), black: vi.fn() }
  const connections = { white: randomUUID(), black: randomUUID() }
  const guests = { white, black }
  for (const side of ['white', 'black'] as const) service.connect(id, guests[side].guest,
    { id: connections[side], send: message => messages[side].push(message), replace: replaced[side] })
  const envelope = (command: OnlineCommand): OnlineCommandEnvelope => {
    const game = service.snapshot(id, white.guest).game
    return { type: 'command', commandId: randomUUID(), gameId: game.id, expectedRevision: game.revision, command }
  }
  const submit = (side: Side, command: OnlineCommand | OnlineCommandEnvelope) => service.execute(id, guests[side].guest, connections[side],
    command.type === 'command' ? command : envelope(command))
  submit('white', { type: 'ready', ready: true })
  submit('black', { type: 'ready', ready: true })
  return { service, store, id, guests, messages, replaced, connections, envelope, submit,
    snapshot: () => service.snapshot(id, white.guest) }
}

describe('authoritative rooms: ownership, atomic commands and lifecycle', () => {
  it('needs two guest identities; consumes the invite once and makes a lost join reply recoverable', () => {
    const store = new RoomStore(':memory:')
    const service = new RoomService(store)
    open.push(service)
    const owner = service.ensureGuest()
    const guest = service.ensureGuest()
    const intruder = service.ensureGuest()
    const request = { name: 'Owner', side: 'black' as const, requestId: randomUUID() }
    const room = service.create(owner.guest, request)
    expect(service.create(owner.guest, request).snapshot.id).toBe(room.snapshot.id)
    // Retrying creation rotates an unconsumed link; use the current link.
    const invite = service.invite(room.snapshot.id, owner.guest)
    expect(() => service.join(room.snapshot.id, owner.guest, { name: 'Me again', invite })).toThrow('sameGuest')
    expect(() => service.join(room.snapshot.id, guest.guest, { name: 'Guest', invite: room.invite })).toThrow('inviteInvalid')
    const joined = service.join(room.snapshot.id, guest.guest, { name: 'Guest', invite })
    expect(joined.you).toBe('white')
    expect(service.join(joined.id, guest.guest, { name: 'Retry', invite }).you).toBe('white')
    expect(service.snapshot(joined.id, guest.guest).players.white?.name).toBe('Guest')
    expect(() => service.join(joined.id, intruder.guest, { name: 'Third', invite })).toThrow('roomFull')
    expect(() => service.snapshot(joined.id, intruder.guest)).toThrow('notYourSeat')
    expect(() => service.create(owner.guest, { ...request, side: 'white' })).toThrow('commandConflict')
    expect(service.authenticate(owner.token)).toBe(owner.guest)
    expect(service.ensureGuest(owner.token).token).toBe(owner.token)
    expect(JSON.stringify(joined)).not.toMatch(/inviteHash|guest|rootSeed|"seed"|"fixed"|"redo"/)
  })

  it('does not let a guest move for the other seat, reuse a command ID with new data, or use an old connection', () => {
    const room = setup()
    expect(room.snapshot().status).toBe('playing')
    expect(() => room.submit('black', move('e2', 'e4'))).toThrow('wrongSide')
    const request = room.envelope(move('e2', 'e4'))
    const ack = room.submit('white', request)
    const count = room.messages.black.length
    expect(room.submit('white', request)).toEqual(ack)
    expect(room.messages.black).toHaveLength(count)
    expect(room.snapshot().game.revision).toBe(1)
    expect(() => room.submit('white', { ...request, command: move('d2', 'd4') })).toThrow('commandConflict')
    expect(() => room.submit('black', request)).toThrow('commandConflict')
    expect(() => room.submit('black', { ...request, commandId: randomUUID(), command: move('e7', 'e5') })).toThrow('staleRevision')
    const newConnection = randomUUID()
    room.service.connect(room.id, room.guests.white.guest, { id: newConnection, send: () => {}, replace: () => {} })
    expect(room.replaced.white).toHaveBeenCalledOnce()
    expect(() => room.submit('white', request)).toThrow('replaced')
    room.service.disconnect(room.id, room.guests.white.guest, room.connections.white)
    expect(room.snapshot().players.white?.connected).toBe(true)
  })

  it('rolls back state, result and ACK together if the transaction fails, and retries once', () => {
    const room = setup()
    const before = room.snapshot()
    const request = room.envelope(move('e2', 'e4'))
    const count = room.messages.black.length
    const failure = vi.spyOn(room.store, 'saveAck').mockImplementationOnce(() => { throw new Error('disk unavailable') })
    expect(() => room.submit('white', request)).toThrow('disk unavailable')
    expect(room.snapshot().game).toEqual(before.game)
    expect(room.store.ack(room.id, request.commandId)).toBeNull()
    expect(room.messages.black).toHaveLength(count)
    failure.mockRestore()
    expect(room.submit('white', request).revision).toBe(1)
    expect(room.snapshot().game.actions).toHaveLength(1)
  })

  it('pauses moves when the opponent is disconnected but permits only the owner to resign', () => {
    const room = setup()
    room.service.disconnect(room.id, room.guests.black.guest, room.connections.black)
    expect(() => room.submit('white', move('e2', 'e4'))).toThrow('opponentOffline')
    expect(() => room.submit('white', { type: 'offerDraw' })).toThrow('opponentOffline')
    expect(() => room.submit('black', { type: 'resign' })).toThrow('replaced')
    room.submit('white', { type: 'resign' })
    expect(room.snapshot().game.state.outcome).toEqual({ reason: 'resignation', winner: 'black' })
  })

  it('requires an opposing draw acceptance and invalidates old offers after a move or a new offer', () => {
    const room = setup()
    room.submit('white', { type: 'offerDraw' })
    const first = room.snapshot().drawOffer!
    expect(() => room.submit('white', { type: 'answerDraw', offerId: first.id, accept: true })).toThrow('drawOfferMissing')
    room.submit('white', move('e2', 'e4'))
    expect(() => room.submit('black', { type: 'answerDraw', offerId: first.id, accept: true })).toThrow('drawOfferMissing')
    room.submit('black', { type: 'offerDraw' })
    const second = room.snapshot().drawOffer!
    room.submit('white', { type: 'offerDraw' })
    expect(() => room.submit('white', { type: 'answerDraw', offerId: second.id, accept: true })).toThrow('drawOfferMissing')
    room.submit('black', { type: 'answerDraw', offerId: room.snapshot().drawOffer!.id, accept: false })
    expect(room.snapshot().drawOffer).toBeNull()
    room.submit('black', { type: 'offerDraw' })
    room.submit('white', { type: 'answerDraw', offerId: room.snapshot().drawOffer!.id, accept: true })
    expect(room.snapshot().game.state.outcome).toEqual({ reason: 'agreement', winner: null })
    expect(room.snapshot().game.actions.at(-1)?.command.type).toBe('agreeDraw')
  })

  it('archives a completed game and starts a fresh rematch only after mutual agreement, with exchanged colors', () => {
    const room = setup()
    room.submit('black', { type: 'resign' })
    const finished = room.snapshot().game
    room.submit('white', { type: 'rematch', accept: true })
    expect(room.snapshot().game.id).toBe(finished.id)
    const second = room.envelope({ type: 'rematch', accept: true })
    const ack = room.submit('black', second)
    const next = room.snapshot()
    expect(next.you).toBe('black')
    expect(next.players.white?.name).toBe('Ben')
    expect(next.game.id).not.toBe(finished.id)
    expect(next.game).toMatchObject({ revision: 0, actions: [], state: { turnSerial: 0, outcome: null } })
    expect(room.store.previousGame(finished.id)).toEqual(finished)
    expect(room.submit('black', second)).toEqual(ack)
    expect(room.snapshot().game.id).toBe(next.game.id)
  })

  it('retains a finished room for seven days and never advances a disconnected game or refreshes expiry by syncing', () => {
    let now = 1_000_000
    const room = setup(undefined, { now: () => now })
    const expiry = room.snapshot().expiresAt
    now += 10_000
    room.snapshot()
    expect(room.snapshot().expiresAt).toBe(expiry)
    room.service.disconnect(room.id, room.guests.black.guest, room.connections.black)
    now = expiry + 1
    room.service.cleanup()
    expect(room.snapshot()).toMatchObject({ status: 'expired', game: { revision: 0, state: { outcome: null } } })
    expect(() => room.submit('white', { type: 'resign' })).toThrow('roomExpired')
    const finished = setup(undefined, { now: () => now, finishedMs: 100 })
    finished.submit('white', { type: 'resign' })
    expect(finished.snapshot().expiresAt - now).toBe(7 * 86_400_000)
    now += 6 * 86_400_000
    finished.service.cleanup()
    expect(finished.snapshot().status).toBe('finished')
  })
})

describe('online mechanics use the same authoritative core and resolved public history', () => {
  it.each([
    [1, 'devastated'], [2, 'guilt'], [3, 'guilt'], [4, 'neutral'], [5, 'neutral'], [6, 'berserk'],
  ] as const)('draws face %s only on the server and remembers the committed result on retry', (face, affliction) => {
    const die = vi.fn(() => face as DieFace)
    const room = setup(position([piece('white', 'rook', 'd4'), piece('black', 'pawn', 'd5')]), { die })
    const command = room.envelope(move('d4', 'd5'))
    room.submit('white', command)
    const snapshot = room.snapshot()
    expect(pieceAt(snapshot.game.state, 'd5')?.affliction).toBe(affliction)
    expect(snapshot.game.actions[0].roll).toEqual({ face, source: 'server' })
    expect(snapshot.game.actions[0].events.every(event => event.id.startsWith(snapshot.game.id + '/' + command.commandId + '/'))).toBe(true)
    const white = room.messages.white.at(-1)
    const black = room.messages.black.at(-1)
    expect(white?.type === 'update' && white.snapshot.game).toEqual(black?.type === 'update' && black.snapshot.game)
    room.submit('white', command)
    expect(die).toHaveBeenCalledOnce()
  })

  it('keeps a bloodlust bonus on the same actor, allows friendly capture and disallows an unrelated piece', () => {
    const room = setup(position([
      piece('white', 'rook', 'd4', { affliction: 'berserk', capturesSinceRebirth: 2 }),
      piece('white', 'rook', 'e5'), piece('black', 'pawn', 'd5'), piece('black', 'knight', 'd7'),
    ]))
    room.submit('white', move('d4', 'd5'))
    expect(room.snapshot().game.state).toMatchObject({ phase: 'bonus', side: 'white', turnSerial: 0 })
    expect(() => room.submit('black', move('d7', 'f6'))).toThrow('wrongSide')
    expect(() => room.submit('white', move('e5', 'f5'))).toThrow('wrongBonusPiece')
    expect(() => room.submit('white', move('d5', 'd6'))).toThrow('bloodlustMove')
    room.submit('white', move('d5', 'e5'))
    expect(room.snapshot().game.state).toMatchObject({ phase: 'primary', side: 'black', turnSerial: 1 })
    expect(room.snapshot().game.actions[1].events).toContainEqual(expect.objectContaining({ type: 'capture', friendly: true }))
  })

  it('captures a bishop with immediate devastation and no die, and keeps a remembered ordinary reaction without rerolling', () => {
    const die = vi.fn(() => 4 as const)
    const bishop = setup(position([piece('white', 'rook', 'd4'), piece('black', 'bishop', 'd5')]), { die })
    bishop.submit('white', move('d4', 'd5'))
    expect(pieceAt(bishop.snapshot().game.state, 'd5')?.affliction).toBe('devastated')
    expect(bishop.snapshot().game.actions[0].roll).toBeUndefined()
    expect(bishop.snapshot().game.actions[0].events).toContainEqual(expect.objectContaining({ type: 'reaction', cause: 'bishop' }))
    const memory = setup(position([piece('white', 'rook', 'd4', { captureReaction: 'guilt' }), piece('black', 'pawn', 'd5')]), { die })
    memory.submit('white', move('d4', 'd5'))
    expect(pieceAt(memory.snapshot().game.state, 'd5')?.affliction).toBe('guilt')
    expect(memory.snapshot().game.actions[0].events).toContainEqual(expect.objectContaining({ type: 'reaction', cause: 'memory' }))
    expect(die).not.toHaveBeenCalled()
  })

  it('advances continuous enemy-bishop influence through guilt, devastation and conversion at authoritative turn boundaries', () => {
    const room = setup(position([
      piece('white', 'bishop', 'c5'), piece('white', 'knight', 'b1'),
      piece('black', 'pawn', 'e7', { pawnDoubleStepEligible: true }),
      piece('black', 'rook', 'd7', { captureReaction: 'unaffected', capturesSinceRebirth: 2 }),
    ]))
    room.submit('white', move('c5', 'd6'))
    expect(pieceAt(room.snapshot().game.state, 'e7')?.affliction).toBe('neutral')
    room.submit('black', move('h8', 'g8')); room.submit('white', move('b1', 'c3'))
    expect(pieceAt(room.snapshot().game.state, 'e7')?.affliction).toBe('guilt')
    room.submit('black', move('g8', 'h8')); room.submit('white', move('c3', 'b1'))
    expect(pieceAt(room.snapshot().game.state, 'e7')?.affliction).toBe('devastated')
    room.submit('black', move('h8', 'g8')); room.submit('white', move('b1', 'c3'))
    expect(pieceAt(room.snapshot().game.state, 'e7')).toMatchObject({ side: 'white', affliction: 'neutral', pawnDoubleStepEligible: false })
    expect(pieceAt(room.snapshot().game.state, 'd7')).toMatchObject({ side: 'white', capturesSinceRebirth: 0, captureReaction: 'unassigned' })
    expect(room.snapshot().game.actions.at(-1)?.events.filter(event => event.type === 'convert')).toHaveLength(2)
  })

  it('cures an ally with bishop proximity after the correct two turns and preserves its capture memory', () => {
    const room = setup(position([
      piece('white', 'bishop', 'd4'), piece('white', 'rook', 'e4'), piece('white', 'knight', 'b1'), piece('black', 'pawn', 'e5'),
    ]), { die: () => 2 })
    room.submit('white', move('b1', 'c3')); room.submit('black', move('h8', 'g8'))
    room.submit('white', move('e4', 'e5'))
    expect(pieceAt(room.snapshot().game.state, 'e5')).toMatchObject({ affliction: 'guilt', cureArmedAt: 3 })
    room.submit('black', move('g8', 'h8'))
    expect(pieceAt(room.snapshot().game.state, 'e5')?.affliction).toBe('guilt')
    room.submit('white', move('c3', 'b1'))
    expect(pieceAt(room.snapshot().game.state, 'e5')).toMatchObject({ affliction: 'neutral', captureReaction: 'guilt' })
    expect(room.snapshot().game.actions.at(-1)?.events).toContainEqual(expect.objectContaining({ type: 'cure', cause: 'bishop' }))
  })

  it('requires a king-safe bonus when timed removal would reveal check; an unsafe pass is not accepted', () => {
    const room = setup(position([
      piece('white', 'knight', 'a3', { affliction: 'devastated', devastationDue: 1 }),
      piece('black', 'rook', 'a8'), piece('black', 'pawn', 'c4'), piece('white', 'rook', 'c3', { affliction: 'berserk' }),
    ]))
    room.submit('white', move('c3', 'c4'))
    expect(() => room.submit('white', { type: 'endTurn' })).toThrow('endTurnUnsafe')
    expect(() => room.submit('white', move('c4', 'b4'))).toThrow('kingSafety')
    room.submit('white', move('c4', 'a4'))
    expect(pieceAt(room.snapshot().game.state, 'a3')).toBeUndefined()
    expect(pieceAt(room.snapshot().game.state, 'a4')?.type).toBe('rook')
  })

  it.each(['queen', 'rook', 'bishop', 'knight'] as const)('commits promotion to %s and any reaction as a single action', promotion => {
    const root = createPosition({ pieces: [piece('white', 'king', 'a1'), piece('black', 'king', 'a8'),
      piece('white', 'pawn', 'g7'), piece('black', 'rook', 'h8')] })
    const room = setup(root, { die: () => 6 })
    expect(() => room.submit('white', move('g7', 'h8'))).toThrow('promotionRequired')
    room.submit('white', { ...move('g7', 'h8'), promotion })
    expect(pieceAt(room.snapshot().game.state, 'h8')?.type).toBe(promotion)
    expect(room.snapshot().game.actions).toHaveLength(1)
    expect(room.snapshot().game.state.phase).toBe(promotion === 'bishop' ? 'primary' : 'bonus')
  })

  it('lets the server, not an arbitrary client outcome, award a repetition draw', () => {
    const room = setup()
    expect(() => room.submit('white', { type: 'claimRepetitionDraw' })).toThrow('noRepetition')
    for (let cycle = 0; cycle < 2; cycle++) {
      room.submit('white', move('g1', 'f3')); room.submit('black', move('g8', 'f6'))
      room.submit('white', move('f3', 'g1')); room.submit('black', move('f6', 'g8'))
    }
    room.submit('white', { type: 'claimRepetitionDraw' })
    expect(room.snapshot().game.state.outcome).toEqual({ reason: 'repetition', winner: null })
  })

  it('rejects forged actors, random results, direct draws, undo and malformed promotion before dispatch', () => {
    const room = setup()
    const command = room.envelope(move('e2', 'e4'))
    for (const extra of [{ actor: 'black' }, { roll: 6 }, { state: {} }, { fixed: true }]) {
      expect(() => clientMessage({ ...command, ...extra })).toThrow('invalidMessage')
    }
    for (const type of ['agreeDraw', 'undo', 'redo', 'replaceState']) {
      expect(() => clientMessage({ ...command, command: { type } })).toThrow('invalidMessage')
    }
    expect(() => clientMessage({ ...command, command: { type: 'move', from: 'e7', to: 'e8', promotion: 'king' } })).toThrow('invalidMessage')
    expect(() => clientMessage({ type: 'hello', protocol: 'future-v2', roomId: room.id })).toThrow('protocolMismatch')
    expect(() => playerName('x'.repeat(25))).toThrow('invalidName')
    expect(() => playerName('x\nq')).toThrow('invalidName')
    expect(createRequest({ name: '  Игрок  ', side: 'random', requestId: randomUUID() }).name).toBe('Игрок')
  })
})
