/** Build a varied town in a saved v0.3 lobby through ordinary HTTP match actions. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export async function runDistrictShowcase({ origin, makePlayers, createLegacyLobby, output }) {
  assert.equal(typeof createLegacyLobby, 'function', 'Showcase needs explicit saved-lobby setup');
  const people = await makePlayers(4);
  const [host, ...guests] = people;
  const created = await createLegacyLobby(host, {
    capacity: 4, title: 'Лазурная бухта · застроенный город', mapId: 'azure-bay',
  });
  const path = '/rooms/' + created.roomId;
  const read = async player => (await player.client.request(path + '/match')).view;
  const lobby = async () => (await host.client.request(path)).room;
  async function act(player, action) {
    const { revision, phaseId, round, phase } = await read(player);
    try {
      return (await player.client.request(path + '/actions', {
        actionId: randomUUID(), expectedRevision: revision, payload: { ...action, phaseId },
      })).view;
    } catch (error) { throw new Error(`Showcase round ${round}, ${phase}, ${action.type}: ${error.message}`, { cause: error }); }
  }
  try {
    for (const guest of guests) {
      const { invitation } = await host.client.request(path + '/invitations', { playerId: guest.id });
      await guest.client.request('/invitations/' + invitation.invitationId + '/accept', {});
      await guest.client.request(path + '/join', {});
    }
    const { revision } = await lobby();
    for (const player of people) await player.client.request(path + '/ready', { expectedRevision: revision, ready: true });
    await host.client.request(path + '/start', { expectedRevision: revision });
    const initial = await read(host);
    await host.page.emulateMedia({ reducedMotion: 'reduce' });
    await host.page.goto(origin + path);
    const liveMap = host.page.locator('.district-map-surface');
    await expect(liveMap.locator('polygon[data-cell-id]').first()).toBeVisible();
    await expect(liveMap.locator('.di-arrival')).toHaveCount(0);
    const lots = initial.cells.filter(cell => cell.kind === 'lot').map(cell => cell.id);
    const parks = initial.cells.filter(cell => cell.kind === 'park').map(cell => cell.id);
    const playerIds = await Promise.all(people.map(async player => (await read(player)).you.participantId));
    for (const player of people) {
      const { goalOptions } = (await read(player)).you;
      await act(player, { type: 'choose-goal', goal: goalOptions[0] });
    }

    const build = (lot, kind) => ({ action: { type: 'build', lotId: lots[lot], building: kind }, materials: kind === 'workshop' ? 2 : 1, crews: 1 });
    const upgrade = lot => ({ action: { type: 'upgrade', lotId: lots[lot] }, materials: 1, crews: 1 });
    const plans = [
      [build(0, 'house'), build(1, 'house'), build(2, 'cafe'), build(3, 'cafe')],
      [build(4, 'workshop'), build(5, 'workshop'), null, upgrade(3)],
      [null, upgrade(1), null, null],
      [null, upgrade(5), null, null],
      [build(6, 'cafe'), build(7, 'house'), build(8, 'workshop'), build(9, 'house')],
      [build(10, 'house'), build(11, 'cafe'), build(12, 'house'), build(13, 'house')],
      [build(14, 'house'), build(15, 'house'), null, null],
      [null, null, null, null],
    ];
    for (let round = 1; round <= initial.totalRounds; round++) {
      if (round === 1 || round === 4) {
        const payer = round === 1 ? 2 : 0;
        const project = await act(people[payer], { type: 'offer-park', parkId: parks[round === 1 ? 0 : 1],
          contributions: [
            { participantId: playerIds[payer], resources: { coins: 3, materials: 1, crews: 1 } },
            { participantId: playerIds[3], resources: { coins: 1, materials: 0, crews: 0 } },
          ],
        });
        const offer = project.you.offers.find(item => item.kind === 'park' && item.status === 'open');
        assert.ok(offer);
        await act(people[3], { type: 'sign-park', offerId: offer.id, version: offer.version });
      }
      const plan = plans[round - 1];
      for (const [i, player] of people.entries()) {
        if (plan[i]) for (const resource of ['materials', 'crews']) {
          const missing = plan[i][resource] - (await read(player)).you.available[resource];
          if (missing > 0) await act(player, { type: 'bank', direction: 'buy', resource, quantity: missing });
        }
      }
      for (const player of people) await act(player, { type: 'ready', ready: true });
      for (const [i, player] of people.entries()) {
        if (plan[i]?.action.type === 'build') {
          await act(player, { type: 'bid', bid: { lotId: plan[i].action.lotId, amount: 1 } });
        }
        if ((await read(player)).legal.confirmBid) await act(player, { type: 'confirm-bid' });
      }
      for (let turn = 0; turn < people.length; turn++) {
        const view = await read(host);
        assert.equal(view.phase, 'development');
        const seat = playerIds.indexOf(view.activeParticipantId);
        await act(people[seat], plan[seat]?.action ?? { type: 'work' });
      }
      if (round === 1) {
        const newBuilding = liveMap.locator('.di-arrival [data-art="house1"]').first();
        await expect(newBuilding).toBeVisible();
        assert.equal(await newBuilding.evaluate(element => getComputedStyle(element.parentElement).animationName), 'none');
      }
      if (round === 4) {
        await host.page.goto(origin + path);
        const map = host.page.locator('.district-map-surface');
        for (const art of ['house1', 'house2', 'cafe1', 'cafe2', 'workshop1', 'workshop2', 'park', 'park-site', 'neutral', 'square']) {
          await expect(map.locator(`[data-art="${art}"]`).first()).toBeVisible();
        }
        await expect(map.locator('.di-owner')).toHaveCount(6);
        await map.screenshot({ path: join(output, 'azure-bay-developed.png') });
      }
    }
    const final = await read(host);
    const others = await Promise.all(guests.map(read));
    assert.equal(final.outcome.reason, 'completed');
    for (const other of others) assert.deepEqual(other.outcome, final.outcome);
    assert.equal(final.cells.filter(cell => cell.building).length, 16);
    assert.equal(final.cells.filter(cell => cell.completed).length, 2);
    await host.page.reload();
    await expect(host.page.locator('.district-map-surface .di-owner')).toHaveCount(16);
    await expect(host.page.locator('.district-results')).toBeVisible();
    await host.page.locator('.district-layout').screenshot({ path: join(output, 'azure-bay-built-finale.png') });
    return { rounds: final.totalRounds, buildings: 16, parks: 2, allBuildingLevels: true, owners: 4, identicalFinalResults: true, reducedMotion: true };
  } finally {
    await Promise.all(people.map(player => player.context.close()));
  }
}
