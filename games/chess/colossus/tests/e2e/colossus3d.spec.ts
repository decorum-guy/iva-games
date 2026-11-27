import { inflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { BOSSES, HUNT_BOSSES } from '../../src/core/data';
import { activate, beginHunt, board, cell, commands, expect, guard, lesson, menu, openEnglish, response, test } from './helpers';

/** Read screenshots in memory; no reference snapshots or screenshot artifacts are published. */
function pixelEvidence(png: Buffer) {
  let width = 0, height = 0, channels = 0;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const bytes = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(0); height = bytes.readUInt32BE(4);
      expect(bytes[8], 'PNG screenshot bit depth').toBe(8);
      channels = bytes[9] === 6 ? 4 : bytes[9] === 2 ? 3 : 0;
    }
    if (type === 'IDAT') compressed.push(bytes);
    offset += length + 12;
  }
  expect(channels, 'RGB/RGBA PNG screenshot').toBeGreaterThanOrEqual(3);
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
  let previous = new Uint8Array(stride), position = 0, minimum = 255, maximum = 0;
  const colors = new Set<number>();
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[position++], row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0, b = previous[x], c = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      row[x] = (raw[position++] + predictor) & 255;
    }
    if (y % 5 === 0) for (let x = 0; x < width; x += 5) {
      const index = x * channels;
      if (channels === 4 && row[index + 3] === 0) continue;
      const r = row[index], g = row[index + 1], b = row[index + 2], light = (r + g + b) / 3;
      minimum = Math.min(minimum, light); maximum = Math.max(maximum, light);
      colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    }
    previous = row;
  }
  return { width, height, colors: colors.size, luminanceRange: maximum - minimum };
}

function modelsLoaded(page: Page) {
  const loaded = new Set<string>(), failed: string[] = [];
  page.on('response', result => {
    const match = /\/assets\/colossus\/models\/([^/]+)\.glb$/.exec(new URL(result.url()).pathname);
    if (match) { if (result.ok()) loaded.add(match[1]); else failed.push(match[1]); }
  });
  return { loaded, failed };
}

async function rendered3D(page: Page) {
  const scene = page.getByTestId('board-3d'), canvas = scene.locator('canvas');
  await expect(scene).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(scene.locator('.scene-hp').first()).toBeVisible();
  expect(await canvas.evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    return { present: !!gl, version: gl?.getParameter(gl.VERSION) as string | undefined, lost: gl?.isContextLost() };
  })).toMatchObject({ present: true, version: expect.stringContaining('WebGL'), lost: false });
  const evidence = pixelEvidence(await canvas.screenshot({ type: 'png' }));
  expect(evidence.width).toBeGreaterThan(200);
  expect(evidence.height).toBeGreaterThan(150);
  expect(evidence.colors, 'rendered scene has more than a clear-color canvas').toBeGreaterThan(12);
  expect(evidence.luminanceRange).toBeGreaterThan(45);
}

async function canvasSquare(page: Page, square: string) {
  // Read the actual projected coordinate labels from the rendered board. Camera
  // matrices/game state are not injected or used to bypass pointer hit testing.
  const labels = page.getByTestId('board-3d').locator('.scene-coordinate');
  const file = await labels.filter({ hasText: new RegExp('^' + square[0] + '$') }).boundingBox();
  const rank = await labels.filter({ hasText: new RegExp('^' + square[1] + '$') }).boundingBox();
  expect(file).not.toBeNull(); expect(rank).not.toBeNull();
  await page.mouse.click(file!.x + file!.width / 2, rank!.y + rank!.height / 2);
}

test('real WebGL renders production models, accepts pointer moves and survives context loss', async ({ page }) => {
  const models = modelsLoaded(page);
  await openEnglish(page, '3d');
  for (const id of HUNT_BOSSES) {
    const name = BOSSES[id].name.en;
    await activate(page.locator('.boss-choices').getByRole('button', { name, exact: true }));
    await beginHunt(page, '3d');
    await expect.poll(() => models.loaded.has(id)).toBe(true);
    await rendered3D(page);
    await menu(page);
  }
  for (const id of ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']) expect(models.loaded.has(id), id + ' loaded').toBe(true);
  expect(models.failed).toEqual([]);
  await activate(page.locator('.boss-choices').getByRole('button', { name: 'The Stone Regent', exact: true }));
  await beginHunt(page, '3d');
  await rendered3D(page);
  await canvasSquare(page, 'a1');
  await expect(page.getByTestId('board-3d').locator('[data-square="a1"]')).toHaveAttribute('aria-selected', 'true');
  await canvasSquare(page, 'a4');
  await expect(page.getByTestId('board-3d').locator('[data-square="a4"]')).toHaveAttribute('aria-label', /^a4, Rook 4\/4 HP/);
  await expect(commands(page)).toHaveCount(2);

  const lossSupported = await page.getByTestId('board-3d').locator('canvas').evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(lossSupported).toBe(true);
  await expect(board(page)).toBeVisible();
  await expect(page.locator('.board-scene-fallback-note')).toHaveText('3D is unavailable. Using 2D.');
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook 4\/4 HP/);
  await expect(commands(page)).toHaveCount(2);
  await guard(page, 'g1');
  await expect(commands(page)).toHaveCount(1);
});

test('Warden has its own 3D model and a promoted piece stays playable across views', async ({ page }) => {
  const models = modelsLoaded(page);
  await openEnglish(page, '3d');
  await activate(page.locator('.tutorial-invitation'));
  await expect(lesson(page)).toContainText('Read the intention');
  await expect(page.locator('.boss-heading h1')).toHaveText('The Warden');
  await expect.poll(() => models.loaded.has('sentinel')).toBe(true);
  await rendered3D(page);
  const accessible = page.getByTestId('board-3d').getByRole('grid', { name: 'Accessible board' });
  await accessible.locator('[data-square="e1"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(accessible.locator('[data-square="d1"]')).toHaveAttribute('aria-label', /^d1, King 20\/20 HP/);
  await response(page);
  await expect(lesson(page)).toContainText('The ray missed');
  await menu(page);

  await activate(page.locator('.mode-tabs').getByRole('button', { name: 'Practice', exact: true }));
  await beginHunt(page, '3d');
  await activate(page.getByRole('button', { name: 'Position editor', exact: true }));
  const editor = page.getByRole('dialog', { name: 'Position editor', exact: true });
  const pawn = editor.locator('.editor-unit').filter({ has: page.locator('input[value="c2"]') });
  await expect(pawn).toHaveCount(1);
  await pawn.getByLabel('Square', { exact: true }).fill('c7');
  await activate(editor.getByRole('button', { name: 'Apply changes', exact: true }));
  const grid = page.getByTestId('board-3d').getByRole('grid', { name: 'Accessible board' });
  await grid.locator('[data-square="c7"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  const promotion = page.getByRole('dialog', { name: 'Pawn promotion', exact: true });
  await expect(promotion.getByRole('button')).toHaveCount(5); // Four choices and the close control.
  await activate(promotion.getByRole('button', { name: 'Queen', exact: true }));
  await expect(grid.locator('[data-square="c8"]')).toHaveAttribute('aria-label', /^c8, Queen 2\/6 HP/);
  await rendered3D(page);
  await activate(page.locator('.board-view-toggle').getByRole('button', { name: '2D', exact: true }));
  await expect(cell(page, 'c8')).toHaveAttribute('aria-label', /^c8, Queen 2\/6 HP/);
  await expect(commands(page)).toHaveCount(2);
  expect(models.failed).toEqual([]);
});
