/** Real HTTP/SQLite browser acceptance for the District trade and card interface.
 * Run after npm run build:portal. No game API is mocked and no external messages are sent.
 * Requests and acknowledgements can be held or dropped around real commits.
 * These cases check acknowledgement handling without replacing server results.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createFeedbackHarness } from './district-feedback-fixtures.mjs';

const resources = ['wood', 'brick', 'grain', 'wool', 'ore'];
const empty = () => Object.fromEntries(resources.map(resource => [resource, 0]));
const stock = values => ({ ...empty(), ...values });
const name = resource => resource[0].toUpperCase() + resource.slice(1);
const harness = await createFeedbackHarness();
let browser;
let releaseHeldRequest;
const contexts = [], pages = [], errors = [], checks = [];
const result = { automated: true, humanPlaytest: false, syntheticPositions: true, realHttp: true, mockedGameApi: false,
  externalMessages: 0, origin: harness.origin, gitHead: harness.manifest.gitHead, sourceHasWorkingChanges: !!harness.manifest.gitStatus,
  buildHashes: harness.manifest.buildHashes, checks, audioListened: false };
async function view(entry, index) { return (await harness.clients[index].request(`/rooms/${entry.roomId}/match`)).view; }
async function post(entry, index, action) {
  const current = await view(entry, index);
  return (await harness.clients[index].request(`/rooms/${entry.roomId}/actions`, {
    actionId: randomUUID(), expectedRevision: current.revision, payload: { ...action, phaseId: current.phaseId },
  })).view;
}
async function action(page, button) {
  const response = page.waitForResponse(response => response.request().method() === 'POST' && /\/rooms\/[^/]+\/actions$/.test(new URL(response.url()).pathname));
  await button.click();
  const accepted = await response;
  const data = await accepted.json();
  assert.equal(accepted.ok(), true, JSON.stringify(data));
  return data.view;
}
async function open(entry) {
  await Promise.all(pages.map(page => page.goto('about:blank')));
  const fresh = await harness.reset(entry);
  await Promise.all(pages.map(async page => {
    await page.goto(fresh.url);
    await expect(page.locator('.territory-match')).toBeVisible();
    await expect(page.locator('.territory-map-tools .ta-cards > summary')).toBeVisible();
  }));
  return fresh;
}
async function openTrade(page) {
  const toggle = page.getByRole('button', { name: /^(Offer a trade|Continue saved terms)$/ });
  // A restored draft is already open after a reload; the new map control toggles it.
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(page.locator('.ta-trade-window')).toBeVisible();
}
async function openBank(page) {
  await openTrade(page);
  await page.getByRole('button', { name: 'Bank', exact: true }).click();
  const bank = page.locator('.ta-bank');
  await expect(bank).toBeVisible();
  return bank;
}
async function closeTrade(page) {
  await page.getByRole('button', { name: 'Close trade', exact: true }).click();
  await expect(page.locator('.ta-trade-window')).toBeHidden();
}
function tradeCount(page, side, resource) {
  return page.locator('.ta-trade-editor').getByRole('group', { name: side, exact: true })
    .locator(`[data-resource="${resource}"] .ta-trade-count`);
}
async function setTradeCount(page, side, resource, amount) {
  const count = tradeCount(page, side, resource);
  const current = Number((await count.allTextContents())[0] ?? 0);
  const step = amount > current ? '+' : '−';
  const control = page.locator('.ta-trade-editor').getByRole('button', { name: `${side} ${step} ${name(resource)}`, exact: true });
  for (let index = 0; index < Math.abs(amount - current); index++) await control.click();
  if (amount) await expect(count).toHaveText(String(amount));
  else await expect(count).toHaveCount(0);
}
async function expectTradeHistory(page, text, repeatedStatus) {
  const tabs = page.locator('.territory-tabs');
  await tabs.getByRole('button', { name: 'Turn history', exact: true }).click();
  const history = page.getByRole('region', { name: 'Turn history', exact: true });
  await history.getByRole('button', { name: 'Trading', exact: true }).click();
  const entry = history.getByRole('listitem').filter({ hasText: text }).first();
  await expect(entry).toBeVisible();
  if (repeatedStatus) await expect(entry).not.toContainText(repeatedStatus);
  await tabs.getByRole('button', { name: /Actions/ }).click();
}
async function expectTradeArrowCentered(terms) {
  await expect(terms).toBeVisible();
  const gaps = await terms.evaluate(element => {
    const [give, receive] = [...element.querySelectorAll('.ta-resources')].map(group => group.getBoundingClientRect());
    const arrow = element.querySelector('.ta-offer-arrow').getBoundingClientRect();
    return { left: arrow.left - give.right, right: receive.left - arrow.right,
      centers: [give, arrow, receive].map(rect => rect.top + rect.height / 2) };
  });
  assert.ok(gaps.left > 0 && gaps.right > 0 && Math.abs(gaps.left - gaps.right) <= 1, JSON.stringify(gaps));
  assert.ok(Math.max(...gaps.centers) - Math.min(...gaps.centers) <= 1, JSON.stringify(gaps));
}
async function enterPlay(entry, index) {
  let current = await action(pages[index], pages[index].getByRole('button', { name: 'Roll dice', exact: true }));
  if (current.phase === 'discard') {
    for (const slot of [0, 1]) {
      const own = await view(entry, slot);
      if (!own.you.discard) continue;
      let remaining = own.you.discard;
      for (const resource of ['grain', 'wool', 'ore', 'wood', 'brick']) {
        const amount = Math.min(remaining, own.you.hand[resource]); remaining -= amount;
        await pages[slot].getByRole('spinbutton', { name: 'Return resources to the bank · ' + name(resource), exact: true }).fill(String(amount));
      }
      assert.equal(remaining, 0);
      await action(pages[slot], pages[slot].getByRole('button', { name: `Discard ${own.you.discard} / ${own.you.discard}`, exact: true }));
    }
  }
  current = await view(entry, index);
  if (current.phase === 'block') {
    const tile = current.legal.block[0];
    await pages[index].locator(`[data-board-target="tile:${tile.tileId}"]`).click();
    current = await action(pages[index], pages[index].getByRole('button', { name: 'Move blockade', exact: true }));
  }
  assert.equal(current.phase, 'play');
  return current;
}
async function touchPoint(locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    let visible = box.width > 0 && box.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const rect = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (y < rect.top || y >= rect.bottom)) visible = false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (x < rect.left || x >= rect.right)) visible = false;
    }
    const hit = visible ? document.elementFromPoint(x, y) : null;
    return { x, y, receivesPointer: !!hit && (hit === element || element.contains(hit)) };
  });
}
async function nativeTap(page, locator) {
  await expect(locator).toBeVisible();
  const point = await touchPoint(locator);
  assert.ok(point.receivesPointer, 'The visible control must receive the real touch without scrolling or force: ' + await locator.textContent());
  await page.touchscreen.tap(point.x, point.y);
}
async function scrollBounds(scroll) {
  return scroll.evaluate(element => ({ top: element.scrollTop, max: Math.max(0, element.scrollHeight - element.clientHeight) }));
}
async function nativeSwipe(page, scroll, { direction = 1, distance: requestedDistance } = {}) {
  const box = await scroll.boundingBox(); assert.ok(box && box.height > 40);
  const before = await scrollBounds(scroll);
  // scrollTop is fractional while scrollHeight/clientHeight are rounded. A
  // boundary is a successful end to scrolling, not another required movement.
  if ((direction > 0 ? before.max - before.top : before.top) <= 1) return false;
  const x = box.x + box.width / 2, startY = direction > 0 ? box.y + box.height - 12 : box.y + 12;
  const distance = Math.min(requestedDistance ?? box.height * .55, box.height - 30);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - direction * distance * step / 8, id: 1 }] });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    // Release a stationary finger rather than fling past a control. Browser
    // versions and CI frame timing otherwise produce different momentum.
    await page.waitForTimeout(120);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
  await expect.poll(async () => direction * ((await scrollBounds(scroll)).top - before.top)).toBeGreaterThan(0);
  return true;
}
async function visibleSheet(page, selector, header) {
  const sheet = page.locator(selector);
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(header).toBeInViewport({ ratio: 1 });
  assert.ok((await touchPoint(header)).receivesPointer, 'The sheet header must remain above its scrolling content');
  const geometry = await page.evaluate(selector => {
    const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }; };
    return { phase: rect(document.querySelector('.territory-phase')), sheet: rect(document.querySelector(selector)), board: rect(document.querySelector('.tb-surface')) };
  }, selector);
  assert.ok(geometry.sheet.y >= geometry.phase.bottom, 'An expanded sheet must preserve the active player and timer');
  assert.ok(geometry.board.height >= 100, 'The reserved toolbar must leave a usable map');
  return geometry;
}
async function tapRoad(page, id) {
  const target = page.locator(`[data-board-target="edge:${id}"]`);
  // SVG hit strokes can have a zero-height/width geometric box. Their midpoint
  // still has to hit the board, and the real handler must select this exact road.
  const point = await target.locator('.tb-edge-hit').evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return { x, y, boardHit: !!document.elementFromPoint(x, y)?.closest('.tb-surface') };
  });
  assert.ok(point.boardHit, 'A map control or offer must not intercept road ' + id);
  await page.touchscreen.tap(point.x, point.y);
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  return point;
}
function passed(check) { checks.push(check); console.log(JSON.stringify({ passed: check })); }

try {
  const assets = await readdir(join(harness.directory, 'portal/assets'));
  result.servedAssets = [];
  for (const asset of assets.filter(asset => /\.(js|css)$/.test(asset))) {
    const expected = await readFile(join(harness.directory, 'portal/assets', asset));
    const response = await fetch(`${harness.origin}/assets/${asset}`);
    assert.equal(response.ok, true);
    const served = Buffer.from(await response.arrayBuffer());
    assert.ok(expected.equals(served), 'Served asset differs from the isolated build: ' + asset);
    result.servedAssets.push({ path: `/assets/${asset}`, bytes: served.length, sha256: createHash('sha256').update(served).digest('hex') });
  }
  const special = join(process.cwd(), '.qa/browser-runtime/node_modules/@sparticuz/chromium/build/index.js');
  let options = { headless: true, args: ['--mute-audio'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  else if (existsSync(special)) {
    const runtime = (await import(pathToFileURL(special).href)).default;
    options = { ...options, executablePath: await runtime.executablePath(),
      args: [...runtime.args.filter(value => !value.includes('disable-web-security') && !value.includes('allow-running-insecure-content') && !value.includes('single-process')), '--mute-audio'] };
  }
  browser = await chromium.launch(options);
  result.browser = browser.version();
  for (const [index, account] of harness.manifest.accounts.entries()) {
    const context = await browser.newContext({ storageState: account.storageState,
      viewport: index ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: !!index });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(20_000);
    await context.addInitScript(() => {
      if (!['http:', 'https:'].includes(window.location.protocol)) return;
      localStorage.setItem('iva.portal.language', 'en');
      localStorage.setItem('iva.district.table.preferences.v1', JSON.stringify({ textSize: 130, reduceMotion: true,
        sound: { enabled: false, master: 0, effects: 0, news: 0 }, newsNotices: false }));
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    contexts.push(context); pages.push(page);
  }

  let entry = await open('trade-draft');
  const desktop = pages[0], desktopEditor = desktop.locator('.ta-trade-editor');
  await openTrade(desktop);
  await expect(desktopEditor.getByRole('spinbutton')).toHaveCount(0);
  await expect(desktopEditor.locator('.ta-trade-count')).toHaveCount(0);
  const desktopLayout = await desktop.locator('.ta-trade-window').evaluate(element => ({
    width: element.clientWidth, height: element.clientHeight, scrollHeight: element.scrollHeight,
    recipientWidth: element.querySelector('.ta-draft-target select').getBoundingClientRect().width,
  }));
  assert.ok(desktopLayout.width <= 340 && desktopLayout.recipientWidth < desktopLayout.width * .65, JSON.stringify(desktopLayout));
  assert.ok(desktopLayout.scrollHeight <= desktopLayout.height + 1, JSON.stringify(desktopLayout));
  assert.ok((await touchPoint(desktopEditor.getByRole('button', { name: 'I receive + Ore', exact: true }))).receivesPointer);
  await expect(desktopEditor.getByRole('button', { name: 'Send offer', exact: true })).toBeInViewport();
  await desktop.screenshot({ path: join(harness.directory, 'trade-editor-1280x720.png') });
  await desktop.keyboard.press('Escape');
  await expect(desktopEditor).toHaveCount(0);
  await expect(desktop.getByRole('button', { name: 'Offer a trade', exact: true })).toBeFocused();
  result.desktopTrade = desktopLayout;
  passed('compact 1280×720 editor fits all controls, has no zero inputs and supports Escape with focus restored');

  const handPage=pages[entry.hostIndex];
  await handPage.locator('.territory-hand').getByRole('button',{name:'Give Wood',exact:true}).click();
  const handEditor=handPage.locator('.ta-trade-editor');
  await expect(tradeCount(handPage, 'I give', 'wood')).toHaveText('1');
  await handPage.locator('.territory-hand').getByRole('button',{name:'Give Wood',exact:true}).click();
  await expect(tradeCount(handPage, 'I give', 'wood')).toHaveText('2');
  const removeWood = handEditor.getByRole('button', { name: 'I give − Wood', exact: true });
  await removeWood.press('Enter');
  await expect(tradeCount(handPage, 'I give', 'wood')).toHaveText('1');
  await removeWood.press('Space');
  await expect(tradeCount(handPage, 'I give', 'wood')).toHaveCount(0);
  const addWood = handEditor.getByRole('button', { name: 'I give + Wood', exact: true });
  await expect(addWood).toBeFocused();
  await addWood.press('Enter');
  await expect(tradeCount(handPage, 'I give', 'wood')).toHaveText('1');
  await handPage.getByRole('button', { name: 'Close trade', exact: true }).click();
  passed('hand adds resources, keyboard adjusts quantities and retains focus when the last unit is removed');
  const authorIndex = entry.hostIndex, receiverIndex = entry.guestIndex;
  const author = pages[authorIndex], receiver = pages[receiverIndex];
  await expect(author.locator('.territory-players')).toContainText('Awaiting reply');
  await expect(receiver.locator('.territory-players')).toContainText('Offers a trade');
  await receiver.getByRole('button', { name: 'Counteroffer', exact: true }).click();
  await setTradeCount(receiver, 'I give', 'brick', 2);
  await setTradeCount(receiver, 'I receive', 'wood', 3);
  await action(author, author.getByRole('button', { name: 'End turn', exact: true }));
  const editor = receiver.locator('.ta-trade-editor');
  await expect(editor).toContainText('Closed: the turn ended');
  await expect(tradeCount(receiver, 'I give', 'brick')).toHaveText('2');
  await expect(tradeCount(receiver, 'I receive', 'wood')).toHaveText('3');
  await expect(author.locator('.ta-offers-panel')).toBeHidden();
  await expect(receiver.locator('.ta-offers-panel')).toBeHidden();
  await receiver.reload();
  await expect(receiver.locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveCount(0);
  await expectTradeHistory(receiver, /Offer closed · Turn ended/);
  await expect(receiver.locator('.territory-player-trade')).toHaveCount(0);
  await expect(receiver.locator('.territory-action-receipt')).toHaveCount(0);
  await expect(editor).toContainText('Closed: the turn ended');
  await expect(tradeCount(receiver, 'I give', 'brick')).toHaveText('2');
  await expect(tradeCount(receiver, 'I receive', 'wood')).toHaveText('3');
  await expect(receiver.getByRole('button', { name: 'Send offer', exact: true })).toBeDisabled();
  await editor.locator('.ta-reuse-draft').scrollIntoViewIfNeeded();
  await receiver.screenshot({ path: join(harness.directory, 'trade-expired-mobile.png') });
  await receiver.getByRole('button', { name: 'Use as a new offer', exact: true }).click();
  await enterPlay(entry, receiverIndex);
  await expect(receiver.getByRole('button', { name: 'Send offer', exact: true })).toBeEnabled();

  const held = new Promise(resolve => { releaseHeldRequest = resolve; });
  const actionsPattern = `**/api/platform/v1/rooms/${entry.roomId}/actions`;
  await receiver.route(actionsPattern, async route => {
    if (route.request().postDataJSON()?.payload?.type === 'offer') await held;
    await route.continue();
  });
  const sendingResponse = receiver.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/rooms/${entry.roomId}/actions`));
  await receiver.getByRole('button', { name: 'Send offer', exact: true }).click();
  await expect(receiver.getByRole('button', { name: 'Sending…', exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(tradeCount(receiver, 'I give', 'brick')).toHaveText('2');
  releaseHeldRequest();
  releaseHeldRequest = undefined;
  const sendingAccepted = await sendingResponse;
  assert.equal(sendingAccepted.ok(), true);
  const sent = (await sendingAccepted.json()).view.offers.find(offer => offer.authorId === entry.expected.otherId);
  assert.ok(sent);
  assert.deepEqual(sent.give, stock({ brick: 2 })); assert.deepEqual(sent.receive, stock({ wood: 3 }));
  await receiver.unroute(actionsPattern);
  await expect(editor).toHaveCount(0);
  await expect(receiver.locator(`[data-offer-id="${sent.id}"][data-offer-status="waiting"]`)).toContainText('Sent · awaiting response');
  const before = await view(entry, authorIndex);
  await expect(author.locator(`[data-offer-id="${sent.id}"]`).getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  const accepted = await action(author, author.locator(`[data-offer-id="${sent.id}"]`).getByRole('button', { name: 'Accept', exact: true }));
  assert.equal(accepted.you.hand.wood, before.you.hand.wood - 3);
  assert.equal(accepted.you.hand.brick, before.you.hand.brick + 2);
  await expect(author.locator('.ta-section-heading h4')).toBeFocused();
  await expect(receiver.locator('.ta-offers-panel')).toBeHidden();
  await expect(author.locator('.ta-offers-panel')).toBeHidden();
  await receiver.reload();
  await expect(receiver.locator(`[data-offer-id="${sent.id}"]`)).toHaveCount(0);
  await expectTradeHistory(receiver, /Trade completed/, '· Accepted: trade completed');
  await expectTradeHistory(author, /Trade completed.*Paid:.*Received:/);
  for (const page of [author, receiver]) {
    await expect(page.locator('.territory-player-trade')).toHaveCount(0);
    await expect(page.locator('.territory-action-receipt')).toHaveCount(0);
  }
  passed('counteroffer survives expiry and reload, commits the exact transfer once, then disappears from the panel and remains in history');

  entry = await open('trade-draft');
  const counterPage = pages[entry.guestIndex], initialAuthorPage = pages[entry.hostIndex];
  await counterPage.getByRole('button', { name: 'Counteroffer', exact: true }).click();
  await setTradeCount(counterPage, 'I give', 'brick', 2);
  await setTradeCount(counterPage, 'I receive', 'wood', 3);
  const counterSent = await action(counterPage, counterPage.getByRole('button', { name: 'Send offer', exact: true }));
  const counter = counterSent.offers.find(offer => offer.authorId === entry.expected.otherId);
  assert.ok(counter);
  assert.equal(counter.parentId, entry.expected.offerId);
  assert.deepEqual(counter.give, stock({ brick: 2 })); assert.deepEqual(counter.receive, stock({ wood: 3 }));
  assert.equal(counterSent.offerHistory.find(offer => offer.id === entry.expected.offerId)?.status, 'replaced');
  await expect(counterPage.locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveCount(0);
  await expect(counterPage.locator(`[data-offer-id="${counter.id}"]`)).toBeVisible();
  await expectTradeHistory(counterPage, /Offer closed · Replaced by new terms/);
  await expect(counterPage.locator('.territory-action-receipt')).toHaveCount(0);
  await expect(initialAuthorPage.locator(`[data-offer-id="${counter.id}"]`).getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  const beforeCounterAccepted = await view(entry, entry.hostIndex);
  const afterCounterAccepted = await action(initialAuthorPage, initialAuthorPage.locator(`[data-offer-id="${counter.id}"]`).getByRole('button', { name: 'Accept', exact: true }));
  assert.equal(afterCounterAccepted.you.hand.wood, beforeCounterAccepted.you.hand.wood - 3);
  assert.equal(afterCounterAccepted.you.hand.brick, beforeCounterAccepted.you.hand.brick + 2);
  await expect(counterPage.locator(`[data-offer-id="${counter.id}"]`)).toHaveCount(0);
  passed('a live counteroffer retains parentId, replaces the original in the active panel and executes only after its chosen recipient accepts');

  entry = await open('trade-draft');
  const unequal = await post(entry, entry.hostIndex, { type: 'offer', targetId: entry.expected.otherId,
    give: stock({ wood: 1, grain: 2, wool: 3, ore: 2 }), receive: stock({ brick: 1 }) });
  const offerId = unequal.offers[0].id;
  for (const page of pages) await expectTradeArrowCentered(page.locator(`[data-offer-id="${offerId}"] .ta-offer-terms`));
  const narrow = pages[1];
  await narrow.setViewportSize({ width: 320, height: 720 });
  await expectTradeArrowCentered(narrow.locator(`[data-offer-id="${offerId}"] .ta-offer-terms`));
  await narrow.screenshot({ path: join(harness.directory, 'offer-unequal-320x720.png') });
  await narrow.setViewportSize({ width: 390, height: 844 });
  passed('the offer arrow is centered on both clients between one and four resource stacks, including when they wrap on a narrow screen');

  entry = await open('trade-draft');
  const lostPage = pages[entry.hostIndex];
  await openTrade(lostPage);
  await lostPage.locator('.ta-trade-editor').getByLabel('Trade with', { exact: true }).selectOption(entry.expected.otherId);
  for (const resource of resources) {
    await setTradeCount(lostPage, 'I give', resource, resource === 'wood' ? 2 : 0);
    await setTradeCount(lostPage, 'I receive', resource, resource === 'brick' ? 1 : 0);
  }
  const lostPattern = `**/api/platform/v1/rooms/${entry.roomId}/actions`;
  let lostOnce = false, committedOfferView;
  await lostPage.route(lostPattern, async route => {
    if (!lostOnce && route.request().postDataJSON()?.payload?.type === 'offer') {
      lostOnce = true;
      const serverResponse = await route.fetch();
      assert.equal(serverResponse.ok(), true);
      committedOfferView = (await serverResponse.json()).view;
      await route.abort('connectionclosed');
    } else await route.continue();
  });
  await lostPage.getByRole('button', { name: 'Send offer', exact: true }).click();
  await expect(lostPage.locator('.territory-notice').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(lostPage.locator('.ta-trade-editor')).toHaveCount(0);
  assert.ok(committedOfferView);
  const beforeRetry = await view(entry, entry.hostIndex);
  const replayedOffer = await action(lostPage, lostPage.locator('.territory-notice').getByRole('button', { name: 'Retry', exact: true }));
  assert.equal(replayedOffer.revision, committedOfferView.revision);
  assert.equal((await view(entry, entry.hostIndex)).revision, beforeRetry.revision);
  await expect(lostPage.locator('.ta-trades')).not.toContainText('Sending was not confirmed');
  await lostPage.unroute(lostPattern);
  passed('lost offer response recovers from explicit server terms; Retry reuses the accepted command without a second offer');

  entry = await open('trade-draft');
  await action(pages[entry.guestIndex], pages[entry.guestIndex].getByRole('button', { name: 'Decline', exact: true }));
  for (const page of pages) {
    await expect(page.locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveCount(0);
    await expect(page.locator('.territory-player-trade')).toHaveCount(0);
    await expectTradeHistory(page, /Trade declined/, '· Declined');
  }
  passed('declined offers disappear automatically and both parties see the decision in history');
  entry = await open('trade-draft');
  await action(pages[entry.hostIndex], pages[entry.hostIndex].getByRole('button', { name: 'Withdraw', exact: true }));
  for (const page of pages) {
    await page.reload();
    await expect(page.locator('.territory-match')).toBeVisible();
    await expect(page.locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveCount(0);
    await expect(page.locator('.ta-offers-panel')).toBeHidden();
    await expectTradeHistory(page, /Offer withdrawn/, '· Withdrawn');
    await expect(page.locator('.territory-player-trade')).toHaveCount(0);
    await expect(page.locator('.territory-action-receipt')).toHaveCount(0);
  }
  passed('withdrawn offers stay out of the panel after reload and both parties see the decision in history');

  entry = await open('trade-draft');
  await post(entry, entry.hostIndex, { type: 'offer', targetId: entry.expected.otherId, give: stock({ wood: 4 }), receive: stock({ brick: 1 }) });
  const bankPage = pages[entry.hostIndex], recipientPage = pages[entry.guestIndex];
  await bankPage.reload();
  const bank = await openBank(bankPage);
  const receipt = bank.getByText('Exchange completed', { exact: true });
  const bankBefore = await view(entry, entry.hostIndex);
  await bank.getByLabel('I receive', { exact: true }).selectOption('grain');
  const rate = bankBefore.legal.bank.wood;
  const exchanged = await action(bankPage, bank.getByRole('button', { name: `Exchange ${rate} → 1`, exact: true }));
  assert.equal(exchanged.you.hand.wood, bankBefore.you.hand.wood - rate);
  assert.equal(exchanged.you.hand.grain, bankBefore.you.hand.grain + 1);
  await expect(receipt).toBeVisible();
  await expect(recipientPage.locator('.ta-offer:not(.is-closed)').getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  await expect(recipientPage.locator('.ta-offer:not(.is-closed)')).toContainText('The sender no longer has the required resources');
  await expect(receipt).toHaveCount(0, { timeout: 7_000 });
  await expect(bank).toBeVisible();
  await bank.getByLabel('I give', { exact: true }).selectOption('brick');
  const brickRate = exchanged.legal.bank.brick;
  const nextExchange = await action(bankPage, bank.getByRole('button', { name: `Exchange ${brickRate} → 1`, exact: true }));
  assert.equal(nextExchange.you.hand.brick, exchanged.you.hand.brick - brickRate);
  await expect(receipt).toBeVisible();
  const nextTurn = await action(bankPage, bankPage.getByRole('button', { name: 'End turn', exact: true }));
  assert.equal(nextTurn.turn, exchanged.turn + 1);
  await expect(receipt).toHaveCount(0);
  await closeTrade(bankPage);
  await openBank(bankPage);
  await expect(receipt).toHaveCount(0);
  await expectTradeHistory(bankPage, /Bank exchange completed.*Paid:.*Received:/);
  passed('a real bank exchange displays exact payment, expires while open and stays in history after the next turn and reopening');

  entry = await open('trade-draft');
  const lostBankPage = pages[entry.hostIndex];
  const lostBank = await openBank(lostBankPage);
  const lostReceipt = lostBank.getByText('Exchange completed', { exact: true });
  const bankUnconfirmed = lostBank.getByText('The exchange was not confirmed.', { exact: false });
  await lostBank.getByLabel('I receive', { exact: true }).selectOption('grain');
  const lostBankBefore = await view(entry, entry.hostIndex);
  const lostBankRate = lostBankBefore.legal.bank.wood;
  const lostBankPattern = `**/api/platform/v1/rooms/${entry.roomId}/actions`;
  const bankMatchPattern = `**/api/platform/v1/rooms/${entry.roomId}/match`;
  const forwardBank = Promise.withResolvers();
  const releasePoll = Promise.withResolvers();
  releaseHeldRequest = () => { forwardBank.resolve(); releasePoll.resolve(); };
  let committedBankView;
  let snapshotHeld = false;
  const bankCommands = [];
  await lostBankPage.route(bankMatchPattern, async route => {
    snapshotHeld = true;
    await releasePoll.promise;
    await route.continue();
  });
  await expect.poll(() => snapshotHeld, { timeout: 8_000 }).toBe(true);
  await lostBankPage.route(lostBankPattern, async route => {
    const command = route.request().postDataJSON();
    if (command?.payload?.type === 'bank') bankCommands.push(command);
    if (command?.payload?.type === 'bank' && bankCommands.length === 1) {
      await forwardBank.promise;
      const serverResponse = await route.fetch();
      assert.equal(serverResponse.ok(), true);
      committedBankView = (await serverResponse.json()).view;
      await route.abort('connectionclosed');
    } else await route.continue();
  });
  const bankSending = lostBank.getByRole('button', { name: `Exchanging… ${lostBankRate} → 1`, exact: true });
  await lostBank.getByRole('button', { name: `Exchange ${lostBankRate} → 1`, exact: true }).click();
  await expect(bankSending).toBeVisible();
  await closeTrade(lostBankPage);
  await openBank(lostBankPage);
  await expect(bankSending).toBeDisabled();
  await expect(lostReceipt).toHaveCount(0);
  assert.equal((await view(entry, entry.hostIndex)).revision, lostBankBefore.revision);
  forwardBank.resolve();
  const bankRetry = lostBankPage.locator('.territory-notice').getByRole('button', { name: 'Retry', exact: true });
  await expect(bankRetry).toBeVisible();
  await expect(bankUnconfirmed).toBeVisible();
  await closeTrade(lostBankPage);
  await openBank(lostBankPage);
  await expect(bankUnconfirmed).toBeVisible();
  await expect(lostReceipt).toHaveCount(0);
  assert.ok(committedBankView);
  assert.equal(committedBankView.you.hand.wood, lostBankBefore.you.hand.wood - lostBankRate);
  assert.equal(committedBankView.you.hand.grain, lostBankBefore.you.hand.grain + 1);
  releasePoll.resolve();
  await expect(lostReceipt).toBeVisible();
  await expect(bankUnconfirmed).toHaveCount(0);
  await closeTrade(lostBankPage);
  await openBank(lostBankPage);
  await expect(lostReceipt).toHaveCount(0);
  const replayedBank = await action(lostBankPage, bankRetry);
  assert.equal(replayedBank.revision, committedBankView.revision);
  assert.deepEqual((await view(entry, entry.hostIndex)).you.hand, committedBankView.you.hand);
  assert.equal(bankCommands.length, 2);
  assert.deepEqual(bankCommands[0], bankCommands[1]);
  await expect(lostReceipt).toHaveCount(0);
  await expect(bankUnconfirmed).toHaveCount(0);
  await lostBankPage.unroute(lostBankPattern);
  await lostBankPage.unroute(bankMatchPattern);
  releaseHeldRequest = undefined;
  passed('closing the bank preserves a pending or unconfirmed exchange, and a real late acknowledgement resolves it without a repeat charge');

  entry = await open('trade-draft');
  const lateBankPage = pages[entry.hostIndex];
  const lateBank = await openBank(lateBankPage);
  const lateBefore = await view(entry, entry.hostIndex);
  const lateRate = lateBefore.legal.bank.wood;
  const latePattern = `**/api/platform/v1/rooms/${entry.roomId}/actions`;
  await lateBank.getByLabel('I receive', { exact: true }).selectOption('grain');
  const commitBank = Promise.withResolvers();
  const returnBank = Promise.withResolvers();
  releaseHeldRequest = () => { commitBank.resolve(); returnBank.resolve(); };
  await lateBankPage.route(latePattern, async route => {
    await commitBank.promise;
    const response = await route.fetch();
    await returnBank.promise;
    await route.fulfill({ response });
  });
  const lateResponse = lateBankPage.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/actions'));
  await lateBank.getByRole('button', { name: `Exchange ${lateRate} → 1`, exact: true }).click();
  await closeTrade(lateBankPage);
  commitBank.resolve();
  await expect(lateBankPage.locator('.territory-hand [data-resource="grain"] > b')).toHaveText(String(lateBefore.you.hand.grain + 1));
  await openBank(lateBankPage);
  const lateReceipt = lateBank.getByText('Exchange completed', { exact: true });
  await expect(lateReceipt).toHaveCount(0);
  returnBank.resolve();
  const lateAccepted = await lateResponse;
  assert.equal(lateAccepted.status(), 200);
  const lateConfirmed = (await lateAccepted.json()).view;
  assert.equal(lateConfirmed.you.hand.wood, lateBefore.you.hand.wood - lateRate);
  await expect(lateBank.getByRole('button', { name: `Exchange ${lateRate} → 1`, exact: true })).toBeVisible();
  await expect(lateReceipt).toHaveCount(0);
  await expectTradeHistory(lateBankPage, /Bank exchange completed.*Paid:.*Received:/);
  await lateBankPage.unroute(latePattern);
  releaseHeldRequest = undefined;
  passed('a result recovered while Bank is closed stays in history, and the older POST acknowledgement cannot revive the notice');

  entry = await open('trade-draft');
  const shortageView = await post(entry, entry.hostIndex, { type: 'offer', targetId: entry.expected.otherId, give: stock({ wood: 1 }), receive: stock({ brick: 5 }) });
  assert.equal(shortageView.offers[0].unavailableReason, undefined, 'Author must not learn a hidden counterparty shortage');
  await expect(pages[entry.guestIndex].locator('.ta-offer:not(.is-closed)')).toContainText('Your hand is missing');
  await expect(pages[entry.guestIndex].locator('.ta-offer:not(.is-closed)').getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  passed('recipient sees own exact shortage while author receives no hidden-hand availability flag');

  entry = await open('patrol');
  let cardPage = pages[entry.hostIndex];
  await cardPage.locator('.ta-cards > summary').click();
  let patrol = cardPage.locator('[data-card-id="fixture-card-0"]');
  const initialRevision = (await view(entry, entry.hostIndex)).revision;
  await patrol.getByRole('button', { name: 'Play card', exact: true }).click();
  await expect(patrol.locator('.ta-card-confirm')).toBeVisible();
  assert.equal((await view(entry, entry.hostIndex)).revision, initialRevision, 'Opening confirmation must not spend the card');
  const movedPhase = await action(cardPage, patrol.getByRole('button', { name: 'Confirm', exact: true }));
  assert.equal(movedPhase.phase, 'block');
  await cardPage.locator(`[data-board-target="tile:${movedPhase.legal.block[0].tileId}"]`).click();
  const moved = await action(cardPage, cardPage.getByRole('button', { name: 'Move blockade', exact: true }));
  assert.equal(moved.blockade.reason, 'patrol');
  await cardPage.locator('.ta-cards > summary').click();
  await expect(cardPage.locator('.ta-cards .ta-feedback')).toContainText('Patrol complete. The blockade has moved.');
  await expect(cardPage.locator('.ta-cards .ta-feedback')).not.toContainText('Choose the blockade');
  await expect(cardPage.locator('[data-card-id="fixture-card-1"]')).toContainText('A card was already played this turn');
  await expect(cardPage.locator('[data-card-id="fixture-card-2"]').getByRole('button', { name: 'Play card', exact: true })).toHaveCount(0);
  passed('patrol confirmation preserves card until confirmed, moves blockade with patrol cause and enforces one active card per turn');

  entry = await open('patrol');
  cardPage = pages[entry.hostIndex];
  await cardPage.locator('.ta-cards > summary').click();
  const supply = cardPage.locator('[data-card-id="fixture-card-2"]');
  await supply.getByLabel('First resource', { exact: true }).selectOption('grain');
  await supply.getByLabel('Second resource', { exact: true }).selectOption('grain');
  const supplyBefore = await view(entry, entry.hostIndex);
  await supply.getByRole('button', { name: 'Play card', exact: true }).click();
  const supplied = await action(cardPage, supply.getByRole('button', { name: 'Confirm', exact: true }));
  assert.equal(supplied.you.hand.grain, supplyBefore.you.hand.grain + 2);
  await expect(cardPage.locator('.ta-cards')).toContainText('Supplies received');
  passed('supply confirmation grants exactly two chosen units, including two of the same resource');

  entry = await open('patrol');
  cardPage = pages[entry.hostIndex];
  await cardPage.locator('.ta-cards > summary').click();
  const survey = cardPage.locator('[data-card-id="fixture-card-1"]');
  await survey.getByRole('button', { name: 'Play card', exact: true }).click();
  let routes = await action(cardPage, survey.getByRole('button', { name: 'Confirm', exact: true }));
  for (let index = 0; index < 2; index++) {
    const route = routes.legal.options.find(option => option.kind === 'route' && option.pricing.reason === 'tactic');
    assert.ok(route); assert.equal(Object.values(route.cost).reduce((sum, count) => sum + count, 0), 0);
    const kind = routes.map.edges.find(edge => edge.id === route.id).kind;
    // A vertical SVG group has zero geometric width although its painted hit stroke is usable.
    // Tap the measured public hit-line midpoint instead of forcing an invisible locator click.
    const midpoint = await cardPage.locator(`[data-board-target="edge:${route.id}"] .tb-edge-hit`).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    if (entry.hostIndex === 1) await cardPage.touchscreen.tap(midpoint.x, midpoint.y);
    else await cardPage.mouse.click(midpoint.x, midpoint.y);
    await expect(cardPage.locator('.ta-selected')).toContainText('Covered by Survey');
    routes = await action(cardPage, cardPage.locator('.ta-selected').getByRole('button', { name: kind === 'sea' ? 'Open sea lane' : 'Build road', exact: true }));
    await cardPage.locator('.ta-cards > summary').click();
    await expect(cardPage.locator('.ta-cards .ta-feedback')).toContainText(index === 0
      ? 'Survey: choose the second route on the map.' : 'Survey complete. Both routes are built.');
    await cardPage.locator('.ta-cards .ta-feedback').scrollIntoViewIfNeeded();
    const closeCards = cardPage.getByRole('button', { name: 'Close development cards', exact: true });
    await expect(closeCards).toBeInViewport({ ratio: 1 });
    if (entry.hostIndex === 1) await closeCards.tap();
    else await closeCards.click();
    await expect(cardPage.locator('.ta-card-panel')).toBeHidden();
  }
  assert.ok(routes.legal.options.filter(option => option.kind === 'route').every(option => option.pricing.reason !== 'tactic'));
  await action(cardPage, cardPage.getByRole('button', { name: 'End turn', exact: true }));
  await cardPage.locator('.ta-cards > summary').click();
  await expect(cardPage.locator('.ta-cards .ta-feedback')).toHaveCount(0);
  passed('survey covers two actual routes, updates remaining/completed guidance and clears its receipt on the next turn');

  entry = await open('patrol');
  cardPage = pages[entry.hostIndex];
  await cardPage.locator('.ta-cards > summary').click();
  let bought;
  for (let index = 0; index < 3; index++) {
    const beforeBuy = await view(entry, entry.hostIndex);
    const boughtView = await action(cardPage, cardPage.getByRole('button', { name: 'Buy a card', exact: true }));
    bought = boughtView.you.cards.find(card => !beforeBuy.you.cards.some(old => old.id === card.id));
    assert.ok(bought);
    if (bought.kind !== 'charter') break;
  }
  assert.notEqual(bought.kind, 'charter', 'Fixture should yield an active card within three purchases');
  await expect(cardPage.locator(`[data-card-id="${bought.id}"]`)).toContainText('From your next turn');
  await expect(cardPage.locator(`[data-card-id="${bought.id}"]`).getByRole('button', { name: 'Play card', exact: true })).toHaveCount(0);
  await expect(cardPage.locator('[data-card-id="fixture-card-3"]')).toContainText('Already gives +1 point');
  passed('newly bought active card cannot be played this turn; charter shows its already-counted hidden point');

  await cardPage.screenshot({ path: join(harness.directory, 'cards-mobile.png') });

  // Russian text at 130% in a real touch context. Do not let locator.click()
  // scroll hidden decisions into view: the arriving offer must already be usable.
  result.mobileLayouts = [];
  for (const height of [600, 844]) {
    const mobile = [];
    for (const account of harness.manifest.accounts) {
      const context = await browser.newContext({ storageState: account.storageState, viewport: { width: 390, height }, hasTouch: true, isMobile: true });
      context.setDefaultTimeout(15_000);
      await context.addInitScript(() => {
        if (!['http:', 'https:'].includes(location.protocol)) return;
        localStorage.setItem('iva.portal.language', 'ru');
        localStorage.setItem('iva.district.table.preferences.v1', JSON.stringify({ textSize: 130, reduceMotion: true,
          sound: { enabled: false, master: 0, effects: 0, news: 0 }, newsNotices: false }));
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
      contexts.push(context); pages.push(page); mobile.push(page);
    }
    entry = await harness.reset('trade-draft');
    await Promise.all(mobile.map(async page => { await page.goto(entry.url); await expect(page.locator('.territory-match')).toBeVisible(); }));
    const receiver = mobile[entry.guestIndex], sender = mobile[entry.hostIndex];
    const offer = receiver.locator(`[data-offer-id="${entry.expected.offerId}"]`);
    const layout = await visibleSheet(receiver, '.ta-offers-panel', receiver.getByRole('button', { name: 'Свернуть сделки', exact: true }));
    await expectTradeArrowCentered(offer.locator('.ta-offer-terms'));
    for (const locator of [offer.locator('.ta-offer-terms'), ...['Принять', 'Другие условия', 'Отклонить'].map(name => offer.getByRole('button', { name, exact: true }))]) {
      await expect(locator).toBeInViewport({ ratio: 1 });
      assert.ok((await touchPoint(locator)).receivesPointer, 'Terms and all decisions must be visible together without internal scrolling');
    }
    await receiver.screenshot({ path: join(harness.directory, `offers-ru130-390x${height}.png`) });
    const untouched = await view(entry, entry.hostIndex);
    await nativeTap(sender, sender.getByRole('button', { name: 'Свернуть сделки', exact: true }));
    await expect(sender.locator('.ta-offers-panel')).toBeHidden();
    await expect(sender.getByRole('button', { name: 'Показать сделки', exact: true })).toContainText('1');
    const roadPoints = [];
    for (const id of [entry.expected.land, entry.expected.sea]) roadPoints.push({ id, ...await tapRoad(sender, id) });
    const afterCollapse = await view(entry, entry.hostIndex);
    assert.equal(afterCollapse.revision, untouched.revision);
    assert.deepEqual(afterCollapse.offers, untouched.offers);
    assert.deepEqual(afterCollapse.offerHistory, untouched.offerHistory);
    assert.deepEqual(afterCollapse.you.hand, untouched.you.hand);
    await sender.screenshot({ path: join(harness.directory, `offer-collapsed-roads-ru130-390x${height}.png`) });
    await nativeTap(sender, sender.getByRole('button', { name: 'Показать сделки', exact: true }));
    await expect(sender.locator('.ta-offers-panel')).toBeVisible();
    assert.equal((await view(entry, entry.hostIndex)).revision, untouched.revision);

    await nativeTap(receiver, offer.getByRole('button', { name: 'Другие условия', exact: true }));
    const trade = receiver.locator('.ta-trade-window'), closeTrade = receiver.getByRole('button', { name: 'Закрыть торговлю', exact: true });
    await visibleSheet(receiver, '.ta-trade-window', closeTrade);
    const addWood = receiver.getByRole('button', { name: 'Получаю + Древесина', exact: true });
    const endTrade = receiver.getByRole('button', { name: 'Отправить', exact: true });
    await expect(trade.getByRole('spinbutton')).toHaveCount(0);
    // On short screens, the sticky header remains reachable through real scrolling.
    let tradeBottom;
    if (height === 600) {
      for (let gesture = 0; gesture < 12; gesture++) {
        if (!await nativeSwipe(receiver, trade)) break;
        await visibleSheet(receiver, '.ta-trade-window', closeTrade);
      }
      tradeBottom = await scrollBounds(trade);
      assert.ok(tradeBottom.max - tradeBottom.top <= 1, 'Real touch must reach the trade scroll boundary');
      assert.ok((await touchPoint(endTrade)).receivesPointer, 'The trade submit must be reachable at the bottom of a short sheet');
    } else {
      assert.equal((await scrollBounds(trade)).max, 0, 'The normal-height mobile trade fits without scrolling');
    }
    let quantityGestures = 0;
    for (; !(await touchPoint(addWood)).receivesPointer && quantityGestures < 12; quantityGestures++) {
      const target = await touchPoint(addWood);
      const center = await trade.evaluate(element => {
        const box = element.getBoundingClientRect();
        const header = element.querySelector('.ta-trade-tabs').getBoundingClientRect();
        return (Math.max(box.top, header.bottom) + box.bottom) / 2;
      });
      const direction = target.y < center ? -1 : 1;
      assert.ok(await nativeSwipe(receiver, trade, { direction, distance: Math.max(35, Math.abs(target.y - center) + 20) }),
        'The quantity control must be reachable without scrolling beyond a content boundary');
      await visibleSheet(receiver, '.ta-trade-window', closeTrade);
    }
    await nativeTap(receiver, addWood);
    await expect(tradeCount(receiver, 'Получаю', 'wood')).toHaveText('2');
    await nativeTap(receiver, receiver.getByRole('button', { name: 'Получаю − Древесина', exact: true }));
    await expect(tradeCount(receiver, 'Получаю', 'wood')).toHaveText('1');
    await receiver.screenshot({ path: join(harness.directory, `trade-editor-ru130-390x${height}.png`) });
    await nativeTap(receiver, receiver.getByRole('button', { name: 'Банк', exact: true }));
    await expect(receiver.locator('.ta-bank')).toBeVisible();
    await visibleSheet(receiver, '.ta-trade-window', closeTrade);
    await nativeTap(receiver, closeTrade);
    await expect(trade).toBeHidden();
    await nativeTap(sender, sender.getByRole('button', { name: 'Свернуть сделки', exact: true }));
    const response = receiver.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/actions'));
    await nativeTap(receiver, offer.getByRole('button', { name: height === 600 ? 'Принять' : 'Отклонить', exact: true }));
    const answered = await response; assert.equal(answered.status(), 200);
    const outcome = (await answered.json()).view;
    assert.equal(outcome.offerHistory.find(item => item.id === entry.expected.offerId).status, height === 600 ? 'accepted' : 'declined');
    await expect(receiver.locator('.ta-offers-panel')).toBeHidden();
    await expect(sender.getByRole('button', { name: 'Показать сделки', exact: true })).toBeHidden();
    await expect(receiver.locator('.territory-player-trade')).toHaveCount(0);
    await expect(sender.locator('.territory-player-trade')).toHaveCount(0);
    // An empty or collapsed panel does not suppress a newly arriving offer.
    if (height === 844) await receiver.screenshot({ path: join(harness.directory, 'trade-closed-ru130-390x844.png') });
    const newOffer = await post(entry, entry.hostIndex, { type: 'offer', targetId: entry.expected.otherId, give: stock({ wood: 1 }), receive: stock({ brick: 1 }) });
    for (const page of [receiver, sender]) {
      await expect(page.locator('.ta-offers-panel')).toBeVisible();
      await expect(page.locator(`[data-offer-id="${newOffer.offers[0].id}"]`)).toBeVisible();
    }

    entry = await harness.reset('patrol');
    await Promise.all(mobile.map(page => page.goto(entry.url)));
    const cards = mobile[entry.hostIndex];
    await expect(cards.locator('.territory-match')).toBeVisible();
    await nativeTap(cards, cards.getByLabel('Карты развития', { exact: true }));
    const cardPanel = cards.locator('.ta-card-panel'), closeCards = cards.getByRole('button', { name: 'Закрыть карты развития', exact: true });
    await visibleSheet(cards, '.ta-card-panel', closeCards);
    let cardGestures = 0;
    for (; cardGestures < 3; cardGestures++) {
      if (!await nativeSwipe(cards, cardPanel)) break;
      await visibleSheet(cards, '.ta-card-panel', closeCards);
    }
    assert.ok(cardGestures > 0, 'The persistent Cards header must be checked after actual scrolling');
    await cards.screenshot({ path: join(harness.directory, `cards-scrolled-ru130-390x${height}.png`) });
    await nativeTap(cards, closeCards);
    await expect(cardPanel).toBeHidden();
    result.mobileLayouts.push({ width: 390, height, language: 'ru', textSize: 130, ...layout, roadPoints,
      controlsVisibleWithoutScroll: true, collapsePreservesState: true, nativeTouch: true, newOfferReopens: true, stickyHeadersAfterScroll: true,
      tradeBottom, quantityGestures, cardGestures });
    await Promise.all(mobile.map(page => page.goto('about:blank')));
  }
  passed('RU130 mobile offers keep terms and decisions together, collapse without a command, reopen for new offers and free the exact land/sea road touch targets');
  passed('RU130 mobile trade/cards stay below the active clock, edit quantities by native touch and keep Bank/close reachable after real scrolling');
  assert.deepEqual(errors, []);
  result.pageErrors = errors.length;
  result.status = 'passed';
  await writeFile(join(harness.directory, 'trade-browser-summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, directory: harness.directory }, null, 2));
} catch (error) {
  result.status = 'failed'; result.error = String(error); result.pageErrors = errors;
  await writeFile(join(harness.directory, 'trade-browser-summary.json'), JSON.stringify(result, null, 2) + '\n');
  for (const [index, page] of pages.entries()) await page.screenshot({ path: join(harness.directory, `trade-failure-${index}.png`) }).catch(() => {});
  console.error('Acceptance evidence: ' + harness.directory);
  throw error;
} finally {
  releaseHeldRequest?.();
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  if (browser) await browser.close();
  await harness.dispose();
}
