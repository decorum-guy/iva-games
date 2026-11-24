import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { translator } from '../../src/i18n/catalog'
import { CAMERA_TRAVEL_MS } from '../../src/scene/cameraFocus'
import { getDieMotionTiming } from '../../src/scene/diceMotion'
import {
  acknowledgeTeaching, learnerAction, saveLearning, scriptAction, startLesson, teachingBeat,
} from '../../src/tutorial/controller'
import type { Learning } from '../../src/tutorial/controller'
import { LESSONS } from '../../src/tutorial/lessons'
import { move } from '../../src/tutorial/lessonTypes'

const playfield = (page: Page) => page.getByTestId('playfield')
const tutorial = (page: Page) => page.getByTestId('tutorial')
const stage = (page: Page) => page.locator('.board-stage')
const scene = (page: Page) => page.locator('[data-renderer="3d"][data-scene-ready="true"]')
const forbiddenNotice = /учебный бросок|фиксированный бросок|tutorial roll|fixed roll|scripted roll|preset roll/i

async function ready(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false')
  await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'false')
}

async function savedLearning(page: Page): Promise<ReturnType<typeof saveLearning>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('remorse-v1')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      return await new Promise<ReturnType<typeof saveLearning>>((resolve, reject) => {
        const request = db.transaction('learning').objectStore('learning').get('progress')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

async function restoreLesson(page: Page, learning: Learning) {
  await page.evaluate(async saved => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('remorse-v1')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('learning', 'readwrite')
        transaction.objectStore('learning').put(saved, 'progress')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      localStorage.setItem('remorse-view-v1', 'learn')
    } finally { db.close() }
  }, saveLearning(learning))
  await page.reload()
  await expect(playfield(page)).toHaveAttribute('data-view', 'learn')
  await ready(page)
}

async function open(page: Page, locale: 'ru' | 'en', board: '2d' | '3d') {
  await page.addInitScript(({ locale, board }) => {
    if (!localStorage.getItem('remorse-settings-v1')) {
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ locale, board, reduce: board === '2d', sound: true }))
    }
    // Observe actual native playback calls, without replacing their audio path.
    const observed = window as Window & { teachingAudioStarts?: number }
    observed.teachingAudioStarts = 0
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      observed.teachingAudioStarts = (observed.teachingAudioStarts ?? 0) + 1
      return Reflect.apply(start, this, args)
    }
  }, { locale, board })
  await page.goto('/')
  await expect(page.getByTestId('mode-learn')).toBeVisible()
}

async function identity(page: Page) {
  return Promise.all(['data-game-id', 'data-revision', 'data-turn', 'data-phase', 'data-active-side']
    .map(attribute => playfield(page).getAttribute(attribute)))
}

async function keyboardPath(page: Page, keys: readonly string[]) {
  for (const key of keys) await stage(page).press(key)
}

test.describe('the actual 3D reaction starts its explanation', () => {
  test.use({ reducedMotion: 'no-preference' })

  for (const locale of ['ru', 'en'] as const) {
    test(`${locale}: guilt is explained on reveal and waits for acknowledgement before the demonstration`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.clock.install({ time: new Date('2030-01-01T08:00:00Z') })
      await open(page, locale, '3d')
      await restoreLesson(page, startLesson(1))
      await expect(scene(page)).toBeVisible({ timeout: 15_000 })
      await page.clock.pauseAt(new Date('2030-01-01T10:00:00Z'))
      // Keyboard operates the same live 3D board; no private app controller is used.
      await keyboardPath(page, ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'Enter', 'ArrowUp', 'Enter'])
      await expect(playfield(page)).toHaveAttribute('data-revision', '1')
      await expect(playfield(page)).toHaveAttribute('data-dice', 'throwing')
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'none')
      await expect(page.getByTestId('teaching-cause')).toHaveCount(0)
      await expect(page.getByTestId('teaching-rule')).toHaveCount(0)
      const timing = getDieMotionTiming(false)
      await page.clock.runFor(timing.motionMs - 1)
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'none')
      await expect(page.getByTestId('teaching-cause')).toHaveCount(0)

      await page.clock.runFor(1)
      const result = LESSONS[1].positions[0].steps[0].after![0]
      await expect(playfield(page)).toHaveAttribute('data-dice', 'settled')
      await expect(playfield(page)).toHaveAttribute('data-animating', 'true')
      await expect(tutorial(page)).toHaveAttribute('data-source-step', 'guilt-roll')
      await expect(tutorial(page).getByRole('heading', { name: result.title[locale], exact: true })).toBeVisible()
      await expect(page.getByTestId('teaching-cause')).toHaveText(result.text[locale])
      await expect(page.getByTestId('teaching-rule')).toHaveText(result.rule![locale])
      await expect(stage(page)).toHaveAttribute('data-focus-square', 'c4')
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'c4')
      await expect(page.getByTestId('lesson-next')).toBeDisabled()
      await page.clock.runFor(timing.holdMs + 5000)
      await ready(page)
      await expect(page.getByTestId('dice-reveal')).toHaveCount(0)
      const held = await savedLearning(page)
      expect(held.match.cursor).toBe(1)
      expect(held.match.actions[0].roll).toEqual({ face: 2, fixed: true })
      expect(held.pendingTeaching).toEqual({ stepId: 'guilt-roll', beatIndex: 0 })
      await expect(page.getByTestId('lesson-next')).toHaveAccessibleName(result.action![locale])
      await expect(page.locator('body')).not.toContainText(forbiddenNotice)
      await page.screenshot({ path: testInfo.outputPath(`guilt-result-${locale}.png`) })

      // A reload resumes the explanation as a static checkpoint, not a new die.
      await page.clock.resume()
      await page.reload()
      await ready(page)
      await expect(scene(page)).toBeVisible({ timeout: 15_000 })
      await expect(tutorial(page)).toHaveAttribute('data-beat', result.id)
      await expect(page.getByTestId('dice-reveal')).toHaveCount(0)
      const restored = await savedLearning(page)
      expect(restored).toEqual(held)
      const beforeLanguage = await identity(page)
      const alternate = locale === 'ru' ? 'en' : 'ru'
      await page.getByTestId(`lang-${alternate}`).click()
      await expect(page.getByTestId('teaching-cause')).toHaveText(result.text[alternate])
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'c4')
      expect(await identity(page)).toEqual(beforeLanguage)
      expect(await savedLearning(page)).toEqual(held)
      await page.getByTestId(`lang-${locale}`).click()
      await page.clock.pauseAt(new Date('2030-01-01T11:00:00Z'))
      expect(await page.evaluate(() => (window as Window & { teachingAudioStarts?: number }).teachingAudioStarts)).toBe(0)

      await page.getByTestId('lesson-next').click()
      await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'true')
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'none')
      await page.clock.runFor(CAMERA_TRAVEL_MS - 1)
      await expect(playfield(page)).toHaveAttribute('data-revision', '1')
      await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'true')
      await page.clock.runFor(1)
      await expect(playfield(page)).toHaveAttribute('data-teaching-returning', 'false')
      await page.clock.runFor(319)
      await expect(playfield(page)).toHaveAttribute('data-revision', '1')
      await page.clock.runFor(1)
      await expect(playfield(page)).toHaveAttribute('data-revision', '2')
      await page.clock.runFor(330)
      await ready(page)
      await expect(tutorial(page)).toHaveAttribute('data-step', 'guilt-forbids-capture')

      const beforeAttempt = await identity(page)
      // The reloaded board's keyboard cursor starts at e2: select c4, try d4.
      await keyboardPath(page, ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowRight', 'Enter'])
      await expect(tutorial(page)).toHaveAttribute('data-source-step', 'guilt-forbids-capture')
      await expect(page.getByTestId('teaching-cause')).toBeVisible()
      await expect(page.getByTestId('game-aside').getByText(translator(locale)('error.guiltCapture'), { exact: true })).toHaveCount(0)
      expect(await identity(page)).toEqual(beforeAttempt)
      await page.getByTestId('lesson-next').click()
      await expect(tutorial(page)).toHaveAttribute('data-step', 'guilt-quiet-move')
      await keyboardPath(page, ['ArrowLeft', 'Enter', 'ArrowUp', 'Enter'])
      await expect(playfield(page)).toHaveAttribute('data-revision', '3')
      await page.clock.runFor(330)
      await ready(page)
      await expect(tutorial(page)).toHaveAttribute('data-kind', 'position-complete')
      await expect(scene(page)).toHaveAttribute('data-camera-focus', 'none')
      await expect(stage(page)).not.toHaveAttribute('data-focus-square', /.+/)
    })
  }
})

function acknowledgeAll(progress: Learning): Learning {
  while (progress.pendingTeaching) progress = acknowledgeTeaching(progress)
  return progress
}

function resultCheckpoints(): Learning[] {
  const first = learnerAction(scriptAction(learnerAction(startLesson(), move('e2', 'e4')).progress), move('e4', 'd5')).progress
  const legend = acknowledgeTeaching(first)
  let knight = acknowledgeAll(learnerAction(startLesson(6), move('b1', 'd2')).progress)
  knight = scriptAction(knight)
  knight = acknowledgeAll(learnerAction(knight, move('d2', 'f3')).progress)
  knight = learnerAction(knight, move('f3', 'h4')).progress
  return [first, legend, knight]
}

for (const viewport of [
  { width: 360, height: 800 }, { width: 390, height: 844 },
  { width: 1280, height: 800 }, { width: 568, height: 320 },
]) {
  for (const locale of ['ru', 'en'] as const) {
    test(`${viewport.width}×${viewport.height} ${locale}: required result, dice legend and CTA fit without scrolling`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await open(page, locale, '2d')
      for (const checkpoint of resultCheckpoints()) {
        await restoreLesson(page, checkpoint)
        const beat = teachingBeat(checkpoint)!
        await expect(tutorial(page)).toHaveAttribute('data-kind', 'result')
        await expect(tutorial(page)).toHaveAttribute('data-beat', beat.id)
        await expect(tutorial(page).getByRole('heading', { name: beat.title[locale], exact: true })).toBeInViewport({ ratio: 1 })
        await expect(page.getByTestId('teaching-cause')).toBeInViewport({ ratio: 1 })
        if (beat.rule) await expect(page.getByTestId('teaching-rule')).toBeInViewport({ ratio: 1 })
        if (beat.diceLegend) await expect(page.getByTestId('dice-legend')).toBeInViewport({ ratio: 1 })
        const next = page.getByTestId('lesson-next')
        await expect(next).toBeEnabled()
        await expect(next).toBeInViewport({ ratio: 1 })
        await expect(next).toHaveAccessibleName(beat.action?.[locale] ?? translator(locale)('tutorial.readAction'))
        await expect(page.locator('.flat-board [draggable="true"]')).toHaveCount(0)
        const dimensions = await page.evaluate(() => {
          window.scrollTo(1000, 1000)
          return { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY,
            scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }
        })
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
        expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height + 1)
        expect(dimensions.x).toBe(0)
        expect(dimensions.y).toBe(0)
        await expect(page.locator('body')).not.toContainText(forbiddenNotice)
      }
    })
  }
}
