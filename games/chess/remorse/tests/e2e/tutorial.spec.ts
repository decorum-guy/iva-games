import { expect, test } from './fixtures'
import type { Locator, Page, Route } from '@playwright/test'
import { createInitialState } from '../../src/core'
import type { Command } from '../../src/core/types'
import { countText, translator } from '../../src/i18n/catalog'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { restoreMatch } from '../../src/session/save'
import { advanceLesson, learnerAction, restoreLearning, saveLearning, scriptAction, startLesson } from '../../src/tutorial/controller'
import type { Learning } from '../../src/tutorial/controller'
import { move } from '../../src/tutorial/lessonTypes'
import type { Step } from '../../src/tutorial/lessonTypes'
import { LESSONS } from '../../src/tutorial/lessons'
import { describeEvent } from '../../src/ui/projections'
import { readRecords } from './qaRecords'

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)
const playfield = (page: Page) => page.getByTestId('playfield')
const tutorial = (page: Page) => page.getByTestId('tutorial')
const scriptedDiceNotice = /учебный бросок|tutorial roll|fixed roll|scripted roll|preset roll/i

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

async function restoreTutorialCheckpoint(page: Page, learning: Learning, legacy = false) {
  // Use the actual v1 saved format so this exercises existing users' progress,
  // not a test-only navigation shortcut or a freshly restarted lesson.
  const saved = saveLearning(learning)
  if (legacy) delete (saved as { pendingTeaching?: unknown }).pendingTeaching
  await page.evaluate(async value => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('remorse-v1')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('learning', 'readwrite')
        transaction.objectStore('learning').put(value, 'progress')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      localStorage.setItem('remorse-view-v1', 'learn')
    } finally {
      db.close()
    }
  }, saved)
  await page.reload()
  await expect(playfield(page)).toHaveAttribute('data-view', 'learn')
  await interactable(page)
  return saved
}

async function boardIdentity(page: Page) {
  return Promise.all([
    'data-game-id', 'data-revision', 'data-turn', 'data-active-side', 'data-phase',
  ].map(attribute => playfield(page).getAttribute(attribute)))
}

async function interactable(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false')
  await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'false')
}

function activate(locator: Locator, mobile: boolean) {
  return mobile ? locator.tap() : locator.click()
}

async function acknowledgeResults(page: Page, step: Step, locale: 'ru' | 'en', mobile: boolean) {
  const beats = step.beforePromotion ? [step.beforePromotion, ...(step.after ?? [])] : step.after ?? []
  for (const beat of beats) {
    await expect(tutorial(page)).toHaveAttribute('data-kind', 'result')
    await expect(tutorial(page)).toHaveAttribute('data-source-step', step.id)
    await expect(tutorial(page)).toHaveAttribute('data-beat', beat.id)
    if (beat === step.beforePromotion) await expectPromotionReaction(page, locale)
    else await interactable(page)
    await expect(tutorial(page).getByRole('heading', { name: beat.title[locale], exact: true })).toBeVisible()
    await expect(page.getByTestId('teaching-cause')).toHaveText(beat.text[locale])
    if (beat.rule) await expect(page.getByTestId('teaching-rule')).toHaveText(beat.rule[locale])
    else await expect(page.getByTestId('teaching-rule')).toHaveCount(0)
    if (beat.focus) {
      await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-square', beat.focus.square)
      await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-subject', beat.focus.subject)
    }
    if (beat.diceLegend) {
      const legend = page.getByTestId('dice-legend')
      for (const [state, faces] of [['devastated', '1'], ['guilt', '2–3'], ['unaffected', '4–5'], ['berserk', '6']] as const) {
        const entry = legend.locator(`[data-reaction="${state}"]`)
        await expect(entry).toContainText(faces)
        await expect(entry).toContainText(translator(locale)(`state.${state}`))
      }
      await expect(legend.locator('[data-reaction="unaffected"]')).toHaveAttribute('data-current', 'true')
    }
    const next = page.getByTestId('lesson-next')
    await expect(next).toHaveAccessibleName(beat.action?.[locale] ?? translator(locale)('tutorial.readAction'))
    await expect(next).toBeEnabled()
    await expect(next).toBeInViewport({ ratio: 1 })
    await expect(page.locator('.flat-board [draggable="true"]')).toHaveCount(0)
    await activate(next, mobile)
  }
}

async function expectPromotionReaction(page: Page, locale: 'ru' | 'en') {
  const t = translator(locale)
  const heading = locale === 'ru' ? 'Выпало 6 — ярость' : 'Rolled 6 — berserk'
  await expect(tutorial(page).getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await expect(playfield(page)).toHaveAttribute('data-promotion-stage', 'reaction')
  await expect(playfield(page)).toHaveAttribute('data-dice', 'settled')
  await expect(page.getByTestId('roll')).toHaveAttribute('data-face', '6')
  await expect(square(page, 'h8')).toHaveAccessibleName(t('game.cell', {
    square: 'h8', side: t('side.white'), piece: t('piece.pawn'), state: t('state.berserk'),
  }))
  await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-square', 'h8')
  await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-subject', 'piece')
  await expect(square(page, 'h8')).toHaveAttribute('data-teaching-focus', 'piece')
  await expect(page.getByTestId('end-turn')).toHaveCount(0)
  const next = page.getByTestId('lesson-next')
  await expect(next).toBeEnabled()
  await expect(next).toBeInViewport({ ratio: 1 })
}

for (const locale of ['ru', 'en'] as const) {
  test(`promotion waits with a visible berserk pawn and restores before formation · ${locale}`, async ({ page }) => {
    await page.setViewportSize(locale === 'ru' ? { width: 360, height: 800 } : { width: 844, height: 390 })
    await page.addInitScript(locale => {
      if (!localStorage.getItem('remorse-settings-v1')) {
        localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale, sound: false }))
      }
    }, locale)
    await page.goto('/remorse/')
    await expect(page.getByTestId('mode-learn')).toBeVisible()
    await restoreTutorialCheckpoint(page, startLesson(7, 1))
    await play(page, move('g7', 'h8', 'bishop'), false)
    await expect(page.getByTestId('teaching-cause')).toBeVisible()
    await expectPromotionReaction(page, locale)
    const held = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
    expect(held.match.actions.map(action => action.roll?.face)).toEqual([6])
    expect(held.pendingTeaching?.beforeFormation).toBe(true)
    await page.waitForTimeout(1550)
    await expectPromotionReaction(page, locale)
    expect(await recorded(page, 'learning', 'progress')).toEqual(held)

    await page.reload()
    await expectPromotionReaction(page, locale)
    await expect(page.getByTestId('die-throw')).toHaveCount(0)
    await page.getByTestId('leave-game').click()
    await page.getByRole('dialog').getByRole('button', { name: translator(locale)('nav.menu'), exact: true }).click()
    await page.getByTestId('mode-learn').click()
    await expectPromotionReaction(page, locale)
    expect(await recorded(page, 'learning', 'progress')).toEqual(held)

    await page.getByTestId('lesson-next').click()
    await expect(playfield(page)).toHaveAttribute('data-promotion-stage', 'formation')
    await expect(page.getByTestId('teaching-cause')).toHaveCount(0)
    await expect(page.getByTestId('teaching-cause')).toContainText(locale === 'ru' ? 'число взятий обнулилось' : 'capture count returns to zero')
    await expect(page.getByTestId('teaching-rule')).toContainText(locale === 'ru' ? 'бонус отменён' : 'the bonus is canceled')
    const t = translator(locale)
    await expect(square(page, 'h8')).toHaveAccessibleName(t('game.cell', {
      square: 'h8', side: t('side.white'), piece: t('piece.bishop'), state: t('state.neutral'),
    }))
    const formed = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
    expect(formed.match).toEqual(held.match)
    expect(formed.pendingTeaching?.beforeFormation).toBeUndefined()
    expect(await readRecords(page, 'ratingLedger')).toEqual([])
    expect(await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth])).toEqual([0, 0])
    await page.getByTestId('lesson-restart').click()
    await page.getByTestId('confirm-action').click()
    await expect(tutorial(page)).toHaveAttribute('data-step', 'promote-inherit')
    await expect(playfield(page)).toHaveAttribute('data-revision', '0')
    await expect(page.getByTestId('die-throw')).toHaveCount(0)
  })
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

async function setSecondaryDetails(page: Page, open: boolean) {
  const toggle = page.locator('button.toggle-sheet')
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', String(open))
}

async function verifyContinuation(page: Page, locale: 'en' | 'ru', mobile: boolean, helpedKnight: boolean) {
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
  const knight = handoff.root.pieces.find(piece => piece.square === 'c3')!
  await activate(square(page, knight.square), mobile)
  const inspector = page.getByTestId('inspector')
  const t = translator(locale)
  await expect(inspector).toHaveAttribute('data-compact', 'true')
  await expect(inspector).toHaveAttribute('data-state', 'devastated')
  await expect(inspector).toContainText(t('game.removalDue', { count: countText(locale, 'turn', 2) }))
  const healing = inspector.getByText(t('game.cureDue', { count: countText(locale, 'turn', 1) }), { exact: true })
  if (helpedKnight) await expect(healing).toBeVisible()
  else await expect(healing).toHaveCount(0)

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
  expect(restoreMatch(played).events).toContainEqual(expect.objectContaining({
    type: helpedKnight ? 'cure' : 'remove', piece: expect.objectContaining({ id: knight.id }),
  }))
  expect(await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')).toEqual(training)
  expect(await recorded(page, 'profiles', 'local')).toEqual(initialProfile)
  await changeLanguage(page, locale)
}

test('a held explanation survives the rules and menu, and restarting from the menu preserves a rated game', async ({ page }) => {
  const t = translator('en')
  await page.goto('/remorse/')
  await expect(page.getByTestId('mode-learn')).toBeVisible()
  await changeLanguage(page, 'en')
  await page.getByTestId('flat-mode').click()
  await page.getByTestId('mode-ai').click()
  await page.getByTestId('setup-rated').click()
  await page.locator('.setup-more > summary').click();
  await page.getByTestId('setup-white').click()
  await page.getByTestId('setup-start').click()
  await expect(playfield(page)).toHaveAttribute('data-mode', 'rated')
  await interactable(page)
  const ratedId = (await playfield(page).getAttribute('data-game-id'))!
  const rated = await recorded<MatchRecord>(page, 'matches', ratedId)
  const profile = await recorded(page, 'profiles', 'local')
  await page.getByTestId('leave-game').click()

  const held = learnerAction(startLesson(1), move('c3', 'c4')).progress
  const saved = saveLearning(restoreLearning(await restoreTutorialCheckpoint(page, held)))
  const before = await boardIdentity(page)
  await page.getByRole('button', { name: t('nav.rules'), exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByTestId('dialog-close').click()
  expect(await boardIdentity(page)).toEqual(before)

  async function returnToMenu() {
    await page.getByTestId('leave-game').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(t('tutorial.exitSaved'))
    await expect(dialog.getByRole('button', { name: t('tutorial.continue'), exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: t('nav.menu'), exact: true }).click()
    await expect(playfield(page)).toHaveAttribute('data-view', 'home')
  }
  await returnToMenu()
  await page.getByTestId('mode-learn').click()
  await expect(tutorial(page)).toHaveAttribute('data-source-step', 'guilt-roll')
  await expect(page.getByTestId('dice-reveal')).toHaveCount(0)
  expect(await boardIdentity(page)).toEqual(before)
  expect(await recorded(page, 'learning', 'progress')).toEqual(saved)
  await returnToMenu()

  const restart = page.getByRole('button', { name: t('tutorial.restartAll'), exact: true })
  await restart.click()
  await page.getByRole('dialog').getByRole('button', { name: t('nav.cancel'), exact: true }).click()
  expect(await recorded(page, 'learning', 'progress')).toEqual(saved)
  await restart.click()
  await page.getByTestId('confirm-action').click()
  await expect(tutorial(page)).toHaveAttribute('data-step', 'open-with-e4')
  expect(await recorded(page, 'learning', 'progress')).toMatchObject({ lesson: 0, position: 0, index: 0 })
  expect(await recorded(page, 'matches', ratedId)).toEqual(rated)
  expect(await recorded(page, 'profiles', 'local')).toEqual(profile)
})

for (const locale of ['ru', 'en'] as const) {
  test.describe(`complete tutorial · ${locale}`, () => {
    test.use({ hasTouch: true, reducedMotion: 'reduce' })

    test('the lesson 3 finish is a visible Continue action and lesson 4 highlights the permitted king move', async ({ page }, testInfo) => {
      const mobile = locale === 'en' || testInfo.project.name === 'webkit'
      await page.setViewportSize(mobile ? { width: 360, height: 800 } : { width: 1280, height: 800 })
      await page.goto('/remorse/')
      await expect(page.getByTestId('mode-learn')).toBeVisible()
      await changeLanguage(page, locale)
      await page.getByTestId('flat-mode').click()

      const nearExpiry = learnerAction(startLesson(2, 2), move('g2', 'g3')).progress
      const saved = await restoreTutorialCheckpoint(page, scriptAction(nearExpiry), true)
      await expect(tutorial(page)).toHaveAttribute('data-step', 'removal-material-only')
      expect(await recorded(page, 'learning', 'progress')).toEqual(saved)
      const before = await boardIdentity(page)

      for (const phase of ['read', 'position-complete']) {
        // New acknowledgements skip the empty completion page. Existing v1
        // saves can still resume on that page and must advance exactly once.
        if (phase === 'position-complete') {
          await restoreTutorialCheckpoint(page, advanceLesson(restoreLearning(saved)))
        }
        await expect(tutorial(page)).toHaveAttribute('data-kind', phase)
        // A core-legal king move must not be advertised as actionable while the
        // lesson asks for Continue. Clicking it cannot produce tutorialChoice.
        await activate(square(page, 'h1'), mobile)
        await expect(page.locator('.flat-board .mark-move, .flat-board .mark-capture, .flat-board .mark-friendly')).toHaveCount(0)
        await activate(square(page, 'g1'), mobile)
        expect(await boardIdentity(page)).toEqual(before)
        await expect(page.getByTestId('game-aside').getByText(translator(locale)('error.tutorialChoice'), { exact: true })).toHaveCount(0)
        await expect(page.getByTestId('lesson-next')).toBeInViewport()
        await expect(page.getByTestId('lesson-next')).toBeEnabled()
        await activate(page.getByTestId('lesson-next'), mobile)
        await expect(tutorial(page)).toHaveAttribute('data-step', 'start-two-cures')
      }

      await expect(tutorial(page)).toHaveAttribute('data-step', 'start-two-cures')
      await interactable(page)
      await play(page, move('c1', 'e3'), mobile)
      await acknowledgeResults(page, LESSONS[3].positions[0].steps.find(step => step.id === 'start-two-cures')!, locale, mobile)
      await expect(tutorial(page)).toHaveAttribute('data-step', 'cure-two-pieces')
      await interactable(page)
      await activate(square(page, 'h1'), mobile)
      await expect(square(page, 'g1')).toHaveClass(/mark-move/)
      await expect(square(page, 'g2')).not.toHaveClass(/mark-move/)
      await activate(square(page, 'g1'), mobile)
      await acknowledgeResults(page, LESSONS[3].positions[0].steps.find(step => step.id === 'cure-two-pieces')!, locale, mobile)
      await expect(tutorial(page)).toHaveAttribute('data-step', 'bishop-pacifism')
      const healed = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
      const state = restoreMatch(healed.match).state
      expect(state.pieces.find(piece => piece.square === 'e4')?.affliction).toBe('neutral')
      expect(state.pieces.find(piece => piece.square === 'f4')?.affliction).toBe('neutral')
      await expect(page.getByTestId('game-aside').getByText(translator(locale)('error.tutorialChoice'), { exact: true })).toHaveCount(0)
    })

    test('plays every lesson, restores mid-way, continues against the worker and starts a clean game', async ({ page }, testInfo) => {
      test.setTimeout(100_000)
      const mobile = locale === 'en' || testInfo.project.name === 'webkit'
      const helpedKnight = testInfo.project.name === 'chromium'
      await page.setViewportSize(mobile ? { width: 360, height: 800 } : { width: 1280, height: 800 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/remorse/')
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
          for (const [stepIndex, step] of position.steps.entries()) {
            if (step.kind === 'script') {
              const commandId = `${lessonIndex}/${positionIndex}/${stepIndex}/${step.id}`
              await expect.poll(async () => {
                const saved = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
                return saved.match.actions.some(action => action.id === commandId)
              }).toBe(true)
              await acknowledgeResults(page, step, locale, mobile)
              continue
            }
            await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
            if (step.id === 'practice-ready') {
              const result = page.getByTestId('choice-feedback')
              await expect(result).toHaveAttribute('data-feedback', helpedKnight ? 'healing' : 'unassisted')
              if (helpedKnight) {
                await expect(result).toContainText(locale === 'ru' ? 'после следующего хода белых' : 'after White’s next turn')
                await expect(page.getByTestId('choice-rule')).toContainText(countText(locale, 'turn', 2))
              } else {
                await expect(result).toContainText(locale === 'ru' ? 'после хода белых и ответа чёрных' : 'after White’s turn and Black’s reply')
              }
            } else {
              await expect(tutorial(page).getByText(step.text[locale], { exact: true })).toBeVisible()
            }
            await interactable(page)
            const offersEndTurn = step.kind === 'move' && step.moves !== 'open'
              && step.moves.some(command => command.type === 'endTurn')
            if (offersEndTurn) await expect(page.getByTestId('end-turn')).toBeEnabled()
            else await expect(page.getByTestId('end-turn')).toHaveCount(0)
            if (step.kind === 'read' || step.kind === 'inspect') {
              await expect(page.locator('.flat-board .mark-move, .flat-board .mark-capture, .flat-board .mark-friendly')).toHaveCount(0)
            }
            if (step.kind === 'read') {
              const finalReading = stepIndex === position.steps.length - 1
              const action = !finalReading ? 'tutorial.readAction'
                : positionIndex + 1 < lesson.positions.length ? 'tutorial.newPosition'
                  : lessonIndex + 1 < LESSONS.length ? 'tutorial.nextLesson' : 'tutorial.finishAction'
              await expect(page.getByTestId('lesson-next')).toHaveAccessibleName(translator(locale)(action))
            }
            if (step.id === 'guilt-forbids-capture') {
              const before = await boardIdentity(page)
              const saved = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
              const capture = restoreMatch(saved.match).events.find(event => event.type === 'capture')!
              const history = page.getByTestId('history')
              await setSecondaryDetails(page, true)
              await history.locator('summary').click()
              const original = describeEvent(translator(locale), capture)
              await expect(history.getByText(original, { exact: true })).toBeVisible()
              await expect(history).not.toContainText(scriptedDiceNotice)
              const alternate = locale === 'en' ? 'ru' : 'en'
              await changeLanguage(page, alternate)
              await expect(tutorial(page).getByText(step.text[alternate], { exact: true })).toBeVisible()
              const translated = describeEvent(translator(alternate), capture)
              expect(translated).not.toBe(original)
              await expect(history.getByText(translated, { exact: true })).toBeVisible()
              await expect(history).not.toContainText(scriptedDiceNotice)
              expect(await boardIdentity(page)).toEqual(before)
              await history.locator('summary').click()
              await setSecondaryDetails(page, false)
              await page.reload()
              await expect(playfield(page)).toHaveAttribute('data-view', 'learn')
              await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
              await expect(page.locator('html')).toHaveAttribute('lang', locale === 'en' ? 'ru' : 'en')
              expect(await boardIdentity(page)).toEqual(before)
              expect(await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')).toEqual(saved)
              await changeLanguage(page, locale)
            }

            if (step.kind === 'move') {
              const command = step.moves === 'open' ? helpedKnight ? move('f1', 'd3') : move('a1', 'a2') : step.moves[0]
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
                for (const kind of ['queen', 'rook', 'knight']) {
                  await expect(promotion.getByTestId(`promotion-${kind}`)).toBeVisible()
                  await expect(promotion.getByTestId(`promotion-${kind}`)).toBeEnabled()
                }
                // This lesson teaches inherited afflictions. Bishop rebirth is
                // the next position, so it must not look actionable here.
                const bishop = promotion.getByTestId('promotion-bishop')
                if (await bishop.count()) await expect(bishop).toBeDisabled()
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
              await expect(tutorial(page)).toHaveAttribute('data-kind', 'result')
              await expect(tutorial(page)).toHaveAttribute('data-source-step', step.id)
              await expect(page.getByTestId('game-aside').getByText(translator(locale)(`error.${step.reason}`), { exact: true })).toHaveCount(0)
              expect(await boardIdentity(page)).toEqual(before)
            } else if (step.kind === 'inspect') {
              const before = await boardIdentity(page)
              await activate(square(page, step.square), mobile)
              // Selecting the figure must leave time to examine its counter.
              // Only the explicit acknowledgement advances to Black's reply.
              await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
              await expect(page.getByTestId('lesson-next')).toHaveAccessibleName(translator(locale)('tutorial.readAction'))
              await expect(page.getByTestId('lesson-next')).toBeEnabled()
              expect(await boardIdentity(page)).toEqual(before)
              if (step.focus?.subject === 'countdown') {
                await expect(page.getByTestId('counter-read')).toBeVisible()
                await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-square', step.square)
                await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-subject', 'countdown')
                const counter = page.getByTestId('flat-counter')
                await expect(counter).toContainText('3')
                await expect(counter).toContainText(step.square)
                await expect(counter).toBeInViewport({ ratio: 1 })
                const boardBox = (await page.locator('.flat-board').boundingBox())!
                const counterBox = (await counter.boundingBox())!
                expect(counterBox.x >= boardBox.x + boardBox.width || counterBox.y >= boardBox.y + boardBox.height).toBe(true)
                await changeLanguage(page, locale === 'en' ? 'ru' : 'en')
                await expect(page.getByTestId('counter-read')).toBeVisible()
                await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
                await expect(page.locator('.board-stage')).toHaveAttribute('data-focus-square', step.square)
                expect(await boardIdentity(page)).toEqual(before)
                await changeLanguage(page, locale)
              }
              await activate(page.getByTestId('lesson-next'), mobile)
            } else {
              await activate(page.getByTestId('lesson-next'), mobile)
            }

            if (step.id === 'capture-and-roll') {
              const beat = step.after![0]
              await interactable(page)
              await expect(tutorial(page).getByRole('heading', { name: beat.title[locale], exact: true })).toBeVisible()
              await expect(page.getByTestId('teaching-cause')).toHaveText(beat.text[locale])
              await expect(tutorial(page)).not.toContainText(scriptedDiceNotice)
              const saved = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
              expect(saved.match.actions.at(-1)?.roll?.face).toBe(4)
              const before = await boardIdentity(page)
              const alternate = locale === 'en' ? 'ru' : 'en'
              await changeLanguage(page, alternate)
              await expect(tutorial(page).getByRole('heading', { name: beat.title[alternate], exact: true })).toBeVisible()
              await expect(page.getByTestId('teaching-cause')).toHaveText(beat.text[alternate])
              await expect(tutorial(page)).toHaveAttribute('data-beat', beat.id)
              expect(await boardIdentity(page)).toEqual(before)
              expect(await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')).toEqual(saved)
              await changeLanguage(page, locale)
              await expect(page.locator('.player-row[data-side="white"] .trophy-group')).toHaveCount(1)
              await expect(page.locator('.player-row[data-side="white"] .material')).toHaveText('+1')
            }
            await acknowledgeResults(page, step, locale, mobile)
            if (step.id === 'friendly-capture') {
              await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus')
              await expect(tutorial(page)).toHaveAttribute('data-step', 'decline-optional-bonus')
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
          const lastStep = position.steps.at(-1)
          const advancedWithAcknowledgement = Boolean(lastStep?.after?.length) || lastStep?.kind === 'read'
          if (!final && !advancedWithAcknowledgement) {
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

      await verifyContinuation(page, locale, mobile, helpedKnight)
      await page.getByTestId('leave-game').click()
      await page.getByTestId('mode-learn').click()
      await expect(tutorial(page)).toHaveAttribute('data-step', 'complete')
      expect(await boardIdentity(page)).toEqual(completed)
      await page.getByTestId('lesson-new').click()
      await page.getByTestId('setup-practice').click()
      await page.locator('.setup-more > summary').click();
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
