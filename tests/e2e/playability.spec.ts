import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { createPosition } from '../../src/core'
import type { Affliction, DieFace, Side } from '../../src/core'
import { countText, translator } from '../../src/i18n/catalog'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { sampleWindow } from '../../src/scene/audioSamples'
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

async function committedThrow(page: Page, face: DieFace, actor: Side, affliction: Affliction, teaching = false) {
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
  if (teaching) await expect(page.getByTestId('teaching-cause')).toBeVisible()
  else await expect(page.getByTestId('roll')).toContainText(result)
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
  await committedThrow(page, saved.match.actions.at(-1)!.roll!.face, 'white', 'neutral', true)
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
  starts: { when: number; offset: number; duration: number; state: string }[]
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
        probe.starts.push({ when, offset, duration, state: this.context.state })
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
  expect(starts.map(({ offset, duration }) => ({ offset, duration }))).toEqual(
    (['capture', 'diceBody', 'diceBounce', 'diceEdge', 'diceBounce', 'diceSettle', 'fracture'] as const)
      .map(sampleWindow),
  )
  expect(starts[1].when - starts[0].when).toBeCloseTo(.23, 3)
  expect(starts[5].when - starts[1].when).toBeCloseTo(1.14, 3)
  expect(starts[6].when - starts[5].when).toBeCloseTo(.09, 3)
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
  // The settled overlay has a short hold. Sample it at the DOM mutation rather
  // than relying on the polling interval hitting its 350ms window under load.
  await page.evaluate(() => {
    const record = new MutationObserver(() => {
      const result = document.querySelector('[data-testid="dice-reveal"][data-phase="settled"] .dice-caption')
      if (result) {
        document.documentElement.dataset.qaDieResult = result.textContent ?? ''
        record.disconnect()
      }
    })
    record.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-phase'] })
  })
  await page.getByTestId('home-resume').click()
  const reveal = page.getByTestId('dice-reveal')
  await expect(reveal).toHaveAttribute('data-actor', 'black')
  await expect(reveal).toHaveAttribute('data-phase', 'throwing')
  await expect(page.getByTestId('die-throw').locator('canvas')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-qa-die-result', '4 · Unaffected')
  const saved = await recorded<MatchRecord>(page, 'matches', game.record.id)
  expect(saved.actions).toHaveLength(1)
  expect(saved.actions[0]).toMatchObject({ actor: 'black', command: move('c3', 'c4'), roll: { face: 4, fixed: false } })
  await ready(page)
  const probe = await nativeAudio(page)
  expect(probe.starts).toHaveLength(7)
  expect(probe.starts[1]).toMatchObject(sampleWindow('diceBody'))
  const peak = Math.max(...probe.signal.map(frame => frame.peak))
  expect(peak).toBeGreaterThan(.012)
  expect(peak).toBeLessThan(.9)
  await testInfo.attach('native-audio-signal', { body: JSON.stringify({ peak, frames: probe.signal, starts: probe.starts }), contentType: 'application/json' })
})
