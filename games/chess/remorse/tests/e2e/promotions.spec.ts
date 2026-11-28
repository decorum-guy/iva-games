import type { Page } from '@playwright/test'
import { applyResolvedCommand, createPosition } from '../../src/core'
import type { DieFace, PieceInput, Promotion, Side } from '../../src/core'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { restoreMatch } from '../../src/session/save'
import { expect, test } from './fixtures'
import { clickMove, gameView, readRecords, readyGame, seedRecords, square } from './qaRecords'
import { localDuel } from './royalFixtures'

const white: PieceInput[] = [
  { side: 'white', type: 'king', square: 'h2' }, { side: 'black', type: 'king', square: 'h6' },
  { side: 'white', type: 'pawn', square: 'b7' }, { side: 'black', type: 'rook', square: 'a8' },
]
const mate: PieceInput[] = [
  { side: 'white', type: 'king', square: 'c6' }, { side: 'black', type: 'king', square: 'a8' },
  { side: 'white', type: 'pawn', square: 'c7' }, { side: 'white', type: 'knight', square: 'b5' },
]
const kinds: Promotion[] = ['queen', 'rook', 'bishop', 'knight']
const seedFor = (face: DieFace) => Array.from({ length: 100 }, (_, seed) => seed).find(seed => nextDie(seed).face === face)!

async function open(page: Page, reduce = true) {
  await page.addInitScript(reduce => {
    if (!localStorage.getItem('remorse-settings-v1')) localStorage.setItem('remorse-settings-v1',
      JSON.stringify({ board: '2d', sound: false, locale: 'en', reduce }))
  }, reduce)
  await page.goto('/remorse/')
  await expect(page.getByTestId('mode-ai')).toBeVisible()
}

async function restoreGame(page: Page, record: MatchRecord) {
  await seedRecords(page, [record], 'game/' + record.id)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', record.id)
  await readyGame(page)
}

type Seen = { stage: string, label: string, die: string }

async function observePresentation(page: Page, target: string) {
  await page.evaluate(target => {
    const steps: Seen[] = []
    Object.assign(window, { promotionTrace: steps })
    const observer = new MutationObserver(() => {
      const field = document.querySelector<HTMLElement>('[data-testid="playfield"]')
      const stage = field?.dataset.promotionStage
      const phase = field?.dataset.dice
      if (!stage || !phase || steps.at(-1)?.stage === stage) return
      const label = document.querySelector(`[data-square="${target}"]`)?.getAttribute('aria-label') ?? ''
      steps.push({ stage, label, die: phase })
    })
    observer.observe(document.body, { childList: true, attributes: true, subtree: true,
      attributeFilter: ['data-promotion-stage', 'data-dice', 'aria-label'] })
  }, target)
}

function trace(page: Page): Promise<Seen[]> {
  return page.evaluate(() => (window as Window & { promotionTrace?: Seen[] }).promotionTrace ?? [])
}

const mirror = (name: string) => String.fromCharCode(201 - name.charCodeAt(0)) + String(9 - Number(name[1]))

for (const side of ['white', 'black'] as const) {
  for (const captures of [false, true]) test(`${side} ${captures ? 'capture' : 'quiet'} promotions form every chosen piece after its pawn`, async ({ page }) => {
    const transform = (name: string) => side === 'white' ? name : mirror(name)
    const from = transform('b7'), to = transform(captures ? 'a8' : 'b8')
    const pieces = white.map(piece => ({ ...piece, square: transform(piece.square),
      side: (side === 'white' ? piece.side : piece.side === 'white' ? 'black' : 'white') as Side }))
    await open(page)
    for (const target of kinds) {
      const root = createPosition({ side, pieces })
      const { record } = createMatch(localDuel, { root, seed: seedFor(2) })
      await restoreGame(page, record)
      await observePresentation(page, to)
      await clickMove(page, from, to)
      await expect(gameView(page)).toHaveAttribute('data-revision', '0')
      await expect(page.getByTestId('roll')).toHaveCount(0)
      await page.getByTestId('promotion-' + target).click()
      await expect(gameView(page)).toHaveAttribute('data-revision', '1')
      await readyGame(page)
      const events = await trace(page)
      expect(events.filter(item => item.stage !== 'none').map(item => item.stage))
        .toEqual(captures ? ['contact', 'roll', 'reaction', 'formation'] : ['contact', 'formation'])
      expect(events.find(item => item.stage === 'contact')?.label).toContain('Pawn')
      if (captures) {
        expect(events.find(item => item.stage === 'roll')).toMatchObject({ label: expect.stringContaining('Pawn'), die: 'throwing' })
        expect(events.find(item => item.stage === 'reaction')).toMatchObject({ label: expect.stringMatching(/Pawn, Guilt-ridden/), die: 'settled' })
      }
      const name = target[0].toUpperCase() + target.slice(1)
      expect(events.find(item => item.stage === 'formation')?.label).toContain(name)
      await expect(square(page, to)).toHaveAccessibleName(new RegExp(name))
      const stored = (await readRecords<MatchRecord>(page, 'matches')).find(match => match.id === record.id)!
      expect(restoreMatch(stored).state).toEqual(applyResolvedCommand(root, { type: 'move', from, to, promotion: target }, captures ? 2 : undefined).state)
    }
  })
}

test('a queen drop survives view, language and resize, then undo and replay restore it silently', async ({ page }) => {
  await open(page, false)
  const { record } = createMatch(localDuel, { root: createPosition({ pieces: white }), seed: seedFor(6) })
  await restoreGame(page, record)
  await observePresentation(page, 'a8')
  await clickMove(page, 'b7', 'a8')
  await page.getByTestId('promotion-queen').click()
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'formation')
  await expect(page.getByTestId('end-turn')).toHaveCount(0)
  await page.getByTestId('lang-ru').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('marble-mode').click()
  await expect(page.getByTestId('marble-mode')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('flat-mode').click()
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'formation')
  await page.getByTestId('undo').click()
  await expect(gameView(page)).toHaveAttribute('data-revision', '2')
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'none')
  await expect(page.getByTestId('flat-promotion')).toHaveCount(0)
  await expect(square(page, 'b7')).toHaveAccessibleName(/Пешка/)
  await page.getByTestId('redo').click()
  await expect(gameView(page)).toHaveAttribute('data-phase', 'bonus')
  await expect(gameView(page)).toHaveAttribute('data-dice', 'none')
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'none')
  await expect(square(page, 'a8')).toHaveAccessibleName(/Ферзь/)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', record.id)
  await expect(page.getByTestId('roll')).toHaveAttribute('data-face', '6')
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'none')
  await expect(page.getByTestId('end-turn')).toBeEnabled()
  await expect(page.getByTestId('end-turn')).toBeInViewport({ ratio: 1 })
})

test('a real worker promotes to mate and yields to the royal finish after formation', async ({ page }) => {
  await open(page, false)
  const { record } = createMatch({ mode: 'practice', human: 'black', level: 4, provenance: 'standard' },
    { root: createPosition({ pieces: mate }), seed: seedFor(4) })
  await seedRecords(page, [record], 'game/' + record.id)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'formation')
  await expect(gameView(page)).toHaveAttribute('data-promotion-kind', 'queen')
  await expect(gameView(page)).toHaveAttribute('data-royal', 'pending')
  await expect(page.getByTestId('game-result')).toHaveCount(0)
  await expect(gameView(page)).toHaveAttribute('data-royal', 'mate')
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'none')
  await expect(page.getByTestId('flat-promotion')).toHaveCount(0)
  await page.getByTestId('skip-royal').click()
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'checkmate')
  await expect(page.getByTestId('game-result')).toContainText('You lost')
  await page.reload()
  await expect(page.getByTestId('game-result')).toHaveAttribute('data-reason', 'checkmate')
  await expect(gameView(page)).toHaveAttribute('data-royal', 'none')
  await expect(gameView(page)).toHaveAttribute('data-promotion-stage', 'none')
  expect(await readRecords(page, 'ratingLedger')).toEqual([])
})
