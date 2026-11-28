import { expect, test } from '@playwright/test';

test('clears finished rooms and restores them while keeping the active room, including after reload', async ({ page }) => {
  const user = { playerId: 'self', handle: 'player', displayName: 'Player', emailVerified: true };
  const room = (roomId: string, title: string, state: string) => ({ roomId, title, state, gameId: 'district', capacity: 4, members: [], hostPlayerId: 'self' });
  const active = room('active', 'Active room', 'lobby');
  const finished = room('finished', 'Finished room', 'finished');
  const cancelled = room('cancelled', 'Cancelled room', 'cancelled');
  let hidden = false;
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/platform/v1', '');
    if (path === '/rooms/history/clear') hidden = true;
    if (path === '/rooms/history/restore') hidden = false;
    const values: Record<string, unknown> = {
      '/session': { user, csrfToken: 'test' }, '/games': { games: [] },
      '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] },
      '/rooms': { rooms: hidden ? [active] : [active, finished, cancelled], hiddenRoomCount: hidden ? 2 : 0 },
      '/invitations': { invitations: [] }, '/telegram': { available: false, linked: false },
    };
    await route.fulfill({ json: values[path] ?? { ok: true } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/rooms');
  await expect(page.getByText('Finished room', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Очистить завершённые', exact: true }).click();
  await expect(page.getByText('Active room', { exact: true })).toBeVisible();
  await expect(page.getByText('Finished room', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cancelled room', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Показать завершённые', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Показать завершённые', exact: true }).click();
  await expect(page.getByText('Finished room', { exact: true })).toBeVisible();
  await expect(page.getByText('Cancelled room', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
