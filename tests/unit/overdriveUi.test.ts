import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInitialState, transition } from '../../src/overdrive/core'
import { TEACHING_FIXTURES } from '../../src/overdrive/core/teaching'
import { OverdriveApp } from '../../src/overdrive/ui/OverdriveApp'
import { lessonText } from '../../src/overdrive/ui/i18n'
import { LOCAL_SESSION_KEY, saveLocalSession, saveOverdriveSettings } from '../../src/overdrive/ui/session'
import type { LocalSessionRecord } from '../../src/overdrive/ui/session'
import type { UseBotOptions } from '../../src/overdrive/ui/useBot'

const { botCall } = vi.hoisted(() => ({ botCall: vi.fn<(options: UseBotOptions) => boolean>(() => false) }))
vi.mock('../../src/overdrive/ui/useBot', () => ({ useBot: botCall }))
// Component rendering tests are deliberately silent. The real audio module has
// its own tests, and no server-rendered markup is described as visual acceptance.
vi.mock('../../src/overdrive/ui/audio', () => ({ OverdriveAudio: class {} }))

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) } }
}

let storage: ReturnType<typeof memoryStorage>
const render = () => renderToStaticMarkup(createElement(OverdriveApp))
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const baseRecord = (): LocalSessionRecord => ({ version: 1, root: createInitialState(), actions: [],
  mode: 'local', level: 4, humanSide: 'white', lessonIndex: 0, lessonAck: false })

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { hash: '', href: 'http://127.0.0.1:5198/overdrive/' })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  saveOverdriveSettings({ lang: 'ru', mute: true, volume: 0, view: '2d' }, storage)
  botCall.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('Overdrive component/data integration (server-rendered, not browser acceptance)', () => {
  for (const lang of ['ru', 'en'] as const) {
    for (const [index, fixture] of TEACHING_FIXTURES.entries()) {
      for (const completed of [false, true]) {
        it(`${lang}: lesson ${index + 1} ${fixture.id} renders ${completed ? 'acknowledged result' : 'its next action'}`, () => {
          saveOverdriveSettings({ lang, mute: true, volume: 0, view: '2d' }, storage)
          const record: LocalSessionRecord = { ...baseRecord(), root: fixture.state, mode: 'tutorial',
            lessonIndex: index, actions: completed ? [fixture.expected] : [], lessonAck: completed }
          expect(saveLocalSession(record, storage)).toBe(true)
          const html = render()
          const text = plain(html)
          const copy = lessonText[fixture.id][lang]
          expect(text).toContain(copy[0])
          expect(text).toContain(copy[completed ? 2 : 1])
          expect(html).toContain('data-mode="tutorial"')
          expect(html).toContain(`data-turn="${completed ? 1 : 0}"`)
          expect(html.match(/role="gridcell"/g)).toHaveLength(64)
          expect(botCall).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
          if (!completed) {
            expect(html.match(/data-focus="true"/g)).toHaveLength(fixture.focusSquares.length)
            expect(text).not.toContain(lang === 'ru' ? 'Следующий приём' : 'Next exercise')
          } else if (index < TEACHING_FIXTURES.length - 1) {
            expect(text).toContain(lang === 'ru' ? 'Следующий приём' : 'Next exercise')
          } else {
            expect(text).toContain(lang === 'ru' ? 'Продолжить с движком' : 'Continue with the engine')
            expect(text).toContain(lang === 'ru' ? 'Играть с начала' : 'Play from the start')
            const after = transition(fixture.state, fixture.expected).state
            expect(after.forms.white?.remainingTurns).toBe(2)
          }
        })
      }
    }
  }

  it('opens a fresh local launch dialog with all three real entry routes', () => {
    const html = render()
    const text = plain(html)
    expect(html).toContain('role="dialog"')
    for (const label of ['Начать партию', 'За одной доской', 'Освоить приёмы', 'Играть по сети']) expect(text).toContain(label)
    expect(botCall).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('restores a local move without opening setup or enabling the engine', () => {
    saveLocalSession({ ...baseRecord(), actions: [{ type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4' }] }, storage)
    const html = render()
    expect(html).toContain('data-mode="local"')
    expect(html).toContain('data-turn="1"')
    expect(html).not.toContain('role="dialog"')
    expect(botCall).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, state: expect.objectContaining({ side: 'black' }) }))
  })

  it('enables the real bot only for its restored live turn', () => {
    saveLocalSession({ ...baseRecord(), mode: 'bot', level: 7,
      actions: [{ type: 'move', mode: 'normal', pieceId: 'white-pawn-4', to: 'e4' }] }, storage)
    render()
    expect(botCall).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, level: 7,
      humanSide: 'white', state: expect.objectContaining({ side: 'black', turnSerial: 1 }) }))
  })

  it('restores both colour outcomes, including resignation before the first move', () => {
    for (const side of ['white', 'black'] as const) {
      saveLocalSession({ ...baseRecord(), mode: 'bot', resignedBy: side }, storage)
      const html = render()
      expect(html).not.toContain('role="dialog"')
      expect(html).toContain(`od-result-glyph">${side === 'white' ? '0:1' : '1:0'}`)
      expect(plain(html)).toContain('Сдача')
      expect(botCall).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))
    }
  })

  it('falls back to a usable launch screen for a corrupt tutorial checkpoint', () => {
    storage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...baseRecord(), mode: 'tutorial', lessonIndex: 99 }))
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('od-panel-setup')
    expect(html).not.toContain('data-mode="tutorial"')
  })

  it('switching stored language changes teaching copy while preserving the reconstructed board', () => {
    const fixture = TEACHING_FIXTURES[3]
    const record: LocalSessionRecord = { ...baseRecord(), mode: 'tutorial', root: fixture.state,
      actions: [fixture.expected], lessonIndex: 3, lessonAck: true }
    saveLocalSession(record, storage)
    const saved = storage.getItem(LOCAL_SESSION_KEY)
    const russian = render()
    saveOverdriveSettings({ lang: 'en', mute: true, volume: 0, view: '2d' }, storage)
    const english = render()
    expect(plain(russian)).toContain(lessonText.raid.ru[2])
    expect(plain(english)).toContain(lessonText.raid.en[2])
    expect(storage.getItem(LOCAL_SESSION_KEY)).toBe(saved)
    expect(russian).toContain('data-turn="1"')
    expect(english).toContain('data-turn="1"')
  })
})
