import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Socket } from 'node:net';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { createOnlineServer } from '../../../../apps/server/src/http';
import type { Locale } from '../../src/i18n/catalog';
import { onlineText } from '../../src/i18n/online';
import type { RoomResponse, RoomSnapshot } from '../../src/online/protocol';
import { expect, silenceWebAudio, test as base } from './fixtures';

interface LiveServer {
  readonly url: string;
  /** A real transport failure: destroy TCP sockets, leaving the server game state alone. */
  disconnectSockets(): void;
}

// Run npm run build before this suite when reusing an existing preview server.
// Each worker serves dist through the real HTTP/WebSocket server, with its own
// room database and an ephemeral port. No owner game on 4173 is accessed.
// No fixture endpoint, injected GameState, forced die, or frontend authority is used.
const test = base.extend<Record<never, never>, { liveServer: LiveServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright inspects the fixture dependency object.
  liveServer: [async ({}, use) => {
    const staticDir = fileURLToPath(new URL('../../dist/', import.meta.url));
    await access(fileURLToPath(new URL('../../dist/index.html', import.meta.url)));
    const app = createOnlineServer({ databasePath: ':memory:', staticDir, heartbeatMs: 1_000 });
    const sockets = new Set<Socket>();
    app.server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    try {
      const address = await app.listen(0);
      await use({ url: `http://${address.host}:${address.port}`, disconnectSockets() {
        for (const socket of sockets) socket.destroy();
      } });
    } finally { await app.close(); }
  }, { scope: 'worker' }],
});

interface Player { context: BrowserContext; page: Page }
const room = (page: Page) => page.getByTestId('online-room');
const board = (page: Page) => page.getByTestId('playfield');
const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function player(browser: Browser, locale: Locale, mobile: boolean): Promise<Player> {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce',
  });
  await context.addInitScript(silenceWebAudio);
  await context.addInitScript(locale => {
    // User preferences only. Match state and randomness always come from the server.
    if (!localStorage.getItem('remorse-settings-v1')) localStorage.setItem('remorse-settings-v1',
      JSON.stringify({ locale, board: '2d', reduce: true, sound: false, volume: 0 }));
  }, locale);
  await context.tracing.start({ screenshots: true, snapshots: true });
  return { context, page: await context.newPage() };
}

async function closePlayers(players: readonly Player[], info: TestInfo) {
  for (const [index, participant] of players.entries()) {
    const failed = info.status !== info.expectedStatus;
    if (failed && !participant.page.isClosed()) {
      await info.attach(`player-${index + 1}`, { body: await participant.page.screenshot(), contentType: 'image/png' }).catch(() => undefined);
    }
    await participant.context.tracing.stop(failed ? { path: info.outputPath(`player-${index + 1}-trace.zip`) } : {});
    await participant.context.close();
  }
}

async function connected(page: Page) {
  await expect(room(page)).toHaveAttribute('data-connection', 'connected');
}

async function snapshot(page: Page): Promise<RoomSnapshot> {
  const id = await room(page).getAttribute('data-room-id');
  expect(id).toBeTruthy();
  // The ordinary authenticated read API is an independent oracle for browser state.
  const response = await page.request.get(new URL(`/api/rooms/${id}`, page.url()).href);
  expect(response.ok()).toBe(true);
  return (await response.json() as RoomResponse).snapshot;
}

async function synchronized(players: readonly Player[], revision: number) {
  for (const participant of players) {
    await connected(participant.page);
    await expect(board(participant.page)).toHaveAttribute('data-revision', String(revision));
    await expect(board(participant.page)).toHaveAttribute('data-animating', 'false');
    await expect(board(participant.page)).toHaveAttribute('data-busy', 'false');
  }
  const [first, second] = await Promise.all(players.map(participant => snapshot(participant.page)));
  expect(first.game.revision).toBe(revision);
  expect(first.game).toEqual(second.game);
  return first;
}

async function move(page: Page, from: string, to: string) {
  // The real board exposes draggable only when this player can act. This also
  // waits out the result-reading pause after a reaction, without sleeping.
  const source = square(page, from);
  await expect(source).toHaveAttribute('draggable', 'true');
  if (!(await source.getAttribute('class'))?.split(' ').includes('mark-selected')) await source.click();
  await square(page, to).click();
}

async function noPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    page: document.scrollingElement!.scrollHeight,
    viewport: document.scrollingElement!.clientHeight,
    width: document.documentElement.scrollWidth,
    screen: innerWidth,
  }));
  expect(size.page).toBeLessThanOrEqual(size.viewport + 1);
  expect(size.width).toBeLessThanOrEqual(size.screen + 1);
}

for (const scenario of [{ locale: 'ru', mobile: false }, { locale: 'en', mobile: true }] as const) {
  test(`online ${scenario.locale}: two real clients, random capture, reconnect, draw and rematch${scenario.mobile ? ' on a phone' : ''}`, async ({ browser, liveServer }, info) => {
    test.setTimeout(120_000);
    const host = await player(browser, scenario.locale, scenario.mobile);
    const guest = await player(browser, scenario.locale, scenario.mobile);
    const players = [host, guest];
    const nt = (key: Parameters<typeof onlineText>[1]) => onlineText(scenario.locale, key);
    let revision = 0;
    try {
      await test.step('Create and join through the visible invitation flow', async () => {
        await host.page.goto(liveServer.url);
        await host.page.getByTestId('mode-online').click();
        await expect(host.page.getByRole('dialog')).toHaveAccessibleName(nt('title'));
        if (scenario.mobile) {
          expect(await host.page.getByTestId('online-name').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
        }
        await host.page.getByTestId('online-name').fill(scenario.locale === 'ru' ? 'Алексей' : 'Alex');
        await host.page.getByTestId('online-side-white').click();
        await host.page.getByTestId('online-create').click();
        await connected(host.page);
        await expect(room(host.page)).toHaveAttribute('data-room-status', 'waiting');
        await expect(host.page.getByTestId('turn-panel')).not.toBeVisible();
        await expect(host.page.getByTestId('online-copy')).toBeInViewport({ ratio: 1 });
        await expect(host.page.getByTestId('online-ready')).toBeInViewport({ ratio: 1 });
        const invitation = await host.page.getByTestId('online-invite').inputValue();
        expect(new URL(invitation).origin).toBe(liveServer.url);
        await noPageOverflow(host.page);

        await guest.page.goto(invitation);
        await expect(guest.page.getByRole('dialog')).toHaveAccessibleName(nt('title'));
        await guest.page.getByTestId('online-name').fill(scenario.locale === 'ru' ? 'Марина' : 'Morgan');
        await guest.page.getByTestId('online-join').click();
        await connected(guest.page);
        const [a, b] = await Promise.all([snapshot(host.page), snapshot(guest.page)]);
        expect(a.id).toBe(b.id);
        expect(a.you).toBe('white'); expect(b.you).toBe('black');
        // Independent contexts must have independent authenticated guests.
        const firstCookie = (await host.context.cookies()).find(cookie => cookie.name === 'remorse_guest');
        const secondCookie = (await guest.context.cookies()).find(cookie => cookie.name === 'remorse_guest');
        expect(firstCookie?.value).toBeTruthy(); expect(secondCookie?.value).toBeTruthy();
        expect(firstCookie!.value).not.toBe(secondCookie!.value);
      });

      await test.step('Show a disconnected seat before the game and recover it', async () => {
        const url = guest.page.url();
        await guest.page.close();
        await expect(host.page.getByTestId('online-connection')).toHaveText(nt('waitingOffline'));
        await expect(host.page.getByTestId('online-seat-black')).toHaveText(nt('seatOffline'));
        guest.page = await guest.context.newPage();
        await guest.page.goto(url);
        await connected(guest.page);
        await expect(host.page.getByTestId('online-connection')).toHaveText(nt('connected'));
      });

      await test.step('Both players must explicitly be ready; controls fit on the phone', async () => {
        if (scenario.mobile) {
          for (const participant of players) {
            await participant.page.setViewportSize({ width: 844, height: 390 });
            await expect(participant.page.getByTestId('online-ready')).toBeInViewport({ ratio: 1 });
            await noPageOverflow(participant.page);
            await participant.page.setViewportSize({ width: 390, height: 667 });
            await expect(participant.page.getByTestId('online-ready')).toBeInViewport({ ratio: 1 });
            await noPageOverflow(participant.page);
          }
        }
        await host.page.getByTestId('online-ready').click();
        await expect(host.page.getByTestId('online-ready')).toHaveText(nt('unready'));
        await expect(room(host.page)).toHaveAttribute('data-room-status', 'waiting');
        await expect(host.page.getByTestId('turn-panel')).not.toBeVisible();
        await guest.page.getByTestId('online-ready').click();
        for (const participant of players) {
          await expect(room(participant.page)).toHaveAttribute('data-room-status', 'playing');
          await expect(participant.page.locator('.player-elo')).toHaveCount(0);
        }
        await synchronized(players, 0);
      });

      await test.step('Play real moves and receive the same unforced capture result', async () => {
        await move(host.page, 'e2', 'e4');
        await synchronized(players, ++revision);
        await move(guest.page, 'd7', 'd5');
        await synchronized(players, ++revision);
        await move(host.page, 'e4', 'd5');
        const position = await synchronized(players, ++revision);
        const rolled = position.game.actions.at(-1)!.roll;
        expect(rolled?.source).toBe('server');
        expect(rolled?.face).toBeGreaterThanOrEqual(1);
        expect(rolled?.face).toBeLessThanOrEqual(6);
        for (const participant of players) {
          await expect(participant.page.getByTestId('roll')).toHaveAttribute('data-face', String(rolled!.face));
          await expect(participant.page.locator('.player-row[data-side="white"] .trophy-group')).toHaveCount(1);
          await noPageOverflow(participant.page);
        }
        if (position.game.state.phase === 'bonus') {
          await expect(host.page.getByTestId('end-turn')).toBeInViewport({ ratio: 1 });
          await expect(host.page.getByTestId('end-turn')).toBeEnabled();
          await host.page.getByTestId('end-turn').click();
          await synchronized(players, ++revision);
        }
        await move(guest.page, 'g8', 'f6');
        await synchronized(players, ++revision);
      });

      await test.step('Refresh and automatic WebSocket reconnect retain the authoritative game', async () => {
        const before = (await snapshot(host.page)).game;
        await host.page.reload();
        const restored = await synchronized(players, revision);
        expect(restored.game).toEqual(before);
        const hostSocket = host.page.waitForEvent('websocket');
        const guestSocket = guest.page.waitForEvent('websocket');
        liveServer.disconnectSockets();
        await Promise.all([hostSocket, guestSocket]);
        const reconnected = await synchronized(players, revision);
        expect(reconnected.game).toEqual(before);
        await move(host.page, 'g1', 'f3');
        await synchronized(players, ++revision);
      });

      await test.step('Agree a draw and show why an offline opponent cannot rematch', async () => {
        await host.page.locator('.online-room-tools > summary').click();
        await host.page.getByTestId('online-draw-offer').click();
        await expect(guest.page.getByTestId('online-draw-accept')).toBeInViewport({ ratio: 1 });
        await guest.page.getByTestId('online-draw-accept').click();
        const drawn = await synchronized(players, ++revision);
        expect(drawn.game.state.outcome).toEqual({ reason: 'agreement', winner: null });
        for (const participant of players) {
          await expect(room(participant.page)).toHaveAttribute('data-room-status', 'finished');
          await expect(participant.page.getByTestId('game-result')).toHaveAttribute('data-reason', 'agreement');
          await expect(participant.page.locator('.result-rating')).toHaveCount(0);
          await expect(participant.page.getByTestId('online-rematch')).toBeEnabled();
        }
        const url = guest.page.url();
        await guest.page.close();
        await expect(host.page.getByTestId('online-connection')).toHaveText(nt('finishedOffline'));
        await expect(host.page.getByTestId('online-rematch')).toBeDisabled();
        guest.page = await guest.context.newPage();
        await guest.page.goto(url);
        await synchronized(players, revision);
        await expect(host.page.getByTestId('online-rematch')).toBeEnabled();
      });

      await test.step('Rematch changes both colours and creates one shared fresh game', async () => {
        const previousId = (await snapshot(host.page)).game.id;
        await host.page.getByTestId('online-rematch').click();
        await expect(guest.page.getByText(nt('rematchReceived'), { exact: true })).toBeVisible();
        await guest.page.getByTestId('online-rematch').click();
        await synchronized(players, 0);
        const [first, second] = await Promise.all([snapshot(host.page), snapshot(guest.page)]);
        expect(first.game.id).not.toBe(previousId);
        expect(first.you).toBe('black'); expect(second.you).toBe('white');
        expect(first.game.actions).toEqual([]);
        expect(first.game.state.pieces).toHaveLength(32);
        expect(first.game.state.outcome).toBeNull();
        for (const participant of players) {
          await expect(room(participant.page)).toHaveAttribute('data-room-status', 'playing');
          await expect(participant.page.getByTestId('game-result')).toHaveCount(0);
          await expect(participant.page.getByTestId('undo')).toHaveCount(0);
        }
        await move(guest.page, 'e2', 'e4');
        await synchronized(players, 1);
        await move(host.page, 'e7', 'e5');
        await synchronized(players, 2);
      });
    } finally { await closePlayers(players, info); }
  });
}
