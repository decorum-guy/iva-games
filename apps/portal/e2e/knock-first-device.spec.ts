import { devices, expect, test } from '@playwright/test';

test.use({ ...devices['iPhone 13'] });

test('mobile entry and an existing room never mount the game controller', async ({ page }) => {
  const user = { playerId: 'self', handle: 'player', displayName: 'Player', email: 'player@example.test', emailVerified: true };
  const room = { roomId: 'knock-room', gameId: 'knock-first', title: 'Shift', hostPlayerId: 'self', state: 'playing', capacity: 2,
    rulesVersion: 'knock-first@1', contentVersion: 'knock-first-content@1', revision: 1, settings: {}, members: [], reservedSeats: 0, matchId: 'match', outcome: null, createdAt: Date.now() };
  const calls: string[] = [];
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/platform/v1', ''); calls.push(path);
    const responses: Record<string, unknown> = {
      '/session': { user, csrfToken: 'test' }, '/games': { games: [] }, '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] },
      '/rooms': { rooms: [room] }, '/rooms/knock-room': { room }, '/invitations': { invitations: [] }, '/telegram': { available: false, linked: false },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
  let sockets = 0; page.on('websocket', socket => { if (socket.url().includes('/api/platform/')) sockets++; });
  await page.goto('/games/knock-first');
  await expect(page.getByRole('heading', { name: 'Играйте на компьютере' })).toBeVisible();
  await page.goto('/rooms/knock-room');
  await expect(page.getByRole('heading', { name: 'Играйте на компьютере' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Я готов' })).toHaveCount(0);
  await expect(page.locator('.knock-scene')).toHaveCount(0);
  expect(sockets).toBe(0);
  expect(calls.some(path => path.startsWith('/rooms/knock-room/match'))).toBe(false);
  await page.getByRole('button', { name: 'К комнатам' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
});
