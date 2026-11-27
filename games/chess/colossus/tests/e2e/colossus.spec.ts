import type { CommandEnvelope, CommandResponse } from '../../src/online/protocol';
import {
  activate, audioNames, beginHunt, board, cell, commands, continueLocal, expect, fitsViewport,
  guard, heardCue, installAudioProbe, lesson, menu, mobileIntent, move, nextLesson, openEnglish,
  openTutorial, playCard, response, strike, test,
} from './helpers';

// Game state is created and changed only through public controls. Network tests
// drop one real committed acknowledgement; audio probes observe native Web Audio.
// Typechecking or listing these tests is not evidence of browser execution.

test('2D movement, cards, mute and saves work at the current viewport', async ({ page }) => {
  await installAudioProbe(page);
  await openEnglish(page);
  await expect(page.locator('.boss-choices > button')).toHaveCount(3);
  await expect(page.locator('.boss-choices')).not.toContainText('Warden');
  await beginHunt(page);
  await fitsViewport(page);
  await move(page, 'a1', 'a4');
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook 4\/4 HP/);
  await heardCue(page, 'move');
  await playCard(page, 'stone-skin', 'e1');
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /Shield 2/);
  await expect(page.locator('.focus-resource b')).toHaveText('2');
  await expect(commands(page)).toHaveCount(2);
  await expect(page.locator('.hand-cards [data-card]')).toHaveCount(2);
  await heardCue(page, 'card');
  await heardCue(page, 'shield');

  await activate(page.locator('.top-rail').getByRole('button', { name: 'Sound', exact: true }));
  const soundsBefore = await audioNames(page);
  await guard(page, 'g1');
  await expect(commands(page)).toHaveCount(1);
  // Negative observation covers all delayed cue offsets from a simple guard.
  await page.waitForTimeout(350);
  expect(await audioNames(page)).toEqual(soundsBefore);

  await page.reload();
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook 4\/4 HP/);
  await expect(cell(page, 'a1')).not.toHaveAttribute('aria-label', /Rook/);
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /Shield 2/);
  await expect(cell(page, 'g1')).toHaveAttribute('aria-label', /Already activated/);
  await expect(page.locator('.focus-resource b')).toHaveText('2');
  await expect(commands(page)).toHaveCount(1);
  await expect(page.locator('.hand-cards [data-card="stone-skin"]')).toHaveCount(0);
  await expect(page.locator('.top-rail').getByRole('button', { name: 'Muted', exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
  await fitsViewport(page);
});

test('practice editing and an interrupted lesson preserve the ordinary hunt', async ({ page }) => {
  await openEnglish(page);
  await beginHunt(page);
  await move(page, 'a1', 'a4');
  await menu(page);
  await activate(page.locator('.mode-tabs').getByRole('button', { name: 'Practice', exact: true }));
  await beginHunt(page);
  await move(page, 'a1', 'a3');
  await mobileIntent(page, true);
  await activate(page.getByRole('button', { name: 'Position editor', exact: true }));
  const editor = page.getByRole('dialog', { name: 'Position editor', exact: true });
  await editor.getByLabel('Armor', { exact: true }).fill('5');
  await activate(editor.getByRole('button', { name: 'Apply changes', exact: true }));
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '5');

  await menu(page);
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '12');
  await openTutorial(page);
  await expect(lesson(page)).toContainText('Read the intention');
  await expect(board(page).locator('.flat-boss-footprint[data-boss="sentinel"]')).toBeVisible();
  await menu(page);
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
  await expect(commands(page)).toHaveCount(2);

  await page.reload();
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
  await menu(page);
  await continueLocal(page, 'Practice');
  await expect(cell(page, 'a3')).toHaveAttribute('aria-label', /^a3, Rook /);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '5');
});

test('seven Warden lessons finish with a real promotion and victory, then restore the hunt', async ({ page }) => {
  await installAudioProbe(page);
  await openEnglish(page);
  await beginHunt(page);
  await move(page, 'a1', 'a4');
  await openTutorial(page);

  await expect(lesson(page)).toContainText('Read the intention');
  await expect(page.locator('.end-button')).toBeDisabled();
  await fitsViewport(page);
  await move(page, 'e1', 'd1');
  await response(page);
  await expect(cell(page, 'd1')).toHaveAttribute('aria-label', /^d1, King 20\/20 HP/);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Break the armor');
  await strike(page, 'a6', 'd6');
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '12');
  await heardCue(page, 'armor-break');
  await strike(page, 'c5', 'd6');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '9');
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Strike and retreat');
  await strike(page, 'f5', 'd6');
  await expect(page.locator('.target-instruction')).toContainText('Choose the knight’s retreat');
  await activate(cell(page, 'e4'));
  await expect(cell(page, 'e4')).toHaveAttribute('aria-label', /^e4, Knight /);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Ray or fire');
  await response(page);
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /^e1, King 20\/20 HP/);
  await expect(cell(page, 'e2')).not.toHaveAttribute('aria-label', /Pawn/);
  await heardCue(page, 'capture');
  await nextLesson(page, 'Compare with fire');
  await response(page);
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /^e1, King 19\/20 HP/);
  await expect(cell(page, 'e2')).toHaveAttribute('aria-label', /^e2, Pawn 1\/2 HP/);
  await heardCue(page, 'fire');
  await nextLesson(page);

  await expect(lesson(page)).toContainText('A shield is consumed');
  await guard(page, 'e2');
  await response(page);
  await expect(cell(page, 'e2')).toHaveAttribute('aria-label', /^e2, Pawn 1\/2 HP/);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('A protective card');
  await playCard(page, 'marble-vow', 'e1');
  await expect(page.locator('.focus-resource b')).toHaveText('0');
  await expect(commands(page)).toHaveCount(3);
  await heardCue(page, 'card');
  await response(page);
  await expect(cell(page, 'e1')).toHaveAttribute('aria-label', /Invulnerability/);
  await expect(page.locator('.flat-army-layer .unit-health em').filter({ hasText: '◇1' })).toHaveCount(1);
  await nextLesson(page);

  await expect(lesson(page)).toContainText('Promotion and victory');
  await move(page, 'c7', 'c8');
  const promotion = page.getByRole('dialog', { name: 'Pawn promotion', exact: true });
  await expect(promotion).toBeVisible();
  await activate(promotion.getByRole('button', { name: 'Queen', exact: true }));
  await expect(cell(page, 'c8')).toHaveAttribute('aria-label', /^c8, Queen 2\/6 HP/);
  await heardCue(page, 'promotion-queen');
  await response(page);
  await mobileIntent(page, true);
  await expect(page.locator('.rest-copy')).toBeVisible();
  await strike(page, 'c8', 'd7');
  await expect(page.getByRole('meter', { name: 'Health', exact: true })).toHaveAttribute('aria-valuenow', '0');
  await expect(lesson(page)).toContainText('Victory!');
  await heardCue(page, 'victory');
  await nextLesson(page, 'Begin hunt');

  await expect(lesson(page)).toHaveCount(0);
  await expect(page.locator('.boss-heading h1')).toHaveText('The Stone Regent');
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
  await expect(commands(page)).toHaveCount(2);
  await expect(page.getByRole('meter', { name: 'Armor', exact: true })).toHaveAttribute('aria-valuenow', '12');
  await fitsViewport(page);
  await activate(page.getByRole('button', { name: 'Settings', exact: true }));
  await activate(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Records', exact: true }));
  await expect(page.locator('.records-list article')).toHaveCount(0);
  await activate(page.getByRole('dialog', { name: 'Records', exact: true }).getByRole('button', { name: 'Close / Закрыть', exact: true }));
  await page.reload();
  await continueLocal(page);
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
});

test('keyboard navigation and RU/EN changes preserve the current position', async ({ page }) => {
  await openEnglish(page);
  await beginHunt(page);
  await cell(page, 'e1').focus();
  await page.keyboard.press('Home');
  await expect(cell(page, 'a1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(page, 'a1')).toHaveAttribute('aria-selected', 'true');
  for (let step = 0; step < 3; step++) await page.keyboard.press('ArrowUp');
  await expect(cell(page, 'a4')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Rook /);
  await activate(page.locator('.language-switch'));
  await expect(cell(page, 'a4')).toHaveAttribute('aria-label', /^a4, Ладья /);
  await expect(commands(page)).toHaveCount(2);
  const settings = page.getByRole('button', { name: 'Настройки', exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Настройки', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  await fitsViewport(page);
});

test('local commanders share commands and consent before ending an unused round', async ({ page }) => {
  await openEnglish(page);
  await activate(page.locator('.mode-tabs').getByRole('button', { name: 'Two commanders', exact: true }));
  await beginHunt(page);
  await guard(page, 'a1');
  await expect(page.locator('.coop-bar .segmented .active')).toHaveText('B');
  await guard(page, 'd1');
  await expect(page.locator('.coop-bar .segmented .active')).toHaveText('A');
  await guard(page, 'g1');
  await expect(commands(page)).toHaveCount(0);
  await response(page);
  await expect(page.locator('.round-counter > b')).toHaveText('2/24');
  await expect(page.locator('.coop-bar .segmented .active')).toHaveText('B');
  await response(page);
  await expect(page.locator('.round-counter > b')).toHaveText('2/24');
  await expect(page.locator('.coop-bar')).toContainText('The other commander must agree');
  await expect(page.locator('.coop-bar .segmented .active')).toHaveText('A');
  await response(page);
  await expect(page.locator('.round-counter > b')).toHaveText('3/24');
  await fitsViewport(page);
});

test('independent online commanders recover a lost ACK without repeating the action', async ({ browser, baseURL }) => {
  const { viewport, isMobile, hasTouch, deviceScaleFactor, userAgent } = test.info().project.use;
  const first = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  const second = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent });
  const errors: string[] = [];
  try {
    const a = await first.newPage(), b = await second.newPage();
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([openEnglish(a), openEnglish(b)]);
    await activate(a.locator('.mode-tabs').getByRole('button', { name: 'Two commanders', exact: true }));
    await activate(a.locator('.coop-choice').getByRole('button', { name: 'Online', exact: true }));
    await activate(a.getByRole('button', { name: 'Create room', exact: true }));
    const invitation = a.getByRole('dialog', { name: 'Invitation', exact: true });
    await expect(invitation).toBeVisible();
    const link = await invitation.getByRole('textbox', { name: 'Invitation', exact: true }).inputValue();
    expect(new URL(link).searchParams.has('invite')).toBe(true);
    const room = new URL(link).searchParams.get('room');

    await activate(b.getByRole('button', { name: 'Join · Online', exact: true }));
    const join = b.getByRole('dialog', { name: 'Join', exact: true });
    await join.getByLabel('Your name', { exact: true }).fill('Test commander B');
    await join.getByLabel('Invitation link', { exact: true }).fill(link);
    await activate(join.getByRole('button', { name: 'Join', exact: true }));
    await activate(invitation.getByRole('button', { name: 'Close / Закрыть', exact: true }));
    await expect(board(b)).toBeVisible();
    await expect(a.locator('.online-banner')).toHaveCount(0);
    const ca = (await first.cookies()).find(cookie => cookie.name === 'colossus_guest');
    const cb = (await second.cookies()).find(cookie => cookie.name === 'colossus_guest');
    expect(Boolean(ca && cb && ca.value !== cb.value && ca.httpOnly && cb.httpOnly)).toBe(true);

    const envelopes: CommandEnvelope[] = [];
    let committed: CommandResponse | undefined;
    await a.route(/\/api\/colossus\/rooms\/[^/]+\/commands$/, async route => {
      envelopes.push(route.request().postDataJSON() as CommandEnvelope);
      if (envelopes.length === 1) {
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        committed = await actual.json() as CommandResponse;
        await route.abort('failed');
      } else await route.continue();
    });
    await guard(a, 'a1');
    await expect(a.getByRole('button', { name: 'Retry sending', exact: true })).toBeVisible();
    await expect(b.locator('.coop-bar')).toContainText('Your command');
    await guard(b, 'd1');
    await expect(commands(a)).toHaveCount(1);
    await activate(a.getByRole('button', { name: 'Retry sending', exact: true }));
    await expect(a.locator('.toast')).toHaveCount(0);
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toEqual(envelopes[0]);
    expect(committed?.snapshot.state.secret).toBeNull();
    expect(JSON.stringify(committed)).not.toMatch(/"(?:runSeed|playerDeck|bossDeck)"/);
    for (const page of [a, b]) await expect(commands(page)).toHaveCount(1);

    await guard(a, 'g1');
    for (const page of [a, b]) await expect(commands(page)).toHaveCount(0);
    await expect(b.locator('.end-button')).toBeDisabled();
    await response(a);
    for (const page of [a, b]) await expect(page.locator('.round-counter > b')).toHaveText('2/24');
    const position = await board(a).getByRole('gridcell').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    const hand = await a.locator('.hand-cards [data-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-card')));

    await Promise.all([a.reload(), b.reload()]);
    for (const page of [a, b]) {
      await expect(board(page)).toBeVisible();
      await expect(page.locator('.round-counter > b')).toHaveText('2/24');
      await expect(page.locator('.online-banner')).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('room')).toBe(room);
      expect(await board(page).getByRole('gridcell').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(position);
      expect(await page.locator('.hand-cards [data-card]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-card')))).toEqual(hand);
    }
    await expect(b.locator('.coop-bar')).toContainText('Your command');
    await guard(b, 'd1');
    for (const page of [a, b]) await expect(commands(page)).toHaveCount(2);
    await expect(a.locator('.coop-bar')).toContainText('Your command');

    // Menu keeps the resumable room. Entering the isolated lesson explicitly
    // leaves it; a reload must not silently reconnect to the prior match.
    await menu(a);
    expect(new URL(a.url()).searchParams.get('room')).toBe(room);
    await activate(a.locator('.tutorial-invitation'));
    await expect(lesson(a)).toContainText('Read the intention');
    await expect(a.locator('.boss-heading h1')).toHaveText('The Warden');
    expect(new URL(a.url()).searchParams.has('room')).toBe(false);
    expect(new URL(a.url()).searchParams.has('invite')).toBe(false);
    const roomRequestsAfterLesson: string[] = [];
    a.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/colossus/rooms/')) roomRequestsAfterLesson.push(request.method());
    });
    await a.reload();
    await expect(a.locator('.setup-screen')).toBeVisible();
    await a.waitForLoadState('networkidle');
    await expect(a.locator('.coop-bar')).toHaveCount(0);
    await expect(a.locator('.online-banner')).toHaveCount(0);
    expect(roomRequestsAfterLesson).toEqual([]);
    expect(new URL(a.url()).searchParams.has('room')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
