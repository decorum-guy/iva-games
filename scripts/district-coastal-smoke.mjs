import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Runs in the existing isolated territorial HTTP/SQLite browser fixture. */
export async function checkCoastalMap(client, phone, origin) {
  const { room } = await client.request('/rooms', { gameId: 'district', capacity: 4, title: 'Coastal map QA' }, 'coast-create');
  const path = '/rooms/' + room.roomId;
  await phone.goto(origin + path);
  await phone.getByRole('button', { name: 'Room settings' }).click();
  await phone.getByLabel('District map').selectOption('longwater');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.locator('.territory-lobby')).toContainText('Great Estuary');
  const saved = (await client.request(path)).room;
  assert.equal(saved.settings.mapId, 'longwater');
  assert.equal(saved.settings.mapVersion, '1');
  let withBot = saved;
  for (let seat = 1; seat < 4; seat++) {
    withBot = (await client.request(path + '/bots', { difficulty: 'normal', expectedRevision: withBot.revision }, 'coast-bot-' + seat)).room;
  }
  await client.request(path + '/ready', { ready: true, expectedRevision: withBot.revision }, 'coast-ready');
  await client.request(path + '/start', { expectedRevision: withBot.revision }, 'coast-start');
  await phone.reload();

  const board = phone.getByRole('group', { name: 'Great Estuary', exact: true });
  await expect(board.locator('[data-tile-origin]')).toHaveCount(49);
  await expect(board.getByRole('button', { name: /Heath · No resource production/ })).toHaveCount(1);
  await expect(board.locator('.tb-harbor text', { hasText: '2:1' }).first()).toBeVisible();
  await expect(board.locator('.tb-harbor text', { hasText: '3:1' }).first()).toBeVisible();
  await phone.getByRole('button', { name: 'Zoom in' }).tap();
  await board.scrollIntoViewIfNeeded();
  for (const kind of ['node', 'edge']) {
    // Use the projected town site or actual shortened road centre, in CSS pixels.
    const target = await board.evaluate((svg, kind) => {
      const bounds = svg.getBoundingClientRect();
      for (const group of svg.querySelectorAll('[data-board-target^="' + kind + ':"]')) {
        const hit = group.querySelector(kind === 'node' ? '.tb-node-hit' : '.tb-edge-hit');
        const box = hit.getBBox();
        const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(hit.getScreenCTM());
        if (point.x < bounds.left + 5 || point.x > bounds.right - 5 || point.y < bounds.top + 5 || point.y > bounds.bottom - 5) continue;
        if (document.elementFromPoint(point.x, point.y)?.closest('[data-board-target]') === group) {
          return { x: point.x, y: point.y, id: group.getAttribute('data-board-target') };
        }
      }
    }, kind);
    assert.ok(target, 'No visible ' + kind + ' hit after zoom');
    await phone.touchscreen.tap(target.x, target.y);
    await expect(board.locator('[data-board-target="' + target.id + '"]')).toHaveAttribute('aria-pressed', 'true');
  }
  const context = await phone.context().browser().newContext({ storageState: await phone.context().storageState() });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('iva.portal.language', 'ru');
      localStorage.setItem('iva.district.table.preferences.v1', JSON.stringify({ textSize: 130 }));
    });
    const page = await context.newPage();
    await page.goto(origin + path);
    const cards = page.locator('.territory-players > li');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('.territory-match')).toHaveCSS('--table-text-scale', '1.3');
    await expect(cards.filter({ hasText: /Бот · Ресурсы/ })).toHaveCount(3);
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const card of await cards.all()) {
        await card.scrollIntoViewIfNeeded();
        const fits = await card.evaluate(element => {
          const stats = element.querySelector('.territory-person small');
          const score = element.querySelector('.territory-points');
          const range = document.createRange();
          range.selectNodeContents(stats);
          const ink = range.getBoundingClientRect();
          const box = stats.getBoundingClientRect();
          const points = score.getBoundingClientRect();
          return stats.scrollWidth <= stats.clientWidth && ink.left >= box.left - 1 &&
            ink.right <= box.right + 1 && ink.bottom <= box.bottom + 1 && ink.right + 2 <= points.left &&
            points.right <= element.getBoundingClientRect().right && ink.left >= 0 && ink.right <= innerWidth;
        });
        assert.ok(fits, 'Incomplete player statistics at ' + viewport.width + 'px: ' + await card.innerText());
      }
    }
  } finally {
    await context.close();
  }
}
