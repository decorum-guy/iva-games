import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { createPosition } from '../../src/core'
import type { Affliction, DieFace, Side } from '../../src/core'
import { countText, translator } from '../../src/i18n/catalog'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { sampleWindow } from '../../src/scene/audioSamples'
import { actionPlan } from '../../src/scene/actionPresentation'
import type { ActionPlan } from '../../src/scene/actionPresentation'
import { learnerAction, saveLearning, scriptAction, startLesson } from '../../src/tutorial/controller'
import type { Learning } from '../../src/tutorial/controller'
import { move } from '../../src/tutorial/lessonTypes'
import { LESSONS } from '../../src/tutorial/lessons'

const hotseat = { mode: 'hotseat', level: null, human: null, provenance: 'standard' } as const
const playfield = (page: Page) => page.getByTestId('playfield')
const cell = (page: Page, square: string) => page.locator(`[data-square="${square}"]`)
const diceExplanations = /учебный бросок|фиксированный бросок|tutorial roll|fixed roll|scripted roll|preset roll/i

test.use({ hasTouch: true, reducedMotion: 'no-preference' })

async function ready(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false')
  await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'false')
}

async function open(page: Page, locale: 'ru' | 'en' = 'en', reduce = true) {
  await page.addInitScript(({ locale, reduce }) => {
    if (!localStorage.getItem('remorse-settings-v1')) {
      // Leave sound and volume absent to exercise their actual product defaults.
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale, reduce }))
    }
  }, { locale, reduce })
  await page.goto('/remorse/')
  await expect(page.getByTestId('mode-ai')).toBeVisible()
}

async function persist(page: Page, store: 'matches' | 'learning', value: MatchRecord | ReturnType<typeof saveLearning>, view: string) {
  await page.evaluate(async ({ store, value, view }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite')
        if (store === 'learning') transaction.objectStore(store).put(value, 'progress')
        else transaction.objectStore(store).put(value)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        transaction.onerror = () => reject(transaction.error)
      })
      localStorage.setItem('remorse-view-v1', view)
    } finally {
      db.close()
    }
  }, { store, value, view })
  await page.reload()
  await expect(playfield(page)).toHaveAttribute('data-view', view === 'home' ? view : store === 'learning' ? 'learn' : 'game')
  await ready(page)
}

async function restoreGame(page: Page, record: MatchRecord) {
  await persist(page, 'matches', record, `game/${record.id}`)
  await expect(playfield(page)).toHaveAttribute('data-game-id', record.id)
}

async function restoreLesson(page: Page, progress: Learning, legacy = false) {
  const saved = saveLearning(progress)
  if (legacy) delete (saved as { pendingTeaching?: unknown }).pendingTeaching
  await persist(page, 'learning', saved, 'learn')
  await expect(playfield(page)).toHaveAttribute('data-game-id', progress.session.record.id)
}

async function recorded<T>(page: Page, store: 'matches' | 'learning', key: string): Promise<T> {
  return await page.evaluate(async ({ store, key }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  }, { store, key })
}

function captureFixture(side: Side, face: DieFace) {
  const from = side === 'white' ? 'c3' : 'f6'
  const to = side === 'white' ? 'c4' : 'f5'
  const seed = Array.from({ length: 100 }, (_, i) => i).find(seed => nextDie(seed).face === face)!
  const root = createPosition({ side, pieces: [
    { side: 'white', type: 'king', square: 'h1' },
    { side: 'black', type: 'king', square: 'a8' },
    { side, type: 'rook', square: from },
    { side: side === 'white' ? 'black' : 'white', type: 'pawn', square: to },
  ] })
  const before = createMatch(hotseat, { root, seed })
  const after = before.submit(before.envelope(move(from, to)), 'human')
  expect(after.record.actions[0].roll).toEqual({ face, fixed: false })
  return { before, after, from, to, side, face }
}

async function noDocumentScroll(page: Page) {
  const dimensions = await page.evaluate(() => {
    const root = document.scrollingElement!
    window.scrollTo(1000, 1000)
    return {
      width: window.innerWidth, height: window.innerHeight,
      scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight,
      scrollX: window.scrollX, scrollY: window.scrollY,
    }
  })
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height + 1)
  expect(dimensions.scrollX).toBe(0)
  expect(dimensions.scrollY).toBe(0)
}

async function visibleAction(button: Locator) {
  await expect(button).toBeEnabled()
  await expect(button).toBeInViewport({ ratio: 1 })
}

for (const viewport of [
  { width: 1440, height: 900, locale: 'en' },
  { width: 1512, height: 715, locale: 'ru' },
  { width: 1280, height: 800, locale: 'ru' },
  { width: 390, height: 844, locale: 'en' },
  { width: 360, height: 800, locale: 'ru' },
  { width: 844, height: 390, locale: 'en' },
  { width: 568, height: 320, locale: 'ru' },
] as const) {
  test(`${viewport.width}×${viewport.height}: the game and tutorial keep the current action on screen`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await open(page, viewport.locale)
    const fixture = captureFixture('white', 6)
    await restoreGame(page, fixture.after.record)
    await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus')
    await page.locator('.board-stage').press('ArrowRight')
    const clearance = await page.getByTestId('board').evaluate(table => {
      const stage = table.querySelector<HTMLElement>('.board-stage')!
      const [far, near] = table.querySelectorAll('.player-detail')
      const board = stage.getBoundingClientRect()
      const outline = getComputedStyle(stage)
      const outside = Math.max(0, parseFloat(outline.outlineOffset) + parseFloat(outline.outlineWidth))
      return Math.min(board.top - far.getBoundingClientRect().bottom, near.getBoundingClientRect().top - board.bottom) - outside
    })
    expect(clearance).toBeGreaterThanOrEqual(0)
    await noDocumentScroll(page)
    await visibleAction(page.getByTestId('end-turn'))
    await visibleAction(page.getByTestId('sound-toggle'))
    await page.getByTestId('end-turn').click()
    await ready(page)
    await expect(playfield(page)).toHaveAttribute('data-active-side', 'black')
    const timed = createMatch(hotseat, { root: createPosition({ pieces: [
      { side: 'white', type: 'king', square: 'h1' },
      { side: 'black', type: 'king', square: 'a8' },
      { side: 'white', type: 'knight', square: 'c3', affliction: 'devastated' },
      { side: 'white', type: 'bishop', square: 'd3' },
    ] }) })
    await restoreGame(page, timed.record)
    await cell(page, 'c3').click()
    const selected = page.getByTestId('inspector')
    await expect(page.locator('button.toggle-sheet')).toHaveAttribute('aria-expanded', 'false')
    await expect(selected).toHaveAttribute('data-compact', 'true')
    await expect(selected).toHaveAttribute('data-state', 'devastated')
    await expect(selected.locator('.inspector-timers > span')).toHaveCount(2)
    await expect(selected).toBeInViewport({ ratio: 1 })
    await expect(selected.locator('details')).toHaveCount(0)
    await expect(page.getByTestId('game-aside')).toHaveJSProperty('scrollTop', 0)
    expect(await page.getByTestId('game-aside').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    await noDocumentScroll(page)

    const checkpoint = scriptAction(learnerAction(startLesson(2, 2), move('g2', 'g3')).progress)
    await restoreLesson(page, checkpoint, true)
    const lesson = page.getByTestId('tutorial')
    const next = page.getByTestId('lesson-next')
    const t = translator(viewport.locale)
    await expect(lesson).toHaveAttribute('data-step', 'removal-material-only')
    await expect(playfield(page)).toHaveAttribute('data-tutorial-mode', 'read')
    await expect(lesson.locator('.lesson-action-label')).toHaveText(t('tutorial.readCue'))
    await expect(next).toHaveAccessibleName(t('tutorial.nextLesson'))
    await visibleAction(next)
    await noDocumentScroll(page)
    expect(await lesson.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
    const dim = await playfield(page).evaluate(element => getComputedStyle(element, '::before').backgroundColor)
    expect(dim).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)

    const revision = await playfield(page).getAttribute('data-revision')
    await expect(cell(page, 'h1')).toHaveAttribute('draggable', 'false')
    await expect(page.locator('.flat-board [draggable="true"]')).toHaveCount(0)
    await cell(page, 'h1').click()
    await cell(page, 'g1').click()
    await expect(playfield(page)).toHaveAttribute('data-revision', revision!)
    await expect(page.locator('.flat-board .mark-move, .flat-board .mark-capture, .flat-board .mark-friendly')).toHaveCount(0)
    await expect(page.getByTestId('game-aside')).not.toContainText(t('error.tutorialChoice'))
    await visibleAction(next)
    await next.click()

    await expect(lesson).toHaveAttribute('data-step', 'start-two-cures')
    await expect(lesson.locator('.lesson-target')).toContainText('c1')
    await expect(lesson.locator('.lesson-target')).toContainText('e3')
    await expect(cell(page, 'c1')).toHaveClass(/mark-lesson/)
    await expect(cell(page, 'e3')).toHaveClass(/mark-lesson/)
    await expect(lesson.locator('.lesson-instruction')).toBeInViewport({ ratio: 1 })
    await noDocumentScroll(page)
  })
}

test('phone layouts keep a recorded roll, the bonus action and both selected-piece deadlines visible in either language', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 })
  await open(page, 'ru')
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 6)!
  const match = createMatch(hotseat, { seed, root: createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'h1' }, { side: 'black', type: 'king', square: 'a8' },
    { side: 'white', type: 'rook', square: 'c3' }, { side: 'black', type: 'pawn', square: 'c4' },
    { side: 'white', type: 'knight', square: 'c6', affliction: 'devastated' }, { side: 'white', type: 'bishop', square: 'd6' },
  ] }) })
  const captured = match.submit(match.envelope(move('c3', 'c4')), 'human')
  await restoreGame(page, captured.record)
  await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus')
  await cell(page, 'c6').tap()
  const timers = page.getByTestId('inspector').locator('.inspector-timers')
  const end = page.getByTestId('end-turn')
  for (const [width, height] of [[568, 320], [844, 390], [360, 800], [390, 844]]) {
    await page.setViewportSize({ width, height })
    for (const locale of ['ru', 'en'] as const) {
      await page.getByTestId(`lang-${locale}`).tap()
      const t = translator(locale)
      await expect(timers.getByText(t('game.removalDue', { count: countText(locale, 'turn', 6) }), { exact: true })).toBeInViewport({ ratio: 1 })
      await expect(timers.getByText(t('game.cureDue', { count: countText(locale, 'turn', 2) }), { exact: true })).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('roll')).toBeInViewport({ ratio: 1 })
      await expect(page.locator('.flat-board')).toBeInViewport({ ratio: 1 })
      await visibleAction(end)
      await noDocumentScroll(page)
    }
  }
  await page.setViewportSize({ width: 568, height: 320 })
  await page.getByTestId('lang-ru').tap()
  await end.tap()
  await ready(page)
  await expect(playfield(page)).toHaveAttribute('data-turn', '1')
  const t = translator('ru')
  await expect(timers.getByText(t('game.removalDue', { count: countText('ru', 'turn', 5) }), { exact: true })).toBeVisible()
  await expect(timers.getByText(t('game.cureDue', { count: countText('ru', 'turn', 1) }), { exact: true })).toBeVisible()
})

test('sound starts enabled and remembers both mute and the selected volume', async ({ page }) => {
  await open(page)
  const sound = page.getByTestId('sound-toggle')
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('settings').click()
  const settings = page.getByRole('dialog')
  const volume = settings.getByRole('slider', { name: translator('en')('settings.volume') })
  await expect(volume).toHaveValue('65')
  await volume.press('Home')
  for (let i = 0; i < 7; i++) await volume.press('ArrowRight')
  await expect(volume).toHaveValue('35')
  await settings.getByTestId('dialog-close').click()
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('remorse-settings-v1')!))).toMatchObject({ sound: false, volume: .35 })

  await page.reload()
  await expect(page.getByTestId('mode-ai')).toBeVisible()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('settings').click()
  await expect(volume).toHaveValue('35')
  await expect(volume).toBeDisabled()
  await settings.getByRole('checkbox', { name: translator('en')('settings.sound'), exact: true }).check()
  await expect(volume).toBeEnabled()
  await expect(volume).toHaveValue('35')
  await settings.getByTestId('dialog-close').click()
  await page.reload()
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('settings').click()
  await expect(volume).toHaveValue('35')
})

async function committedThrow(page: Page, face: DieFace, actor: Side, affliction: Affliction, plan: ActionPlan, target: string, teaching = false) {
  const reveal = page.getByTestId('dice-reveal')
  const die = page.getByTestId('die-throw')
  const roll = plan.roll!
  await expect(playfield(page)).toHaveAttribute('data-awaiting-reaction', 'true')
  await page.clock.runFor(roll.start - 1)
  await expect(die).toHaveCount(0)
  await page.clock.runFor(1)
  await expect(playfield(page)).toHaveAttribute('data-dice', 'throwing')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'true')
  await expect(page.locator('[data-renderer="2d"]')).toBeVisible()
  await expect(reveal).toHaveAttribute('data-actor', actor)
  await expect(die).toHaveAttribute('data-face', String(face))
  await expect(die.locator('canvas')).toBeVisible()
  await expect(die.locator('[data-die-renderer="fallback"]')).toHaveCount(0)
  await expect(reveal.locator('.dice-actor')).toHaveText(translator('en')('die.actor', { side: translator('en')(`side.${actor}`) }))
  await expect(page.locator('body')).not.toContainText(diceExplanations)

  // Inspect the committed presentation at each boundary.
  await page.clock.runFor(roll.settle - roll.start - 1)
  await expect(reveal).toHaveAttribute('data-phase', 'throwing')
  await expect(die).toHaveAttribute('data-phase', 'throwing')
  await page.clock.runFor(1)
  await expect(reveal).toHaveAttribute('data-phase', 'settled')
  await expect(die).toHaveAttribute('data-phase', 'settled')
  const result = translator('en')(affliction === 'neutral' ? 'state.unaffected' : `state.${affliction}`)
  await expect(reveal.locator('.dice-caption')).toHaveText(String(face))
  await expect(cell(page, target)).toHaveAccessibleName(new RegExp(translator('en')('state.neutral')))
  if (teaching) await expect(page.getByTestId('teaching-cause')).toHaveCount(0)
  await page.clock.runFor(roll.reveal - roll.settle - 1)
  await expect(reveal.locator('.dice-caption')).toHaveText(String(face))
  await page.clock.runFor(1)
  await expect(reveal.locator('.dice-caption')).toHaveText(`${face} · ${result}`)
  await expect(cell(page, target)).toHaveAccessibleName(new RegExp(translator('en')(`state.${affliction}`)))
  if (teaching) await expect(page.getByTestId('teaching-cause')).toBeVisible()
  else await expect(page.getByTestId('roll')).toContainText(result)
  await page.clock.runFor(plan.end - roll.reveal - 1)
  await expect(reveal).toBeVisible()
  await expect(playfield(page)).toHaveAttribute('data-animating', 'true')
  await page.clock.runFor(1)
  await expect(reveal).toHaveCount(0)
  await expect(die).toHaveAttribute('data-phase', 'settled')
  await expect(playfield(page)).toHaveAttribute('data-dice', 'none')
  await ready(page)
}

async function dockIsClearOfBoard(page: Page) {
  const dock = page.getByTestId('dice-dock')
  await expect(dock).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.board-stage').getByTestId('dice-reveal')).toHaveCount(0)
  const board = (await page.locator('.board-stage').boundingBox())!
  const bounds = (await dock.boundingBox())!
  const overlapX = Math.max(0, Math.min(board.x + board.width, bounds.x + bounds.width) - Math.max(board.x, bounds.x))
  const overlapY = Math.max(0, Math.min(board.y + board.height, bounds.y + bounds.height) - Math.max(board.y, bounds.y))
  expect(overlapX * overlapY).toBe(0)
  const viewport = page.viewportSize()!
  if (viewport.height > viewport.width) expect(bounds.y).toBeGreaterThanOrEqual(board.y + board.height)
  else expect(bounds.x).toBeGreaterThanOrEqual(board.x + board.width)
  await noDocumentScroll(page)
}

test('the dice dock leaves the board still and clear through a throw, language switch and resize', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') })
  await open(page, 'ru', false)
  await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'))
  for (const [width, height] of [[1512, 715], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height })
    const fixture = captureFixture('white', 6)
    await restoreGame(page, fixture.before.record)
    const before = await page.locator('.board-stage').boundingBox()
    await cell(page, fixture.from).click()
    if (width === 390) {
      await page.locator('.toggle-sheet').click()
      await page.locator('.piece-details > summary').click()
      await page.locator('.history > details > summary').click()
      await page.getByTestId('game-aside').evaluate(element => { element.scrollTop = element.scrollHeight })
      expect(await page.getByTestId('game-aside').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    }
    await cell(page, fixture.to).click()
    await expect(playfield(page)).toHaveAttribute('data-revision', '1')
    const plan = actionPlan(fixture.after.current.events, true, false, false)
    const roll = plan.roll!
    await page.clock.runFor(roll.start)
    const die = page.getByTestId('die-throw')
    await expect(die.locator('canvas')).toBeVisible()
    const canvas = (await die.locator('canvas').elementHandle())!
    await dockIsClearOfBoard(page)
    expect(await page.locator('.board-stage').boundingBox()).toEqual(before)
    await page.clock.runFor(740)
    await page.getByTestId('lang-en').click()
    expect(await canvas.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.getByTestId('dice-reveal')).toHaveAttribute('data-phase', 'throwing')
    await page.setViewportSize({ width: height, height: width })
    expect(await canvas.evaluate(element => element.isConnected)).toBe(true)
    await page.setViewportSize({ width, height })
    await dockIsClearOfBoard(page)
    await page.clock.runFor(760)
    expect(await canvas.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.getByTestId('dice-reveal')).toHaveAttribute('data-phase', 'settled')
    await expect(page.getByTestId('roll')).toHaveAttribute('data-face', '6')
    await expect(page.locator('.dice-caption')).toHaveText('6')
    await page.clock.runFor(roll.reveal - roll.settle)
    await expect(page.getByTestId('roll')).toContainText('6 · Berserk')
    expect(await page.locator('.board-stage').boundingBox()).toEqual(before)
    await page.clock.runFor(plan.end - roll.reveal)
    await ready(page)
    await expect(page.getByTestId('die-throw')).toHaveAttribute('data-phase', 'settled')
    expect(await canvas.evaluate(element => element.isConnected)).toBe(true)
    if (width === 390) {
      const aside = page.getByTestId('game-aside')
      await aside.evaluate(element => { element.scrollTop = 30 })
      const scrolled = await aside.evaluate(element => element.scrollTop)
      expect(scrolled).toBeGreaterThan(0)
      await page.getByTestId('lang-ru').click()
      expect(await aside.evaluate(element => element.scrollTop)).toBeCloseTo(scrolled, 0)
      await page.getByTestId('lang-en').click()
      await aside.evaluate(element => { element.scrollTop = 0 })
    }
    await visibleAction(page.getByTestId('end-turn'))
    await dockIsClearOfBoard(page)
    expect(await page.locator('.board-stage').boundingBox()).toEqual(before)
    await page.reload()
    await ready(page)
    await expect(page.getByTestId('roll')).toContainText('6 · Berserk')
    await expect(page.getByTestId('die-throw')).toHaveCount(0)
    await dockIsClearOfBoard(page)
  }
})

test('the tutorial dock remains visible with held explanations, primary action and countdown', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') })
  await open(page, 'ru', false)
  await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'))
  for (const [width, height] of [[1512, 715], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height })
    for (const lesson of [1, 2]) {
      const progress = startLesson(lesson)
      await restoreLesson(page, progress)
      const plan = actionPlan(learnerAction(progress, move('c3', 'c4')).progress.session.current.events, true, false, false)
      const roll = plan.roll!
      const before = await page.locator('.board-stage').boundingBox()
      await cell(page, 'c3').click()
      await cell(page, 'c4').click()
      await expect(playfield(page)).toHaveAttribute('data-revision', '1')
      await page.clock.runFor(roll.start)
      await expect(page.getByTestId('dice-reveal')).toHaveAttribute('data-phase', 'throwing')
      await dockIsClearOfBoard(page)
      expect(await page.locator('.board-stage').boundingBox()).toEqual(before)
      await page.clock.runFor(roll.reveal - roll.start)
      await expect(page.getByTestId('teaching-cause')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('teaching-rule')).toBeInViewport({ ratio: 1 })
      await dockIsClearOfBoard(page)
      expect(await page.locator('.board-stage').boundingBox()).toEqual(before)
      await page.clock.runFor(plan.end - roll.reveal)
      await ready(page)
      await visibleAction(page.getByTestId('lesson-next'))
      for (const locale of ['en', 'ru'] as const) {
        await page.getByTestId(`lang-${locale}`).click()
        await visibleAction(page.getByTestId('lesson-next'))
        await dockIsClearOfBoard(page)
      }
      if (lesson === 2) {
        await page.getByTestId('lesson-next').click()
        await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'inspect-countdown')
        await cell(page, 'c4').click()
        await expect(page.getByTestId('flat-counter')).toBeInViewport({ ratio: 1 })
        await visibleAction(page.getByTestId('lesson-next'))
        await dockIsClearOfBoard(page)
      }
    }
  }
})

test('real captures by either side show the committed 3D die in 2D, without replay on restore or undo', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') })
  await open(page, 'en', false)
  await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'))

  for (const [side, face] of [['white', 2], ['black', 6]] as const) {
    const fixture = captureFixture(side, face)
    await restoreGame(page, fixture.before.record)
    await cell(page, fixture.from).click()
    await cell(page, fixture.to).click()
    await expect(playfield(page)).toHaveAttribute('data-revision', '1')
    const saved = await recorded<MatchRecord>(page, 'matches', fixture.before.record.id)
    expect(saved.actions[0]).toMatchObject({ actor: side, command: move(fixture.from, fixture.to), roll: { face, fixed: false } })
    const reaction = fixture.after.state.pieces.find(piece => piece.square === fixture.to)!.affliction
    await committedThrow(page, saved.actions[0].roll!.face, side, reaction, actionPlan(fixture.after.current.events, true, false, false), fixture.to)

    await page.reload()
    await expect(playfield(page)).toHaveAttribute('data-game-id', fixture.before.record.id)
    await ready(page)
    await page.clock.runFor(2000)
    await expect(page.getByTestId('die-throw')).toHaveCount(0)
    await expect(page.getByTestId('roll')).toHaveAttribute('data-face', String(face))
    await page.getByTestId('undo').click()
    await ready(page)
    await page.clock.runFor(2000)
    await expect(page.getByTestId('die-throw')).toHaveCount(0)
    await expect(page.getByTestId('roll')).toHaveCount(0)
    await expect(cell(page, fixture.from)).toHaveAccessibleName(/rook/i)
  }

  const lesson = scriptAction(learnerAction(startLesson(), move('e2', 'e4')).progress)
  await restoreLesson(page, lesson)
  await cell(page, 'e4').click()
  await cell(page, 'd5').click()
  await expect(playfield(page)).toHaveAttribute('data-revision', '3')
  const saved = await recorded<ReturnType<typeof saveLearning>>(page, 'learning', 'progress')
  expect(saved.match.actions.at(-1)?.roll).toEqual({ face: 4, fixed: true })
  const lessonPlan = actionPlan(learnerAction(lesson, move('e4', 'd5')).progress.session.current.events, true, false, false)
  await committedThrow(page, saved.match.actions.at(-1)!.roll!.face, 'white', 'neutral', lessonPlan, 'd5', true)
  const firstResult = LESSONS[0].positions[0].steps.find(step => step.id === 'capture-and-roll')!.after![0]
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-beat', firstResult.id)
  await expect(page.getByTestId('tutorial').getByRole('heading', { name: firstResult.title.en, exact: true })).toBeVisible()
  await visibleAction(page.getByTestId('lesson-next'))
  await expect(page.locator('body')).not.toContainText(diceExplanations)
  await page.reload()
  await ready(page)
  await page.clock.runFor(2000)
  await expect(page.getByTestId('die-throw')).toHaveCount(0)
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-beat', firstResult.id)
  await expect(page.getByTestId('teaching-cause')).toHaveText(firstResult.text.en)
  await page.getByTestId('lesson-next').click()
  // The board is in 2D. Acknowledgement works with the clock still paused.
  await ready(page)
  const legend = page.getByTestId('dice-legend')
  await expect(legend).toBeVisible()
  await expect(legend.locator('[data-reaction="unaffected"]')).toHaveAttribute('data-current', 'true')
  await expect(legend.locator('[data-reaction="guilt"]')).toContainText('2–3')
  await page.getByTestId('lesson-next').click()
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'faces-and-material')
})

test('the short introduction explains reactions, the die and bishops in both languages', async ({ page }) => {
  await open(page, 'ru')
  const intro = page.getByTestId('home-introduction')
  await expect(intro).toContainText(/кубик.*фигура её запоминает/i)
  await expect(intro).toContainText(/ярости взятие первым действием/i)
  await expect(intro).toContainText(/слоны лечат/i)
  await page.getByTestId('lang-en').click()
  await expect(intro).toContainText(/a die sets the reaction.*the piece remembers/i)
  await expect(intro).toContainText(/berserk piece that captures on its first action/i)
  await expect(intro).toContainText(/bishops heal/i)
  await expect(page.getByTestId('mode-ai')).toBeVisible()
})

interface AudioProbe {
  context: string
  starts: { when: number; offset: number; duration: number; state: string; buffer: number }[]
  stops: { at: number; scheduled?: number }[]
  signal: { time: number; peak: number }[]
}

async function instrumentNativeAudio(page: Page) {
  await page.addInitScript(() => {
    // Observe the native master before the test fixture's silent output.
    const probe: AudioProbe = { context: 'none', starts: [], stops: [], signal: [] }
    Object.assign(window, { remorseAudioProbe: probe })
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const result = Reflect.apply(connect, this, args)
      if (args[0] === this.context.destination && this.context instanceof AudioContext) {
        const analyser = this.context.createAnalyser()
        analyser.fftSize = 2048
        Reflect.apply(connect, this, [analyser])
        const data = new Float32Array(analyser.fftSize)
        const context = this.context
        setInterval(() => {
          probe.context = context.state
          analyser.getFloatTimeDomainData(data)
          let peak = 0
          for (const value of data) peak = Math.max(peak, Math.abs(value))
          probe.signal.push({ time: performance.now(), peak })
        }, 10)
      }
      return result
    } as typeof connect
    const start = AudioBufferSourceNode.prototype.start
    const scheduled = new WeakMap<AudioBufferSourceNode, number>()
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      if (duration !== undefined) {
        scheduled.set(this, when)
        probe.starts.push({ when, offset, duration, state: this.context.state, buffer: this.buffer?.duration ?? 0 })
      }
      if (duration === undefined) start.call(this, when, offset)
      else start.call(this, when, offset, duration)
    }
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (when = 0) {
      probe.stops.push({ at: when, scheduled: scheduled.get(this) })
      stop.call(this, when)
    }
  })
}

function nativeAudio(page: Page): Promise<AudioProbe> {
  return page.evaluate(() => (window as Window & { remorseAudioProbe?: AudioProbe }).remorseAudioProbe!)
}

const dieWindows = Array.from({ length: 5 }, (_, index) => ({
  offset: expect.closeTo(index * .128, 5), duration: expect.closeTo(.108, 5),
}))

test('real audio plays the opening worker move and the confirmed resignation', async ({ page }) => {
  await instrumentNativeAudio(page)
  await open(page, 'en', false)
  expect((await nativeAudio(page)).context).toBe('none')
  await page.getByTestId('mode-ai').click()
  await page.getByTestId('setup-practice').click()
  await page.getByTestId('setup-black').click()
  await page.getByTestId('setup-start').click()
  await expect(playfield(page)).toHaveAttribute('data-turn', '1')
  await ready(page)
  await expect.poll(async () => (await nativeAudio(page)).starts.length).toBe(1)
  expect((await nativeAudio(page)).starts[0]).toMatchObject({ state: 'running', ...sampleWindow('stone') })
  await expect.poll(async () => Math.max(...(await nativeAudio(page)).signal.map(frame => frame.peak))).toBeGreaterThan(.012)

  await page.getByTestId('resign').click()
  await page.getByTestId('confirm-action').click()
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'resignation')
  await expect.poll(async () => (await nativeAudio(page)).starts.length).toBe(2)
  expect((await nativeAudio(page)).starts[1]).toMatchObject({ state: 'running', ...sampleWindow('fracture') })
})

test('real recorded impacts follow the animation, and undo stops the pending audio', async ({ page }) => {
  await instrumentNativeAudio(page)
  const dieRecordings = new Set<string>()
  page.on('request', request => {
    if (/\/dice-auditions\/[^/]+\.mp3$/.test(request.url())) dieRecordings.add(request.url().split('/').at(-1)!)
  })
  await open(page, 'en', false)
  const capture = captureFixture('white', 2)
  await restoreGame(page, capture.before.record)
  await cell(page, capture.from).click()
  await expect.poll(async () => (await nativeAudio(page)).context).toBe('running')
  await cell(page, capture.to).click()
  await expect(playfield(page)).toHaveAttribute('data-dice', 'throwing')
  // Observe the first audible contact in the page, then click before the final
  // contacts. A remote polling interval can consume most of the throw window.
  await page.waitForFunction(() => {
    const probe = (window as Window & { remorseAudioProbe?: AudioProbe }).remorseAudioProbe
    return probe?.signal.some(frame => frame.peak > .012)
  }, undefined, { polling: 16 })
  await page.getByTestId('undo').click()
  await expect(playfield(page)).toHaveAttribute('data-dice', 'none')
  await expect(playfield(page)).toHaveAttribute('data-turn', '0')
  await expect(page.getByTestId('dice-reveal')).toHaveCount(0)
  const { starts, stops } = await nativeAudio(page)
  expect([...dieRecordings]).toEqual(['d2.mp3'])
  expect(starts.slice(0, 6).map(({ offset, duration }) => ({ offset, duration }))).toEqual(
    [sampleWindow('capture'), ...dieWindows],
  )
  expect(starts).toHaveLength(7)
  expect(starts[6]).toMatchObject({ offset: 0, duration: 1.4, buffer: expect.closeTo(3, 1) })
  expect(starts[1].when + .009 - starts[0].when).toBeCloseTo(.618, 3)
  expect(starts[5].when - starts[1].when).toBeCloseTo(1.14, 3)
  expect(starts[6].when - (starts[5].when + .009)).toBeCloseTo(.240, 3)
  for (const { when } of starts.slice(-2)) {
    expect(stops.some(stop => stop.scheduled === when && stop.at < when)).toBe(true)
  }
  const afterUndo = await page.evaluate(() => performance.now())
  await expect.poll(async () => (await nativeAudio(page)).signal.at(-1)?.time).toBeGreaterThan(afterUndo + 1600)
  const quiet = (await nativeAudio(page)).signal.filter(frame => frame.time > afterUndo + 90)
  expect(Math.max(...quiet.map(frame => frame.peak))).toBeLessThan(.004)
})

test('a real worker capture shows and sounds its own committed die', async ({ page }, testInfo) => {
  await instrumentNativeAudio(page)
  await open(page, 'en', false)
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 4)!
  const root = createPosition({ side: 'black', pieces: [
    { side: 'white', type: 'king', square: 'h1' },
    { side: 'black', type: 'king', square: 'a8' },
    { side: 'black', type: 'rook', square: 'c3' },
    { side: 'white', type: 'queen', square: 'c4' },
  ] })
  const game = createMatch({ mode: 'practice', level: 10, human: 'white', provenance: 'standard' }, { root, seed })
  await persist(page, 'matches', game.record, 'home')
  // Observe both transient phases in the page. Remote polling can miss them
  // while the first WebGL die is drawing and video is being captured.
  await page.evaluate(() => {
    const record = new MutationObserver(() => {
      const throwing = document.querySelector<HTMLCanvasElement>(
        '[data-testid="dice-reveal"][data-actor="black"][data-phase="throwing"] canvas',
      )
      if (throwing && throwing.getBoundingClientRect().width > 0) document.documentElement.dataset.qaDieThrow = 'black'
      const result = document.querySelector('[data-testid="dice-reveal"][data-phase="settled"] .dice-caption')
      const caption = result?.textContent?.trim()
      if (caption === '4') document.documentElement.dataset.qaDieFace = caption
      if (caption?.includes('Unaffected')) {
        document.documentElement.dataset.qaDieResult = caption
        record.disconnect()
      }
    })
    record.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-phase'] })
  })
  await page.getByTestId('home-resume').click()
  await expect(page.locator('html')).toHaveAttribute('data-qa-die-throw', 'black')
  await expect(page.locator('html')).toHaveAttribute('data-qa-die-face', '4')
  await expect(page.locator('html')).toHaveAttribute('data-qa-die-result', '4 · Unaffected')
  const saved = await recorded<MatchRecord>(page, 'matches', game.record.id)
  expect(saved.actions).toHaveLength(1)
  expect(saved.actions[0]).toMatchObject({ actor: 'black', command: move('c3', 'c4'), roll: { face: 4, fixed: false } })
  await ready(page)
  const probe = await nativeAudio(page)
  expect(probe.starts).toHaveLength(7)
  expect(probe.starts.toSorted((a, b) => a.when - b.when)[1]).toMatchObject(dieWindows[0])
  const peak = Math.max(...probe.signal.map(frame => frame.peak))
  expect(peak).toBeGreaterThan(.012)
  expect(peak).toBeLessThan(.9)
  await testInfo.attach('native-audio-signal', { body: JSON.stringify({ peak, frames: probe.signal, starts: probe.starts }), contentType: 'application/json' })
})

test('pawn reaction and queen contact use one live audio batch and undo cancels the late cues', async ({ page }) => {
  await instrumentNativeAudio(page)
  await open(page, 'en', false)
  const root = createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'h2' }, { side: 'black', type: 'king', square: 'h6' },
    { side: 'white', type: 'pawn', square: 'b7' }, { side: 'black', type: 'rook', square: 'a8' },
  ] })
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 2)!
  await restoreGame(page, createMatch(hotseat, { root, seed }).record)
  await cell(page, 'b7').click()
  await expect.poll(async () => (await nativeAudio(page)).context).toBe('running')
  await cell(page, 'a8').click()
  await page.getByTestId('promotion-queen').click()
  // Undo the live batch before its delayed accents. Waiting for the WebGL die
  // to render can consume that window on a slow browser.
  await expect(playfield(page)).toHaveAttribute('data-revision', '1')
  await expect.poll(async () => (await nativeAudio(page)).starts.length).toBe(8)
  const sounds = (await nativeAudio(page)).starts.sort((a, b) => a.when - b.when)
  expect(sounds.slice(0, 6).map(({ offset, duration }) => ({ offset, duration }))).toEqual(
    [sampleWindow('capture'), ...dieWindows],
  )
  expect(sounds[6]).toMatchObject({ buffer: expect.closeTo(3, 1), duration: expect.closeTo(.38, 3) })
  expect(sounds[7]).toMatchObject({ buffer: expect.closeTo(5, 1), offset: 0, duration: expect.closeTo(2.49, 3) })
  expect(sounds[6].when - (sounds[5].when + .009)).toBeCloseTo(.240, 3)
  expect(sounds[7].when).toBeGreaterThan(sounds[6].when + sounds[6].duration)
  await page.getByTestId('undo').click()
  await expect(playfield(page)).toHaveAttribute('data-promotion-stage', 'none')
  await expect(cell(page, 'b7')).toHaveAccessibleName(/Pawn/)
  await expect.poll(async () => {
    const { stops } = await nativeAudio(page)
    return sounds.slice(6).every(sound => stops.some(stop => stop.scheduled === sound.when && stop.at < sound.when))
  }).toBe(true)
})

test('the promotion lesson schedules formation only after acknowledgment, including after a reload', async ({ page }) => {
  await instrumentNativeAudio(page)
  await open(page, 'en', false)
  await restoreLesson(page, startLesson(7, 1))
  await cell(page, 'g7').click()
  await expect.poll(async () => (await nativeAudio(page)).context).toBe('running')
  await cell(page, 'h8').click()
  await page.getByTestId('promotion-bishop').click()
  await expect(page.getByTestId('teaching-cause')).toContainText('went berserk')
  const windows = async () => (await nativeAudio(page)).starts.map(({ offset, duration }) => ({ offset, duration }))
  const reaction = [sampleWindow('capture'), ...dieWindows,
    { offset: .4, duration: expect.closeTo(1.26, 3) },
    { offset: 0, duration: expect.closeTo(.88, 3) }]
  expect(await windows()).toEqual(reaction)
  await page.waitForTimeout(550)
  expect(await windows()).toEqual(reaction)

  await page.reload()
  await expect(page.getByTestId('teaching-cause')).toContainText('went berserk')
  await page.getByTestId('tutorial').getByRole('heading', { name: 'Rolled 6 — berserk' }).click()
  await expect.poll(async () => (await nativeAudio(page)).context).toBe('running')
  expect(await windows()).toEqual([])
  await page.getByTestId('lesson-next').click()
  const formation = [{ offset: 0, duration: expect.closeTo(.93, 3) }]
  await expect.poll(windows).toEqual(formation)
  await expect(page.getByTestId('teaching-cause')).toContainText('capture count returns to zero')
  expect(await windows()).toEqual(formation)
})
