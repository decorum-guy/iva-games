import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Acceptance uses only visible controls and ordinary reloads. No injected game
// state, storage replacement, fixture endpoints, or direct API moves are used.
// Typechecking this suite is not evidence of a browser execution.
const board = (page: Page) => page.getByTestId('board-2d');
const cell = (page: Page, square: string) => board(page).locator(`[data-square="${square}"]`);
const lesson = (page: Page) => page.locator('.tutorial-banner');
const commands = (page: Page) => page.locator('.command-resource .full');

async function mobileIntent(page: Page, expanded: boolean) {
  const toggle = page.locator('.intent-mobile-toggle');
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded') === 'true') !== expanded) await toggle.click();
}

async function openEnglish2D(page: Page) {
  await page.goto('/colossus/');
  await expect(page.locator('.setup-screen')).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: '2D', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check();
  await dialog.getByRole('button', { name: 'Close / Закрыть', exact: true }).click();
}

async function beginHunt(page: Page) {
  await page.getByRole('button', { name: 'Begin hunt', exact: true }).click();
  await expect(board(page)).toBeVisible();
}

async function move(page: Page, from: string, to: string) {
  await mobileIntent(page, false);
  await cell(page, from).click();
  await expect(cell(page, from)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, to)).toHaveClass(/\blegal\b/);
  await cell(page, to).click();
}

async function guard(page: Page, square: string) {
  await mobileIntent(page, false);
  await cell(page, square).click();
  const button = page.locator('.piece-actions').getByRole('button', { name: 'Guard', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

async function strike(page: Page, from: string, target: string) {
  await mobileIntent(page, false);
  await cell(page, from).click();
  await page.locator('.piece-actions').getByRole('button', { name: 'Strike', exact: true }).click();
  await expect(cell(page, target)).toHaveClass(/\battack-target\b/);
  await cell(page, target).click();
}

async function playCard(page: Page, id: string, target: string) {
  await mobileIntent(page, false);
  await page.locator(`.hand-cards [data-card="${id}"]`).click();
  await cell(page, target).click();
  await page.locator('.card-target-panel').getByRole('button', { name: 'Apply', exact: true }).click();
}

async function menu(page: Page) {
  await page.locator('.top-rail').getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('.setup-screen')).toBeVisible();
}

async function continueLocal(page: Page, mode: 'Hunt' | 'Practice' = 'Hunt') {
  await page.locator('.mode-tabs').getByRole('button', { name: mode, exact: true }).click();
  await page.locator('.start-actions').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(board(page)).toBeVisible();
}

async function openTutorial(page: Page) {
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await page.getByRole('dialog', { name: 'Rules', exact: true })
    .getByRole('button', { name: 'Replay tutorial', exact: true }).click();
  await expect(lesson(page)).toBeVisible();
}

async function nextLesson(page: Page, name = 'Continue') {
  const button = lesson(page).getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

test('a legal 2D move and card survive a real reload', async ({ page }) => {
  await openEnglish2D(page);
  await beginHunt(page);
  await move(page, 'a1', 'a4');
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook 4\/4 HP/);
  await playCard(page, 'stone-skin', 'e1');
  await expect(cell(page, 'e1').locator('.unit-health em')).toHaveText('⬡2');
  await expect(page.locator('.focus-resource b')).toHaveText('2');
  await expect(commands(page)).toHaveCount(2);
  await expect(page.locator('.hand-cards [data-card]')).toHaveCount(2);

  await page.reload();
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook 4\/4 HP/);
  await expect(cell(page, 'a1').locator('.flat-unit')).toHaveCount(0);
  await expect(cell(page, 'e1').locator('.unit-health em')).toHaveText('⬡2');
  await expect(page.locator('.focus-resource b')).toHaveText('2');
  await expect(commands(page)).toHaveCount(2);
  await expect(page.locator('.hand-cards [data-card="stone-skin"]')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('practice edits and leaving a tutorial preserve the ordinary hunt', async ({ page }) => {
  await openEnglish2D(page);
  await beginHunt(page);
  await move(page, 'a1', 'a4');
  await menu(page);
  await page.locator('.mode-tabs').getByRole('button', { name: 'Practice', exact: true }).click();
  await beginHunt(page);
  await move(page, 'a1', 'a3');
  await mobileIntent(page, true);
  await page.getByRole('button', { name: 'Position editor', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Position editor', exact: true });
  await editor.getByLabel('Armor', { exact: true }).fill('5');
  await editor.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '5');

  await menu(page);
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook /);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '12');
  await openTutorial(page);
  await expect(lesson(page)).toContainText('Break the armor');
  await menu(page);
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook /);
  await expect(commands(page)).toHaveCount(2);

  await page.reload();
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook /);
  await menu(page);
  await continueLocal(page, 'Practice');
  await expect(cell(page, 'a3')).toHaveAttribute('aria-label', /^a3 Rook /);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '5');
});

test('all six lessons finish through real actions and return to the existing hunt', async ({ page }) => {
  test.setTimeout(90_000);
  await openEnglish2D(page);
  await beginHunt(page);
  await move(page, 'a1', 'a4');
  await openTutorial(page);

  await expect(lesson(page)).toContainText('Break the armor');
  await strike(page, 'a6', 'd6');
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '28');
  await strike(page, 'c5', 'd6');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '25');
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Strike and retreat');
  await strike(page, 'f5', 'd6');
  await expect(page.locator('.target-instruction')).toContainText('Choose the knight’s retreat');
  await cell(page, 'e4').click();
  await expect(cell(page, 'e4')).toHaveAttribute('aria-label', /^e4 Knight /);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('A living shield');
  await page.locator('.end-button').click();
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /^e1 King 20\/20 HP/);
  await expect(cell(page, 'e2').locator('.flat-unit')).toHaveCount(0);
  await nextLesson(page, 'Compare with fire');
  await page.locator('.end-button').click();
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /^e1 King 19\/20 HP/);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('A shield is consumed');
  await guard(page, 'e2');
  await page.locator('.end-button').click();
  await expect(cell(page, 'e2')).toHaveAttribute('aria-label', /^e2 Pawn 1\/2 HP/);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Two protected responses');
  await playCard(page, 'marble-vow', 'e1');
  await expect(page.locator('.focus-resource b')).toHaveText('0');
  await page.locator('.end-button').click();
  await expect(cell(page, 'e1').locator('.unit-health em')).toHaveText('◇1');
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Prepare a powerful round');
  for (const square of ['a6', 'c5', 'f5']) await guard(page, square);
  await expect(commands(page)).toHaveCount(0);
  await page.locator('.end-button').click();
  await mobileIntent(page, true);
  await expect(page.locator('.rest-copy')).toBeVisible();
  await strike(page, 'a6', 'd6');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '24');
  await nextLesson(page, 'Begin hunt');

  await expect(lesson(page)).toHaveCount(0);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4 Rook /);
  await expect(commands(page)).toHaveCount(2);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '12');
});

test('two independent commanders complete a round and reconnect to the same game', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = test.info().project.use;
  const first = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  const second = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  try {
    const a = await first.newPage(), b = await second.newPage();
    await Promise.all([openEnglish2D(a), openEnglish2D(b)]);
    await a.locator('.mode-tabs').getByRole('button', { name: 'Two commanders', exact: true }).click();
    await a.locator('.coop-choice').getByRole('button', { name: 'Online', exact: true }).click();
    await a.getByRole('button', { name: 'Create room', exact: true }).click();
    const invitation = a.getByRole('dialog', { name: 'Invitation', exact: true });
    await expect(invitation).toBeVisible();
    const link = await invitation.getByRole('textbox', { name: 'Invitation', exact: true }).inputValue();
    expect(new URL(link).searchParams.get('invite')).toBeTruthy();
    const room = new URL(link).searchParams.get('room');

    await b.getByRole('button', { name: 'Join · Online', exact: true }).click();
    const join = b.getByRole('dialog', { name: 'Join', exact: true });
    await join.getByLabel('Your name', { exact: true }).fill('Commander B');
    await join.getByLabel('Invitation link', { exact: true }).fill(link);
    await join.getByRole('button', { name: 'Join', exact: true }).click();
    await invitation.getByRole('button', { name: 'Close / Закрыть', exact: true }).click();
    await expect(board(b)).toBeVisible();
    await expect(a.locator('.online-banner')).toHaveCount(0);

    await guard(a, 'a1');
    await expect(b.locator('.coop-bar')).toContainText('Your command');
    await guard(b, 'd1');
    await expect(a.locator('.coop-bar')).toContainText('Your command');
    await guard(a, 'g1');
    await expect(commands(a)).toHaveCount(0);
    await expect(commands(b)).toHaveCount(0);
    await expect(b.locator('.end-button')).toBeDisabled();
    await a.locator('.end-button').click();
    for (const page of [a, b]) await expect(page.locator('.round-counter > b')).toHaveText('2/24');
    const position = await board(a).getByRole('gridcell').allTextContents();
    const hand = await a.locator('.hand-cards [data-card]').allTextContents();
    await expect(b.locator('.coop-bar')).toContainText('Your command');

    await Promise.all([a.reload(), b.reload()]);
    for (const page of [a, b]) {
      await expect(board(page)).toBeVisible();
      await expect(page.locator('.round-counter > b')).toHaveText('2/24');
      await expect(page.locator('.online-banner')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('room')).toBe(room);
      expect(await board(page).getByRole('gridcell').allTextContents()).toEqual(position);
      expect(await page.locator('.hand-cards [data-card]').allTextContents()).toEqual(hand);
    }
    // A subsequent authoritative command proves that the session and seat survived.
    await expect(b.locator('.coop-bar')).toContainText('Your command');
    await guard(b, 'd1');
    await expect(commands(a)).toHaveCount(2);
    await expect(commands(b)).toHaveCount(2);
    await expect(a.locator('.coop-bar')).toContainText('Your command');
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
