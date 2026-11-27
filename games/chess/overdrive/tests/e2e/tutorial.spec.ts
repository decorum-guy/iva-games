import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ABILITY_PRACTICE, QUICK_LESSONS } from '../../src/tutorial/quickTeaching'
import { ABILITIES, type Action, type GameState } from '../../src/core'
import { abilityName, pieceName, type Language } from '../../src/ui/i18n'

const tutorial = (page: Page) => page.locator('.od-quick-tutorial')
const app = (page: Page) => page.locator('.od-app')
const square = (page: Page, cell: string) => page.locator(`.od-board-2d [data-square="${cell}"]`)
const localSave = (page: Page) => page.evaluate(() => localStorage.getItem('overdrive-local-v1'))
async function preferences(context: BrowserContext, lang: Language = 'en') {
  await context.addInitScript(language => {
    if (!localStorage.getItem('overdrive-settings-v1')) localStorage.setItem('overdrive-settings-v1',
      JSON.stringify({ version: 1, settings: { lang: language, mute: true, volume: 0, view: '2d', reduced: true } }))
  }, lang)
}
async function clickSquare(page: Page, cell: string) {
  if (test.info().project.name.includes('mobile') || test.info().project.name.includes('landscape')) await square(page, cell).tap()
  else await square(page, cell).click()
}
async function normalGame(page: Page, lang: Language) {
  await page.goto('/overdrive/')
  await page.getByRole('button', { name: lang === 'ru' ? 'За одной доской' : 'At one board', exact: true }).click()
  await page.getByRole('button', { name: lang === 'ru' ? 'Начать партию' : 'Start game', exact: true }).click()
  await clickSquare(page, 'e2'); await clickSquare(page, 'e4')
  await expect(app(page)).toHaveAttribute('data-turn', '1')
  await expect(app(page)).toHaveAttribute('data-locked', 'false')
  return localSave(page)
}
async function openTutorial(page: Page, lang: Language) {
  await page.getByRole('button', { name: lang === 'ru' ? 'Обучение' : 'Tutorial', exact: true }).click()
  await expect(tutorial(page)).toHaveAttribute('data-step', 'pawn')
}
async function play(page: Page, state: GameState, action: Action, lang: Language) {
  await expect(tutorial(page)).toHaveAttribute('data-status', 'ready')
  if (action.mode !== 'normal') {
    const mode = action.mode === 'activate' ? (lang === 'ru' ? 'Форсаж' : 'Overdrive')
      : action.mode === 'form' ? (lang === 'ru' ? 'Приём' : 'Ability') : (lang === 'ru' ? 'Импульс' : 'Impulse')
    await page.locator('.od-power-switch').getByRole('button', { name: new RegExp(`^${mode}`) }).click()
  }
  const target = action.to ?? state.pieces.find(piece => piece.id === action.targetId)!.square
  await expect(square(page, target)).toHaveAttribute('data-target', 'true')
  await clickSquare(page, target)
  await expect(tutorial(page)).toHaveAttribute('data-status', 'showing')
}
async function visibleBoardAndControls(page: Page) {
  for (const cell of ['a1', 'h1', 'a8', 'h8']) {
    expect(await square(page, cell).evaluate(element => {
      const rect = element.getBoundingClientRect()
      return rect.width >= 18 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
        element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
  }
  for (const button of await page.locator('.od-quick-guide .od-power-switch button').all()) await expect(button).toBeInViewport({ ratio: 1 })
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
  expect(width[0]).toBeLessThanOrEqual(width[1])
}

for (const lang of ['ru', 'en'] as const) {
  test(`${lang}: ten real actions, energy and own-turn timer; ordinary save survives`, async ({ page, context }, info) => {
    await preferences(context, lang)
    const before = await normalGame(page, lang)
    await openTutorial(page, lang)
    for (const [index, step] of QUICK_LESSONS.entries()) {
      await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
      await visibleBoardAndControls(page)
      if (step.id === 'activate') {
        await expect(page.locator('.od-quick-timer')).toHaveAttribute('data-remaining', '3')
        await expect(page.locator('.od-capacitors')).toHaveAccessibleName(/6/)
        await info.attach(`tutorial-${lang}-form`, { body: await page.screenshot(), contentType: 'image/png' })
      }
      await play(page, step.state, step.expected, lang)
      if (step.id === 'rook') await expect(page.locator('.od-capacitors')).toHaveAccessibleName(/2/)
      if (step.id === 'impulse' || step.id === 'activate') await expect(page.locator('.od-capacitors')).toHaveAccessibleName(/0/)
      if (index >= 7) {
        const remaining = String(9 - index)
        await expect(page.locator('.od-quick-timer')).toHaveAttribute('data-remaining', remaining)
        if (step.reply) {
          await expect(tutorial(page)).toHaveAttribute('data-status', 'opponent')
          await expect(page.locator('.od-quick-timer')).toHaveAttribute('data-remaining', remaining)
        }
      }
      expect(await localSave(page)).toBe(before)
    }
    await expect(tutorial(page)).toHaveAttribute('data-status', 'complete')
    await expect(page.locator('.od-quick-pieces button')).toHaveCount(6)
    await info.attach(`tutorial-${lang}-complete`, { body: await page.screenshot(), contentType: 'image/png' })
    await page.getByRole('button', { name: lang === 'ru' ? 'Вернуться к игре' : 'Return to game', exact: true }).click()
    await expect(app(page)).toHaveAttribute('data-mode', 'local')
    await expect(app(page)).toHaveAttribute('data-turn', '1')
    expect(await localSave(page)).toBe(before)
    await page.reload()
    await expect(app(page)).toHaveAttribute('data-turn', '1')
    await expect(square(page, 'e4')).toHaveAccessibleName(lang === 'ru' ? /Пешка/ : /Pawn/)
  })
}

test('skip chess basics, optional six abilities and replay stay separate from a saved game', async ({ page, context }) => {
  await preferences(context)
  const before = await normalGame(page, 'en')
  await openTutorial(page, 'en')
  await page.getByRole('button', { name: /I know chess/ }).click()
  await expect(tutorial(page)).toHaveAttribute('data-step', 'impulse')
  for (const step of QUICK_LESSONS.slice(6)) {
    await expect(tutorial(page)).toHaveAttribute('data-step', step.id)
    await play(page, step.state, step.expected, 'en')
  }
  await expect(tutorial(page)).toHaveAttribute('data-status', 'complete')
  for (const fixture of ABILITY_PRACTICE) {
    const piece = fixture.state.pieces.find(item => item.id === fixture.expected.pieceId)!
    await page.getByRole('button', { name: `${pieceName(piece.type, 'en')} · ${abilityName(ABILITIES[piece.type], 'en')}`, exact: true }).click()
    await expect(tutorial(page)).toHaveAttribute('data-track', 'abilities')
    await play(page, fixture.state, fixture.expected, 'en')
    await expect(tutorial(page)).toHaveAttribute('data-status', 'complete')
    await expect(tutorial(page).getByRole('heading', { level: 1 })).toContainText('— complete')
    expect(await localSave(page)).toBe(before)
  }
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(tutorial(page)).toHaveAttribute('data-step', 'pawn')
  await page.keyboard.press('Escape')
  await expect(app(page)).toHaveAttribute('data-turn', '1')
  expect(await localSave(page)).toBe(before)
})

test('move-book entry and reloading an unfinished lesson preserve the normal save', async ({ page, context }) => {
  await preferences(context)
  const before = await normalGame(page, 'en')
  // The move book remains in the header on wide screens; mobile reaches the same
  // practice from the setup menu without a second, save-replacing trainer.
  if (await page.getByRole('button', { name: 'Move book', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Move book', exact: true }).click()
    await page.getByRole('button', { name: 'Try on the board', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('button', { name: /Learn on the board/ }).click()
  }
  await play(page, QUICK_LESSONS[0].state, QUICK_LESSONS[0].expected, 'en')
  expect(await localSave(page)).toBe(before)
  await page.reload()
  await expect(tutorial(page)).toHaveCount(0)
  await expect(app(page)).toHaveAttribute('data-mode', 'local')
  await expect(app(page)).toHaveAttribute('data-turn', '1')
  expect(await localSave(page)).toBe(before)
})

test('opening the trainer cancels the hidden local bot until returning', async ({ page, context }) => {
  await preferences(context)
  await page.goto('/overdrive/')
  await page.getByRole('slider', { name: /Difficulty/ }).fill('1')
  await page.getByRole('button', { name: 'Start game', exact: true }).click()
  await clickSquare(page, 'e2'); await clickSquare(page, 'e4')
  await openTutorial(page, 'en')
  const before = await localSave(page)
  expect(JSON.parse(before!).actions).toHaveLength(1)
  await play(page, QUICK_LESSONS[0].state, QUICK_LESSONS[0].expected, 'en')
  await expect(tutorial(page)).toHaveAttribute('data-step', 'knight')
  expect(await localSave(page)).toBe(before)
  await page.getByRole('button', { name: /Back to game/ }).click()
  await expect(app(page)).toHaveAttribute('data-turn', '2', { timeout: 15_000 })
})

test('online tutorial consumes a queued reply and returns the latest room without sending lesson actions', async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'Authoritative room/animation isolation is independent of viewport')
  await preferences(context)
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await preferences(guestContext)
  const guest = await guestContext.newPage()
  let revision = 0, sent = 0
  page.on('websocket', socket => {
    socket.on('framesent', frame => { if (JSON.parse(String(frame.payload)).type === 'command') sent++ })
    socket.on('framereceived', frame => {
      const message = JSON.parse(String(frame.payload))
      if (message.snapshot) revision = Math.max(revision, message.snapshot.game.revision)
    })
  })
  await page.clock.install({ time: new Date('2026-11-27T12:00:00Z') })
  try {
    const before = await normalGame(page, 'en')
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('button', { name: /Play online/ }).click()
    await page.getByLabel('Your name', { exact: true }).fill('Tutor host')
    await page.getByRole('button', { name: 'Create room', exact: true }).click()
    const invitation = await page.locator('.od-lobby input').inputValue()
    await guest.goto(invitation)
    await guest.getByLabel('Your name', { exact: true }).fill('Tutor guest')
    await guest.getByRole('button', { name: 'Join room', exact: true }).click()
    await expect(page.locator('.od-connection')).toHaveCount(0)
    await expect(guest.locator('.od-connection')).toHaveCount(0)
    await page.getByRole('button', { name: 'I’m ready', exact: true }).click()
    await guest.getByRole('button', { name: 'I’m ready', exact: true }).click()
    await expect(page.locator('.od-lobby')).toHaveCount(0)
    await expect(guest.locator('.od-lobby')).toHaveCount(0)
    const roomUrl = page.url()
    // Hold only the host's visual clock. Both players still use real sockets and
    // native clicks; a real guest move must arrive behind the host's animation.
    await page.clock.pauseAt(new Date('2026-11-27T12:01:00Z'))
    await square(page, 'e2').click({ force: true }); await square(page, 'e4').click({ force: true })
    await expect(app(page)).toHaveAttribute('data-turn', '1')
    await expect(app(guest)).toHaveAttribute('data-turn', '1')
    await expect(app(guest)).toHaveAttribute('data-locked', 'false')
    await square(guest, 'e7').click(); await square(guest, 'e5').click()
    await expect.poll(() => revision).toBe(2)
    await expect(app(page)).toHaveAttribute('data-turn', '1')
    await expect(app(page)).toHaveAttribute('data-locked', 'true')
    await page.getByRole('button', { name: 'Tutorial', exact: true }).click({ force: true })
    await expect(tutorial(page)).toHaveAttribute('data-step', 'pawn')
    await page.getByRole('button', { name: /Back to game/ }).click({ force: true })
    await expect(app(page)).toHaveAttribute('data-turn', '2')
    await expect(app(page)).toHaveAttribute('data-locked', 'false')
    await page.clock.resume()
    await clickSquare(page, 'g1'); await clickSquare(page, 'f3')
    await expect(app(page)).toHaveAttribute('data-turn', '3')
    await expect(app(guest)).toHaveAttribute('data-turn', '3')
    await openTutorial(page, 'en')
    const commandsBeforeLesson = sent
    await expect(app(guest)).toHaveAttribute('data-locked', 'false')
    await square(guest, 'g8').click(); await square(guest, 'f6').click()
    await expect.poll(() => revision).toBe(4)
    await play(page, QUICK_LESSONS[0].state, QUICK_LESSONS[0].expected, 'en')
    await expect(tutorial(page)).toHaveAttribute('data-step', 'knight')
    expect(sent).toBe(commandsBeforeLesson)
    expect(await localSave(page)).toBe(before)
    expect(page.url()).toBe(roomUrl)
    await page.getByRole('button', { name: /Back to game/ }).click()
    await expect(app(page)).toHaveAttribute('data-mode', 'online')
    await expect(app(page)).toHaveAttribute('data-turn', '4')
    await expect(square(page, 'f6')).toHaveAccessibleName(/Knight/)
    await clickSquare(page, 'f1'); await clickSquare(page, 'c4')
    await expect(app(guest)).toHaveAttribute('data-turn', '5')
    expect(await localSave(page)).toBe(before)
  } finally { await page.clock.resume(); await guestContext.close() }
})
