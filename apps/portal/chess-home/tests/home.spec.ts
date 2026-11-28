import { expect, test } from '@playwright/test';
import { createMatch } from '../../../../games/chess/remorse/src/session/match';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: true, sound: false }));
  });
});

test('shows the chess collection and opens each game at its own path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  for (const [name, path] of [['Remorse', '/remorse/'], ['Форсаж', '/overdrive/'], ['Колосс', '/colossus/']]) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByRole('link', { name: 'Играть' })).toHaveAttribute('href', path);
  }
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chess', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Chess', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the production portal points to the chess home and the new REMORSE path', async ({ page }) => {
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session')) return route.fulfill({ json: { user: null, csrfToken: 'test' } });
    if (path.endsWith('/games')) return route.fulfill({ json: { games: [
      { gameId: 'remorse', collectionId: 'chess', title: 'Remorse', minPlayers: 2, maxPlayers: 2, status: 'unavailable' },
    ] } });
    return route.fulfill({ json: {} });
  });
  const portal = `http://127.0.0.1:${process.env.CHESS_HOME_PORTAL_TEST_PORT ?? '5217'}`;
  await page.goto(portal);
  await expect(page.getByRole('navigation', { name: 'Разделы игр' }).getByRole('link', { name: 'Шахматы', exact: true }))
    .toHaveAttribute('href', 'https://chess.iva-games.pro/');
  await page.goto(`${portal}/chess`);
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Remorse', exact: true }) }).getByRole('link', { name: 'Играть' }))
    .toHaveAttribute('href', 'https://chess.iva-games.pro/remorse/');
});

test('opens a root-origin saved game at the new path and keeps subsequent moves', async ({ page }) => {
  const record = createMatch({ mode: 'hotseat', level: null, human: null, provenance: 'standard' }, { seed: 42 }).record;
  await page.goto('/');
  await page.evaluate(async match => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('remorse-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('profiles', { keyPath: 'id' });
        request.result.createObjectStore('matches', { keyPath: 'id' });
        request.result.createObjectStore('ratingLedger', { keyPath: 'matchId' });
        request.result.createObjectStore('learning');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('matches', 'readwrite');
      tx.objectStore('matches').put(match);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem('remorse-view-v1', `game/${match.id}`);
  }, record);
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Remorse', exact: true }) }).getByRole('link', { name: 'Играть' }).click();
  const board = page.getByTestId('playfield');
  await expect(board).toHaveAttribute('data-busy', 'false');
  await expect(board).toHaveAttribute('data-game-id', record.id);
  const id = record.id;
  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e4"]').click();
  await expect(board).toHaveAttribute('data-turn', '1');
  await page.goto('/');
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Remorse', exact: true }) }).getByRole('link', { name: 'Играть' }).click();
  await expect(page).toHaveURL(/\/remorse\/$/);
  await expect(board).toHaveAttribute('data-game-id', id!);
  await expect(board).toHaveAttribute('data-turn', '1');
});

test('opens an old root invitation at the new REMORSE path and joins the same room', async ({ page, browser }) => {
  await page.goto('/remorse/');
  await page.getByTestId('mode-friend').click();
  await page.getByTestId('mode-online').click();
  await page.getByTestId('online-name').fill('Host');
  await page.getByTestId('online-side-white').click();
  await page.getByTestId('online-create').click();
  await expect(page.getByTestId('online-room')).toHaveAttribute('data-connection', 'connected');
  const invitation = new URL(await page.getByTestId('online-invite').inputValue());
  expect(invitation.pathname).toBe('/remorse/');
  const oldLink = new URL(invitation.href);
  oldLink.pathname = '/';
  const guest = await browser.newContext();
  try {
    await guest.addInitScript(() => localStorage.setItem('remorse-settings-v1', JSON.stringify({ board: '2d', reduce: true, sound: false })));
    const other = await guest.newPage();
    await other.goto(oldLink.href);
    await expect(other).toHaveURL(invitation.href);
    await other.getByTestId('online-name').fill('Guest');
    await other.getByTestId('online-join').click();
    await expect(other.getByTestId('online-room')).toHaveAttribute('data-connection', 'connected');
    await expect(other.getByTestId('online-room')).toHaveAttribute('data-room-id', (await page.getByTestId('online-room').getAttribute('data-room-id'))!);
  } finally { await guest.close(); }
});
