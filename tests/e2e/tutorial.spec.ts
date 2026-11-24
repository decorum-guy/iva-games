import { expect, test } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'
import { createInitialState } from '../../src/core'
import type { Command } from '../../src/core/types'
import { translator } from '../../src/i18n/catalog'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { restoreMatch } from '../../src/session/save'
import type { saveLearning } from '../../src/tutorial/controller'
import { move } from '../../src/tutorial/lessonTypes'
import { LESSONS } from '../../src/tutorial/lessons'
import { describeEvent } from '../../src/ui/projections'

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const playfield = (page: Page) => page.getByTestId('playfield')
const tutorial = (page: Page) => page.getByTestId('tutorial')

async function recorded<T>(page: Page, store: string, key: string): Promise<T> {
  const value = await page.evaluate(async ({ store, key }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('remorse-v1')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const query = db.transaction(store).objectStore(store).get(key)
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })
    } finally {
      db.close()
    }
  }, { store, key })
  return value as T
}

async function boardIdentity(page: Page) {
  return Promise.all([
    'data-game-id', 'data-revision', 'data-turn', 'data-active-side', 'data-phase',
  ].map(attribute => playfield(page).getAttribute(attribute)))
}

async function interactable(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false')
}

function activate(locator: Locator, mobile: boolean) {
  return mobile ? locator.tap() : locator.click()
}

async function play(page: Page, command: Command, mobile: boolean) {
  if (command.type === 'endTurn') {
    await activate(page.getByTestId('end-turn'), mobile)
    return
  }
  if (command.type !== 'move') throw new Error('Unexpected tutorial input')
  await activate(square(page, command.from), mobile)
  await activate(square(page, command.to), mobile)
  if (command.promotion) {
    await activate(page.getByTestId(`promotion-${command.promotion}`), mobile)
  }
}

async function changeLanguage(page: Page, locale: 'en' | 'ru', scope: Page | Locator = page) {
  await scope.getByTestId(`lang-${locale}`).click()
  await expect(page.locator('html')).toHaveAttribute('lang', locale)
}

async function verifyContinuation(page: Page, locale: 'en' | 'ru', mobile: boolean) {
  const state = playfield(page)
  const initialProfile = await recorded(page, 'profiles', 'local')
  const training = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
  const snapshot = restoreMatch(training.match)
  const oldID = snapshot.record.id
  const turn = snapshot.state.turnSerial
  await page.getByTestId('lesson-continue').click()
  await expect(state).toHaveAttribute('data-mode', 'practice')
  await expect(state).toHaveAttribute('data-turn', String(turn))
  await expect(state).toHaveAttribute('data-active-side', 'white')
  const id = (await state.getAttribute('data-game-id'))!
  expect(id).not.toBe(oldID)
  const handoff = await recorded<MatchRecord>(page, 'matches', id)
  expect(handoff.config).toMatchObject({ level: 4, mode: 'practice', provenance: 'handoff' })
  expect(handoff.root).toEqual(snapshot.state)
  expect(handoff.rootLedger.map(event => event.victim.square)).toEqual(['c5'])
  expect(handoff.actions).toHaveLength(0)

  // Delay only module loading, then let the actual worker complete and submit its command.
  let releaseWorker = () => {}
  const gate = new Promise<void>(resolve => { releaseWorker = resolve })
  let workerRequested = false
  const pattern = /\/search\.worker[^/]*(?:\?.*)?$/
  const delayWorker = async (route: Route) => {
    workerRequested = true
    await gate
    await route.continue()
  }
  await page.route(pattern, delayWorker, { times: 1 })
  try {
    await interactable(page)
    await play(page, move('h3', 'g4'), mobile)
    await expect(state).toHaveAttribute('data-revision', '1')
    const capture = await recorded<MatchRecord>(page, 'matches', id)
    expect(capture.actions[0]).toMatchObject({
      actor: 'white', command: move('h3', 'g4'), roll: { face: nextDie(handoff.rootSeed).face, fixed: false },
    })
    if (await state.getAttribute('data-phase') === 'bonus') {
      await interactable(page)
      await play(page, { type: 'endTurn' }, mobile)
    }
    await expect.poll(() => workerRequested).toBe(true)
    await expect(state).toHaveAttribute('data-thinking', 'true')
    const waiting = await boardIdentity(page)
    await changeLanguage(page, locale === 'ru' ? 'en' : 'ru')
    expect(await boardIdentity(page)).toEqual(waiting)
    await expect(state).toHaveAttribute('data-thinking', 'true')
  } finally {
    releaseWorker()
  }
  await expect(state).toHaveAttribute('data-active-side', 'white')
  await expect(state).toHaveAttribute('data-turn', String(turn + 2))
  const played = await recorded<MatchRecord>(page, 'matches', id)
  expect(played.actions.some(action => action.actor === 'black')).toBe(true)
  expect(played.actions.filter(action => action.actor === 'white' && action.command.type === 'move')).toHaveLength(1)
  expect(await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')).toEqual(training)
  expect(await recorded(page, 'profiles', 'local')).toEqual(initialProfile)
  await changeLanguage(page, locale)
}

for (const locale of ['ru', 'en'] as const) {
  test.describe(`complete tutorial · ${locale}`, () => {
    test.use({ hasTouch: true, reducedMotion: 'reduce' })

    test('plays every lesson, restores mid-way, continues against the worker and starts a clean game', async ({ page }, testInfo) => {
      test.setTimeout(100_000)
      const mobile = locale === 'en' || testInfo.project.name === 'webkit'
      await page.setViewportSize(mobile ? { width: 360, height: 800 } : { width: 1280, height: 800 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/')
      await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
      if (locale === 'en') await changeLanguage(page, 'en')
      else await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
      await page.getByTestId('mode-learn').click()
      await page.getByTestId('flat-mode').click()
      await expect(page.locator('[data-renderer="2d"]')).toBeVisible()
      if (mobile) {
        await interactable(page)
        await play(page, move('e2', 'e4'), true)
        await expect(tutorial(page)).toHaveAttribute('data-kind', 'script')
        const started = await boardIdentity(page)
        await page.getByTestId('lesson-restart').tap()
        await page.getByTestId('confirm-action').tap()
        await expect(tutorial(page)).toHaveAttribute('data-step', 'open-with-e4')
        await expect(playfield(page)).not.toHaveAttribute('data-game-id', started[0]!)
        // Observe past the reduced-motion script delay to catch an obsolete opposing move.
        await page.waitForTimeout(360)
        await expect(playfield(page)).toHaveAttribute('data-turn', '0')
        await expect(playfield(page)).toHaveAttribute('data-revision', '0')
      }

      for (const [lessonIndex, lesson] of LESSONS.entries()) {
        await expect(tutorial(page)).toHaveAttribute('data-lesson', lesson.id)
        await expect(tutorial(page).getByText(lesson.title[locale], { exact: true })).toBeVisible()
        for (const [positionIndex, position] of lesson.positions.entries()) {
          await expect(tutorial(page)).toHaveAttribute('data-position', String(positionIndex))
          for (const step of position.steps) {
            if (step.kind === 'script') continue
            await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
            await expect(tutorial(page).getByText(step.text[locale], { exact: true })).toBeVisible()
            await interactable(page)
            if (step.id === 'guilt-forbids-capture') {
              const before = await boardIdentity(page)
              const saved = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
              const capture = restoreMatch(saved.match).events.find(event => event.type === 'capture')!
              const history = page.getByTestId('history')
              await history.locator('summary').click()
              const original = describeEvent(translator(locale), capture, true)
              await expect(history.getByText(original, { exact: true })).toBeVisible()
              const alternate = locale === 'en' ? 'ru' : 'en'
              await changeLanguage(page, alternate)
              await expect(tutorial(page).getByText(step.text[alternate], { exact: true })).toBeVisible()
              const translated = describeEvent(translator(alternate), capture, true)
              expect(translated).not.toBe(original)
              await expect(history.getByText(translated, { exact: true })).toBeVisible()
              expect(await boardIdentity(page)).toEqual(before)
              await page.reload()
              await expect(playfield(page)).toHaveAttribute('data-view', 'learn')
              await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
              await expect(page.locator('html')).toHaveAttribute('lang', locale === 'en' ? 'ru' : 'en')
              expect(await boardIdentity(page)).toEqual(before)
              expect(await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')).toEqual(saved)
              await changeLanguage(page, locale)
            }

            if (step.kind === 'move') {
              const command = step.moves === 'open' ? move('a1', 'a2') : step.moves[0]
              if (step.id === 'open-with-e4' && !mobile) {
                const board = page.locator('.board-stage')
                await board.focus()
                await board.press('Enter')
                await board.press('ArrowUp')
                await board.press('ArrowUp')
                await board.press('Enter')
              } else if (step.id === 'promote-inherit' && command.type === 'move') {
                const before = await boardIdentity(page)
                await activate(square(page, command.from), mobile)
                await activate(square(page, command.to), mobile)
                const promotion = page.locator('.promotion-dialog[open]')
                for (const kind of ['queen', 'rook', 'bishop', 'knight']) {
                  await expect(promotion.getByTestId(`promotion-${kind}`)).toBeVisible()
                }
                await changeLanguage(page, locale === 'en' ? 'ru' : 'en', promotion)
                expect(await boardIdentity(page)).toEqual(before)
                await changeLanguage(page, locale, promotion)
                await activate(promotion.getByTestId(`promotion-${command.promotion}`), mobile)
              } else {
                await play(page, command, mobile)
              }
            } else if (step.kind === 'illegal') {
              const before = await boardIdentity(page)
              await play(page, step.move, mobile)
              await expect(tutorial(page)).not.toHaveAttribute('data-step', step.id)
              await expect(page.getByTestId('game-aside').getByText(translator(locale)(`error.${step.reason}`), { exact: true })).toBeVisible()
              expect(await boardIdentity(page)).toEqual(before)
            } else if (step.kind === 'inspect') {
              await activate(square(page, step.square), mobile)
            } else {
              await activate(page.getByTestId('lesson-next'), mobile)
            }

            if (step.id === 'capture-and-roll') {
              const roll = page.getByTestId('roll')
              await expect(roll).toHaveAttribute('data-face', '4')
              await expect(roll).toHaveAttribute('data-fixed', 'true')
              await expect(roll).toContainText(translator(locale)('die.tutorial'))
              const before = await boardIdentity(page)
              const alternate = locale === 'en' ? 'ru' : 'en'
              await changeLanguage(page, alternate)
              await expect(roll).toHaveAttribute('data-face', '4')
              await expect(roll).toContainText(translator(alternate)('die.tutorial'))
              expect(await boardIdentity(page)).toEqual(before)
              await changeLanguage(page, locale)
              await expect(page.locator('.player-row[data-side="white"] .trophy-group')).toHaveCount(1)
              await expect(page.locator('.player-row[data-side="white"] .material')).toHaveText('+1')
            }
            if (step.id === 'friendly-capture') {
              await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus')
              await expect(page.getByTestId('end-turn')).toBeVisible()
              const bonus = await boardIdentity(page)
              await changeLanguage(page, locale === 'en' ? 'ru' : 'en')
              await expect(page.getByTestId('end-turn')).toBeVisible()
              expect(await boardIdentity(page)).toEqual(bonus)
              await changeLanguage(page, locale)
              await expect(page.locator('.player-row')).toHaveCount(2)
              await page.screenshot({ path: testInfo.outputPath('lesson-bonus.png') })
              expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
              if (mobile) {
                await page.setViewportSize({ width: 390, height: 844 })
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
                await expect(page.getByTestId('end-turn')).toBeInViewport()
                await page.setViewportSize({ width: 844, height: 390 })
                await expect(page.getByTestId('end-turn')).toBeVisible()
                expect(await boardIdentity(page)).toEqual(bonus)
                await page.setViewportSize({ width: 360, height: 800 })
              }
            }
          }
          const final = lessonIndex === LESSONS.length - 1 && positionIndex === lesson.positions.length - 1
          if (!final) {
            await expect(tutorial(page)).toHaveAttribute('data-step', 'position-complete')
            await interactable(page)
            await activate(page.getByTestId('lesson-next'), mobile)
          }
        }
      }

      await expect(tutorial(page)).toHaveAttribute('data-step', 'complete')
      const completed = await boardIdentity(page)
      await page.getByTestId('lesson-new').click()
      await page.getByTestId('setup-cancel').click()
      await expect(tutorial(page)).toHaveAttribute('data-step', 'complete')
      expect(await boardIdentity(page)).toEqual(completed)

      await verifyContinuation(page, locale, mobile)
      await page.getByTestId('leave-game').click()
      await page.getByTestId('mode-learn').click()
      await expect(tutorial(page)).toHaveAttribute('data-step', 'complete')
      expect(await boardIdentity(page)).toEqual(completed)
      await page.getByTestId('lesson-new').click()
      await page.getByTestId('setup-practice').click()
      await page.getByTestId('setup-white').click()
      await page.getByTestId('setup-start').click()
      await expect(playfield(page)).toHaveAttribute('data-mode', 'practice')
      await expect(playfield(page)).toHaveAttribute('data-turn', '0')
      await expect(playfield(page)).toHaveAttribute('data-revision', '0')
      const gameId = (await playfield(page).getAttribute('data-game-id'))!
      expect(gameId).not.toBe(completed[0])
      const clean = await recorded<MatchRecord>(page, 'matches', gameId)
      expect(clean.root).toEqual(createInitialState())
      expect(clean.rootLedger).toEqual([])
      expect(clean.config.provenance).toBe('standard')
      expect(errors).toEqual([])
    })
  })
}
