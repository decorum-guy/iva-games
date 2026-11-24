import { describe, expect, it } from 'vitest'
import { AFFLICTIONS, PIECE_TYPES, REACTIONS, SIDES } from '../core'
import { PRESETS } from '../engine/presets'
import { LESSONS } from '../tutorial/lessons'
import { countText, dateText, messages, numberText, translator } from './catalog'
import type { Message } from './catalog'
import { digitalRules, rulesMeta, sourceRules } from './rules'

const locales = ['ru', 'en'] as const

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map(([, name]) => name))].sort()
}

describe('Russian and English catalogs', () => {
  it('provides a complete pair with the same interpolation contract for every semantic message', () => {
    for (const key of Object.keys(messages) as Message[]) {
      const [ru, en] = messages[key]
      expect(ru.trim(), `${key} in Russian`).not.toBe('')
      expect(en.trim(), `${key} in English`).not.toBe('')
      const keys = placeholders(en)
      expect(placeholders(ru), key).toEqual(keys)
      const parameters = Object.fromEntries(keys.map(name => [name, 'Sample']))
      for (const locale of locales) {
        const translated = translator(locale)(key, parameters)
        expect(translated, key).not.toBe(key)
        expect(placeholders(translated), key).toEqual([])
      }
    }
  })

  it('diagnoses unknown keys and missing parameters in development', () => {
    for (const locale of locales) {
      expect(() => translator(locale)('unknown' as Message)).toThrow('Unknown message')
      expect(() => translator(locale)('setup.levelValue', { level: 4 })).toThrow('Missing parameter elo')
    }
  })

  it('localizes the complete piece, state, side and ten-opponent selectors', () => {
    for (const locale of locales) {
      const t = translator(locale)
      for (const side of SIDES) expect(t(`side.${side}`)).toMatch(/\p{L}/u)
      for (const type of PIECE_TYPES) expect(t(`piece.${type}`)).toMatch(/\p{L}/u)
      for (const state of [...AFFLICTIONS, ...REACTIONS]) expect(t(`state.${state}`)).toMatch(/\p{L}/u)
      const options = PRESETS.map(preset => t('setup.levelValue', { level: preset.id, elo: preset.anchor }))
      expect(new Set(options)).toHaveProperty('size', 10)
      options.forEach((label, index) => expect(label).toContain(`≈${PRESETS[index].anchor}`))
    }
  })

  it('authors every rule and lesson in both languages under unique IDs', () => {
    const sections = [...sourceRules, ...digitalRules]
    expect(new Set(sections.map(section => section.id))).toHaveProperty('size', sections.length)
    const steps = LESSONS.flatMap(lesson => lesson.positions.flatMap(position => position.steps))
    expect(new Set(steps.map(step => step.id))).toHaveProperty('size', steps.length)
    expect(new Set(LESSONS.map(lesson => lesson.id))).toHaveProperty('size', LESSONS.length)
    const pairs = [
      ...sections.flatMap(section => [section.title, ...section.body]),
      ...LESSONS.map(lesson => lesson.title), ...steps.map(step => step.text),
      ...Object.values(rulesMeta),
    ]
    for (const pair of pairs) {
      expect(pair.ru).toMatch(/[а-яё]/i)
      expect(pair.en).toMatch(/[a-z]/i)
      expect(pair.en).not.toMatch(/[а-яё]/i)
    }
  })

  it.each([
    [1, '1 полный цикл', '1 взятие'],
    [2, '2 полных цикла', '2 взятия'],
    [5, '5 полных циклов', '5 взятий'],
    [11, '11 полных циклов', '11 взятий'],
    [21, '21 полный цикл', '21 взятие'],
    [22, '22 полных цикла', '22 взятия'],
    [0.5, '0,5 полного цикла', '0,5 взятия'],
  ] as const)('uses Russian plural forms for %s', (value, cycles, captures) => {
    expect(countText('ru', 'cycle', value)).toBe(cycles)
    expect(countText('ru', 'capture', value)).toBe(captures)
  })

  it('uses English singular and plural and formats dates and large numbers by locale', () => {
    expect(countText('en', 'cycle', 1)).toBe('1 full cycle')
    expect(countText('en', 'cycle', 2)).toBe('2 full cycles')
    expect(countText('en', 'capture', 1)).toBe('1 capture')
    expect(countText('en', 'capture', 0)).toBe('0 captures')
    expect(numberText('en', 2200)).toBe('2,200')
    expect(numberText('ru', 2200)).toMatch(/^2\s200$/)
    const date = Date.UTC(2026, 10, 24, 12)
    expect(dateText('en', date)).toMatch(/Nov/)
    expect(dateText('ru', date)).toMatch(/нояб/)
  })
})
