import { describe, expect, it } from 'vitest'
import { createInitialState, transition } from '../core'
import type { Command } from '../core'
import { TEACHING_FIXTURES } from '../core/teaching'
import { clearLocalSession, DEFAULT_OVERDRIVE_SETTINGS, loadLocalSession, loadOverdriveSettings,
  LOCAL_SESSION_KEY, MAX_LOCAL_ACTIONS, saveLocalSession, saveOverdriveSettings, SETTINGS_KEY } from './session'
import type { LocalSessionRecord, OverdriveSettings } from './session'

function memoryStorage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) } }
}

const move = (pieceId: string, to: string): Command => ({ type: 'move', mode: 'normal', pieceId, to })
const e4 = move('white-pawn-4', 'e4')
const e5 = move('black-pawn-4', 'e5')
const record = (): LocalSessionRecord => ({ version: 1, root: createInitialState(), actions: [e4, e5],
  mode: 'bot', level: 4, humanSide: 'white', lessonIndex: 0, lessonAck: false })

describe('Overdrive isolated local session persistence', () => {
  it('reconstructs the actual position by replaying every command through shared rules', () => {
    const storage = memoryStorage()
    const source = record()
    const snapshot = structuredClone(source)
    expect(saveLocalSession(source, storage)).toBe(true)
    const loaded = loadLocalSession(storage)!
    const expected = transition(transition(source.root, e4).state, e5).state
    expect(loaded.state).toEqual(expected)
    expect(loaded.state.turnSerial).toBe(2)
    expect(loaded.state).not.toEqual(loaded.record.root)
    expect(source).toEqual(snapshot)
    expect(JSON.parse(storage.getItem(LOCAL_SESSION_KEY)!)).not.toHaveProperty('state')
  })

  it('keeps tutorial acknowledgement and chosen mode/side/level without changing the game on reload', () => {
    const storage = memoryStorage()
    const source: LocalSessionRecord = { ...record(), root: TEACHING_FIXTURES[5].state,
      actions: [TEACHING_FIXTURES[5].expected], mode: 'tutorial', level: 8,
      humanSide: 'black', lessonIndex: 5, lessonAck: true }
    saveLocalSession(source, storage)
    expect(loadLocalSession(storage)?.record).toEqual(source)
  })

  it('rejects nonexistent tutorial lessons and mismatched fixture/command acknowledgements', () => {
    const storage = memoryStorage()
    const source: LocalSessionRecord = { ...record(), mode: 'tutorial', lessonIndex: 0,
      root: TEACHING_FIXTURES[0].state, actions: [], lessonAck: false }
    for (const changes of [
      { lessonIndex: 9 }, { lessonIndex: 99 }, { lessonAck: true },
      { root: createInitialState() }, { actions: [TEACHING_FIXTURES[0].expected] },
      { actions: [e4], lessonAck: true }, { resignedBy: 'white' },
    ]) {
      storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...source, ...changes }))
      expect(loadLocalSession(storage)).toBeNull()
    }
  })

  it.each([
    { actions: [move('white-pawn-4', 'e7')] },
    { actions: [e5] },
    { actions: [{ type: 'ability', mode: 'impulse', pieceId: 'white-rook-0', targetId: 'white-pawn-0' }] },
    { actions: [{ type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4', forged: true }] },
  ])('rejects tampered or unaffordable actions %j', change => {
    const storage = memoryStorage()
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...record(), ...change }))
    expect(loadLocalSession(storage)).toBeNull()
  })

  it('rejects commands appended after a correctly reconstructed final result', () => {
    const storage = memoryStorage()
    const actions = [move('white-pawn-5', 'f3'), e5, move('white-pawn-6', 'g4'), move('black-queen-3', 'h4')]
    saveLocalSession({ ...record(), actions }, storage)
    expect(loadLocalSession(storage)?.state.outcome).toEqual({ winner: 'black', reason: 'checkmate' })
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...record(), actions: [...actions, e4] }))
    expect(loadLocalSession(storage)).toBeNull()
  })

  it('restores a human resignation during the bot turn without changing the actor or move history', () => {
    const storage = memoryStorage()
    const source: LocalSessionRecord = { ...record(), actions: [e4], resignedBy: 'white' }
    const snapshot = structuredClone(source)
    expect(saveLocalSession(source, storage)).toBe(true)
    const loaded = loadLocalSession(storage)!
    expect(loaded.state).toMatchObject({ side: 'black', turnSerial: 1,
      outcome: { winner: 'black', reason: 'resignation' } })
    expect(loaded.record.actions).toEqual([e4])
    expect(loaded.record.root).toEqual(source.root)
    expect(source).toEqual(snapshot)
  })

  it('rejects a resignation flag after a replay that already ended the game', () => {
    const storage = memoryStorage()
    const actions = [move('white-pawn-5', 'f3'), e5, move('white-pawn-6', 'g4'), move('black-queen-3', 'h4')]
    const source: LocalSessionRecord = { ...record(), actions, resignedBy: 'black' }
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify(source))
    expect(loadLocalSession(storage)).toBeNull()
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...record(), resignedBy: 'green' }))
    expect(loadLocalSession(storage)).toBeNull()
  })

  it.each([
    { version: 0 }, { state: { arbitrary: true } }, { level: 11 }, { humanSide: 'green' },
    { mode: 'online' }, { lessonIndex: -1 }, { lessonAck: 'yes' },
  ])('rejects incompatible schema/metadata %j', changes => {
    const storage = memoryStorage()
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...record(), ...changes }))
    expect(loadLocalSession(storage)).toBeNull()
  })

  it('rejects invalid roots and the wrong rules version rather than trusting a saved board', () => {
    const storage = memoryStorage()
    for (const change of [{ rulesVersion: 'remorse-digital-v1' }, { energy: { white: 11, black: 0 } }, { pieces: [] }]) {
      const source = record()
      storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...source, root: { ...source.root, ...change } }))
      expect(loadLocalSession(storage)).toBeNull()
    }
  })

  it('rejects corruption and oversized/action-flood records without deleting other game data', () => {
    const storage = memoryStorage()
    storage.setItem('remorse-owner-data', 'preserve-me')
    for (const text of ['{bad json', 'x'.repeat(2_000_001),
      JSON.stringify({ ...record(), actions: Array.from({ length: MAX_LOCAL_ACTIONS + 1 }, () => e4) })]) {
      storage.setItem(LOCAL_SESSION_KEY, text)
      expect(loadLocalSession(storage)).toBeNull()
    }
    expect(storage.getItem('remorse-owner-data')).toBe('preserve-me')
  })

  it('reports storage failures and never writes to another game’s key', () => {
    const storage = memoryStorage()
    storage.setItem('remorse-owner-data', 'preserve-me')
    const denied = { ...storage, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(saveLocalSession(record(), denied)).toBe(false)
    expect(loadLocalSession({ ...storage, getItem: () => { throw new Error('SecurityError') } })).toBeNull()
    expect(storage.getItem('remorse-owner-data')).toBe('preserve-me')
    expect(storage.values.size).toBe(1)
  })

  it('clears only the local match and keeps settings and unrelated saved games', () => {
    const storage = memoryStorage()
    saveLocalSession(record(), storage)
    saveOverdriveSettings({ ...DEFAULT_OVERDRIVE_SETTINGS, lang: 'en' }, storage)
    storage.setItem('remorse-owner-data', 'preserve-me')
    expect(clearLocalSession(storage)).toBe(true)
    expect(loadLocalSession(storage)).toBeNull()
    expect(loadOverdriveSettings(storage).lang).toBe('en')
    expect(storage.getItem('remorse-owner-data')).toBe('preserve-me')
  })
})

describe('Overdrive independent settings', () => {
  it('round-trips mute, volume, language, view and explicit motion preference', () => {
    const storage = memoryStorage()
    const settings: OverdriveSettings = { lang: 'en', mute: false, volume: .3, view: '2d', reduced: true }
    expect(saveOverdriveSettings(settings, storage)).toBe(true)
    expect(loadOverdriveSettings(storage)).toEqual(settings)
    expect(storage.getItem(LOCAL_SESSION_KEY)).toBeNull()
  })

  it('returns safe defaults for corrupt/legacy settings and rejects invalid new values', () => {
    const storage = memoryStorage()
    for (const text of ['[', JSON.stringify({ version: 0, settings: DEFAULT_OVERDRIVE_SETTINGS }),
      JSON.stringify({ version: 1, settings: { ...DEFAULT_OVERDRIVE_SETTINGS, volume: 8 } })]) {
      storage.setItem(SETTINGS_KEY, text)
      expect(loadOverdriveSettings(storage)).toEqual(DEFAULT_OVERDRIVE_SETTINGS)
    }
    expect(saveOverdriveSettings({ ...DEFAULT_OVERDRIVE_SETTINGS, volume: NaN }, storage)).toBe(false)
    expect(saveOverdriveSettings({ ...DEFAULT_OVERDRIVE_SETTINGS, volume: -.1 }, storage)).toBe(false)
  })
})
