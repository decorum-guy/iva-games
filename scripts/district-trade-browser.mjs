/** Real HTTP/SQLite browser acceptance for the District trade and card interface.
 * Run after npm run build:portal. No game API is mocked and no external messages are sent.
 * A request is briefly held before forwarding; real offer/bank responses are dropped after commit.
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
      viewport: index ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: !!index });
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
  const handPage=pages[entry.hostIndex];
  await handPage.locator('.territory-hand').getByRole('button',{name:'Give Wood',exact:true}).click();
  const handEditor=handPage.locator('.ta-trade-editor');
  await expect(handEditor.getByRole('spinbutton',{name:'I give · Wood',exact:true})).toHaveValue('1');
  await handPage.locator('.territory-hand').getByRole('button',{name:'Give Wood',exact:true}).click();
  await expect(handEditor.getByRole('spinbutton',{name:'I give · Wood',exact:true})).toHaveValue('2');
  await handEditor.getByRole('button',{name:'I give − Wood',exact:true}).click();
  await expect(handEditor.getByRole('spinbutton',{name:'I give · Wood',exact:true})).toHaveValue('1');
  await handEditor.getByRole('button',{name:'Collapse',exact:true}).click();
  passed('clicking the real hand adds resources; clicking the selected resource removes one unit');
  const authorIndex = entry.hostIndex, receiverIndex = entry.guestIndex;
  const author = pages[authorIndex], receiver = pages[receiverIndex];
  await receiver.getByRole('button', { name: 'Counteroffer', exact: true }).click();
  await receiver.getByRole('spinbutton', { name: 'I give · Brick', exact: true }).fill('2');
  await receiver.getByRole('spinbutton', { name: 'I receive · Wood', exact: true }).fill('3');
  await action(author, author.getByRole('button', { name: 'End turn', exact: true }));
  const editor = receiver.locator('.ta-trade-editor');
  await expect(editor).toContainText('Closed: the turn ended');
  await expect(receiver.getByRole('spinbutton', { name: 'I give · Brick', exact: true })).toHaveValue('2');
  await expect(receiver.getByRole('spinbutton', { name: 'I receive · Wood', exact: true })).toHaveValue('3');
  await receiver.reload();
  await expect(editor).toContainText('Closed: the turn ended');
  await expect(receiver.getByRole('spinbutton', { name: 'I give · Brick', exact: true })).toHaveValue('2');
  await expect(receiver.getByRole('spinbutton', { name: 'I receive · Wood', exact: true })).toHaveValue('3');
  await expect(receiver.getByRole('button', { name: 'Send offer', exact: true })).toBeDisabled();
  await editor.locator('.ta-draft-heading').scrollIntoViewIfNeeded();
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
  await expect(receiver.getByRole('spinbutton', { name: 'I give · Brick', exact: true })).toHaveValue('2');
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
  await expect(receiver.locator(`[data-offer-id="${sent.id}"][data-offer-status="accepted"]`)).toContainText('Accepted · trade completed');
  await expect(author.locator('.ta-section-heading h4')).toBeFocused();
  passed('counteroffer survives turn expiry and reload, explicit lawful reuse, waits for real acknowledgement, exact accepted transfer on both clients');

  entry = await open('trade-draft');
  const counterPage = pages[entry.guestIndex], initialAuthorPage = pages[entry.hostIndex];
  await counterPage.getByRole('button', { name: 'Counteroffer', exact: true }).click();
  await counterPage.getByRole('spinbutton', { name: 'I give · Brick', exact: true }).fill('2');
  await counterPage.getByRole('spinbutton', { name: 'I receive · Wood', exact: true }).fill('3');
  const counterSent = await action(counterPage, counterPage.getByRole('button', { name: 'Send offer', exact: true }));
  const counter = counterSent.offers.find(offer => offer.authorId === entry.expected.otherId);
  assert.ok(counter);
  assert.equal(counter.parentId, entry.expected.offerId);
  assert.deepEqual(counter.give, stock({ brick: 2 })); assert.deepEqual(counter.receive, stock({ wood: 3 }));
  assert.equal(counterSent.offerHistory.find(offer => offer.id === entry.expected.offerId)?.status, 'replaced');
  await expect(counterPage.locator(`[data-offer-id="${entry.expected.offerId}"]`)).toContainText('Replaced by new terms');
  await expect(initialAuthorPage.locator(`[data-offer-id="${counter.id}"]`).getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  const beforeCounterAccepted = await view(entry, entry.hostIndex);
  const afterCounterAccepted = await action(initialAuthorPage, initialAuthorPage.locator(`[data-offer-id="${counter.id}"]`).getByRole('button', { name: 'Accept', exact: true }));
  assert.equal(afterCounterAccepted.you.hand.wood, beforeCounterAccepted.you.hand.wood - 3);
  assert.equal(afterCounterAccepted.you.hand.brick, beforeCounterAccepted.you.hand.brick + 2);
  await expect(counterPage.locator(`[data-offer-id="${counter.id}"]`)).toHaveAttribute('data-offer-status', 'accepted');
  passed('a live counteroffer retains parentId, replaces the original visibly and executes only after its chosen recipient accepts');

  entry = await open('trade-draft');
  const lostPage = pages[entry.hostIndex];
  await openTrade(lostPage);
  await lostPage.locator('.ta-trade-editor').getByLabel('Trade with', { exact: true }).selectOption(entry.expected.otherId);
  for (const resource of resources) {
    await lostPage.getByRole('spinbutton', { name: 'I give · ' + name(resource), exact: true }).fill(resource === 'wood' ? '2' : '0');
    await lostPage.getByRole('spinbutton', { name: 'I receive · ' + name(resource), exact: true }).fill(resource === 'brick' ? '1' : '0');
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
  await expect(pages[entry.hostIndex].locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveAttribute('data-offer-status', 'declined');
  passed('decline is visible to both parties');
  entry = await open('trade-draft');
  await action(pages[entry.hostIndex], pages[entry.hostIndex].getByRole('button', { name: 'Withdraw', exact: true }));
  await expect(pages[entry.guestIndex].locator(`[data-offer-id="${entry.expected.offerId}"]`)).toHaveAttribute('data-offer-status', 'withdrawn');
  passed('withdrawal is visible to both parties');

  entry = await open('trade-draft');
  await post(entry, entry.hostIndex, { type: 'offer', targetId: entry.expected.otherId, give: stock({ wood: 4 }), receive: stock({ brick: 1 }) });
  const bankPage = pages[entry.hostIndex], recipientPage = pages[entry.guestIndex];
  await bankPage.reload();
  await openTrade(bankPage);
  await bankPage.getByRole('button', { name: 'Bank', exact: true }).click();
  const bankBefore = await view(entry, entry.hostIndex);
  await bankPage.locator('.ta-bank').getByLabel('I receive', { exact: true }).selectOption('grain');
  const rate = bankBefore.legal.bank.wood;
  const exchanged = await action(bankPage, bankPage.locator('.ta-bank').getByRole('button', { name: `Exchange ${rate} → 1`, exact: true }));
  assert.equal(exchanged.you.hand.wood, bankBefore.you.hand.wood - rate);
  assert.equal(exchanged.you.hand.grain, bankBefore.you.hand.grain + 1);
  await expect(bankPage.locator('.ta-bank')).toContainText('Exchange completed');
  await expect(recipientPage.locator('.ta-offer:not(.is-closed)').getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
  await expect(recipientPage.locator('.ta-offer:not(.is-closed)')).toContainText('The sender no longer has the required resources');
  passed('bank transfer has visible receipt and exact quantities; stale sender resource offer cannot be accepted');

  entry = await open('trade-draft');
  const lostBankPage = pages[entry.hostIndex];
  await openTrade(lostBankPage);
  await lostBankPage.getByRole('button', { name: 'Bank', exact: true }).click();
  await lostBankPage.locator('.ta-bank').getByLabel('I receive', { exact: true }).selectOption('grain');
  const lostBankBefore = await view(entry, entry.hostIndex);
  const lostBankRate = lostBankBefore.legal.bank.wood;
  const lostBankPattern = `**/api/platform/v1/rooms/${entry.roomId}/actions`;
  let bankResponseLost = false, committedBankView;
  await lostBankPage.route(lostBankPattern, async route => {
    if (!bankResponseLost && route.request().postDataJSON()?.payload?.type === 'bank') {
      bankResponseLost = true;
      const serverResponse = await route.fetch();
      assert.equal(serverResponse.ok(), true);
      committedBankView = (await serverResponse.json()).view;
      await route.abort('connectionclosed');
    } else await route.continue();
  });
  await lostBankPage.locator('.ta-bank').getByRole('button', { name: `Exchange ${lostBankRate} → 1`, exact: true }).click();
  await expect(lostBankPage.locator('.territory-notice').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(lostBankPage.locator('.ta-bank')).toContainText('Exchange completed');
  assert.ok(committedBankView);
  assert.equal(committedBankView.you.hand.wood, lostBankBefore.you.hand.wood - lostBankRate);
  assert.equal(committedBankView.you.hand.grain, lostBankBefore.you.hand.grain + 1);
  const replayedBank = await action(lostBankPage, lostBankPage.locator('.territory-notice').getByRole('button', { name: 'Retry', exact: true }));
  assert.equal(replayedBank.revision, committedBankView.revision);
  assert.deepEqual((await view(entry, entry.hostIndex)).you.hand, committedBankView.you.hand);
  await expect(lostBankPage.locator('.ta-bank')).not.toContainText('The exchange was not confirmed');
  await lostBankPage.unroute(lostBankPattern);
  passed('lost bank response recovers the receipt from explicit server history; Retry cannot execute the exchange twice');

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
