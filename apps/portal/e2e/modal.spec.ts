import { expect, test } from '@playwright/test';

// Exercise the real portal and dialog with isolated, non-network account data.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/platform/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').at(-1);
    const data: Record<string, unknown> = {
      session: { user: { playerId: 'self', handle: 'player', displayName: 'Player', email: 'player@example.test', emailVerified: true }, csrfToken: 'test' },
      games: { games: [{ gameId: 'platform-lab', title: 'Пробный стол', minPlayers: 2, maxPlayers: 6, supportsBots: true, rulesVersion: '1', contentVersion: '1', status: 'available' }] },
      friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
      rooms: { rooms: [] }, invitations: { invitations: [] },
      telegram: { available: false, linked: false, reason: 'not_configured' },
    };
    await route.fulfill({ json: data[path ?? ''] ?? {} });
  });
});

test('keeps focus in the dialog and returns it to its opener', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/rooms');
  const opener = page.getByRole('button', { name: 'Создать комнату' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('fits the viewport and keeps form controls reachable at high zoom equivalent', async ({ page }) => {
  await page.setViewportSize({ width: 195, height: 422 });
  await page.goto('/rooms');
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      controlsFit: [...node.querySelectorAll('input, select, button')].every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= rect.left - 1 && box.right <= rect.right + 1;
      }) };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.controlsFit).toBe(true);
  await dialog.getByRole('button', { name: 'Создать комнату' }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Создать комнату' })).toBeInViewport();
});
