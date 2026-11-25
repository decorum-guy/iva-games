import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../src/overdrive/core'
import { ONLINE_PROTOCOL } from '../../src/overdrive/online/protocol'
import type { RoomSnapshot } from '../../src/overdrive/online/protocol'
import { canInteractOnline } from '../../src/overdrive/ui/presentation'

const root = createInitialState()
function snapshot(): RoomSnapshot {
  return { protocol: ONLINE_PROTOCOL, id: 'test-room', revision: 5, status: 'playing', you: 'white',
    players: { white: { name: 'One', ready: true, connected: true }, black: { name: 'Two', ready: true, connected: true } },
    game: { id: 'game-1', revision: 0, createdAt: 0, updatedAt: 0, root, state: root, actions: [] },
    drawOffer: null, rematchVotes: [], expiresAt: 1000, serverTime: 0 }
}
const options = (room = snapshot()) => ({ room, displayedGame: { id: room.game.id, revision: room.game.revision },
  side: 'white' as const, transport: { status: 'connected' as const, pending: false }, queuedActions: 0 })

describe('Overdrive online presentation gate', () => {
  it('allows the first move after ready/metadata snapshots with separately deserialized state objects', () => {
    const displayed = snapshot()
    const metadata = JSON.parse(JSON.stringify({ ...displayed, revision: 7,
      drawOffer: { id: 'offer-1', from: 'black' }, serverTime: 200 })) as RoomSnapshot
    expect(metadata.game.state).not.toBe(displayed.game.state)
    expect(metadata.game.state).toEqual(displayed.game.state)
    expect(canInteractOnline({ ...options(displayed), room: metadata })).toBe(true)
  })

  it('keeps input locked until displayed actions reach the authoritative game revision', () => {
    const room = snapshot()
    const newer = { ...room, game: { ...room.game, revision: 1 } }
    expect(canInteractOnline({ ...options(), room: newer })).toBe(false)
    expect(canInteractOnline({ ...options(newer), queuedActions: 1 })).toBe(false)
    expect(canInteractOnline(options(newer))).toBe(true)
  })

  it('does not confuse a fresh rematch with the same numerical revision in the old game', () => {
    const room = snapshot()
    expect(canInteractOnline({ ...options(room), room: { ...room, game: { ...room.game, id: 'game-2' } } })).toBe(false)
  })

  it('blocks waiting/finished rooms, the other side, pending commands and lost synchronization', () => {
    expect(canInteractOnline({ ...options(), room: null })).toBe(false)
    expect(canInteractOnline({ ...options(), room: { ...snapshot(), status: 'waiting' } })).toBe(false)
    expect(canInteractOnline({ ...options(), room: { ...snapshot(), status: 'finished' } })).toBe(false)
    expect(canInteractOnline({ ...options(), side: 'black' })).toBe(false)
    expect(canInteractOnline({ ...options(), transport: { status: 'connected', pending: true } })).toBe(false)
    expect(canInteractOnline({ ...options(), transport: { status: 'syncing', pending: false } })).toBe(false)
  })

  it('does not offer a move that the authoritative server will reject while the opponent is offline', () => {
    const room = snapshot()
    const offline: RoomSnapshot = { ...room, players: { ...room.players,
      black: { ...room.players.black!, connected: false } } }
    expect(canInteractOnline({ ...options(), room: offline })).toBe(false)
  })
})
