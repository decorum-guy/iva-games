import type { Side } from '../core'
import type { OnlineTransportState } from '../online/client'
import type { RoomSnapshot } from '../online/protocol'

export interface DisplayedGame {
  readonly id: string
  readonly revision: number
}

/** Metadata/heartbeats may replace state objects without advancing the game. */
export function canInteractOnline({ room, displayedGame, side, transport, queuedActions }: {
  readonly room: RoomSnapshot | null
  readonly displayedGame: DisplayedGame | null
  readonly side: Side
  readonly transport: Pick<OnlineTransportState, 'status' | 'pending'>
  readonly queuedActions: number
}): boolean {
  return room?.status === 'playing' && room.you === side &&
    room.players.white?.connected === true && room.players.black?.connected === true &&
    transport.status === 'connected' && !transport.pending && queuedActions === 0 &&
    displayedGame?.id === room.game.id && displayedGame.revision === room.game.revision
}
