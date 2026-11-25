import type { CreateRoomRequest, JoinRoomRequest, OnlineClientMessage, OnlineErrorCode } from '@chess-2/overdrive/online/protocol'
import { ONLINE_NAME_LIMIT, ONLINE_PROTOCOL } from '@chess-2/overdrive/online/protocol'
import { exactKeys, isEnvelope, isIdentifier, isObject, isOnlineCommand } from '@chess-2/overdrive/online/validation'

export { isOnlineCommand }

export class OnlineError extends Error {
  constructor(readonly code: OnlineErrorCode, readonly status = 400) { super(code); this.name = 'OverdriveOnlineError' }
}

export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new OnlineError('invalidMessage')
  return value
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (!exactKeys(value, required, optional)) throw new OnlineError('invalidMessage')
}

export function identifier(value: unknown): string {
  if (!isIdentifier(value)) throw new OnlineError('invalidMessage')
  return value
}

export function playerName(value: unknown): string {
  if (typeof value !== 'string') throw new OnlineError('invalidName')
  const name = value.trim()
  if (!name || [...name].length > ONLINE_NAME_LIMIT || /[\p{Cc}\p{Cf}]/u.test(name)) throw new OnlineError('invalidName')
  return name
}

export function createRequest(value: unknown): CreateRoomRequest {
  const input = object(value)
  keys(input, ['name', 'side', 'requestId'])
  if (input.side !== 'white' && input.side !== 'black' && input.side !== 'random') throw new OnlineError('invalidMessage')
  return { name: playerName(input.name), side: input.side, requestId: identifier(input.requestId) }
}

export function joinRequest(value: unknown): JoinRoomRequest {
  const input = object(value)
  keys(input, ['name', 'invite'])
  return { name: playerName(input.name), invite: identifier(input.invite) }
}

export function emptyRequest(value: unknown) { keys(object(value), []) }

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
      if (!isEnvelope(input)) throw new OnlineError('invalidMessage')
      return input
    default: throw new OnlineError('invalidMessage')
  }
}
