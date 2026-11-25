import { validateCommand } from '../core'
import type { OnlineCommand, OnlineCommandEnvelope } from './protocol'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value)

export function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}

/** Shared shape validation only. The authoritative core separately checks move legality. */
export function isOnlineCommand(value: unknown): value is OnlineCommand {
  if (!isObject(value)) return false
  switch (value.type) {
    case 'ready': return exactKeys(value, ['type', 'ready']) && typeof value.ready === 'boolean'
    case 'offerDraw': return exactKeys(value, ['type'])
    case 'answerDraw': return exactKeys(value, ['type', 'offerId', 'accept']) &&
      isIdentifier(value.offerId) && typeof value.accept === 'boolean'
    case 'rematch': return exactKeys(value, ['type', 'accept']) && typeof value.accept === 'boolean'
    case 'agreeDraw': return false // Agreement requires the opponent's current offer.
    default: return validateCommand(value)
  }
}

export function isEnvelope(value: unknown): value is OnlineCommandEnvelope {
  return isObject(value) && exactKeys(value, ['type', 'commandId', 'gameId', 'expectedRevision', 'command']) &&
    value.type === 'command' && isIdentifier(value.commandId) && isIdentifier(value.gameId) &&
    Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0 && isOnlineCommand(value.command)
}
