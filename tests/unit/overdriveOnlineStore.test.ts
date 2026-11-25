import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomService } from '../../server/overdrive/rooms'
import { RoomStore } from '../../server/overdrive/store'
import { RoomStore as RemorseStore } from '../../server/store'
import { clientMessage } from '../../server/overdrive/validation'
import type { OnlineCommand, OnlineCommandEnvelope } from '../../src/overdrive/online/protocol'

const open: RoomService[] = []
afterEach(() => { for (const service of open.splice(0)) service.close() })

function setup(path = ':memory:', now: () => number = Date.now) {
  const service = new RoomService(new RoomStore(path), { now, inactiveMs: 1000 })
  open.push(service)
  const white = service.ensureGuest(), black = service.ensureGuest()
  const created = service.create(white.guest, { name: 'Белые', side: 'white', requestId: randomUUID() })
  service.join(created.snapshot.id, black.guest, { name: 'Black', invite: created.invite })
  const connections = { white: randomUUID(), black: randomUUID() }
  service.connect(created.snapshot.id, white.guest, { id: connections.white, send() {}, replace() {} })
  service.connect(created.snapshot.id, black.guest, { id: connections.black, send() {}, replace() {} })
  const submit = (side: 'white' | 'black', command: OnlineCommand) => {
    const game = service.snapshot(created.snapshot.id, white.guest).game
    const request: OnlineCommandEnvelope = { type: 'command', commandId: randomUUID(), gameId: game.id, expectedRevision: game.revision, command }
    return service.execute(created.snapshot.id, side === 'white' ? white.guest : black.guest, connections[side], request)
  }
  submit('white', { type: 'ready', ready: true })
  submit('black', { type: 'ready', ready: true })
  return { service, white, black, created, submit, snapshot: () => service.snapshot(created.snapshot.id, white.guest) }
}

describe('Overdrive durable room integrity and boundary validation', () => {
  it('rotates retry invitations without duplicating rooms, consumes a join once, and never exposes seat secrets', () => {
    const service = new RoomService(new RoomStore(':memory:'))
    open.push(service)
    const owner = service.ensureGuest(), guest = service.ensureGuest(), outsider = service.ensureGuest()
    const request = { name: 'Owner', side: 'black' as const, requestId: randomUUID() }
    const first = service.create(owner.guest, request)
    const retry = service.create(owner.guest, request)
    expect(retry.snapshot.id).toBe(first.snapshot.id)
    expect(retry.invite).not.toBe(first.invite)
    expect(() => service.join(first.snapshot.id, guest.guest, { name: 'Guest', invite: first.invite })).toThrow('inviteInvalid')
    const joined = service.join(first.snapshot.id, guest.guest, { name: 'Guest', invite: retry.invite })
    expect(service.join(first.snapshot.id, guest.guest, { name: 'Retry', invite: retry.invite }).you).toBe('white')
    expect(() => service.join(first.snapshot.id, outsider.guest, { name: 'Third', invite: retry.invite })).toThrow('roomFull')
    expect(() => service.create(owner.guest, { ...request, side: 'white' })).toThrow('commandConflict')
    expect(JSON.stringify(joined)).not.toMatch(/inviteHash|createPayload|guest|token/)
  })

  it('rolls back an illegal energy payment with no new revision, history, charge, or ACK', () => {
    const game = setup()
    const before = game.snapshot().game
    const rook = before.state.pieces.find(piece => piece.square === 'a1')!
    expect(() => game.submit('white', { type: 'ability', mode: 'impulse', pieceId: rook.id, targetId: 'white-pawn-0' })).toThrow()
    expect(game.snapshot().game).toEqual(before)
    const enemy = before.state.pieces.find(piece => piece.square === 'e7')!
    expect(() => game.submit('white', { type: 'move', mode: 'normal', pieceId: enemy.id, to: 'e5' })).toThrow()
    expect(game.snapshot().game).toEqual(before)
  })

  it('expires abandoned rooms without mutating the chess result or accepting later commands', () => {
    let time = 100
    const game = setup(':memory:', () => time)
    const before = game.snapshot().game
    time = 1101
    game.service.cleanup()
    expect(game.snapshot().status).toBe('expired')
    expect(game.snapshot().game).toEqual(before)
    expect(() => game.submit('white', { type: 'resign' })).toThrow('roomExpired')
    expect(game.snapshot().game.state.outcome).toBeNull()
  })

  it('replays durable events on restart and refuses a divergent saved energy total', () => {
    const directory = mkdtempSync(join(tmpdir(), 'overdrive-integrity-'))
    try {
      const path = join(directory, 'game.sqlite')
      const game = setup(path)
      const pawn = game.snapshot().game.state.pieces.find(piece => piece.square === 'e2')!
      game.submit('white', { type: 'move', mode: 'normal', pieceId: pawn.id, to: 'e4' })
      const stored = game.service.store.load(game.created.snapshot.id)!
      stored.game = { ...stored.game, state: { ...stored.game.state, energy: { white: 5, black: 0 } } }
      game.service.store.save(stored)
      game.service.close()
      open.splice(open.indexOf(game.service), 1)
      const restarted = new RoomService(new RoomStore(path))
      open.push(restarted)
      expect(() => restarted.snapshot(game.created.snapshot.id, game.white.guest)).toThrow('serverError')
      restarted.close()
      open.splice(open.indexOf(restarted), 1)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('refuses to adopt the existing Remorse database as an Overdrive database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'overdrive-namespace-'))
    try {
      const path = join(directory, 'remorse.sqlite')
      const remorse = new RemorseStore(path)
      remorse.close()
      expect(() => new RoomStore(path)).toThrow('protocolMismatch')
      const stillRemorse = new RemorseStore(path)
      expect(() => stillRemorse.health()).not.toThrow()
      stillRemorse.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rejects direct draw agreements, client energy, alternate protocols and arbitrary action fields', () => {
    const envelope = { type: 'command', commandId: randomUUID(), gameId: randomUUID(), expectedRevision: 0 }
    for (const command of [
      { type: 'agreeDraw' },
      { type: 'ability', mode: 'impulse', pieceId: 'white-rook-0', targetId: 'target', energy: 10 },
      { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4', roll: 6 },
      { type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e9' },
    ]) expect(() => clientMessage({ ...envelope, command })).toThrow('invalidMessage')
    expect(() => clientMessage({ type: 'hello', protocol: 'remorse-online-v1', roomId: randomUUID() })).toThrow('protocolMismatch')
  })
})
