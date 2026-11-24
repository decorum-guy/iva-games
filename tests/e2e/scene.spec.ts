import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const surface = (page: Page) => page.locator('[data-renderer="3d"][data-scene-ready="true"]')

async function startHotseat(page: Page) {
  await page.getByTestId('mode-hotseat').click()
  await page.getByTestId('setup-start').click()
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-mode', 'hotseat')
}

async function readyCanvas(page: Page) {
  await expect(surface(page)).toBeVisible({ timeout: 15000 })
  return surface(page).locator('canvas')
}

async function topCamera(page: Page) {
  await page.getByTestId('settings').click()
  await page.getByRole('dialog').getByRole('combobox', { name: /^(Камера|Camera)$/ }).selectOption('top')
  await page.getByTestId('dialog-close').click()
}

// The top-view marble slab is 9.55 cells wide. Use square centers so pointer and
// touch events go through the actual rendered board and the normal picking path.
async function cellCenter(canvas: Locator, square: string, flipped = false) {
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Canvas does not have a visible bounding box')
  const cell = Math.min(box.width, box.height) / 10
  const orientation = flipped ? -1 : 1
  return {
    x: box.x + box.width / 2 + (square.charCodeAt(0) - 100.5) * cell * orientation,
    y: box.y + box.height / 2 + (4.5 - Number(square[1])) * cell * orientation,
  }
}

test.use({ reducedMotion: 'reduce' })

test('live 3D hotseat accepts pointer input, flips and recovers the same game after context loss', async ({ page, hasTouch }, testInfo) => {
  const errors: string[] = []
  const failedAssets: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().includes('/assets/chess/') && !response.ok()) failedAssets.push(response.url())
  })

  await page.goto('/')
  const canvas = await readyCanvas(page)
  await startHotseat(page)
  await topCamera(page)
  await expect(canvas).toBeVisible()
  const game = page.getByTestId('playfield')
  const id = (await game.getAttribute('data-game-id'))!
  expect(id).not.toBe('preview')

  if (hasTouch) {
    for (const square of ['b1', 'c3']) {
      const { x, y } = await cellCenter(canvas, square)
      await page.touchscreen.tap(x, y)
    }
  } else {
    const from = await cellCenter(canvas, 'b1')
    const to = await cellCenter(canvas, 'c3')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 5 })
    await page.mouse.up()
  }
  await expect(game).toHaveAttribute('data-revision', '1')
  await expect(game).toHaveAttribute('data-active-side', 'black')
  await expect(game).toHaveAttribute('data-animating', 'false')
  await page.getByTestId('flip').click()

  for (const square of ['e7', 'e5']) {
    const { x, y } = await cellCenter(canvas, square, true)
    if (hasTouch) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
  }
  await expect(game).toHaveAttribute('data-revision', '2')
  await expect(game).toHaveAttribute('data-active-side', 'white')
  await page.screenshot({ path: testInfo.outputPath('marble-hotseat.png') })

  expect(await canvas.evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2')
    const extension = gl?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    extension.loseContext()
    return true
  })).toBe(true)
  await expect(page.getByTestId('fallback')).toBeVisible()
  await expect(game).toHaveAttribute('data-game-id', id)
  await expect(game).toHaveAttribute('data-revision', '2')
  await expect(page.locator('[data-renderer="2d"]')).toBeVisible()
  await page.locator('[data-square="d2"]').click()
  await page.locator('[data-square="d4"]').click()
  await expect(game).toHaveAttribute('data-revision', '3')
  await expect(game).toHaveAttribute('data-turn', '3')

  await page.getByTestId('marble-mode').click()
  await readyCanvas(page)
  await expect(page.getByTestId('fallback')).toHaveCount(0)
  await expect(game).toHaveAttribute('data-game-id', id)
  await expect(game).toHaveAttribute('data-revision', '3')
  expect(failedAssets).toEqual([])
  expect(errors).toEqual([])
})

test('a failed chess model leaves a playable 2D board and retries the asset on demand', async ({ page }) => {
  const model = '**/assets/chess/chess_set_1k.gltf'
  await page.route(model, route => route.abort('failed'))
  await page.goto('/')
  await expect(page.getByTestId('fallback')).toBeVisible({ timeout: 15000 })
  await startHotseat(page)
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  const game = page.getByTestId('playfield')
  await expect(game).toHaveAttribute('data-revision', '1')
  const id = await game.getAttribute('data-game-id')

  await page.unroute(model)
  await page.getByTestId('marble-mode').click()
  await readyCanvas(page)
  await expect(game).toHaveAttribute('data-game-id', id!)
  await expect(game).toHaveAttribute('data-revision', '1')
})

test('studio lighting stays playable without its optional HDR reflection map', async ({ page }) => {
  let missingReflection = false
  await page.route('**/assets/chess/studio_small_09_1k.hdr', route => {
    missingReflection = true
    return route.abort('failed')
  })
  await page.goto('/')
  await readyCanvas(page)
  await expect.poll(() => missingReflection).toBe(true)
  await expect(page.getByTestId('fallback')).toHaveCount(0)
  await startHotseat(page)
  const board = page.locator('.board-stage')
  await board.focus()
  await board.press('Enter') // e2
  await board.press('ArrowUp')
  await board.press('ArrowUp')
  await board.press('Enter') // e4
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-revision', '1')
})
