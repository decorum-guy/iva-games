import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { agreeDraw, createInitialState, resign, RuleError, transition, validateState } from '@chess-2/overdrive/core'
import type { Command, GameState, Side, Transition } from '@chess-2/overdrive/core'
import { ONLINE_PROTOCOL, ONLINE_SAVE_VERSION } from '@chess-2/overdrive/online/protocol'
import type { CreateRoomRequest, CreateRoomResponse, JoinRoomRequest, OnlineAck, OnlineAction, OnlineCommandEnvelope,
  OnlineGameSnapshot, OnlineServerMessage, RoomSnapshot } from '@chess-2/overdrive/online/protocol'
import { RoomStore } from './store'
import type { StoredRoom } from './store'
import { OnlineError } from './validation'

const DAY = 86_400_000
const secret = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

interface Connection {
  id: string
  send: (message: OnlineServerMessage) => void
  replace: () => void
}

export interface RoomOptions {
  now?: () => number
  inactiveMs?: number
  finishedMs?: number
}

function resolve(state: GameState, command: Command, actor: Side): Transition {
  try {
    if (command.type === 'resign') return resign(state, actor)
    if (command.type === 'agreeDraw') return agreeDraw(state)
    if (state.side !== actor) throw new OnlineError('wrongSide', 409)
    return transition(state, command)
  } catch (error) {
    if (error instanceof RuleError) throw new OnlineError(error.code, 409)
    throw error
  }
}

export class RoomService {
  readonly inactiveMs: number
  readonly finishedMs: number
  private readonly now: () => number
  private readonly connections = new Map<string, Map<string, Connection>>()
  private readonly validated = new Map<string, number>()

  constructor(readonly store: RoomStore, options: RoomOptions = {}) {
    this.now = options.now ?? Date.now
    this.inactiveMs = options.inactiveMs ?? DAY
    this.finishedMs = Math.max(options.finishedMs ?? 7 * DAY, 7 * DAY)
  }

  ensureGuest(token?: string): { token: string; guest: string } {
    const existing = token && /^[a-zA-Z0-9_-]{43}$/.test(token) && this.store.guest(hash(token), this.now())
    const value = existing ? token! : secret()
    const guest = hash(value)
    this.store.saveGuest(guest, this.now() + 30 * DAY)
    return { token: value, guest }
  }

  authenticate(token?: string): string | null {
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
    const guest = hash(token)
    return this.store.guest(guest, this.now()) ? guest : null
  }

  private game(): OnlineGameSnapshot {
    const root = createInitialState()
    const now = this.now()
    return { id: randomUUID(), revision: 0, createdAt: now, updatedAt: now, root, state: root, actions: [] }
  }

  private checkGame(game: OnlineGameSnapshot) {
    if (!validateState(game.root) || !validateState(game.state)) throw new OnlineError('serverError', 500)
    if (game.revision !== game.actions.length || !Number.isSafeInteger(game.revision)) throw new OnlineError('serverError', 500)
    if (this.validated.get(game.id) === game.revision) return
    let state = game.root
    for (const action of game.actions) {
      const result = resolve(state, action.command, action.actor)
      const events = result.events.map(event => ({ ...event, id: game.id + '/' + action.id + '/' + event.id }))
      if (JSON.stringify(events) !== JSON.stringify(action.events)) throw new OnlineError('serverError', 500)
      state = result.state
    }
    if (JSON.stringify(state) !== JSON.stringify(game.state)) throw new OnlineError('serverError', 500)
    if (this.validated.size >= 8192) this.validated.delete(this.validated.keys().next().value!)
    this.validated.set(game.id, game.revision)
  }

  private load(id: string): StoredRoom {
    const room = this.store.load(id)
    if (!room) throw new OnlineError('roomMissing', 404)
    this.checkGame(room.game)
    if (room.status !== 'expired' && room.expiresAt <= this.now()) {
      room.status = 'expired'
      room.revision++
      this.store.save(room)
    }
    return room
  }

  private seat(room: StoredRoom, guest: string): Side {
    if (room.players.white?.guest === guest) return 'white'
    if (room.players.black?.guest === guest) return 'black'
    throw new OnlineError('notYourSeat', 403)
  }
  private connected(room: StoredRoom, side: Side) {
    const seat = room.players[side]
    return Boolean(seat && this.connections.get(room.id)?.has(seat.guest))
  }
  private bothConnected(room: StoredRoom) { return this.connected(room, 'white') && this.connected(room, 'black') }

  private publicRoom(room: StoredRoom, guest: string): RoomSnapshot {
    const player = (side: Side) => {
      const seat = room.players[side]
      return seat ? { name: seat.name, ready: seat.ready, connected: this.connected(room, side) } : null
    }
    return { protocol: ONLINE_PROTOCOL, id: room.id, revision: room.revision, status: room.status,
      you: this.seat(room, guest), players: { white: player('white'), black: player('black') }, game: room.game,
      drawOffer: room.drawOffer, rematchVotes: room.rematchVotes, expiresAt: room.expiresAt, serverTime: this.now() }
  }

  snapshot(id: string, guest: string) { return this.publicRoom(this.load(id), guest) }

  private notify(id: string, action?: OnlineAction, except?: string) {
    const room = this.load(id)
    for (const [guest, connection] of this.connections.get(id) ?? []) {
      if (connection.id === except) continue
      try { connection.send({ type: 'update', snapshot: this.publicRoom(room, guest), ...(action ? { action } : {}) }) }
      catch { /* The committed room remains recoverable if a socket disappears. */ }
    }
  }

  create(guest: string, input: CreateRoomRequest): CreateRoomResponse {
    return this.store.transaction(() => {
      const payload = JSON.stringify({ name: input.name, side: input.side })
      const previous = this.store.findCreated(guest, input.requestId)
      if (previous) {
        if (previous.createPayload !== payload) throw new OnlineError('commandConflict', 409)
        const room = this.load(previous.id)
        if (room.status === 'expired') throw new OnlineError('roomExpired', 410)
        const invite = room.status === 'waiting' && (!room.players.white || !room.players.black) ? secret() : ''
        if (invite) { room.inviteHash = hash(invite); this.store.save(room) }
        return { snapshot: this.publicRoom(room, guest), invite }
      }
      if (this.store.activeOwned(guest) >= 6) throw new OnlineError('rateLimited', 429)
      const side = input.side === 'random' ? randomInt(0, 2) ? 'white' : 'black' : input.side
      const invite = secret()
      const now = this.now()
      const room: StoredRoom = { version: ONLINE_SAVE_VERSION, id: randomUUID(), owner: guest,
        createRequest: input.requestId, createPayload: payload, inviteHash: hash(invite), revision: 0,
        status: 'waiting', players: { white: null, black: null }, game: this.game(), drawOffer: null,
        rematchVotes: [], createdAt: now, updatedAt: now, expiresAt: now + this.inactiveMs }
      room.players[side] = { guest, name: input.name, ready: false }
      this.store.save(room)
      return { snapshot: this.publicRoom(room, guest), invite }
    })
  }

  join(id: string, guest: string, input: JoinRoomRequest): RoomSnapshot {
    const snapshot = this.store.transaction(() => {
      const room = this.load(id)
      if (room.status === 'expired') throw new OnlineError('roomExpired', 410)
      if (room.owner === guest) throw new OnlineError('sameGuest', 409)
      if (room.players.white?.guest === guest || room.players.black?.guest === guest) return this.publicRoom(room, guest)
      if (room.status !== 'waiting' || (room.players.white && room.players.black)) throw new OnlineError('roomFull', 409)
      if (!room.inviteHash || !timingSafeEqual(Buffer.from(room.inviteHash, 'hex'), Buffer.from(hash(input.invite), 'hex'))) {
        throw new OnlineError('inviteInvalid', 403)
      }
      const side = room.players.white ? 'black' : 'white'
      room.players[side] = { guest, name: input.name, ready: false }
      room.inviteHash = null
      room.revision++
      room.updatedAt = this.now()
      room.expiresAt = this.now() + this.inactiveMs
      this.store.save(room)
      return this.publicRoom(room, guest)
    })
    this.notify(id)
    return snapshot
  }

  invite(id: string, guest: string): string {
    return this.store.transaction(() => {
      const room = this.load(id)
      if (room.owner !== guest) throw new OnlineError('notYourSeat', 403)
      if (room.status === 'expired') throw new OnlineError('roomExpired', 410)
      if (room.status !== 'waiting' || (room.players.white && room.players.black)) throw new OnlineError('roomFull', 409)
      const invite = secret()
      room.inviteHash = hash(invite)
      room.revision++
      room.updatedAt = this.now()
      room.expiresAt = this.now() + this.inactiveMs
      this.store.save(room)
      return invite
    })
  }

  connect(id: string, guest: string, connection: Connection): RoomSnapshot {
    let room = this.load(id)
    this.seat(room, guest)
    const connections = this.connections.get(id) ?? new Map<string, Connection>()
    this.connections.set(id, connections)
    const previous = connections.get(guest)
    connections.set(guest, connection)
    previous?.replace()
    if (room.status === 'waiting' && room.players.white?.ready && room.players.black?.ready && this.bothConnected(room)) {
      room = this.store.transaction(() => {
        const current = this.load(id)
        current.status = 'playing'
        current.revision++
        current.updatedAt = this.now()
        current.expiresAt = this.now() + this.inactiveMs
        this.store.save(current)
        return current
      })
    }
    this.notify(id, undefined, connection.id)
    return this.publicRoom(room, guest)
  }

  disconnect(id: string, guest: string, connectionId: string) {
    const connections = this.connections.get(id)
    if (connections?.get(guest)?.id !== connectionId) return
    connections.delete(guest)
    if (connections.size === 0) this.connections.delete(id)
    try { this.notify(id) } catch { /* An expired room may already have been cleaned. */ }
  }

  execute(id: string, guest: string, connectionId: string, request: OnlineCommandEnvelope): OnlineAck {
    if (this.connections.get(id)?.get(guest)?.id !== connectionId) throw new OnlineError('replaced', 403)
    const accepted = this.store.transaction(() => {
      const room = this.load(id)
      const side = this.seat(room, guest)
      const payload = JSON.stringify({ gameId: request.gameId, expectedRevision: request.expectedRevision, command: request.command })
      const previous = this.store.ack(id, request.commandId)
      if (previous) {
        if (previous.guest !== guest || previous.payload !== payload) throw new OnlineError('commandConflict', 409)
        return { ack: previous.ack, changed: false, action: undefined }
      }
      if (room.status === 'expired') throw new OnlineError('roomExpired', 410)
      if (request.gameId !== room.game.id || request.expectedRevision !== room.game.revision) throw new OnlineError('staleRevision', 409)
      const requestedGame = room.game
      const command = request.command
      let action: OnlineAction | undefined
      if (command.type === 'ready') {
        if (room.status !== 'waiting') throw new OnlineError('notReady', 409)
        room.players[side]!.ready = command.ready
        if (room.players.white?.ready && room.players.black?.ready && this.bothConnected(room)) room.status = 'playing'
      } else if (command.type === 'rematch') {
        if (room.status !== 'finished') throw new OnlineError('notReady', 409)
        room.rematchVotes = room.rematchVotes.filter(vote => vote !== side)
        if (command.accept) room.rematchVotes.push(side)
        if (room.rematchVotes.length === 2) {
          room.players = { white: room.players.black, black: room.players.white }
          room.game = this.game()
          room.drawOffer = null
          room.rematchVotes = []
          room.status = this.bothConnected(room) ? 'playing' : 'waiting'
        }
      } else {
        if (room.status !== 'playing') throw new OnlineError(room.status === 'finished' ? 'finished' : 'notReady', 409)
        if (command.type !== 'resign' && !this.bothConnected(room)) throw new OnlineError('opponentOffline', 409)
        let move: Command | undefined
        if (command.type === 'offerDraw') room.drawOffer = { id: randomUUID(), from: side }
        else if (command.type === 'answerDraw') {
          if (!room.drawOffer || room.drawOffer.id !== command.offerId || room.drawOffer.from === side) throw new OnlineError('drawOfferMissing', 409)
          room.drawOffer = null
          if (command.accept) move = { type: 'agreeDraw' }
        } else move = command
        if (move) {
          const resolved = resolve(room.game.state, move, side)
          action = { id: request.commandId, actor: side, command: move,
            events: resolved.events.map(event => ({ ...event, id: room.game.id + '/' + request.commandId + '/' + event.id })) }
          room.game = { ...room.game, revision: room.game.revision + 1, updatedAt: this.now(), state: resolved.state,
            actions: [...room.game.actions, action] }
          room.drawOffer = null
          if (resolved.state.outcome) room.status = 'finished'
        }
      }
      room.revision++
      room.updatedAt = this.now()
      room.expiresAt = this.now() + (room.status === 'finished' ? this.finishedMs : this.inactiveMs)
      const ack: OnlineAck = { type: 'ack', commandId: request.commandId, gameId: requestedGame.id,
        revision: room.game.id === requestedGame.id ? room.game.revision : requestedGame.revision }
      this.store.save(room)
      this.store.saveAck(id, guest, payload, ack)
      this.validated.set(room.game.id, room.game.revision)
      return { ack, changed: true, action }
    })
    if (accepted.changed) this.notify(id, accepted.action)
    return accepted.ack
  }

  cleanup() {
    const now = this.now()
    for (const id of this.store.due(now)) { this.load(id); this.notify(id) }
    this.store.prune(now, this.finishedMs)
  }

  close() {
    this.connections.clear()
    this.store.close()
  }
}
