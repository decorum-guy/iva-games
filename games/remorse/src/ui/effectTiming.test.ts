import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { applyResolvedCommand, createPosition } from '../core'
import type { GameState } from '../core'
import { translator } from '../i18n/catalog'
import type { Locale } from '../i18n/catalog'
import { move } from '../tutorial/lessonTypes'
import { effectTiming } from './effectTiming'
import { Inspector } from './PlayPanel'

function card(state: GameState, square: string, locale: Locale, compact = true) {
  return renderToStaticMarkup(createElement(Inspector, {
    state, piece: state.pieces.find(piece => piece.square === square), t: translator(locale), locale, compact,
  }))
}

describe('exact selected-piece deadlines', () => {
  it('shows all six remaining turns without rounding odd counts up to full cycles', () => {
    let state = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'e1' },
      { side: 'black', type: 'king', square: 'e8' },
      { side: 'white', type: 'knight', square: 'c3', affliction: 'devastated' },
    ] })
    const commands = [move('e1', 'f1'), move('e8', 'f8'), move('f1', 'g1'), move('f8', 'g8'), move('g1', 'h1'), move('g8', 'h8')]
    const russian = ['6 ходов игроков', '5 ходов игроков', '4 хода игроков', '3 хода игроков', '2 хода игроков', '1 ход игрока']
    for (const [index, command] of commands.entries()) {
      expect(effectTiming(state.pieces.find(piece => piece.square === 'c3')!, state).removal).toBe(6 - index)
      expect(card(state, 'c3', 'ru')).toContain(`До исчезновения: ${russian[index]}`)
      expect(card(state, 'c3', 'en')).toContain(`${6 - index} player turn${index === 5 ? '' : 's'}`)
      expect(card(state, 'c3', 'ru')).not.toMatch(/цикл/)
      state = applyResolvedCommand(state, command).state
    }
    expect(state.pieces.some(piece => piece.square === 'c3')).toBe(false)
  })

  it.each(['cure', 'shame'] as const)('shows two then one player turn before %s actually matures', timer => {
    let state = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'h1' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'white', type: 'rook', square: 'd4', affliction: timer === 'cure' ? 'guilt' : 'neutral' },
      { side: timer === 'cure' ? 'white' : 'black', type: 'bishop', square: 'e5' },
    ] })
    const label = timer === 'cure' ? 'До исцеления' : 'До следующего этапа стыда'
    const rook = () => state.pieces.find(piece => piece.square === 'd4')!
    expect(effectTiming(rook(), state)[timer]).toBe(2)
    expect(card(state, 'd4', 'ru')).toContain(`${label}: 2 хода игроков`)
    state = applyResolvedCommand(state, move('h1', 'g1')).state
    expect(effectTiming(rook(), state)[timer]).toBe(1)
    expect(card(state, 'd4', 'ru')).toContain(`${label}: 1 ход игрока`)
    expect(card(state, 'd4', 'en')).toContain('1 player turn')
    state = applyResolvedCommand(state, move('a8', 'b8')).state
    expect(rook().affliction).toBe(timer === 'cure' ? 'neutral' : 'guilt')
    expect(effectTiming(rook(), state)[timer]).toBe(timer === 'cure' ? null : 2)
  })

  it('includes the current unfinished turn when a new aura starts during a bonus', () => {
    const root = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'h1' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'white', type: 'rook', square: 'd4', affliction: 'bloodlust' },
      { side: 'white', type: 'bishop', square: 'd5' },
      { side: 'white', type: 'rook', square: 'e5', affliction: 'guilt' },
      { side: 'black', type: 'bishop', square: 'f6' },
    ] })
    // The friendly capture removes the rook's protection and starts a new
    // shame timer. The current turn has not ended while its bonus is offered.
    let state = applyResolvedCommand(root, move('d4', 'd5')).state
    const rook = () => state.pieces.find(piece => piece.square === 'e5')!
    expect(state).toMatchObject({ phase: 'bonus', turnSerial: 0 })
    expect(rook().shameArmedAt).toBe(1)
    expect(effectTiming(rook(), state).shame).toBe(3)
    expect(card(state, 'e5', 'ru')).toContain('До следующего этапа стыда: 3 хода игроков')
    expect(card(state, 'e5', 'ru')).not.toMatch(/цикл/)
    state = applyResolvedCommand(state, { type: 'endTurn' }).state
    expect(effectTiming(rook(), state).shame).toBe(2)
    state = applyResolvedCommand(state, move('a8', 'b8')).state
    expect(effectTiming(rook(), state).shame).toBe(1)
    state = applyResolvedCommand(state, move('h1', 'g1')).state
    expect(rook().affliction).toBe('devastated')
  })

  it('keeps status and active timers in the compact card, with full explanations behind Details', () => {
    const state = createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'h1' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'white', type: 'knight', square: 'c3', affliction: 'devastated' },
      { side: 'white', type: 'bishop', square: 'd3' },
    ] })
    const compact = card(state, 'c3', 'ru')
    expect(compact).toContain('data-compact="true"')
    expect(compact).toContain('data-state="devastated"')
    expect(compact).toContain('До исчезновения: 6 ходов игроков')
    expect(compact).toContain('До исцеления: 2 хода игроков')
    expect(compact).not.toContain('<details')
    expect(card(state, 'c3', 'ru', false)).toContain('<details')
  })
})
