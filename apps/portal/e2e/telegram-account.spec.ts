import { expect, test } from '@playwright/test';

test('registers through the Telegram code and opens the profile on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const guest = { auth: { email: false, telegram: true }, csrfToken: 'fixture' };
  const player = { playerId: 'self', email: '', emailVerified: false, telegramVerified: true, handle: 'iva_user', displayName: 'Iva' };
  let signedIn = false;
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/api/platform/v1')[1];
    const body = route.request().postDataJSON();
    if (path === '/auth/telegram/finish' && body.handle) {
      expect(body).toMatchObject({ attemptId: 'fixture', code: 'ABCDE234', handle: 'iva_user' });
      signedIn = true;
    }
    const replies: Record<string, unknown> = {
      '/session': { ...guest, user: signedIn ? player : null },
      '/games': { games: [] },
      '/rooms': { rooms: [] },
      '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] },
      '/invitations': { invitations: [] },
      '/telegram': { available: false, linked: false },
      '/auth/telegram/start': { attemptId: 'fixture', deepLink: 'https://t.me/iva_fixture_bot?start=fixture' },
      '/auth/telegram/finish': signedIn ? { user: player } : { profileRequired: true },
    };
    await route.fulfill({ json: replies[path] ?? {} });
  });
  await page.goto('/login');
  await expect(page.getByLabel('Почта', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Продолжить через Telegram' }).click();
  await expect(page.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute('href', 'https://t.me/iva_fixture_bot?start=fixture');
  await page.getByLabel('Код из Telegram').fill('ABCDE234');
  await page.getByRole('button', { name: 'Подтвердить код' }).click();
  await page.getByLabel('Имя пользователя').fill('iva_user');
  await page.getByLabel('Как вас называть').fill('Iva');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Iva', { exact: true }).first()).toBeVisible();
  await page.goto('/profile');
  await expect(page.getByText('Подтверждён', { exact: true })).toBeVisible();
  await page.getByLabel('Аватар').selectOption('knight');
  await expect(page.locator('.profile-identity .avatar')).toHaveText('♞');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
