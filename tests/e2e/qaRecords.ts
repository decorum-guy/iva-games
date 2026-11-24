import type { Page } from '@playwright/test'
import type { Profile } from '../../src/rating/elo'
import type { MatchRecord } from '../../src/session/match'
import { expect } from './fixtures'

export const gameView = (page: Page) => page.getByTestId('playfield')
export const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`)

export async function seedRecords(page: Page, matches: readonly MatchRecord[], active?: string, learning?: unknown, profile?: Profile) {
  await page.evaluate(async ({ matches, active, learning, profile }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['matches', 'learning', 'profiles'], 'readwrite')
        for (const match of matches) tx.objectStore('matches').put(match)
        if (learning) tx.objectStore('learning').put(learning, 'progress')
        if (profile) tx.objectStore('profiles').put(profile)
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
    if (active) localStorage.setItem('remorse-view-v1', active)
  }, { matches, active, learning, profile })
}

export async function readRecords<T>(page: Page, name: 'matches' | 'profiles' | 'ratingLedger' | 'learning'): Promise<T[]> {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open('remorse-v1')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(name)
      const read = tx.objectStore(name).getAll()
      tx.oncomplete = () => { db.close(); resolve(read.result) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  }), name)
}

export async function readyGame(page: Page) {
  await expect(gameView(page)).toHaveAttribute('data-busy', 'false')
  await expect(gameView(page)).toHaveAttribute('data-animating', 'false')
}

export async function clickMove(page: Page, from: string, to: string) {
  await readyGame(page)
  await square(page, from).click()
  await square(page, to).click()
}
