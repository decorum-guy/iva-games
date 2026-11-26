import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createDistrictState, applyDistrictAction } from '../../../games/district/src/core';
import { viewDistrict } from '../../../games/district/src/view';
import type { DistrictAction, DistrictState } from '../../../games/district/src/types';
import type { DistrictMap } from '../../../games/district/src/map-schema';
import { readFileSync } from 'node:fs';
const crossroads = JSON.parse(readFileSync(new URL('../../../games/district/maps/crossroads.1.json', import.meta.url), 'utf8')) as DistrictMap;

const self = { playerId: 'self', handle: 'iva', displayName: 'Ива', email: 'iva@example.test', emailVerified: true };
const participants = [
  { participantId: 'p1', playerId: 'self', displayName: 'Ива', seatIndex: 0, controller: { kind: 'human' as const, playerId: 'self' } },
  { participantId: 'p2', playerId: 'friend', displayName: 'Лена', seatIndex: 1, controller: { kind: 'human' as const, playerId: 'friend' } },
];

/** Browser + actual rules core, with controlled account/HTTP transport. Not a live server acceptance. */
async function harness(page: Page, options: { lobby?: boolean; loseBankResponse?: boolean; noRooms?: boolean } = {}) {
  let state = createDistrictState({ matchId: 'match-district', roomId: 'district-room', participants, map: crossroads as DistrictMap, now: Date.now(), seed: 'portal-district-test' });
  const actionBodies: Array<{ actionId: string; expectedRevision: number; payload: DistrictAction & { phaseId: string } }> = [];
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  const receipts = new Map<string, ReturnType<typeof viewDistrict>>();
  let lost = false;
  let settings: Record<string, unknown> = { mapId: 'crossroads', mapVersion: '1' };
  const now = () => Date.now();
  function otherPlayer() {
    for (let i = 0; i < 4; i++) {
      const view = viewDistrict(state, 'p2', now());
      const action: DistrictAction | null = view.legal.chooseGoal ? { type: 'choose-goal', goal: view.you.goalOptions[0] }
        : view.legal.negotiate && !view.players.find(p => p.participantId === 'p2')!.ready ? { type: 'ready', ready: true }
          : view.legal.confirmBid ? { type: 'confirm-bid' }
            : view.legal.develop ? { type: 'work' } : null;
      if (!action) break;
      state = applyDistrictAction(state, 'p2', action, now());
    }
  }
  otherPlayer();
  const room = () => ({
    roomId: 'district-room', gameId: 'district', title: 'Наш район', hostPlayerId: 'self',
    state: options.lobby || options.noRooms ? 'lobby' : state.phase === 'finished' ? 'finished' : 'playing', capacity: 2,
    rulesVersion: 'district@0.2', contentVersion: 'district-maps@0.1', revision: 0, settings,
    members: participants.map(p => ({ ...p, ready: true, handle: p.playerId, avatar: 'king' })),
    reservedSeats: 0, matchId: options.lobby || options.noRooms ? null : state.matchId, outcome: state.outcome, createdAt: now(),
  });
  await page.route('**/api/platform/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/platform/v1', '');
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutations.push({ path, body });
      if (path === '/rooms' || path === '/rooms/district-room/settings') {
        if (body.settings) settings = body.settings as Record<string, unknown>;
        await route.fulfill({ json: { room: room() } }); return;
      }
      if (path === '/rooms/district-room/actions') {
        const command = body as typeof actionBodies[number];
        actionBodies.push(command);
        const previous = receipts.get(command.actionId);
        if (previous) { await route.fulfill({ json: { view: previous } }); return; }
        const { phaseId, ...payload } = command.payload;
        if (command.expectedRevision !== state.revision || phaseId !== state.phaseId) { await route.fulfill({ status: 409, json: { error: { code: 'STALE_REVISION' } } }); return; }
        try {
          state = applyDistrictAction(state, 'p1', payload, now());
          otherPlayer();
          const view = viewDistrict(state, 'p1', now());
          receipts.set(command.actionId, view);
          if (options.loseBankResponse && !lost && payload.type === 'bank') { lost = true; await route.abort('failed'); return; }
          await route.fulfill({ json: { view } }); return;
        } catch (error) {
          await route.fulfill({ status: 400, json: { error: { code: (error as { code: string }).code } } }); return;
        }
      }
    }
    const data: Record<string, unknown> = {
      '/session': { user: self, csrfToken: 'test' },
      '/games': { games: [{ gameId: 'district', title: 'Район', collectionId: 'other', minPlayers: 2, maxPlayers: 4, supportsBots: true, rulesVersion: 'district@0.2', contentVersion: 'district-maps@0.1', status: 'available' }] },
      '/friends': { friends: [], incoming: [], outgoing: [], blocked: [] }, '/invitations': { invitations: [] },
      '/rooms': { rooms: options.noRooms ? [] : [room()] }, '/rooms/district-room': { room: room() },
      '/telegram': { available: false, linked: false, reason: 'not_configured' },
      '/rooms/district-room/match': { view: viewDistrict(state, 'p1', now()) },
    };
    await route.fulfill({ json: data[path] ?? {} });
  });
  return { state: () => state, setState: (next: DistrictState) => { state = next; }, actions: actionBodies, mutations, settings: () => settings };
}

async function chooseGoal(page: Page) {
  await expect(page.getByRole('heading', { name: 'Ваш план на район' })).toBeVisible();
  await page.locator('button.district-goal').first().click();
  await expect(page.getByRole('heading', { name: 'Договоримся?' })).toBeVisible();
}

test('new room and lobby settings select maps without changing game rules', async ({ page }) => {
  const fixture = await harness(page, { noRooms: true });
  await page.goto('/rooms');
  await page.getByRole('button', { name: 'Создать комнату', exact: true }).first().click();
  await page.getByLabel('Карта района', { exact: true }).selectOption('gardens@1');
  await expect(page.locator('.district-map-mini > span')).toHaveCount(25);
  await page.getByRole('dialog').getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await expect.poll(() => fixture.mutations.find(item => item.path === '/rooms')?.body.settings).toEqual({ mapId: 'gardens', mapVersion: '1' });
  await page.goto('/rooms/district-room');
  await page.getByRole('button', { name: 'Настройки комнаты', exact: true }).click();
  await page.getByLabel('Карта района', { exact: true }).selectOption('boulevard@1');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => fixture.settings().mapId).toBe('boulevard');
});

test('plays all six rounds through real core, exposes bidding and results, survives reload', async ({ page }) => {
  const fixture = await harness(page);
  await page.goto('/rooms/district-room');
  await chooseGoal(page);
  if (process.env.DISTRICT_UI_SCREENSHOTS) await page.screenshot({ path: '.qa/district/ui-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Готов', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Земля на торгах' })).toBeVisible();
  await page.getByLabel('Участок', { exact: true }).selectOption('A1');
  await page.getByLabel('Ваша ставка', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Сохранить выбор' }).click();
  await expect(page.getByRole('button', { name: 'Подтвердить ставку' })).toBeEnabled();
  await page.getByRole('button', { name: 'Подтвердить ставку' }).click();
  await page.getByRole('button', { name: /Построить дом/ }).click();
  for (let round = 2; round <= 6; round++) {
    await expect(page.getByRole('heading', { name: 'Договоримся?' })).toBeVisible();
    await page.getByRole('button', { name: 'Готов', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить пропуск' }).click();
    await page.getByRole('button', { name: 'Поработать · +2 монеты', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Итоги района' })).toBeVisible();
  expect(fixture.state().outcome?.reason).toBe('completed');
  expect(fixture.state().cells.find(cell => cell.id === 'A1')?.building?.kind).toBe('house');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Итоги района' })).toBeVisible();
  await page.getByText('История района', { exact: false }).click();
  await expect(page.locator('.district-history-income')).toHaveCount(6);
  await expect(page.locator('.district-history-bids').first()).toContainText('пропуск');
});

test('bank retry reuses the command after an uncertain response, without a second charge', async ({ page }) => {
  const fixture = await harness(page, { loseBankResponse: true });
  await page.goto('/rooms/district-room');
  await chooseGoal(page);
  await page.getByRole('button', { name: 'Купить · 3 ●', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
  const bank = fixture.actions.filter(item => item.payload.type === 'bank');
  expect(bank).toHaveLength(2); expect(bank[0]).toEqual(bank[1]);
  expect(fixture.state().players[0].resources).toEqual({ coins: 9, materials: 3, crews: 2 });
});

test('trade normalization, replace and cancellation are real actions; self-funded park completes', async ({ page }) => {
  const fixture = await harness(page);
  await page.goto('/rooms/district-room'); await chooseGoal(page);
  await page.getByRole('button', { name: 'Сделки', exact: true }).click();
  await page.getByLabel('Отдаю: Монеты', { exact: true }).fill('3');
  await page.getByLabel('Получаю: Монеты', { exact: true }).fill('1');
  await page.getByLabel('Получаю: Материалы', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Предложить обмен', exact: true }).click();
  await expect(page.locator('.district-offer')).toHaveCount(1);
  const offerAction = fixture.actions.find(item => item.payload.type === 'offer-trade')!.payload;
  expect(offerAction).toMatchObject({ give: { coins: 2 }, receive: { coins: 0, materials: 1 } });
  await page.getByRole('button', { name: 'Другие условия', exact: true }).click();
  await page.getByLabel('Отдаю: Монеты', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Отправить новые условия' }).click();
  await expect.poll(() => fixture.state().offers.filter(item => item.status === 'open')).toHaveLength(1);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('.district-offer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Парки', exact: true }).click();
  await page.getByRole('button', { name: 'Построить парк', exact: true }).click();
  await expect.poll(() => fixture.state().cells.filter(cell => cell.kind === 'park' && cell.completed)).toHaveLength(1);
});

test('narrow screen, keyboard rules dialog, English copy and return to an ongoing game', async ({ page }) => {
  const fixture = await harness(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/rooms/district-room'); await chooseGoal(page);
  await page.getByRole('button', { name: 'Как играть', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Как играть', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.DISTRICT_UI_SCREENSHOTS) await page.screenshot({ path: '.qa/district/ui-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Выйти из партии', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Вернуться в игру', exact: true })).toBeVisible();
  expect(fixture.state().players[0].left).toBe(true);
  await page.getByRole('button', { name: 'Вернуться в игру', exact: true }).click();
  await expect.poll(() => fixture.state().players[0].left).toBe(false);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('region', { name: 'District game', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'How to play', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('incoming trade and shared park show exact terms and execute only after consent', async ({ page }) => {
  const fixture = await harness(page);
  await page.goto('/rooms/district-room'); await chooseGoal(page);
  fixture.setState(applyDistrictAction(fixture.state(), 'p2', { type: 'offer-trade', targetId: 'p1', give: { coins: 0, materials: 1, crews: 0, lots: [] }, receive: { coins: 2, materials: 0, crews: 0, lots: [] } }, Date.now()));
  await expect(page.getByRole('button', { name: 'Принять', exact: true })).toBeVisible();
  expect(fixture.state().players[0].resources.coins).toBe(12);
  await page.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect.poll(() => fixture.state().players[0].resources).toEqual({ coins: 10, materials: 3, crews: 2 });
  fixture.setState(applyDistrictAction(fixture.state(), 'p2', { type: 'offer-park', parkId: 'C1', contributions: [
    { participantId: 'p2', resources: { coins: 2, materials: 0, crews: 0 } },
    { participantId: 'p1', resources: { coins: 2, materials: 1, crews: 1 } },
  ] }, Date.now()));
  await expect(page.getByRole('button', { name: 'Подписать', exact: true })).toBeVisible();
  expect(fixture.state().cells.find(cell => cell.id === 'C1')?.completed).toBe(false);
  await page.getByRole('button', { name: 'Подписать', exact: true }).click();
  await expect.poll(() => fixture.state().cells.find(cell => cell.id === 'C1')?.completed).toBe(true);
  expect(fixture.state().players[0].resources).toEqual({ coins: 8, materials: 2, crews: 1 });
});
