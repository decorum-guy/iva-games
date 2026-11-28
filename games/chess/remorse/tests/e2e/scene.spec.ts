import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { createPosition } from '../../src/core'
import { CAMERA_OVERSCAN } from '../../src/scene/cameraFocus'
import { createMatch } from '../../src/session/match'
import { exportMatch } from '../../src/session/save'

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
  const box = await canvas.evaluate(element => {
    const rect = element.closest('[data-renderer="3d"]')!.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  const cell = Math.min(box.width, box.height) / 10
  const orientation = flipped ? -1 : 1
  return {
    x: box.x + box.width / 2 + (square.charCodeAt(0) - 100.5) * cell * orientation,
    y: box.y + box.height / 2 + (4.5 - Number(square[1])) * cell * orientation,
  }
}

test.use({ reducedMotion: 'reduce' })

test('the flat board accepts a normal desktop drag and a mobile tap move', async ({ page, hasTouch }) => {
  await page.goto('/remorse/')
  await page.getByTestId('flat-mode').click()
  await startHotseat(page)
  const from = page.locator('[data-square="e2"]')
  const to = page.locator('[data-square="e4"]')
  if (hasTouch) {
    await from.tap()
    await to.tap()
  } else {
    const start = (await from.boundingBox())!
    const finish = (await to.boundingBox())!
    const center = (rect: typeof start) => [rect.x + rect.width / 2, rect.y + rect.height / 2] as const
    await page.mouse.move(...center(start))
    await page.mouse.down()
    await page.mouse.move(...center(finish), { steps: 12 })
    await page.mouse.move(...center(finish))
    await page.mouse.up()
  }
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-revision', '1')
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-active-side', 'black')
  await expect(to).toHaveAccessibleName(/Пешка|Pawn/)
})

test('live 3D hotseat accepts pointer input, flips and recovers the same game after context loss', async ({ page, hasTouch }, testInfo) => {
  const errors: string[] = []
  const failedAssets: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().includes('/assets/chess/') && !response.ok()) failedAssets.push(response.url())
  })

  await page.goto('/remorse/')
  const canvas = await readyCanvas(page)
  await startHotseat(page)
  await topCamera(page)
  await expect(canvas).toBeVisible()
  const game = page.getByTestId('playfield')
  const id = (await game.getAttribute('data-game-id'))!
  expect(id).not.toBe('preview')

  const knight = await cellCenter(canvas, 'b1')
  const pickKnight = () => hasTouch ? page.touchscreen.tap(knight.x, knight.y) : page.mouse.click(knight.x, knight.y)
  await pickKnight()
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-selected', 'b1')
  await pickKnight()
  await expect(page.getByTestId('inspector')).toHaveCount(0)

  if (hasTouch) {
    const from = await cellCenter(canvas, 'b1')
    const to = await cellCenter(canvas, 'c3')
    await page.touchscreen.tap(from.x, from.y)
    await expect(page.getByTestId('inspector')).toContainText('b1')
    expect(await cellCenter(canvas, 'c3')).toEqual(to)
    await page.touchscreen.tap(to.x, to.y)
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
  await page.goto('/remorse/')
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
  await page.goto('/remorse/')
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

test('both armies render their distinct surface states at the ordinary camera in high and low quality', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /WebGLProgram|VALIDATE_STATUS|shader.*error|Error compiling/i.test(message.text())) {
      errors.push(message.text())
    }
  })
  if (testInfo.project.name === 'webkit') await page.setViewportSize({ width: 360, height: 800 })
  const root = createPosition({ pieces: [
    { side: 'white', type: 'king', square: 'a1' },
    { side: 'black', type: 'king', square: 'a8' },
    { side: 'white', type: 'rook', square: 'b2' },
    { side: 'white', type: 'rook', square: 'd2', affliction: 'guilt' },
    { side: 'white', type: 'rook', square: 'f2', affliction: 'devastated' },
    { side: 'white', type: 'rook', square: 'h2', affliction: 'berserk' },
    { side: 'black', type: 'rook', square: 'b6' },
    { side: 'black', type: 'rook', square: 'd6', affliction: 'guilt' },
    { side: 'black', type: 'rook', square: 'f6', affliction: 'devastated' },
    { side: 'black', type: 'rook', square: 'h6', affliction: 'bloodlust' },
  ] })
  const session = createMatch({ mode: 'hotseat', human: null, level: null, provenance: 'import' }, { root })
  await page.goto('/remorse/')
  await readyCanvas(page)
  await page.getByTestId('settings').click()
  await page.getByTestId('import-file').setInputFiles({
    name: 'surface-states.json', mimeType: 'application/json', buffer: Buffer.from(exportMatch(session)),
  })
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-mode', 'hotseat')
  const canvas = await readyCanvas(page)
  const board = page.locator('.board-stage')
  // Use the ordinary fitted camera throughout. These artifacts are for actual
  // normal-scale visual review; shader compilation and input are asserted here.
  await board.focus()
  await board.press('ArrowLeft') // d2 from the default keyboard square e2
  await board.press('Enter')
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-state', 'guilt')
  for (const quality of ['high', 'low']) {
    await page.getByTestId('settings').click()
    await page.getByRole('dialog').getByRole('combobox', { name: /^(Качество 3D|3D quality)$/ }).selectOption(quality)
    await page.getByTestId('dialog-close').click()
    await expect(surface(page)).toBeVisible()
    await canvas.screenshot({ path: testInfo.outputPath(`material-states-${quality}.png`) })
    await expect(page.getByTestId('fallback')).toHaveCount(0)
  }
  await board.focus()
  await board.press('ArrowUp')
  await board.press('Enter') // the guilt-ridden rook makes a permitted quiet move
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-revision', '1')
  await expect(page.getByTestId('playfield')).toHaveAttribute('data-active-side', 'black')
  await page.getByTestId('flip').click()
  await canvas.screenshot({ path: testInfo.outputPath('material-states-flipped.png') })
  expect(errors).toEqual([])
})

test('a manual 3D flip uses the larger canvas throughout one continuous orbit', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/remorse/')
  await readyCanvas(page)
  await startHotseat(page)
  const stage = page.locator('.board-stage')
  const scene = surface(page)
  await expect(stage).toHaveCSS('overflow', 'hidden')
  const canvas = scene.locator('canvas')
  // After entering hotseat, the renderer resizes from the home layout.
  const dimensions = await stage.evaluate(element => ({
    width: element.clientWidth, height: element.clientHeight,
  }))
  await expect.poll(async () => {
    const bounds = await canvas.boundingBox()
    return bounds ? Math.abs(bounds.height - dimensions.height * CAMERA_OVERSCAN) : Infinity
  }).toBeLessThan(2)
  const canvasBefore = await canvas.boundingBox()
  expect(canvasBefore!.width).toBeGreaterThan(dimensions.width * 1.4)
  await page.getByTestId('flip').click()
  await expect(scene).toHaveAttribute('data-camera-orbit', '')
  await expect(stage).toHaveCSS('overflow', 'visible')
  const canvasDuring = await scene.locator('canvas').boundingBox()
  expect(canvasDuring).toEqual(canvasBefore)
  await expect(scene).not.toHaveAttribute('data-camera-orbit')
  await expect(stage).toHaveCSS('overflow', 'hidden')
  expect(await scene.locator('canvas').boundingBox()).toEqual(canvasBefore)
  await expect(page.locator('.table-column .player-row').last()).toHaveAttribute('data-side', 'black')
})
