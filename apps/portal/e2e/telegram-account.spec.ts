import { expect, test } from '@playwright/test';
import { encode } from 'jpeg-js';

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
  await page.getByRole('link', { name: 'Мой профиль' }).click();
  await expect(page.getByRole('heading', { name: 'Iva', exact: true })).toBeVisible();
  await expect(page.getByText('Подтверждён', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Аватар: Конь' }).click();
  await expect(page.locator('.profile-identity .avatar')).toHaveText('♞');
  expect((await page.locator('.profile-identity .avatar-piece').boundingBox())!.height).toBeGreaterThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('chooses a character and uploads, previews and saves a profile photo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let player: Record<string, unknown> = { playerId: '99999999-1111-4111-8111-999999999999', email: '', emailVerified: false,
    telegramVerified: true, handle: 'iva_user', displayName: 'Iva', avatar: 'queen' };
  let uploaded = '';
  const pixels = Buffer.alloc(96 * 64 * 4);
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 200; pixels[i + 1] = 90; pixels[i + 2] = 45; pixels[i + 3] = 255; }
  const image = encode({ data: pixels, width: 96, height: 64 }, 80).data;
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/api/platform/v1')[1];
    if (path.startsWith('/avatars/')) { await route.fulfill({ status: 200, contentType: 'image/jpeg', body: image }); return; }
    if (path === '/profile') {
      const body = route.request().postDataJSON();
      expect(body.avatar).toBe('photo');
      expect(body.avatarPhoto).toMatch(/^data:image\/jpeg;base64,/);
      uploaded = body.avatarPhoto;
      player = { ...player, avatar: 'photo', avatarVersion: 'new-version' };
    }
    const replies: Record<string, unknown> = {
      '/session': { user: player, auth: { email: false, telegram: true }, csrfToken: 'fixture' },
      '/games': { games: [] }, '/rooms': { rooms: [] },
      '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] },
      '/invitations': { invitations: [] }, '/telegram': { available: false, linked: false },
      '/profile': { user: player },
    };
    await route.fulfill({ json: replies[path] ?? {} });
  });
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Аватар: Лис' }).click();
  await expect(page.locator('.profile-identity .avatar-art')).toBeVisible();
  await page.getByLabel('Загрузить фото').setInputFiles({ name: 'profile.jpg', mimeType: 'image/jpeg', buffer: image });
  await expect(page.locator('.profile-identity img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect.poll(() => uploaded.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('.profile-identity img')).toHaveAttribute('src', /\/api\/platform\/v1\/avatars\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
