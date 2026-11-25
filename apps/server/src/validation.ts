import { PROMOTIONS, validSquare } from '@chess-2/remorse/core'
import type { CreateRoomRequest, JoinRoomRequest, OnlineClientMessage, OnlineCommand, OnlineErrorCode } from '@chess-2/remorse/online/protocol'
import { ONLINE_NAME_LIMIT, ONLINE_PROTOCOL } from '@chess-2/remorse/online/protocol'

export class OnlineError extends Error {
  constructor(readonly code: OnlineErrorCode, readonly status = 400) { super(code) }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OnlineError('invalidMessage')
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new OnlineError('invalidMessage')
  }
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) throw new OnlineError('invalidMessage')
  return value
}

export function playerName(value: unknown): string {
  if (typeof value !== 'string') throw new OnlineError('invalidName')
  const name = value.trim()
  if (!name || [...name].length > ONLINE_NAME_LIMIT || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new OnlineError('invalidName')
  }
  return name
}

export function createRequest(value: unknown): CreateRoomRequest {
  const input = object(value)
  keys(input, ['name', 'side', 'requestId'])
  if (typeof input.side !== 'string' || !['white', 'black', 'random'].includes(input.side)) throw new OnlineError('invalidMessage')
  return { name: playerName(input.name), side: input.side as CreateRoomRequest['side'], requestId: identifier(input.requestId) }
}

export function joinRequest(value: unknown): JoinRoomRequest {
  const input = object(value)
  keys(input, ['name', 'invite'])
  return { name: playerName(input.name), invite: identifier(input.invite) }
}

export function emptyRequest(value: unknown) { keys(object(value), []) }

export function onlineCommand(value: unknown): OnlineCommand {
  const input = object(value)
  switch (input.type) {
    case 'move': {
      keys(input, ['type', 'from', 'to'], ['promotion'])
      if (typeof input.from !== 'string' || typeof input.to !== 'string' || !validSquare(input.from) || !validSquare(input.to)
        || (input.promotion !== undefined && !PROMOTIONS.includes(input.promotion as typeof PROMOTIONS[number]))) {
        throw new OnlineError('invalidMessage')
      }
      return { type: 'move', from: input.from, to: input.to,
        ...(input.promotion === undefined ? {} : { promotion: input.promotion as typeof PROMOTIONS[number] }) }
    }
    case 'endTurn': case 'resign': case 'claimRepetitionDraw': case 'offerDraw':
      keys(input, ['type'])
      return { type: input.type }
    case 'ready':
      keys(input, ['type', 'ready'])
      if (typeof input.ready !== 'boolean') throw new OnlineError('invalidMessage')
      return { type: 'ready', ready: input.ready }
    case 'rematch':
      keys(input, ['type', 'accept'])
      if (typeof input.accept !== 'boolean') throw new OnlineError('invalidMessage')
      return { type: 'rematch', accept: input.accept }
    case 'answerDraw':
      keys(input, ['type', 'offerId', 'accept'])
      if (typeof input.accept !== 'boolean') throw new OnlineError('invalidMessage')
      return { type: 'answerDraw', offerId: identifier(input.offerId), accept: input.accept }
    default: throw new OnlineError('invalidMessage')
  }
}

export function clientMessage(value: unknown): OnlineClientMessage {
  const input = object(value)
  switch (input.type) {
    case 'hello':
      keys(input, ['type', 'protocol', 'roomId'])
      if (input.protocol !== ONLINE_PROTOCOL) throw new OnlineError('protocolMismatch', 409)
      return { type: 'hello', protocol: ONLINE_PROTOCOL, roomId: identifier(input.roomId) }
    case 'sync':
      keys(input, ['type'])
      return { type: 'sync' }
    case 'command':
      keys(input, ['type', 'commandId', 'gameId', 'expectedRevision', 'command'])
      if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new OnlineError('invalidMessage')
      return { type: 'command', commandId: identifier(input.commandId), gameId: identifier(input.gameId),
        expectedRevision: Number(input.expectedRevision), command: onlineCommand(input.command) }
    default: throw new OnlineError('invalidMessage')
  }
}
