import { test, expect } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { ABILITIES, transition } from '../../src/core'
import { TEACHING_FIXTURES } from '../../src/core/teaching'
import type { TeachingFixture } from '../../src/core/teaching'
import { abilityName, lessonText } from '../../src/ui/i18n'
import type { Language } from '../../src/ui/i18n'
import type { LocalSessionRecord } from '../../src/ui/session'

// Native UI routes only. Preference initialization is allowed; no test endpoint,
// injected match state, direct tutorial checkpoint or engine result is used.
// Authored here for a browser-capable host; listing/compilation is not execution.
async function preferences(context: BrowserContext, lang: Language = 'en', reduced: boolean | null = true) {
  await context.addInitScript(({ language, reduced }) => {
    if (!localStorage.getItem('overdrive-settings-v1')) localStorage.setItem('overdrive-settings-v1',
      JSON.stringify({ version: 1, settings: { lang: language, mute: true, volume: 0, view: '2d', ...(reduced === null ? {} : { reduced }) } }))
  }, { language: lang, reduced })
}
const app = (page: Page) => page.locator('.od-app')
const cell = (page: Page, square: string) => page.locator(`.od-board-2d [data-square="${square}"]`)
const ready = async (page: Page) => { await expect(app(page)).toHaveAttribute('data-locked', 'false') }
async function clickSquare(page: Page, square: string) {
  if (test.info().project.name.includes('mobile') || test.info().project.name.includes('landscape')) await cell(page, square).tap()
  else await cell(page, square).click()
}
async function move(page: Page, from: string, to: string) {
  await ready(page)
  await clickSquare(page, from)
  await expect(cell(page, from)).toHaveAttribute('data-selected', 'true')
  await clickSquare(page, to)
}
async function saved(page: Page): Promise<LocalSessionRecord> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('overdrive-local-v1')!) as LocalSessionRecord)
}
async function exercise(page: Page, fixture: TeachingFixture, lang: Language) {
  const piece = fixture.state.pieces.find(item => item.id === fixture.expected.pieceId)!
  const target = fixture.expected.to ?? fixture.state.pieces.find(item => item.id === fixture.expected.targetId)!.square
  await ready(page)
  await clickSquare(page, piece.square)
  if (fixture.expected.mode !== 'normal') {
    const mode = fixture.expected.mode === 'activate' ? (lang === 'ru' ? 'Форсаж' : 'Overdrive') : (lang === 'ru' ? 'Импульс' : 'Impulse')
    await page.locator('.od-power-switch').getByRole('button', { name: new RegExp(mode) }).click()
  }
  await clickSquare(page, target)
  if (await page.locator('.od-command-dialog').isVisible()) {
    const title = abilityName(ABILITIES[piece.type], lang)
    await page.locator('.od-action-choices').getByRole('button', { name: new RegExp(title) }).click()
  }
  await expect(app(page)).toHaveAttribute('data-turn', '1')
  await ready(page)
  await expect(page.locator('.od-lesson')).toContainText(lessonText[fixture.id][lang][2])
}

for (const lang of ['ru', 'en'] as const) for (const finish of ['continue', 'new'] as const) {
  test(`${lang}: nine lessons, persisted acknowledgements and ${finish} exit`, async ({ page, context }) => {
    await preferences(context, lang)
    await page.goto('/overdrive/')
    await page.getByRole('button', { name: new RegExp(lang === 'ru' ? 'Освоить приёмы' : 'Learn the abilities') }).click()
    for (const [index, fixture] of TEACHING_FIXTURES.entries()) {
      await expect(app(page)).toHaveAttribute('data-mode', 'tutorial')
      await expect(page.locator('.od-lesson')).toContainText(lessonText[fixture.id][lang][0])
      await expect(page.locator('.od-lesson')).toContainText(lessonText[fixture.id][lang][1])
      await exercise(page, fixture, lang)
      // Actual reload of the just-played lesson: no localStorage replacement.
      await page.reload()
      await expect(page.locator('.od-lesson')).toContainText(lessonText[fixture.id][lang][2])
      await expect(app(page)).toHaveAttribute('data-turn', '1')
      if (index < TEACHING_FIXTURES.length - 1) {
        await page.getByRole('button', { name: lang === 'ru' ? 'Следующий приём' : 'Next exercise', exact: true }).click()
      }
    }
    await page.getByRole('button', { name: finish === 'continue'
      ? (lang === 'ru' ? 'Продолжить с движком' : 'Continue with the engine')
      : (lang === 'ru' ? 'Играть с начала' : 'Play from the start'), exact: true }).click()
    await expect(app(page)).toHaveAttribute('data-mode', 'bot')
    const persisted = await saved(page)
    if (finish === 'continue') {
      expect(persisted.root.forms.white).toEqual({ pieceId: 'wn', remainingTurns: 2 })
      expect(persisted.root.turnSerial).toBe(1)
    } else {
      expect(persisted.root.pieces).toHaveLength(32)
      expect(persisted.root.turnSerial).toBe(0)
      expect(persisted.root.energy).toEqual({ white: 0, black: 0 })
    }
  })
}

test('local launch, repeat-click/tap and Escape deselection, keyboard, save and language/view switching', async ({ page, context }) => {
  await preferences(context)
  await page.goto('/overdrive/')
  await page.getByRole('button', { name: 'At one board', exact: true }).click()
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await expect(app(page)).toHaveAttribute('data-mode', 'local')
  await clickSquare(page, 'e2')
  await expect(cell(page, 'e2')).toHaveAttribute('data-selected', 'true')
  await clickSquare(page, 'e2')
  await expect(cell(page, 'e2')).toHaveAttribute('data-selected', 'false')
  await clickSquare(page, 'e2')
  await page.keyboard.press('Escape')
  await expect(cell(page, 'e2')).toHaveAttribute('data-selected', 'false')
  await cell(page, 'e2').focus()
  await page.keyboard.press('ArrowRight')
  await expect(cell(page, 'f2')).toBeFocused()
  await move(page, 'e2', 'e4')
  await ready(page)
  await move(page, 'e7', 'e5')
  await expect(app(page)).toHaveAttribute('data-turn', '2')
  await ready(page)
  const before = await saved(page)
  await page.reload()
  await expect(app(page)).toHaveAttribute('data-mode', 'local')
  await expect(app(page)).toHaveAttribute('data-turn', '2')
  await expect(cell(page, 'e4')).toHaveAccessibleName(/Pawn/)
  await page.getByRole('button', { name: 'Русский', exact: true }).click()
  await expect(cell(page, 'e4')).toHaveAccessibleName(/Пешка/)
  expect((await saved(page)).actions).toEqual(before.actions)
  await page.locator('.od-board-tools').getByRole('button', { name: '3D', exact: true }).click()
  await page.locator('.od-board-tools').getByRole('button', { name: '2D', exact: true }).click()
  await expect(app(page)).toHaveAttribute('data-turn', '2')
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }))
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width + 1)
  expect(size.scrollHeight).toBeLessThanOrEqual(size.height + 1)
})

test('changing motion preference finishes the current scene without undoing or duplicating its action', async ({ page, context }) => {
  await preferences(context, 'en', null)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/overdrive/')
  await page.getByRole('button', { name: 'At one board', exact: true }).click()
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  for (const [index, [from, to, reduced]] of [['e2', 'e4', 'reduce'], ['e7', 'e5', 'no-preference']].entries()) {
    await move(page, from, to)
    await expect(app(page)).toHaveAttribute('data-locked', 'true')
    await page.emulateMedia({ reducedMotion: reduced as 'reduce' | 'no-preference' })
    // Let React's preference listener and layout cleanup commit; do not wait for the old scene timer.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await app(page).getAttribute('data-locked')).toBe('false')
    expect(await page.locator('.od-motion-layer').count()).toBe(0)
    const record = await saved(page)
    expect(record.actions).toHaveLength(index + 1)
    let state = record.root
    for (const action of record.actions) state = transition(state, action).state
    expect(state.turnSerial).toBe(index + 1)
    expect(state.pieces.find(piece => piece.square === to)?.type).toBe('pawn')
  }
})

test('engine uses the real bundled Worker and commits a legal reply', async ({ page, context }) => {
  await preferences(context)
  const workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  await page.goto('/overdrive/')
  await page.getByRole('slider', { name: /Difficulty/ }).focus()
  await page.keyboard.press('Home')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await move(page, 'e2', 'e4')
  await expect.poll(() => workers.length).toBeGreaterThan(0)
  await expect(app(page)).toHaveAttribute('data-turn', '2', { timeout: 15_000 })
  await ready(page)
  const record = await saved(page)
  expect(record.actions).toHaveLength(2)
  let state = record.root
  for (const action of record.actions) state = transition(state, action).state
  expect(state.side).toBe('white')
  expect(state.turnSerial).toBe(2)
})

test('3D scene loads the six independent models and retains a keyboard board', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'GPU scene route is checked in the dedicated desktop Chromium project')
  await preferences(context)
  const models = new Set<string>()
  page.on('response', response => { if (response.ok() && /\/assets\/overdrive\/models\/.*\.glb/.test(response.url())) models.add(response.url()) })
  await page.goto('/overdrive/')
  await page.getByRole('button', { name: 'At one board', exact: true }).click()
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await page.locator('.od-board-tools').getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.locator('.od-board-host canvas')).toBeVisible()
  await expect.poll(() => models.size).toBe(6)
  await page.locator('.od-board-accessible [data-square="e2"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.od-board-accessible [data-square="e2"]')).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Escape')
  await info.attach('overdrive-3d-desktop', { body: await page.screenshot(), contentType: 'image/png' })
})

test('two independent players: ready, metadata, move, reload, resignation and swapped-colour rematch', async ({ page, context, browser, baseURL }) => {
  await preferences(context)
  let syncFrames = 0
  page.on('websocket', socket => socket.on('framesent', frame => {
    try { if (JSON.parse(String(frame.payload)).type === 'sync') syncFrames++ }
    catch { /* Non-JSON frames are irrelevant to the heartbeat assertion. */ }
  }))
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })
  await preferences(guestContext)
  const guest = await guestContext.newPage()
  try {
    await page.goto('/overdrive/')
    await page.getByRole('button', { name: /Play online/ }).click()
    await page.getByLabel('Your name', { exact: true }).fill('Alpha')
    await page.getByRole('button', { name: 'Create room', exact: true }).click()
    await expect(page.locator('.od-lobby input')).toBeVisible()
    const invitation = await page.locator('.od-lobby input').inputValue()
    await guest.goto(invitation)
    await guest.getByLabel('Your name', { exact: true }).fill('Beta')
    await guest.getByRole('button', { name: 'Join room', exact: true }).click()
    await expect(page.locator('.od-connection')).toHaveCount(0)
    await expect(guest.locator('.od-connection')).toHaveCount(0)
    await page.getByRole('button', { name: 'I’m ready', exact: true }).click()
    await guest.getByRole('button', { name: 'I’m ready', exact: true }).click()
    await expect(page.locator('.od-lobby')).toHaveCount(0)
    await expect(guest.locator('.od-lobby')).toHaveCount(0)
    await move(page, 'e2', 'e4')
    for (const current of [page, guest]) { await expect(app(current)).toHaveAttribute('data-turn', '1'); await ready(current) }
    // Draw metadata must not freeze input because a deserialized board has a new object identity.
    await page.getByRole('button', { name: 'Offer draw', exact: true }).click()
    await guest.getByRole('button', { name: 'Play on', exact: true }).click()
    // Observe a real client heartbeat/resync; no transport callback or snapshot is injected.
    const previousSyncs = syncFrames
    await expect.poll(() => syncFrames, { timeout: 22_000 }).toBeGreaterThan(previousSyncs)
    await expect(page.locator('.od-connection')).toHaveCount(0)
    await move(guest, 'e7', 'e5')
    for (const current of [page, guest]) { await expect(app(current)).toHaveAttribute('data-turn', '2'); await ready(current) }
    await guest.reload()
    await guest.getByRole('button', { name: 'Return to your room', exact: true }).click()
    await expect(guest.locator('.od-connection')).toHaveCount(0)
    await expect(app(guest)).toHaveAttribute('data-mode', 'online')
    await move(page, 'g1', 'f3')
    for (const current of [page, guest]) { await expect(app(current)).toHaveAttribute('data-turn', '3'); await ready(current) }
    // White may resign while Blue is the actor; no history/turn rewrite is allowed.
    await page.getByRole('button', { name: 'Resign', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Resign', exact: true }).click()
    for (const current of [page, guest]) await expect(current.locator('.od-result-glyph')).toHaveText('0:1')
    await page.getByRole('button', { name: 'Rematch', exact: true }).click()
    await guest.getByRole('button', { name: 'Rematch', exact: true }).click()
    for (const current of [page, guest]) await expect(app(current)).toHaveAttribute('data-turn', '0')
    const roomId = new URL(page.url()).hash.match(/room=([^&]+)/)![1]
    const response = await page.request.get(`${baseURL}/api/overdrive/rooms/${roomId}`)
    expect(response.ok()).toBe(true)
    const result = await response.json()
    expect(result.snapshot.you).toBe('black')
    expect(result.snapshot.game.actions).toHaveLength(0)
  } finally { await guestContext.close() }
})
