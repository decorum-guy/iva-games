import { expect, test } from '@playwright/test';

for (const lang of ['ru', 'en'] as const) {
  test.describe(lang, () => {
  const ru = lang === 'ru';
  const text = (a: string, b: string) => ru ? a : b;
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(lang => {
      localStorage.setItem('remorse-settings-v1', JSON.stringify({ locale: lang, board: '2d', reduce: true, sound: false }));
      localStorage.setItem('overdrive-settings-v1', JSON.stringify({ version: 1, settings: { lang, mute: true, volume: 0, view: '2d', reduced: true } }));
      localStorage.setItem('colossus.settings.v1', JSON.stringify({ lang, view: '2d', sound: false, reduced: true, theme: 'ivory' }));
    }, lang);
  });

  test(`${lang}: REMORSE has one new-game route, a short friend choice and keeps its rated save`, async ({ page }) => {
    await page.goto('/remorse/');
    const home = page.locator('.home-panel');
    await expect(home.locator('.play-options>.primary')).toHaveCount(1);
    await expect(home.getByRole('button', { name: text('Обучение', 'Tutorial'), exact: true })).toBeVisible();
    await page.getByTestId('mode-friend').click();
    const friends = page.getByRole('dialog', { name: text('С другом', 'With a friend'), exact: true });
    await expect(friends.getByRole('button', { name: text('На одном устройстве', 'On one device'), exact: true })).toBeVisible();
    await expect(friends.getByRole('button', { name: text('По сети', 'Online'), exact: true })).toBeVisible();
    await friends.getByTestId('dialog-close').click();
    await home.getByRole('button', { name: text('Новая партия', 'New game'), exact: true }).click();
    await expect(page.locator('.setup-more')).not.toHaveAttribute('open');
    await page.getByTestId('setup-start').click();
    const board = page.getByTestId('playfield');
    await expect(board).toHaveAttribute('data-view', 'game');
    const id = await board.getAttribute('data-game-id');
    await page.reload();
    await expect(board).toHaveAttribute('data-game-id', id!);
    // Going home preserves the pending rated match and makes Continue primary.
    await page.locator('.brand').click();
    await expect(home.getByRole('button', { name: text('Продолжить', 'Continue'), exact: true })).toHaveClass(/primary/);
    await page.getByTestId('mode-ai').click();
    await expect(page.getByTestId('setup-start')).toBeDisabled();
    await page.getByTestId('setup-cancel').click();
    await home.getByRole('button', { name: text('Продолжить', 'Continue'), exact: true }).click();
    await expect(board).toHaveAttribute('data-game-id', id!);
  });

  test(`${lang}: OVERDRIVE starts simply and cancellation preserves a zero-move saved game`, async ({ page }) => {
    await page.goto('/overdrive/');
    expect(await page.evaluate(() => localStorage.getItem('overdrive-local-v1'))).toBeNull();
    await page.getByTestId('mode-friend').click();
    const friends = page.getByRole('dialog', { name: text('С другом', 'With a friend'), exact: true });
    await expect(friends.getByRole('button', { name: text('На одном устройстве', 'On one device'), exact: true })).toBeVisible();
    await expect(friends.getByRole('button', { name: text('По сети', 'Online'), exact: true })).toBeVisible();
    await friends.getByRole('button', { name: text('В меню', 'Menu'), exact: true }).click();
    await expect(page.locator('.od-more-options')).not.toHaveAttribute('open');
    await page.getByRole('button', { name: text('На одном устройстве', 'On one device'), exact: true }).click();
    await page.getByRole('button', { name: text('Начать партию', 'Start game'), exact: true }).click();
    const save = await page.evaluate(() => localStorage.getItem('overdrive-local-v1'));
    expect(save).not.toBeNull();
    await page.reload();
    await expect(page.locator('.od-app')).toHaveAttribute('data-mode', 'local');
    await expect(page.locator('.od-app')).toHaveAttribute('data-turn', '0');
    await page.locator('.od-new-game').click();
    await expect(page.getByTestId('continue-game')).toBeVisible();
    await expect(page.locator('.od-new-options')).not.toHaveAttribute('open');
    await page.locator('.od-new-options>summary').click();
    await page.getByRole('button', { name: text('Начать партию', 'Start game'), exact: true }).click();
    const confirm = page.getByRole('dialog', { name: text('Начать новую партию?', 'Start a new game?'), exact: true });
    await confirm.getByRole('button', { name: text('Отмена', 'Cancel'), exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('overdrive-local-v1'))).toBe(save);
    await page.getByTestId('continue-game').click();
    await expect(page.locator('.od-app')).toHaveAttribute('data-turn', '0');
  });

  test(`${lang}: COLOSSUS hides advanced modes and preserves a hunt through menu and tutorial`, async ({ page }) => {
    await page.goto('/colossus/');
    await expect(page.locator('.setup-more')).not.toHaveAttribute('open');
    await page.getByTestId('mode-friend').click();
    const friends = page.getByRole('dialog', { name: text('С другом', 'With a friend'), exact: true });
    await expect(friends.getByRole('button', { name: text('На одном устройстве', 'On one device'), exact: true })).toBeVisible();
    await expect(friends.getByRole('button', { name: text('По сети', 'Online'), exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('start-game').click();
    await expect(page.getByTestId('board-2d')).toBeVisible();
    const save = await page.evaluate(() => localStorage.getItem('colossus.save.v1'));
    expect(save).not.toBeNull();
    await page.reload();
    const setup = page.locator('.setup-screen');
    await expect(setup.getByRole('button', { name: text('Продолжить', 'Continue'), exact: true })).toHaveClass(/primary/);
    await page.getByTestId('start-game').click();
    const confirm = page.getByRole('dialog', { name: text('Начать новую партию?', 'Start a new game?'), exact: true });
    await confirm.getByRole('button', { name: text('Отмена', 'Cancel'), exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('colossus.save.v1'))).toBe(save);
    await setup.getByRole('button', { name: text('Обучение', 'Tutorial'), exact: true }).click();
    await expect(page.locator('.tutorial-banner')).toBeVisible();
    await page.locator('.top-rail').getByRole('button', { name: text('Меню', 'Menu'), exact: true }).click();
    await setup.getByRole('button', { name: text('Продолжить', 'Continue'), exact: true }).click();
    await expect(page.getByTestId('board-2d')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('colossus.save.v1'))).toBe(save);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  });
}
