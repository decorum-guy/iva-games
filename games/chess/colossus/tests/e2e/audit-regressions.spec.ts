import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { activate, beginHunt, board, cell, expect, fitsViewport, menu, mobileIntent, openEnglish, test } from './helpers';

const huntSave = 'colossus.save.v1';
const practiceSave = 'colossus.practice.v1';
const storageValue = (page: Page, key: string) => page.evaluate(key => localStorage.getItem(key), key);
const mode = (page: Page, name: string) => page.locator('.mode-tabs').getByRole('button', { name, exact: true });

test('damaged hunt and practice saves can be downloaded and are archived before replacement', async ({ page }) => {
  await openEnglish(page);
  const damaged = { [huntSave]: '  {partial hunt save\n', [practiceSave]: JSON.stringify({ state: { revision: -20 }, options: {}, attemptId: 'bad-practice' }) };
  await page.evaluate(damaged => {
    for (const [key, raw] of Object.entries(damaged)) localStorage.setItem(key, raw);
  }, damaged);
  await page.reload();
  const notice = page.locator('.save-notice');
  const start = page.getByTestId('start-game');
  const continueGame = page.locator('.start-actions').getByRole('button', { name: 'Continue', exact: true });
  await expect(notice.getByRole('alert')).toContainText('This save could not be opened');
  await expect(continueGame).toHaveCount(0);
  const download = page.waitForEvent('download');
  await activate(notice.getByRole('button', { name: 'Download a copy' }));
  const recovered = await download;
  expect(JSON.parse(await readFile(await recovered.path(), 'utf8'))).toEqual({ slot: huntSave, copies: [damaged[huntSave]] });
  expect(await storageValue(page, huntSave)).toBe(damaged[huntSave]);

  for (const [name, key] of [['Practice', practiceSave], ['Hunt', huntSave]] as const) {
    await activate(mode(page, name));
    await expect(notice.getByRole('alert')).toContainText('This save could not be opened');
    await expect(continueGame).toHaveCount(0);
    await activate(start);
    await expect(board(page)).toBeVisible();
    await expect.poll(() => storageValue(page, key + '.recovery')).toBe(JSON.stringify([damaged[key]]));
    expect(JSON.parse((await storageValue(page, key))!).state.mode).toBe(name.toLowerCase());
    if (key === practiceSave) expect(await storageValue(page, huntSave)).toBe(damaged[huntSave]);
    await page.reload();
    await activate(mode(page, name));
    await expect(notice.getByRole('status')).toContainText('A copy of the damaged save');
    await activate(continueGame);
    await expect(board(page)).toBeVisible();
    await menu(page);
  }
});

test('rules show strike values in both languages and a targetless card needs only Apply', async ({ page }) => {
  await openEnglish(page);
  for (const language of ['en', 'ru'] as const) {
    const ru = language === 'ru';
    if (ru) await activate(page.locator('.language-switch'));
    await activate(page.getByRole('button', { name: ru ? 'Правила' : 'Rules', exact: true }));
    const dialog = page.getByRole('dialog');
    const table = dialog.getByRole('table', { name: ru ? 'Удары фигур' : 'Piece strikes' });
    await expect(table.locator('tbody tr')).toHaveCount(6);
    const rook = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: ru ? 'Ладья' : 'Rook' }) });
    const bishop = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: ru ? 'Слон' : 'Bishop' }) });
    await expect(rook).toContainText(ru ? '3 после снятия до 1 брони' : '3 after removing up to 1 armor');
    await expect(rook).toContainText(ru ? 'До 3 клеток' : 'Up to 3 squares');
    await expect(bishop).toContainText(ru ? '2 при наличии брони, 3 без неё' : '2 while armored, 3 when exposed');
    await expect(bishop).toContainText(ru ? 'До 4 клеток' : 'Up to 4 squares');
    await expect(dialog).toContainText(ru ? 'если нужно, цель' : 'if needed, a target');
    await activate(dialog.getByRole('button', { name: 'Close / Закрыть', exact: true }));
  }
  await activate(page.locator('.language-switch'));
  await activate(mode(page, 'Practice'));
  await beginHunt(page);
  await mobileIntent(page, true);
  await activate(page.getByRole('button', { name: 'Position editor', exact: true }));
  const editor = page.getByRole('dialog', { name: 'Position editor', exact: true });
  await editor.getByRole('checkbox', { name: 'Concentration', exact: true }).check();
  await activate(editor.getByRole('button', { name: 'Apply changes', exact: true }));
  await mobileIntent(page, false);
  await activate(page.locator('.hand-cards [data-card="focus"]'));
  await expect(page.locator('.selection-hint')).toHaveText('Press Apply');
  const apply = page.locator('.card-target-panel').getByRole('button', { name: 'Apply', exact: true });
  await expect(apply).toBeEnabled();
  await activate(apply);
  await expect(page.locator('.focus-resource b')).toHaveText('5');
});

async function playOnFullBoard(page: Page) {
  const grid = board(page);
  const width = () => grid.evaluate(element => element.getBoundingClientRect().width);
  const minWidth = page.viewportSize()!.height <= 680 ? 304 : 272;
  await expect.poll(width).toBeGreaterThanOrEqual(minWidth);
  const initial = await width();
  await activate(page.locator('.hand-cards [data-card="stone-skin"]'));
  await expect.poll(async () => Math.abs(await width() - initial)).toBeLessThanOrEqual(1);
  const king = cell(page, 'e1');
  await king.scrollIntoViewIfNeeded();
  await expect.poll(() => king.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(x + width / 2, y + height / 2));
  })).toBe(true);
  await activate(king);
  await activate(page.locator('.card-target-panel').getByRole('button', { name: 'Apply', exact: true }));
  await expect(king).toHaveAccessibleName(/shield 2/i);
  await fitsViewport(page);
}

test('the battle keeps a usable board while choosing a card target at 130% text', async ({ page }, info) => {
  await openEnglish(page);
  await page.addStyleTag({ content: 'html { font-size: 130%; }' });
  await beginHunt(page);
  await playOnFullBoard(page);
  if (info.project.name === 'short-mobile-chromium') {
    await menu(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await beginHunt(page);
    await playOnFullBoard(page);
  }
});
