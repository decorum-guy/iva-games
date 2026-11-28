import type { Page } from '@playwright/test'
import { createPosition } from '../../src/core'
import { createMatch } from '../../src/session/match'
import type { MatchRecord } from '../../src/session/match'
import { nextDie } from '../../src/session/random'
import { learnerAction, saveLearning, scriptAction, startLesson } from '../../src/tutorial/controller'
import { expect, test } from './fixtures'
import { clickMove, gameView, readRecords, readyGame, seedRecords } from './qaRecords'
import { localDuel } from './royalFixtures'

const recovery = (page: Page) => page.getByTestId('storage-recovery')
const retry = (page: Page) => page.getByTestId('retry-storage')
const practice = { mode: 'practice', human: 'white', level: 1, provenance: 'standard' } as const
const move = (from: string, to: string) => ({ type: 'move', from, to } as const)

async function open(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('remorse-settings-v1')) {
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: true, sound: false }))
    }
  })
  await page.goto('/remorse/')
  await page.getByTestId('mode-ai').waitFor()
}

async function holdWrite(page: Page, name: 'matches' | 'learning') {
  await page.evaluate(async name => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = database.transaction(name, 'readwrite')
    const closed = new Promise<void>(resolve => { tx.onabort = () => resolve() })
    Object.assign(window, { releaseRemorseLock: async () => { tx.abort(); await closed; database.close() } })
    // Continue issuing native requests in the other connection to hold the
    // write lock until the first tab reaches its actual time limit.
    await new Promise<void>((resolve, reject) => {
      function readAgain() {
        const request = tx.objectStore(name).get('__browser-test-lock__')
        request.onsuccess = () => { resolve(); readAgain() }
        request.onerror = () => reject(request.error)
      }
      readAgain()
    })
  }, name)
}

async function releaseWrite(page: Page) {
  await page.evaluate(() => (
    window as unknown as { releaseRemorseLock: () => Promise<void> }
  ).releaseRemorseLock())
}

/** Keep the native storage commit but suppress its one acknowledgement to idb. */
async function loseNextWriteAcknowledgement(page: Page, skip = 0) {
  await page.evaluate(skip => {
    const prototype: EventTarget = IDBTransaction.prototype
    const add = prototype.addEventListener
    prototype.addEventListener = function (this: IDBTransaction, type, listener, options) {
      if (type === 'complete' && this.mode === 'readwrite' && this.objectStoreNames.contains('matches') && skip-- === 0) {
        prototype.addEventListener = add
        return
      }
      return add.call(this, type, listener, options)
    }
  }, skip)
}

async function queueVersionChange(page: Page, held: boolean) {
  // An aborted upgrade exercises real versionchange/blocked events and leaves
  // the test database at v1. This never runs against a user's browser profile.
  await page.evaluate(async held => {
    const keeper = held ? await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }) : null
    const request = indexedDB.open('remorse-v1', 2)
    const upgraded = new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => { request.transaction?.abort(); resolve() }
      request.onsuccess = () => { request.result.close(); reject(new Error('Unexpected schema upgrade')) }
    })
    if (keeper) {
      await new Promise<void>(resolve => { request.onblocked = () => resolve() })
      Object.assign(window, { releaseRemorseUpgrade: async () => { keeper.close(); await upgraded } })
    } else {
      await Promise.race([upgraded, new Promise<never>((_, reject) => {
        request.onblocked = () => reject(new Error('An abandoned connection still holds the database'))
      })])
    }
  }, held)
}

test('a completed second tab coexists with a real worker, a capture and restoration', async ({ page, context }) => {
  await open(page)
  const seed = Array.from({ length: 100 }, (_, n) => n).find(n => nextDie(n).face === 4)!
  const game = createMatch(practice, { seed, root: createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'h1' }, { side: 'white', type: 'rook', square: 'c3' },
    { side: 'black', type: 'king', square: 'a8' }, { side: 'black', type: 'pawn', square: 'c4' },
    { side: 'black', type: 'rook', square: 'a7' }, { side: 'white', type: 'pawn', square: 'g2' },
  ] }) })
  const other = createMatch(localDuel)
  const finished = other.submit(other.envelope({ type: 'agreeDraw' }), 'human')
  await seedRecords(page, [game.record, finished.record], `game/${finished.record.id}`)
  const second = await context.newPage()
  await second.goto('/remorse/')
  await expect(gameView(second)).toHaveAttribute('data-game-id', finished.record.id)
  await expect(second.getByTestId('game-result')).toHaveAttribute('data-reason', 'agreement')
  await seedRecords(page, [], `game/${game.record.id}`)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', game.record.id)
  await clickMove(page, 'c3', 'c4')
  await expect(page.getByTestId('roll')).toHaveAttribute('data-face', '4')
  await expect(gameView(page)).toHaveAttribute('data-active-side', 'white', { timeout: 12_000 })
  await readyGame(page)
  const stored = (await readRecords<MatchRecord>(page, 'matches')).find(record => record.id === game.record.id)!
  expect(stored.actions[0].roll).toEqual({ face: 4, fixed: false })
  expect(stored.actions.some(action => action.actor === 'black')).toBe(true)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', game.record.id)
  await expect(gameView(page)).toHaveAttribute('data-revision', String(stored.revision))
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'none')
  await expect(gameView(page)).toHaveAttribute('data-dice', 'none')
  await expect(second.getByTestId('game-result')).toHaveAttribute('data-reason', 'agreement')
})

test('a queued write aborts at six seconds and recovery can replay only the uncommitted action', async ({ page, context }) => {
  await open(page)
  const start = createMatch(localDuel)
  await seedRecords(page, [start.record], `game/${start.record.id}`)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', start.record.id)
  const blocker = await context.newPage()
  await blocker.goto('/remorse/')
  await holdWrite(blocker, 'matches')
  const attemptedAt = Date.now()
  await clickMove(page, 'e2', 'e4')
  await expect(gameView(page)).toHaveAttribute('data-busy', 'true')
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageTimeout', { timeout: 12_000 })
  expect(Date.now() - attemptedAt).toBeGreaterThanOrEqual(5800)
  await expect(gameView(page)).toHaveAttribute('data-revision', '0')
  await releaseWrite(blocker)
  expect(await readRecords<MatchRecord>(page, 'matches')).toEqual([start.record])
  for (const [width, height] of [[1200, 710], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height })
    for (const locale of ['ru', 'en']) {
      await page.getByTestId(`lang-${locale}`).click()
      await expect(retry(page)).toBeInViewport({ ratio: 1 })
      await expect(recovery(page)).toContainText(locale === 'ru' ? 'Сохранения' : 'Saved games')
      await expect(page.locator('.flat-board')).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    }
  }
  await retry(page).click()
  await expect(recovery(page)).toHaveCount(0)
  await expect(gameView(page)).toHaveAttribute('data-game-id', start.record.id)
  await clickMove(page, 'e2', 'e4')
  await expect(gameView(page)).toHaveAttribute('data-revision', '1')
})

test('recovery reads a capture whose write landed and keeps the committed die still', async ({ page }) => {
  await open(page)
  let start = createMatch(localDuel)
  for (const command of [move('e2', 'e4'), move('d7', 'd5')]) start = start.submit(start.envelope(command), 'human')
  await seedRecords(page, [start.record], `game/${start.record.id}`)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-revision', '2')
  await loseNextWriteAcknowledgement(page)
  await clickMove(page, 'e4', 'd5')
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageTimeout', { timeout: 12_000 })
  await expect(gameView(page)).toHaveAttribute('data-revision', '2')
  const [record] = await readRecords<MatchRecord>(page, 'matches')
  expect(record.revision).toBe(3)
  expect(record.actions.at(-1)?.roll?.face).toBeDefined()
  await retry(page).click()
  await expect(gameView(page)).toHaveAttribute('data-game-id', start.record.id)
  await expect(gameView(page)).toHaveAttribute('data-revision', '3')
  await expect(gameView(page)).toHaveAttribute('data-dice', 'none')
  await expect(gameView(page)).toHaveAttribute('data-royal', 'none')
  await expect(page.getByTestId('roll')).toHaveAttribute('data-face', String(record.actions.at(-1)?.roll?.face))
  expect(await readRecords<MatchRecord>(page, 'matches')).toEqual([record])
})

test('a failed tutorial acknowledgement restores the same held result', async ({ page, context }) => {
  await open(page)
  const scripted = scriptAction(learnerAction(startLesson(), move('e2', 'e4')).progress)
  const checkpoint = saveLearning(learnerAction(scripted, move('e4', 'd5')).progress)
  await seedRecords(page, [], 'learn', checkpoint)
  await page.reload()
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-source-step', 'capture-and-roll')
  const step = await page.getByTestId('tutorial').getAttribute('data-step')
  const blocker = await context.newPage()
  await blocker.goto('/remorse/')
  await holdWrite(blocker, 'learning')
  await page.getByTestId('lesson-next').click()
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageTimeout', { timeout: 12_000 })
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', step!)
  await releaseWrite(blocker)
  await retry(page).click()
  await expect(recovery(page)).toHaveCount(0)
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', step!)
  await expect(gameView(page)).toHaveAttribute('data-dice', 'none')
  expect(await readRecords(page, 'learning')).toEqual([checkpoint])
  await page.getByTestId('lesson-next').click()
  await expect(page.getByTestId('tutorial')).not.toHaveAttribute('data-step', step!)
})

test('a late open closes, and a failed acknowledgement of the recovered practice copy does not fork it again', async ({ page, context }) => {
  await open(page)
  const original = createMatch(localDuel)
  await seedRecords(page, [original.record], `game/${original.record.id}`)
  await page.reload()
  await expect(gameView(page)).toHaveAttribute('data-game-id', original.record.id)
  const second = await context.newPage()
  await second.goto('/remorse/')
  await queueVersionChange(second, true)
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageClosed')
  await retry(page).click()
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageTimeout', { timeout: 12_000 })
  await page.getByTestId('leave-game').click()
  await expect(page.getByTestId('mode-learn')).toBeDisabled()
  await page.getByTestId('mode-ai').click()
  await page.getByTestId('setup-practice').click()
  await page.locator('.setup-more > summary').click();
  await page.getByTestId('setup-white').click()
  await page.getByTestId('setup-level').selectOption('1')
  await page.getByTestId('setup-start').click()
  await expect(gameView(page)).toHaveAttribute('data-mode', 'practice')
  await expect(gameView(page)).not.toHaveAttribute('data-game-id', original.record.id)
  const temporaryId = (await gameView(page).getAttribute('data-game-id'))!
  await expect(retry(page)).toBeVisible()
  await clickMove(page, 'e2', 'e4')
  await expect(gameView(page)).toHaveAttribute('data-active-side', 'white')
  await readyGame(page)
  const revision = (await gameView(page).getAttribute('data-revision'))!

  await second.evaluate(() => (window as unknown as { releaseRemorseUpgrade: () => Promise<void> }).releaseRemorseUpgrade())
  await queueVersionChange(second, false)
  await expect(gameView(page)).toHaveAttribute('data-game-id', temporaryId)
  await expect(gameView(page)).toHaveAttribute('data-revision', revision)
  const conflicting = createMatch(practice, { id: temporaryId, seed: 31 }).record
  await seedRecords(second, [conflicting])
  await loseNextWriteAcknowledgement(page, 1)
  await retry(page).click()
  await expect(gameView(page)).toHaveAttribute('data-storage-problem', 'storageTimeout', { timeout: 12_000 })
  const copyId = (await gameView(page).getAttribute('data-game-id'))!
  expect(copyId).not.toBe(temporaryId)
  const before = await readRecords<MatchRecord>(second, 'matches')
  expect(before).toHaveLength(3)
  expect(before).toContainEqual(original.record)
  expect(before).toContainEqual(conflicting)
  expect(before.find(record => record.id === copyId)?.revision).toBe(Number(revision))
  await retry(page).click()
  await expect(recovery(page)).toHaveCount(0)
  await expect(gameView(page)).toHaveAttribute('data-game-id', copyId)
  const after = await readRecords<MatchRecord>(second, 'matches')
  expect(after).toEqual(before)
})
