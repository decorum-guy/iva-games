import { commandKey, resign, transition, validateCommand, validateState } from '../core'
import type { Command, GameState, Side } from '../core'
import { TEACHING_FIXTURES } from '../core/teaching'
import { LEGACY_TEACHING_FIXTURES } from '../core/legacyTeaching'

export const LOCAL_SESSION_KEY = 'overdrive-local-v1'
export const SETTINGS_KEY = 'overdrive-settings-v1'
export const MAX_LOCAL_ACTIONS = 2048
const MAX_SESSION_BYTES = 2_000_000

export interface LocalSessionRecord {
  readonly version: 1
  readonly root: GameState
  readonly actions: readonly Command[]
  readonly mode: 'bot' | 'local' | 'tutorial'
  readonly level: number
  readonly humanSide: Side
  readonly lessonIndex: number
  readonly lessonAck: boolean
  /** Resignation may be declared by either side, independently of the actor. */
  readonly resignedBy?: Side
}

export interface LoadedLocalSession {
  readonly record: LocalSessionRecord
  readonly state: GameState
}

export interface OverdriveSettings {
  readonly lang: 'ru' | 'en'
  readonly mute: boolean
  readonly volume: number
  readonly view: '3d' | '2d'
  readonly reduced?: boolean
}

export const DEFAULT_OVERDRIVE_SETTINGS: OverdriveSettings = Object.freeze({
  lang: 'ru', mute: true, volume: .65, view: '3d',
})

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))

function validRecord(value: unknown): value is LocalSessionRecord {
  const valid = object(value) && exactKeys(value, ['version', 'root', 'actions', 'mode', 'level', 'humanSide', 'lessonIndex', 'lessonAck'], ['resignedBy']) &&
    value.version === 1 && validateState(value.root) && Array.isArray(value.actions) &&
    value.actions.length <= MAX_LOCAL_ACTIONS && value.actions.every(validateCommand) &&
    ['bot', 'local', 'tutorial'].includes(String(value.mode)) &&
    typeof value.level === 'number' && Number.isInteger(value.level) && value.level >= 1 && value.level <= 10 &&
    (value.humanSide === 'white' || value.humanSide === 'black') &&
    typeof value.lessonIndex === 'number' && Number.isSafeInteger(value.lessonIndex) && value.lessonIndex >= 0 && value.lessonIndex < 100 &&
    typeof value.lessonAck === 'boolean' &&
    (!Object.hasOwn(value, 'resignedBy') || value.resignedBy === 'white' || value.resignedBy === 'black')
  if (!valid) return false
  const record = value as unknown as LocalSessionRecord
  if (record.mode !== 'tutorial') return true
  const fixture = (record.root.rulesVersion === 'overdrive-v1' ? LEGACY_TEACHING_FIXTURES : TEACHING_FIXTURES)[record.lessonIndex]
  // Teaching has exactly one accepted command per fixture. An invalid index or
  // mismatched acknowledgement would otherwise leave the learner unable to act.
  return !!fixture && !record.resignedBy && JSON.stringify(record.root) === JSON.stringify(fixture.state) &&
    record.actions.length <= 1 && record.lessonAck === (record.actions.length === 1) &&
    (record.actions.length === 0 || commandKey(record.actions[0]) === commandKey(fixture.expected))
}

/**
 * The root is an explicitly supplied initial/lesson position, not a claimed
 * standard-opening provenance. Every subsequent command is replayed by rules.
 */
export function loadLocalSession(storage?: StoragePort): LoadedLocalSession | null {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(LOCAL_SESSION_KEY)
    if (!raw || raw.length > MAX_SESSION_BYTES) return null
    const record: unknown = JSON.parse(raw)
    if (!validRecord(record)) return null
    let state = record.root
    for (const command of record.actions) state = transition(state, command).state
    if (record.resignedBy) state = resign(state, record.resignedBy).state
    return { record, state }
  } catch { return null }
}

/** Saving is cheap; the complete expensive replay is performed on loading. */
export function saveLocalSession(record: LocalSessionRecord, storage?: StoragePort): boolean {
  try {
    if (!validRecord(record)) return false
    const raw = JSON.stringify(record)
    if (raw.length > MAX_SESSION_BYTES) return false
    ;(storage ?? globalThis.localStorage).setItem(LOCAL_SESSION_KEY, raw)
    return true
  } catch { return false }
}

export function clearLocalSession(storage?: StoragePort): boolean {
  try {
    ;(storage ?? globalThis.localStorage).removeItem(LOCAL_SESSION_KEY)
    return true
  } catch { return false }
}

function validSettings(value: unknown): value is OverdriveSettings {
  return object(value) && exactKeys(value, ['lang', 'mute', 'volume', 'view'], ['reduced']) &&
    (value.lang === 'ru' || value.lang === 'en') && typeof value.mute === 'boolean' &&
    typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 &&
    (value.view === '3d' || value.view === '2d') &&
    (!Object.hasOwn(value, 'reduced') || typeof value.reduced === 'boolean')
}

export function loadOverdriveSettings(storage?: StoragePort): OverdriveSettings {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(SETTINGS_KEY)
    if (!raw || raw.length > 2048) return { ...DEFAULT_OVERDRIVE_SETTINGS }
    const envelope: unknown = JSON.parse(raw)
    if (!object(envelope) || !exactKeys(envelope, ['version', 'settings']) || envelope.version !== 1 ||
      !validSettings(envelope.settings)) return { ...DEFAULT_OVERDRIVE_SETTINGS }
    return envelope.settings
  } catch { return { ...DEFAULT_OVERDRIVE_SETTINGS } }
}

export function saveOverdriveSettings(settings: OverdriveSettings, storage?: StoragePort): boolean {
  try {
    if (!validSettings(settings)) return false
    ;(storage ?? globalThis.localStorage).setItem(SETTINGS_KEY, JSON.stringify({ version: 1, settings }))
    return true
  } catch { return false }
}
