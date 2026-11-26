import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const player = { playerId: 'self', handle: 'player', displayName: 'Player', email: 'player@example.test', emailVerified: true };
const games = [
  { gameId: 'platform-lab', collectionId: 'other', title: 'Пробный стол', minPlayers: 2, maxPlayers: 6, supportsBots: true, rulesVersion: '1', contentVersion: '1', status: 'available' },
  { gameId: 'remorse', collectionId: 'chess', title: 'Remorse', minPlayers: 2, maxPlayers: 2, supportsBots: false, rulesVersion: 'pending', contentVersion: 'pending', status: 'unavailable' },
  { gameId: 'overdrive', collectionId: 'chess', title: 'Форсаж', minPlayers: 2, maxPlayers: 2, supportsBots: false, rulesVersion: 'pending', contentVersion: 'pending', status: 'unavailable' },
  { gameId: 'district', collectionId: 'other', title: 'Район', minPlayers: 2, maxPlayers: 4, supportsBots: false, rulesVersion: 'pending', contentVersion: 'pending', status: 'planned' },
  { gameId: 'harbor', collectionId: 'other', title: 'Гавань', minPlayers: 3, maxPlayers: 6, supportsBots: false, rulesVersion: 'pending', contentVersion: 'pending', status: 'planned' },
];

// Only the transport is controlled. Exercise real rendering, routing and forms;
// these fixtures send no email and do not create real user accounts.
async function mockPortal(page: Page, initialUser: typeof player | null = null) {
  let user = initialUser;
  const requests: { path: string; body: unknown }[] = [];
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/platform/v1', '');
    const body = route.request().postDataJSON() as unknown;
    requests.push({ path, body });
    if (path === '/auth/login') user = player;
    if (path === '/auth/reset-password') user = null;
    const responses: Record<string, unknown> = {
      '/session': { user, csrfToken: 'test' }, '/games': { games },
      '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] },
      '/rooms': { rooms: [] }, '/invitations': { invitations: [] },
      '/telegram': { available: false, linked: false, reason: 'not_configured' },
      '/invitations/test-invite': { invitation: {
        invitationId: 'test-invite', roomId: 'private-room', roomTitle: 'Our table', gameId: 'platform-lab',
        inviter: { playerId: 'friend', handle: 'friend', displayName: 'Friend' }, invitee: player,
        status: 'pending', displayStatus: 'pending', expiresAt: Date.now() + 60_000,
        reservationExpiresAt: null, reason: null, url: '/invite/test-invite',
      } },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
  return requests;
}

test('guests can browse two distinct collections with direct links, reload and history', async ({ page }) => {
  const requests = await mockPortal(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Разделы игр' }).getByRole('link', { name: 'Шахматы', exact: true }).click();
  await expect(page).toHaveURL(/\/chess$/);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Форсаж', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Район', exact: true })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Remorse', exact: true }) }).getByRole('link', { name: 'Играть', exact: true }))
    .toHaveAttribute('href', 'http://127.0.0.1:4173/');
  await page.getByRole('navigation', { name: 'Разделы игр' }).getByRole('link', { name: 'Другие игры', exact: true }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Форсаж', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Об игре', exact: true })).toHaveCount(2);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Другие игры', exact: true })).toBeVisible();
  expect(requests.some(request => ['/friends', '/rooms', '/invitations'].includes(request.path))).toBe(false);
});

test('collections remain readable on a narrow screen in Russian and English', async ({ page }) => {
  await mockPortal(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/#/chess');
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chess', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Other games', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Practice table', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Iva Games', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'What shall we play?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a guest sees sign-in only when entering account rooms, then resumes there', async ({ page }) => {
  await mockPortal(page);
  await page.goto('/games');
  await page.getByRole('button', { name: 'Войти и играть', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(page.getByRole('heading', { name: 'Войти в Iva Games' })).toBeVisible();
  await page.getByLabel('Почта', { exact: true }).fill('player@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('a long testing password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои комнаты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Создать комнату', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('public chess stays available before email verification and old invitations survive login', async ({ page }) => {
  await mockPortal(page, { ...player, emailVerified: false });
  await page.goto('/chess');
  await expect(page.getByRole('heading', { name: 'Форсаж', exact: true })).toBeVisible();
  await expect(page.getByText('Продолжим после подтверждения')).toHaveCount(0);
  await page.unroute('**/api/platform/v1/**');
  await mockPortal(page);
  await page.goto('/#/invite/test-invite');
  await page.getByLabel('Почта', { exact: true }).fill('player@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('a long testing password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/invite\/test-invite$/);
  await expect(page.getByRole('heading', { name: 'Приглашения', exact: true })).toBeVisible();
  await expect(page.getByText('Our table', { exact: true })).toBeVisible();
});

test('verification and recovery links still reach their forms outside the public catalogue', async ({ page }) => {
  const requests = await mockPortal(page);
  await page.goto('/verify?token=discarded-fixture');
  await expect(page.getByRole('heading', { name: 'Подтвердите почту', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Iva Games', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Во что сыграем?' })).toBeVisible();
  expect(requests.some(request => request.path === '/auth/verify')).toBe(false);
  await page.goto('/verify?token=verification-fixture');
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Войти в Iva Games' })).toBeVisible();
  expect(requests.find(request => request.path === '/auth/verify')?.body).toEqual({ token: 'verification-fixture' });
  await page.goto('/reset?token=recovery-fixture');
  await expect(page.getByRole('heading', { name: 'Новый пароль', exact: true })).toBeVisible();
  await page.getByLabel('Пароль', { exact: true }).fill('a long replacement password');
  await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Войти в Iva Games' })).toBeVisible();
  expect(requests.find(request => request.path === '/auth/reset-password')?.body).toEqual({ token: 'recovery-fixture', password: 'a long replacement password' });
});
