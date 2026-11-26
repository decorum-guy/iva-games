/** Full District room playthroughs against isolated built services. */
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const label = (page, name) => page.getByLabel(name, { exact: true });
const exact = (page, name) => page.getByText(name, { exact: true });
const read = async (player, roomId) => (await player.client.request(`/rooms/${roomId}/match`)).view;
const roomInfo = async (player, roomId) => (await player.client.request(`/rooms/${roomId}`)).room;
const me = view => view.players.find(player => player.participantId === view.you.participantId);
const changed = (view, type) => view.history.filter(entry => entry.type === type);
const mapNames = { 'azure-bay': 'Лазурная бухта', 'two-shores': 'Два берега', 'four-islands': 'Четыре острова' };
const resources = (coins = 0, materials = 0, crews = 0) => ({ coins, materials, crews });

async function createRoom(origin, players, { title, map, bots = [], changeFrom, output }) {
  const [host, ...guests] = players;
  const { page, client } = host;
  await page.goto(origin + '/rooms');
  await button(page, 'Создать комнату').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Игра', { exact: false }).first().selectOption('district');
  await label(dialog, 'Название комнаты').fill(title);
  await dialog.getByLabel('Мест за столом').selectOption(String(players.length + bots.length));
  const cards = dialog.locator('.district-map-card');
  await expect(cards).toHaveCount(3);
  const previews = [];
  for (const name of Object.values(mapNames)) {
    const card = cards.filter({ hasText: name });
    const polygons = card.locator('svg[aria-hidden="true"] polygon');
    await expect(polygons.first()).toBeVisible();
    previews.push(await polygons.evaluateAll(nodes => nodes.map(node => node.getAttribute('points')).join('|')));
  }
  assert.equal(new Set(previews).size, 3);
  await dialog.getByRole('radio', { name: new RegExp(mapNames[changeFrom ?? map]) }).check();
  if (output) await dialog.screenshot({ path: join(output, 'map-catalog.png') });
  await button(dialog, 'Создать комнату').click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const roomId = new URL(page.url()).pathname.split('/').pop();
  assert.equal((await roomInfo(host, roomId)).settings.mapId, changeFrom ?? map);
  for (const guest of guests) {
    const invitation = (await client.request(`/rooms/${roomId}/invitations`, { playerId: guest.id })).invitation;
    await guest.client.request(`/invitations/${invitation.invitationId}/accept`, {});
    await guest.client.request(`/rooms/${roomId}/join`, {});
  }
  if (guests.length) await page.reload();
  for (const [index, difficulty] of bots.entries()) {
    await label(page, 'Сложность бота').selectOption(difficulty);
    await button(page, 'Добавить').click();
    await expect(page.locator('.seat-row:not(.vacant)')).toHaveCount(players.length + index + 1);
  }
  for (const player of players) {
    await player.page.goto(`${origin}/rooms/${roomId}`);
    await button(player.page, 'Я готов').click();
    await expect(button(player.page, 'Пока не готов')).toBeVisible();
  }
  if (changeFrom) {
    await button(page, 'Настройки комнаты').click();
    await page.getByRole('dialog').getByRole('radio', { name: new RegExp(mapNames[map]) }).check();
    const savedResponse = page.waitForResponse(response => response.url().endsWith(`/rooms/${roomId}/settings`) && response.request().method() === 'POST');
    await button(page.getByRole('dialog'), 'Сохранить').click();
    const response = await savedResponse;
    assert.equal(response.status(), 200, `Lobby settings: ${JSON.stringify(await response.json())}`);
    await expect(page.locator('.district-lobby-map strong')).toHaveText(mapNames[map]);
    await expect(button(page, 'Начать игру')).toBeDisabled();
    const saved = await roomInfo(host, roomId);
    assert.deepEqual(saved.settings, { mapId: map, mapVersion: '1' });
    assert.ok(saved.members.filter(member => member.controller.kind === 'human').every(member => !member.ready));
    for (const player of players) {
      await expect(button(player.page, 'Я готов')).toBeEnabled();
      await button(player.page, 'Я готов').click();
      await expect(button(player.page, 'Пока не готов')).toBeVisible();
    }
  }
  const startResponse = page.waitForResponse(response => response.url().endsWith(`/rooms/${roomId}/start`) && response.request().method() === 'POST');
  await button(page, 'Начать игру').click();
  const started = await startResponse;
  assert.equal(started.status(), 200, `Start match: ${JSON.stringify(await started.json())}`);
  for (const player of players) {
    await expect(player.page.getByRole('region', { name: 'Игра Район' })).toBeVisible();
    await expect(player.page.locator('.district-heading .district-eyebrow')).toHaveText(mapNames[map]);
  }
  await expect(button(page, 'Настройки комнаты')).toHaveCount(0);
  if (output) {
    const cells = page.locator('polygon[role="button"][data-cell-id]');
    const view = await read(host, roomId);
    await expect(cells.first()).toBeVisible();
    await page.screenshot({ path: join(output, map + '-empty.png'), fullPage: true });
    const lot = view.cells.find(cell => cell.kind === 'lot');
    const selected = page.locator(`polygon[role="button"][data-cell-id="${lot.id}"]`);
    const posts = [];
    const record = request => { if (request.method() === 'POST' && request.url().endsWith('/actions')) posts.push(request.url()); };
    page.on('request', record);
    try {
      await selected.focus();
      await selected.press('Enter');
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({ path: join(output, map + '-selected.png'), fullPage: true });
      const park = view.cells.find(cell => cell.kind === 'park');
      await page.locator(`polygon[data-cell-id="${park.id}"]`).hover();
      const prices = page.locator('.district-map-tooltip .district-cell-prices');
      await expect(prices).toContainText('Разбить парк');
      await page.screenshot({ path: join(output, map + '-park-price-hover.png'), fullPage: true });
      assert.deepEqual(posts, []);
      assert.equal((await read(host, roomId)).revision, view.revision);
    } finally { page.off('request', record); }
  }
  const playing = await roomInfo(host, roomId);
  await assert.rejects(client.request(`/rooms/${roomId}/settings`, {
    expectedRevision: playing.revision, settings: { mapId: map === 'four-islands' ? 'azure-bay' : 'four-islands', mapVersion: '1' },
  }), /HTTP 409/);
  return roomId;
}

function clickAction(roomId, count) {
  return async (page, locator, { lost = false, prepare } = {}) => {
    const url = `/rooms/${roomId}/actions`;
    const action = request => request.url().endsWith(url) && request.method() === 'POST';
    for (let attempt = 0; attempt < 3; attempt++) {
      await prepare?.();
      await expect(locator).toBeEnabled();
      const pending = lost ? page.waitForEvent('requestfailed', action) : page.waitForResponse(response => action(response.request()));
      await locator.click();
      const response = await pending;
      if (lost) return;
      const data = await response.json();
      if (response.status() === 409 && data.error?.code === 'STALE_REVISION' && attempt < 2) {
        // A peer may act during the UI's polling interval. The first request
        // was rejected, so repeat the same still-visible choice after refresh.
        count.stale++;
        continue;
      }
      assert.equal(response.status(), 200, `Command ${response.request().postDataJSON().payload.type}: ${JSON.stringify(data.error)}`);
      count.actions++;
      return data.view;
    }
  };
}

async function submitBid(page, click, lotId, amount = 1) {
  const select = label(page.locator('.district-auction'), 'Участок');
  await select.selectOption(lotId);
  await label(page, 'Ваша ставка').fill(String(amount));
  await expect(button(page, 'Подтвердить пропуск')).toBeDisabled();
  await click(page, button(page, 'Сохранить выбор'));
  return click(page, button(page, 'Подтвердить ставку'));
}

async function finish(players, roomId, click, react) {
  const first = players[0];
  const buildingTypes = ['мастерскую', 'кафе', 'дом'];
  for (let pass = 0; pass < 110; pass++) {
    const start = await read(first, roomId);
    if (start.phase === 'finished') break;
    await react?.(start);
    for (const player of players) {
      const view = await read(player, roomId);
      const { page } = player;
      if (view.phase !== start.phase || view.round !== start.round) break;
      if (view.legal.chooseGoal) {
        await click(page, page.locator('.district-goal-choices button').first());
      } else if (view.legal.negotiate && !me(view).ready) {
        await click(page, button(page.locator('.district-negotiation'), 'Готов'));
      } else if (view.legal.confirmBid) {
        const lots = view.cells.filter(cell => cell.kind === 'lot' && !cell.ownerId);
        const lot = lots.at(player.seat === 0 ? 0 : -player.seat);
        if (view.round <= 3 && view.legal.bid && lot && view.you.available.coins >= 2) {
          await submitBid(page, click, lot.id);
        } else {
          await click(page, button(page, 'Подтвердить пропуск'));
        }
      } else if (view.legal.develop) {
        const property = label(page, 'Ваша недвижимость');
        const empty = view.cells.find(cell => cell.ownerId === view.you.participantId && !cell.building);
        const upgradable = view.cells.find(cell => cell.ownerId === view.you.participantId && cell.building?.level === 1);
        if (empty) {
          await property.selectOption(empty.id);
          const build = button(page, new RegExp('^Построить ' + buildingTypes[player.seat]));
          if (await build.isEnabled()) { await click(page, build); continue; }
        }
        if (upgradable) {
          await property.selectOption(upgradable.id);
          const upgrade = button(page, /^Улучшить до уровня 2/);
          if (await upgrade.isEnabled()) { await click(page, upgrade); continue; }
        }
        await click(page, button(page, 'Поработать · +2 монеты'));
      }
    }
    if (start.phase === 'development' && start.players.some(player => player.participantId === start.activeParticipantId && player.isBot)) await delay(200);
  }
  const result = await read(first, roomId);
  assert.equal(result.phase, 'finished', `Did not finish: round ${result.round}, ${result.phase}`);
  assert.equal(result.outcome.reason, 'completed');
  assert.equal(changed(result, 'event').length, result.totalRounds);
  assert.equal(changed(result, 'income').length, result.totalRounds);
  for (const entry of result.outcome.results) {
    assert.equal(entry.capital, entry.coins + entry.materials + entry.crews + entry.buildings + entry.goalBonus);
    assert.equal(entry.goalBonus, entry.goalCompleted ? 5 : 0);
  }
  for (const player of players) {
    const peer = await read(player, roomId);
    assert.deepEqual(peer.outcome, result.outcome);
    await expect(player.page.locator('.district-result-row')).toHaveCount(result.players.length);
  }
  return result;
}

async function fillTrade(page, give, receive, lotPair) {
  const form = page.locator('.district-trade-form');
  for (const [title, values] of [['Отдаю', give], ['Получаю', receive]]) {
    for (const [key, name] of [['coins', 'Монеты'], ['materials', 'Материалы'], ['crews', 'Бригады']]) {
      await label(form, `${title}: ${name}`).fill(String(values[key] ?? 0));
    }
  }
  if (lotPair) {
    for (const [i, lot] of lotPair.entries()) {
      const bundle = form.locator('fieldset').nth(i);
      await exact(bundle, 'Добавить недвижимость').click();
      await bundle.getByRole('checkbox', { name: new RegExp('^' + lot + ' ·') }).check();
    }
  }
}

async function mixedDeals({ roomId, players, click, output }) {
  const [a, b, c] = players;
  const initial = await read(a, roomId);
  const aId = initial.you.participantId;
  const bId = (await read(b, roomId)).you.participantId;
  const aPage = a.page;
  const bPage = b.page;
  const cards = (page, text) => page.locator('.district-offer').filter({ hasText: text });

  // The first POST really reaches the server. Only its response to Chromium is discarded.
  const actionUrl = `**/rooms/${roomId}/actions`;
  let lostCommand;
  await aPage.route(actionUrl, async route => {
    lostCommand = route.request().postDataJSON();
    const committed = await route.fetch();
    assert.equal(committed.status(), 200);
    await route.abort('failed');
  }, { times: 1 });
  await click(aPage, button(aPage, 'Купить · 3 ●').first(), { lost: true });
  await expect(button(aPage, 'Повторить')).toBeVisible();
  const afterBank = await read(a, roomId);
  const bankEntries = changed(afterBank, 'bank').filter(entry => entry.actorId === aId);
  assert.equal(bankEntries.length, 1);
  const retryRequest = aPage.waitForRequest(request => request.url().endsWith('/actions') && request.method() === 'POST');
  await click(aPage, button(aPage, 'Повторить'));
  assert.deepEqual((await retryRequest).postDataJSON(), lostCommand);
  assert.equal(changed(await read(a, roomId), 'bank').filter(entry => entry.actorId === aId).length, 1);

  await button(aPage, 'Сделки').click();
  await label(aPage, 'С кем договоримся').selectOption(bId);
  await fillTrade(aPage, resources(2), resources(0, 1));
  await click(aPage, button(aPage, 'Предложить обмен'));
  let terms = cards(bPage, `${a.name} ↔ ${b.name}`);
  await expect(terms.locator('.district-bundle-line').first()).toContainText('1Материалы');
  await expect(terms.locator('.district-bundle-line').last()).toContainText('2Монеты');
  const open = (await read(a, roomId)).you.offers.find(offer => offer.kind === 'trade' && offer.status === 'open' && offer.targetId === bId);
  const third = await read(c, roomId);
  assert.ok(!third.you.offers.some(offer => offer.id === open.id));
  assert.ok(!JSON.stringify(third).includes(open.id));
  assert.ok(third.players.every(player => !('available' in player) && !('reserved' in player) && !('goal' in player) && !('bid' in player)));
  await expect(cards(c.page, `${a.name} ↔ ${b.name}`)).toHaveCount(0);
  await bPage.screenshot({ path: join(output, 'incoming-offer.png'), fullPage: true });
  await click(bPage, button(terms, 'Принять'));
  assert.ok(changed(await read(c, roomId), 'trade').some(entry => entry.data.give?.coins === 2));

  await fillTrade(aPage, resources(1), resources(0, 0, 1));
  await click(aPage, button(aPage, 'Предложить обмен'));
  terms = cards(bPage, `${a.name} ↔ ${b.name}`);
  await button(terms, 'Другие условия').click();
  await label(bPage, 'Получаю: Монеты').fill('2');
  await click(bPage, button(bPage, 'Отправить новые условия'));
  terms = cards(bPage, `${b.name} ↔ ${a.name}`);
  await button(terms, 'Другие условия').click();
  await label(bPage, 'Получаю: Монеты').fill('3');
  await click(bPage, button(bPage, 'Отправить новые условия'));
  terms = cards(aPage, `${b.name} ↔ ${a.name}`);
  await expect(terms.locator('.district-bundle-line').first()).toContainText('3Монеты');
  await click(aPage, button(terms, 'Отказаться'));
  await expect(terms).toHaveCount(0);
  assert.ok(!(await read(c, roomId)).you.offers.some(offer => offer.authorId === aId || offer.authorId === bId));

  await button(aPage, 'Парки').click();
  const parks = initial.cells.filter(cell => cell.kind === 'park').map(cell => cell.id);
  for (const [index, parkId] of parks.slice(0, 2).entries()) {
    const form = aPage.locator('.district-park-form');
    await label(form, 'Где строим парк').selectOption(parkId);
    const guest = form.getByRole('group', { name: b.name, exact: true });
    const invite = guest.getByRole('checkbox');
    await invite.check();
    await label(form, a.name + ': Монеты').fill('2');
    await label(form, b.name + ': Монеты').fill('2');
    await click(aPage, button(form, 'Предложить парк'));
    const partnerOffer = cards(bPage, 'Парк ' + parkId);
    await expect(partnerOffer).toContainText('Ждём');
    const visible = (await read(b, roomId)).you.offers.find(offer => offer.kind === 'park' && offer.parkId === parkId);
    assert.deepEqual(visible.signedBy, [aId]);
    assert.deepEqual(visible.contributions, [
      { participantId: aId, resources: resources(2, 1, 1) }, { participantId: bId, resources: resources(2) },
    ]);
    const bystander = await read(c, roomId);
    assert.ok(!JSON.stringify(bystander).includes(visible.id));
    assert.equal(bystander.cells.find(cell => cell.id === parkId).completed, false);
    if (index === 0) {
      assert.deepEqual((await read(a, roomId)).you.reserved, resources(2, 1, 1));
      await click(aPage, button(cards(aPage, 'Парк ' + parkId), 'Отменить'));
      assert.deepEqual((await read(a, roomId)).you.reserved, resources());
      assert.equal((await read(c, roomId)).cells.find(cell => cell.id === parkId).completed, false);
    } else {
      await click(bPage, button(partnerOffer, 'Подписать'));
      const built = (await read(c, roomId)).cells.find(cell => cell.id === parkId);
      assert.equal(built.completed, true);
      assert.deepEqual(built.sponsors, visible.contributions);
    }
  }
  await aPage.screenshot({ path: join(output, 'negotiation-desktop.png'), fullPage: true });
}

async function mobileCheck(page, output) {
  await button(page, 'EN').click();
  await expect(page.getByRole('region', { name: 'District game' })).toBeVisible();
  await expect(exact(page.getByRole('region', { name: 'District game' }), 'Bot 4')).toBeVisible();
  const lot = page.locator('polygon[data-cell-id="E6"]');
  const posts = [];
  const record = request => { if (request.method() === 'POST' && request.url().endsWith('/actions')) posts.push(request.url()); };
  page.on('request', record);
  try {
    await lot.tap();
    await expect(lot).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: join(output, 'mobile-tap-detail.png'), fullPage: true });
    assert.deepEqual(posts, []);
  } finally { page.off('request', record); }
  const help = button(page, 'How to play');
  await help.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'District in a minute' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(button(dialog, 'Close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  await button(page, 'Your actions ↓').click();
  await expect(page.locator('.district-decisions')).toBeFocused();
  const turn = await page.locator('.district-mobile-turn').boundingBox();
  assert.ok(turn.y >= -1 && turn.y < 25, 'Phase clock should remain at the top after jumping');
  await expect(page.locator('.district-mobile-turn').getByLabel('Time left')).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'negotiation-mobile-webkit-en.png'), fullPage: true });
  await button(page, 'RU').click();
}

function leaveGame(page, click) {
  const confirm = button(page.getByRole('dialog'), 'Выйти');
  return click(page, confirm, {
    prepare: async () => {
      if (!await confirm.isVisible()) await button(page, 'Выйти из партии').click();
    },
  });
}

async function expireAndLeave({ origin, players, count }) {
  const [host, guest] = players;
  const roomId = await createRoom(origin, players, { title: 'Район · время и выход', map: 'two-shores', bots: ['normal'] });
  const click = clickAction(roomId, count);
  await click(host.page, host.page.locator('.district-goal-choices button').first());
  const before = await read(guest, roomId);
  assert.equal(before.phase, 'goals');
  assert.equal(before.you.goal, null);
  await guest.context.setOffline(true);
  try {
    await expect(guest.page.getByText('Нет связи. Пробуем снова…', { exact: true })).toBeVisible();
    const connected = await read(host, roomId);
    assert.equal(connected.deadlineAt, before.deadlineAt);
    const missing = connected.players.find(player => player.participantId === before.you.participantId);
    assert.ok(!missing.isBot && !missing.left && !missing.submitted);
    await expect.poll(async () => (await read(host, roomId)).phase, {
      timeout: Math.max(1000, before.deadlineAt - Date.now() + 10000), intervals: [1000],
    }).toBe('negotiation');
  } finally { await guest.context.setOffline(false); }
  const recovered = await read(guest, roomId);
  await expect(button(guest.page.locator('.district-negotiation'), 'Готов')).toBeVisible();
  assert.equal(recovered.matchId, before.matchId);
  assert.equal(recovered.you.goal, before.you.goalOptions[0]);
  assert.ok(recovered.deadlineAt - recovered.serverNow > 110000);
  assert.equal(changed(recovered, 'event').length, 1);
  assert.ok(!me(recovered).isBot && !recovered.you.left);
  for (const player of players) await leaveGame(player.page, click);
  const abandoned = await read(host, roomId);
  assert.equal(abandoned.outcome.reason, 'abandoned');
  assert.deepEqual(abandoned.outcome.winnerParticipantIds, []);
  assert.deepEqual(abandoned.outcome, (await read(guest, roomId)).outcome);
  assert.equal(changed(abandoned, 'income').length, 0);
  await expect(host.page.getByRole('heading', { name: 'Район опустел' })).toBeVisible();
}

export async function runDistrictAcceptance({ origin, makePlayers, stop, start, output }) {
  const count = { actions: 0, stale: 0 };
  const matches = [];
  const photographed = new Set();
  for (const fixture of [
    { title: 'Район · один бот', map: 'two-shores', bots: ['easy'], humans: 1 },
    { title: 'Район · два бота', map: 'azure-bay', bots: ['easy', 'normal'], humans: 1 },
    { title: 'Район · три бота', map: 'four-islands', bots: ['easy', 'normal', 'hard'], humans: 1, changeFrom: 'azure-bay' },
    { title: 'Район · смешанный стол', map: 'azure-bay', bots: ['hard'], humans: 3, changeFrom: 'two-shores' },
  ]) {
    const people = await makePlayers(fixture.humans);
    const [a, b, c] = people;
    console.info(`Accepting ${fixture.map}: ${fixture.humans} human slots, ${fixture.bots.length} bots`);
    const roomId = await createRoom(origin, people, { ...fixture, output });
    const click = clickAction(roomId, count);
    const visited = new Set();
    const result = await finish(people, roomId, click, async view => {
      for (const cell of view.cells.filter(cell => cell.building)) {
        const { kind, level } = cell.building;
        const key = kind + level;
        if (photographed.has(key)) continue;
        const names = { house: 'Дом', cafe: 'Кафе', workshop: 'Мастерская' };
        const tile = a.page.locator(`polygon[data-cell-id="${cell.id}"]`);
        await expect(tile).toHaveAttribute('aria-label', new RegExp(names[kind] + ' ' + (level === 2 ? 'II' : 'I') + ' ·'));
        await a.page.locator('.di-map[role="group"]').screenshot({ path: join(output, 'developed-' + key + '.png') });
        photographed.add(key);
      }
      const stage = `${view.round}:${view.phase}`;
      if (visited.has(stage)) return;
      visited.add(stage);
      if (fixture.humans === 1 && fixture.bots.length === 3 && view.phase === 'negotiation' && view.round === 2) {
        await stop();
        await start();
        const restored = await read(a, roomId);
        assert.equal(restored.matchId, view.matchId);
        assert.equal(restored.deadlineAt, view.deadlineAt);
        assert.deepEqual(restored.map, view.map);
        assert.deepEqual(restored.cells, view.cells);
      }
      if (!b) return;
      if (view.phase === 'negotiation' && view.round === 1) {
        await mobileCheck(c.page, output);
        await mixedDeals({ roomId, players: people, click, output });
      }
      if (view.phase === 'auction' && view.round === 1) {
        // The third human bids elsewhere, so they have property to trade.
        const lot = 'D1';
        const saved = await submitBid(a.page, click, lot, 4);
        assert.equal(saved.you.bid.amount, 4);
        await a.page.screenshot({ path: join(output, 'sealed-bid.png'), fullPage: true });
        const otherViews = await Promise.all([read(b, roomId), read(c, roomId)]);
        assert.ok(otherViews.every(peer => peer.phase === 'auction' && peer.you.bid === null && !peer.players.some(p => 'bid' in p)));
        await submitBid(b.page, click, lot, 4);
        const revealed = await submitBid(c.page, click, 'E6', 8);
        const auction = changed(revealed, 'auction').at(-1);
        const tied = [saved.you.participantId, otherViews[0].you.participantId];
        const highest = Math.max(...auction.data.bids.filter(entry => entry.bid?.lotId === lot).map(entry => entry.bid.amount));
        assert.equal(highest, 4, 'The tie must include the winning bid');
        assert.equal(revealed.cells.find(cell => cell.id === lot).ownerId, revealed.priority.find(id => tied.includes(id)));
      }
      if (view.phase === 'negotiation' && view.round === 2) {
        const peers = [view, await read(b, roomId), await read(c, roomId)];
        const winner = people[peers.findIndex(peer => peer.you.participantId === view.cells.find(cell => cell.id === 'D1').ownerId)];
        const winId = (await read(winner, roomId)).you.participantId;
        const cId = peers[2].you.participantId;
        // The auctioned properties can be exchanged even after development.
        const target = view.cells.find(cell => cell.id === 'E6').ownerId;
        assert.equal(target, cId);
        await button(winner.page, 'Сделки').click();
        await label(winner.page, 'С кем договоримся').selectOption(cId);
        await fillTrade(winner.page, resources(), resources(), ['D1', 'E6']);
        await click(winner.page, button(winner.page, 'Предложить обмен'));
        const card = c.page.locator('.district-offer').filter({ hasText: `${winner.name} ↔ ${c.name}` });
        await expect(card).toContainText('Участки: D1');
        await expect(card).toContainText('Участки: E6');
        const swapped = await click(c.page, button(card, 'Принять'));
        assert.equal(swapped.cells.find(cell => cell.id === 'D1').ownerId, cId);
        assert.equal(swapped.cells.find(cell => cell.id === 'E6').ownerId, winId);

        await leaveGame(b.page, click);
        const away = await read(b, roomId);
        assert.ok(away.you.left && !me(away).isBot);
        await click(b.page, button(b.page, 'Вернуться в игру'));
        assert.equal((await read(b, roomId)).you.left, false);
      }
    });
    assert.deepEqual(result.players.filter(player => player.isBot).map(player => player.difficulty).sort(), [...fixture.bots].sort());
    matches.push({ map: result.map.id, humans: fixture.humans, botLevels: fixture.bots,
      rounds: result.totalRounds, builds: changed(result, 'build').length, upgrades: changed(result, 'upgrade').length,
      parks: changed(result, 'park').length, trades: changed(result, 'trade').length });
    console.info(JSON.stringify(matches.at(-1)));
    await Promise.all(people.map(player => player.context.close()));
  }
  console.info('Accepting real goal deadline, offline recovery, and abandonment');
  const people = await makePlayers(2);
  await expireAndLeave({ origin, players: people, count });
  return { matches, photographedBuildings: [...photographed].sort(), acceptedUiActions: count.actions, staleUiActionsRetried: count.stale, mobileWebKitEmulation: 'passed', realGoalDeadlineAndAbandonment: 'passed' };
}
