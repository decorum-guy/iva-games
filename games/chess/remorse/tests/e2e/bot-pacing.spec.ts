import { createPosition } from '../../src/core'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { expect, test } from './fixtures'
import { clickMove, gameView, readRecords, readyGame, seedRecords, square } from './qaRecords'

type Frame = {
  time: number
  revision: string | null
  die: string | null
  caption: string
  bloodlust: string
  fits: boolean
  piece: string
  thinking: boolean
}

function botCapture(rolled: boolean) {
  const seed = Array.from({ length: 100 }, (_, value) => value).find(value => nextDie(value).face === 6)!
  return createMatch({ mode: 'practice', human: 'white', level: 8, provenance: 'standard' }, {
    seed,
    root: createPosition({ side: 'black', pieces: [
      { type: 'king', side: 'black', square: 'a8' },
      { type: 'king', side: 'white', square: 'h1' },
      { type: 'rook', side: 'black', square: 'd4', capturesSinceRebirth: 2,
        ...(rolled ? {} : { affliction: 'berserk', captureReaction: 'berserk' }) },
      { type: 'queen', side: 'white', square: 'd5' },
      { type: 'pawn', side: 'white', square: 'f5' },
      { type: 'pawn', side: 'white', square: 'g2' },
    ] }),
  })
}

for (const rolled of [true, false]) {
  test(`the real bot leaves its ${rolled ? 'die and escalation' : 'unrolled bloodlust'} readable before its bonus`, async ({ page }, testInfo) => {
    const reduced = testInfo.project.name === 'webkit'
    const locale = reduced ? 'ru' : 'en'
    await page.setViewportSize(reduced ? { width: 568, height: 320 } : { width: 1440, height: 820 })
    await page.addInitScript(({ locale, reduced }) => {
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale, reduce: reduced, sound: false }))
      const frames: Frame[] = []
      Object.assign(window, { pacingFrames: frames })
      let previous = ''
      new MutationObserver(() => {
        const view = document.querySelector('[data-testid="playfield"]')
        if (!view) return
        const label = view.querySelector('[data-testid="bloodlust-result"]')
        const bounds = label?.getBoundingClientRect()
        const values = {
          revision: view.getAttribute('data-revision'),
          die: view.getAttribute('data-dice'),
          caption: view.querySelector('.dice-caption')?.textContent?.trim() ?? '',
          bloodlust: label?.textContent?.trim() ?? '',
          fits: Boolean(bounds && bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.left >= 0
            && bounds.right <= innerWidth && bounds.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight),
          piece: view.querySelector('[data-square="d5"] .piece-icon')?.getAttribute('class') ?? '',
          thinking: view.getAttribute('data-thinking') === 'true',
        }
        const key = JSON.stringify(values)
        if (key !== previous) frames.push({ time: performance.now(), ...values })
        previous = key
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    }, { locale, reduced })
    const { record } = botCapture(rolled)
    await page.goto('/')
    await page.getByTestId('mode-ai').waitFor()
    await seedRecords(page, [record], 'game/' + record.id)
    await page.reload()

    const view = gameView(page)
    const result = page.getByTestId('bloodlust-result')
    await expect(result).toHaveText(reduced ? 'Жажда крови на d5' : 'Bloodlust on d5')
    await expect(view).toHaveAttribute('data-revision', '1')
    await expect(page.getByTestId('end-turn')).toHaveCount(0)
    await expect(view).toHaveAttribute('data-revision', '2')
    const frames = await page.evaluate(() => (window as unknown as { pacingFrames: Frame[] }).pacingFrames)
    const opening = frames.find(frame => frame.revision === '0' && frame.thinking)!
    const landing = frames.find(frame => frame.revision === '1')!
    const effect = frames.find(frame => frame.revision === '1' && frame.bloodlust)!
    const next = frames.find(frame => frame.revision === '2')!
    expect(opening).toBeDefined()
    expect(landing.time - opening.time).toBeGreaterThan(reduced ? 165 : 280)
    expect(landing.bloodlust).toBe('')
    expect(landing.piece).toContain(rolled ? 'neutral' : 'berserk')
    expect(effect.piece).toContain('bloodlust')
    expect(effect.fits).toBe(true)
    expect(frames.some(frame => frame.revision === '1' && frame.thinking && frame.bloodlust)).toBe(true)
    expect(next.time - effect.time).toBeGreaterThan(reduced ? 550 : 760)
    if (rolled) {
      const settled = frames.find(frame => frame.die === 'settled' && frame.caption === '6')!
      const reaction = frames.find(frame => frame.caption === (reduced ? '6 · Ярость' : '6 · Berserk'))!
      expect(frames.some(frame => frame.die === 'throwing')).toBe(true)
      expect(settled.time).toBeLessThan(reaction.time)
      expect(reaction.time).toBeLessThan(effect.time)
      expect(reaction.piece).toContain('berserk')
    } else {
      expect(frames.every(frame => frame.caption === '')).toBe(true)
    }
    const stored = (await readRecords<MatchRecord>(page, 'matches')).find(match => match.id === record.id)!
    expect(stored.actions).toHaveLength(2)
    expect(stored.actions[0]).toMatchObject({ actor: 'black', command: { type: 'move', from: 'd4', to: 'd5' } })
    expect(stored.actions[0].roll).toEqual(rolled ? { face: 6, fixed: false } : undefined)
    expect(stored.actions[1]).toMatchObject({ actor: 'black', command: { type: 'move', from: 'd5', to: 'f5' } })
    expect(stored.actions[1].roll).toBeUndefined()
  })
}

test('keeps the result readable when a long task delays its first paint', async ({ page }, testInfo) => {
  const reduced = testInfo.project.name === 'webkit'
  await page.addInitScript(({ reduced }) => {
    localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale: 'en', reduce: reduced, sound: false }))
    const sample = { blocked: false, revealFrameAt: 0, nextAt: 0 }
    Object.assign(window, { delayedResultSample: sample })
    new MutationObserver(() => {
      const view = document.querySelector('[data-testid="playfield"]')
      const revision = view?.getAttribute('data-revision')
      if (!sample.blocked && revision === '1' && view?.querySelector('[data-testid="bloodlust-result"]')) {
        sample.blocked = true
        // Simulate a busy main thread after the DOM changed but before paint.
        const until = performance.now() + 1100
        while (performance.now() < until) { /* deliberate long task */ }
        requestAnimationFrame(() => { sample.revealFrameAt = performance.now() })
      }
      if (revision === '2' && sample.nextAt === 0) sample.nextAt = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  }, { reduced })
  const { record } = botCapture(false)
  await page.goto('/')
  await page.getByTestId('mode-ai').waitFor()
  await seedRecords(page, [record], 'game/' + record.id)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-revision', '2', { timeout: 15_000 })
  const sample = await page.evaluate(() => (window as unknown as {
    delayedResultSample: { blocked: boolean; revealFrameAt: number; nextAt: number }
  }).delayedResultSample)
  expect(sample.blocked).toBe(true)
  expect(sample.revealFrameAt).toBeGreaterThan(0)
  expect(sample.nextAt - sample.revealFrameAt).toBeGreaterThan(reduced ? 550 : 760)
})

test('waits for the returned result after visibility changes during the AI die', async ({ page }, testInfo) => {
  const reduced = testInfo.project.name === 'webkit'
  await page.addInitScript(({ reduced }) => {
    localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', locale: 'en', reduce: reduced, sound: false }))
    const sample = { hidden: false, hidOnce: false, returnedAt: 0, nextAt: 0 }
    Object.assign(window, { resultVisibilitySample: sample })
    // Exercise the page's real visibility listener deterministically in both
    // browser engines. This is a simulated tab-visibility change, not OS focus.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => sample.hidden })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: () => sample.hidden ? 'hidden' : 'visible',
    })
    new MutationObserver(() => {
      const view = document.querySelector('[data-testid="playfield"]')
      if (!sample.hidOnce && view?.getAttribute('data-revision') === '1'
        && view.getAttribute('data-dice') === 'throwing') {
        sample.hidden = true
        sample.hidOnce = true
        document.dispatchEvent(new Event('visibilitychange'))
      }
      if (view?.getAttribute('data-revision') === '2' && sample.nextAt === 0) sample.nextAt = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  }, { reduced })
  const { record } = botCapture(true)
  await page.goto('/')
  await page.getByTestId('mode-ai').waitFor()
  await seedRecords(page, [record], 'game/' + record.id)
  await page.reload()
  await expect(page.getByTestId('bloodlust-result')).toHaveText('Bloodlust on d5')
  expect(await page.evaluate(() => document.hidden)).toBe(true)
  await page.waitForTimeout(1800)
  await expect(gameView(page)).toHaveAttribute('data-revision', '1')
  const before = (await readRecords<MatchRecord>(page, 'matches')).find(match => match.id === record.id)!
  expect(before.actions).toHaveLength(1)
  expect(before.actions[0].roll?.face).toBe(6)
  await page.evaluate(() => {
    const sample = (window as unknown as { resultVisibilitySample: { hidden: boolean; returnedAt: number } }).resultVisibilitySample
    sample.hidden = false
    sample.returnedAt = performance.now()
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(gameView(page)).toHaveAttribute('data-revision', '2', { timeout: 15_000 })
  const interval = await page.evaluate(() => {
    const sample = (window as unknown as { resultVisibilitySample: { returnedAt: number; nextAt: number } }).resultVisibilitySample
    return sample.nextAt - sample.returnedAt
  })
  expect(interval).toBeGreaterThan(reduced ? 550 : 760)
  const after = (await readRecords<MatchRecord>(page, 'matches')).find(match => match.id === record.id)!
  expect(after.actions).toHaveLength(2)
  expect(after.actions.filter(action => action.roll)).toHaveLength(1)
})

test('a selected figure can be cleared again, including a restored bonus', async ({ page, hasTouch }) => {
  await page.addInitScript(() => {
    localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: true, sound: false }))
  })
  await page.goto('/')
  await page.getByTestId('mode-hotseat').waitFor()
  const game = createMatch({ mode: 'hotseat', human: null, level: null, provenance: 'standard' }, {
    root: createPosition({ pieces: [
      { type: 'king', side: 'white', square: 'h1' },
      { type: 'king', side: 'black', square: 'a8' },
      { type: 'rook', side: 'white', square: 'd4', affliction: 'berserk', captureReaction: 'berserk', capturesSinceRebirth: 1 },
      { type: 'pawn', side: 'black', square: 'd5' },
      { type: 'pawn', side: 'black', square: 'e5' },
    ] }),
  })
  await seedRecords(page, [game.record], 'game/' + game.record.id)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', game.record.id)
  const pick = (name: string) => hasTouch ? square(page, name).tap() : square(page, name).click()
  await pick('d4')
  await expect(square(page, 'd4')).toHaveClass(/mark-selected/)
  await pick('d4')
  await expect(square(page, 'd4')).not.toHaveClass(/mark-selected/)
  await expect(square(page, 'd5')).not.toHaveClass(/mark-capture/)
  await clickMove(page, 'd4', 'd5')
  await readyGame(page)

  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-phase', 'bonus')
  await expect(square(page, 'd5')).toHaveClass(/mark-selected/)
  await pick('d5')
  await expect(square(page, 'd5')).not.toHaveClass(/mark-selected/)
  await expect(square(page, 'e5')).not.toHaveClass(/mark-capture/)
  // An empty square must not bring back the cleared bonus selection.
  await pick('d6')
  await expect(square(page, 'd5')).not.toHaveClass(/mark-selected/)
  await expect(square(page, 'e5')).not.toHaveClass(/mark-capture/)
  await expect(gameView(page)).toHaveAttribute('data-revision', '1')
  await expect(page.getByTestId('end-turn')).toBeEnabled()
  await pick('d5')
  await expect(square(page, 'd5')).toHaveClass(/mark-selected/)
  await page.locator('.board-stage').press('Escape')
  await expect(square(page, 'd5')).not.toHaveClass(/mark-selected/)
  await pick('d6')
  await expect(square(page, 'd5')).not.toHaveClass(/mark-selected/)
  await expect(square(page, 'e5')).not.toHaveClass(/mark-capture/)
  await expect(gameView(page)).toHaveAttribute('data-revision', '1')
  await clickMove(page, 'd5', 'e5')
  await expect(gameView(page)).toHaveAttribute('data-revision', '2')
})
