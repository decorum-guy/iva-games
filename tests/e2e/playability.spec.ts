import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { createPosition } from '../../src/core'
import type { Affliction, DieFace, Side } from '../../src/core'
import { translator } from '../../src/i18n/catalog'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { learnerAction, saveLearning, scriptAction, startLesson } from '../../src/tutorial/controller'
import type { Learning } from '../../src/tutorial/controller'
import { move } from '../../src/tutorial/lessonTypes'

const hotseat = { mode: 'hotseat', level: null, human: null, provenance: 'standard' } as const
const playfield = (page: Page) => page.getByTestId('playfield')
const cell = (page: Page, square: string) => page.locator(`[data-square="${square}"]`)
const diceExplanations = /учебный бросок|фиксированный бросок|tutorial roll|fixed roll|scripted roll|preset roll/i

test.use({ hasTouch: true, reducedMotion: 'no-preference' })

async function ready(page: Page) {
  await expect(playfield(page)).toHaveAttribute('data-busy', 'false')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'false')
}

async function open(page: Page, locale: 'ru' | 'en' = 'en', reduce = true) {
  await page.addInitScript(({ locale, reduce }) => {
    if (!localStorage.getItem('remorse-settings-v1')) {
      // Leave sound and volume absent to exercise their actual product defaults.
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale, reduce }))
    }
  }, { locale, reduce })
  await page.goto('/')
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
  await expect(playfield(page)).toHaveAttribute('data-view', store === 'learning' ? 'learn' : 'game')
  await ready(page)
}

async function restoreGame(page: Page, record: MatchRecord) {
  await persist(page, 'matches', record, `game/${record.id}`)
  await expect(playfield(page)).toHaveAttribute('data-game-id', record.id)
}

async function restoreLesson(page: Page, progress: Learning) {
  await persist(page, 'learning', saveLearning(progress), 'learn')
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
  { width: 1280, height: 800, locale: 'ru' },
  { width: 390, height: 844, locale: 'en' },
  { width: 360, height: 800, locale: 'ru' },
  { width: 844, height: 390, locale: 'en' },
] as const) {
  test(`${viewport.width}×${viewport.height}: the game and tutorial keep the current action on screen`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await open(page, viewport.locale)
    const fixture = captureFixture('white', 6)
    await restoreGame(page, fixture.after.record)
    await expect(playfield(page)).toHaveAttribute('data-phase', 'bonus')
    await noDocumentScroll(page)
    await visibleAction(page.getByTestId('end-turn'))
    await visibleAction(page.getByTestId('sound-toggle'))
    await page.getByTestId('end-turn').click()
    await ready(page)
    await expect(playfield(page)).toHaveAttribute('data-active-side', 'black')

    const checkpoint = scriptAction(learnerAction(startLesson(2, 2), move('g2', 'g3')).progress)
    await restoreLesson(page, checkpoint)
    const lesson = page.getByTestId('tutorial')
    const next = page.getByTestId('lesson-next')
    const t = translator(viewport.locale)
    await expect(lesson).toHaveAttribute('data-step', 'removal-material-only')
    await expect(playfield(page)).toHaveAttribute('data-tutorial-mode', 'read')
    await expect(lesson.locator('.lesson-action-label')).toHaveText(t('tutorial.readCue'))
    await expect(next).toHaveAccessibleName(t('tutorial.readAction'))
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
    await expect(playfield(page)).toHaveAttribute('data-tutorial-mode', 'position-complete')
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

async function committedThrow(page: Page, face: DieFace, actor: Side, affliction: Affliction) {
  const reveal = page.getByTestId('dice-reveal')
  const die = page.getByTestId('die-throw')
  await expect(playfield(page)).toHaveAttribute('data-dice', 'throwing')
  await expect(playfield(page)).toHaveAttribute('data-animating', 'true')
  await expect(page.locator('[data-renderer="2d"]')).toBeVisible()
  await expect(reveal).toHaveAttribute('data-actor', actor)
  await expect(die).toHaveAttribute('data-face', String(face))
  await expect(die.locator('canvas')).toBeVisible()
  await expect(die.locator('[data-die-renderer="fallback"]')).toHaveCount(0)
  await expect(reveal.locator('.dice-actor')).toHaveText(translator('en')('die.actor', { side: translator('en')(`side.${actor}`) }))
  await expect(page.locator('body')).not.toContainText(diceExplanations)

  // Exercise the specified 1500 ms throw and 350 ms result hold without racing
  // wall-clock rendering or sleeping until a fleeting animation happens to end.
  await page.clock.runFor(1499)
  await expect(reveal).toHaveAttribute('data-phase', 'throwing')
  await expect(die).toHaveAttribute('data-phase', 'throwing')
  await page.clock.runFor(1)
  await expect(reveal).toHaveAttribute('data-phase', 'settled')
  await expect(die).toHaveAttribute('data-phase', 'settled')
  const result = translator('en')(affliction === 'neutral' ? 'state.unaffected' : `state.${affliction}`)
  await expect(reveal.locator('.dice-caption')).toHaveText(`${face} · ${result}`)
  await expect(page.getByTestId('roll')).toContainText(result)
  await page.clock.runFor(349)
  await expect(reveal).toBeVisible()
  await expect(playfield(page)).toHaveAttribute('data-animating', 'true')
  await page.clock.runFor(1)
  await expect(reveal).toHaveCount(0)
  await expect(die).toHaveCount(0)
  await expect(playfield(page)).toHaveAttribute('data-dice', 'none')
  await ready(page)
}

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
    await committedThrow(page, saved.actions[0].roll!.face, side, reaction)

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
  await committedThrow(page, saved.match.actions.at(-1)!.roll!.face, 'white', 'neutral')
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'faces-and-material')
  await visibleAction(page.getByTestId('lesson-next'))
  await expect(page.locator('body')).not.toContainText(diceExplanations)
  await page.reload()
  await ready(page)
  await page.clock.runFor(2000)
  await expect(page.getByTestId('die-throw')).toHaveCount(0)
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', 'faces-and-material')
})
