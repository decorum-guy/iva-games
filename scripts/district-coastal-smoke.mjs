import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Runs in the existing isolated territorial HTTP/SQLite browser fixture. */
export async function checkCoastalMap(client, phone, origin) {
  const { room } = await client.request('/rooms', { gameId: 'district', capacity: 2, title: 'Coastal map QA' }, 'coast-create');
  const path = '/rooms/' + room.roomId;
  await phone.goto(origin + path);
  await phone.getByRole('button', { name: 'Room settings' }).click();
  await phone.getByLabel('District map').selectOption('longwater');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.locator('.territory-lobby')).toContainText('Great Estuary');
  const saved = (await client.request(path)).room;
  assert.equal(saved.settings.mapId, 'longwater');
  assert.equal(saved.settings.mapVersion, '1');
  const withBot = (await client.request(path + '/bots', { difficulty: 'normal', expectedRevision: saved.revision }, 'coast-bot')).room;
  await client.request(path + '/ready', { ready: true, expectedRevision: withBot.revision }, 'coast-ready');
  await client.request(path + '/start', { expectedRevision: withBot.revision }, 'coast-start');
  await phone.reload();

  const board = phone.getByRole('group', { name: 'Great Estuary', exact: true });
  await expect(board.locator('[data-tile-origin]')).toHaveCount(48);
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
}
