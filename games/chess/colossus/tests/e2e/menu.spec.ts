import type { Locator, Page } from '@playwright/test';
import { activate, board, expect, openEnglish, test } from './helpers';

// Exercise public controls and inspect the browser's layout/animations. No game
// state, focus state or animation state is replaced by the test.
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeEnabled();
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!hit && element.contains(hit);
  }), { message: 'The control must receive a real pointer at its visible center' }).toBe(true);
}

async function noPageOverflow(page: Page) {
  const bounds = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    setupWidth: document.querySelector('.setup-screen')!.clientWidth,
    setupScrollWidth: document.querySelector('.setup-screen')!.scrollWidth,
  }));
  expect(bounds.scrollWidth, 'No horizontal page overflow').toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.scrollHeight, 'The menu scrolls inside its viewport').toBeLessThanOrEqual(bounds.height + 1);
  expect(bounds.setupScrollWidth, 'No horizontal menu overflow').toBeLessThanOrEqual(bounds.setupWidth + 1);
}

async function difficultyHasRoom(page: Page) {
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    return {
      label: rect('label[for="colossus-difficulty"]'),
      select: rect('#colossus-difficulty'),
      helper: rect('#colossus-difficulty-description'),
      extras: rect('.setup-extras'),
    };
  });
  expect(bounds.select.top - bounds.label.bottom, 'Label stays above the field').toBeGreaterThanOrEqual(4);
  expect(bounds.helper.top - bounds.select.bottom, 'Helper stays below the focused field').toBeGreaterThanOrEqual(4);
  expect(bounds.helper.height, 'Helper has its own layout space').toBeGreaterThan(14);
  expect(bounds.extras.top - bounds.helper.bottom, 'The following controls do not cover the helper').toBeGreaterThanOrEqual(4);
}

async function controlPaint(control: Locator) {
  return control.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, image: style.backgroundImage, border: style.borderColor, shadow: style.boxShadow };
  });
}

test('menu preserves native pointer focus, accessible keyboard focus and clear mode actions at 130% text', async ({ page }) => {
  await openEnglish(page);
  const language = page.locator('.language-switch');
  await activate(language);
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
  await activate(language);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.addStyleTag({ content: 'html { font-size: 130%; }' });
  const setup = page.locator('.setup-screen');
  const difficulty = page.getByRole('combobox', { name: 'Difficulty', exact: true });
  const helper = page.locator('#colossus-difficulty-description');
  await expect(difficulty).toHaveAttribute('aria-describedby', 'colossus-difficulty-description');

  // Opening and closing the native picker must not blur it or fabricate a
  // keyboard ring. selectOption emits input/change events for the option choice.
  await activate(difficulty);
  await page.keyboard.press('Escape');
  await difficulty.selectOption('initiate');
  await expect(difficulty).toHaveValue('initiate');
  await expect(difficulty).toBeFocused();
  await expect(setup).toHaveAttribute('data-focus-modality', 'pointer');
  await expect(difficulty).toHaveCSS('outline-style', 'none');
  await expect(helper).toContainText('4 commands per round');
  await difficultyHasRoom(page);

  await page.keyboard.press('Tab');
  await expect(page.locator('.boss-cards-option input')).toBeFocused();
  await expect(setup).toHaveAttribute('data-focus-modality', 'keyboard');
  await page.keyboard.press('Shift+Tab');
  await expect(difficulty).toBeFocused();
  await expect(difficulty).toHaveCSS('outline-style', 'solid');
  await expect(difficulty).toHaveCSS('outline-offset', '-4px');
  await difficultyHasRoom(page);

  const opponents = page.locator('.boss-choices > button');
  expect(await opponents.count()).toBeGreaterThan(1);
  const chosenBoss = opponents.last();
  await activate(chosenBoss);
  await expect(chosenBoss).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.boss-choices > button[aria-pressed="true"]')).toHaveCount(1);
  await expect(chosenBoss.locator('.selection-check')).toHaveText('✓');
  expect(await controlPaint(chosenBoss), 'Selected boss has a distinct border/background treatment')
    .not.toEqual(await controlPaint(opponents.first()));

  const modes = page.locator('.mode-tabs');
  const start = page.getByTestId('start-game');
  for (const [mode, action] of [
    ['Hunt', 'Begin hunt'], ['Campaign', 'Begin campaign'],
    ['Two commanders', 'Play together'], ['Practice', 'Open practice'],
  ]) {
    const selected = modes.getByRole('button', { name: mode, exact: true });
    await activate(selected);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(selected.locator('.mode-check')).toHaveText('✓');
    const other = modes.getByRole('button', { name: mode === 'Hunt' ? 'Practice' : 'Hunt', exact: true });
    expect(await controlPaint(selected), 'Selected mode remains distinct after pointer activation')
      .not.toEqual(await controlPaint(other));
    await expect(start).toHaveText(action);
    await reachable(start);
    await difficultyHasRoom(page);
    await noPageOverflow(page);
    if (mode === 'Two commanders') {
      await activate(page.locator('.coop-choice').getByRole('button', { name: 'Online', exact: true }));
      await expect(start).toHaveText('Create room');
      await reachable(start);
      await activate(page.locator('.coop-choice').getByRole('button', { name: 'On one device', exact: true }));
      await expect(start).toHaveText('Play together');
    }
  }
  await activate(start);
  await expect(board(page)).toBeVisible();
  await expect(page.locator('.mode-caption')).toContainText('Practice · Initiation');
});

async function fixedControls(dialog: Locator) {
  return dialog.evaluate(element => ['header', '[data-testid="bestiary-selector"]', '[data-testid="bestiary-previous"]', '[data-testid="bestiary-next"]', 'header button'].map(selector => {
    const rect = element.querySelector(selector)!.getBoundingClientRect();
    return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
}

async function expectFixed(dialog: Locator, original: Awaited<ReturnType<typeof fixedControls>>) {
  const current = await fixedControls(dialog);
  for (let index = 0; index < original.length; index++) for (const dimension of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(current[index][dimension] - original[index][dimension]), `${original[index].selector}: fixed ${dimension}`)
      .toBeLessThanOrEqual(1);
  }
}

test('bestiary keeps top controls fixed through scrolling, every boss, wrapping and keyboard navigation', async ({ page }) => {
  await openEnglish(page);
  const opponents = page.locator('.boss-choices > button');
  const roster = await opponents.evaluateAll(buttons => buttons.map(button => ({
    id: button.querySelector('.boss-icon')!.getAttribute('data-boss')!,
    name: button.querySelector(':scope > span')!.textContent!,
  })));
  expect(roster.length).toBeGreaterThan(1);
  expect(new Set(roster.map(boss => boss.id)).size).toBe(roster.length);
  expect(roster.map(boss => boss.id)).not.toContain('sentinel');
  await activate(opponents.last());
  const opener = page.getByRole('button', { name: 'Bestiary', exact: true });
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Bestiary', exact: true });
  const browser = dialog.getByTestId('bestiary-browser');
  const next = dialog.getByTestId('bestiary-next');
  const previous = dialog.getByTestId('bestiary-previous');
  const details = dialog.getByTestId('bestiary-details');
  const close = dialog.getByRole('button', { name: 'Close / Закрыть', exact: true });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(browser).toHaveAttribute('data-reduced-motion', 'true');
  const original = await fixedControls(dialog);

  const selectedBoss = async (index: number) => {
    await expect(browser).toHaveAttribute('data-boss', roster[index].id);
    await expect(dialog.getByTestId('bestiary-position')).toHaveText(`${index + 1}/${roster.length}`);
    await expect(dialog.getByRole('heading', { name: roster[index].name, exact: true })).toBeVisible();
    await expect(dialog.locator('header h2')).toHaveText('Bestiary');
    await expectFixed(dialog, original);
  };
  await selectedBoss(roster.length - 1);
  await details.focus();
  await expect(details).toBeFocused();
  expect(await details.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await page.keyboard.press('End');
  await expect.poll(() => details.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop),
    { message: 'End reaches the bottom of the focused details pane' }).toBeLessThanOrEqual(1);
  await page.keyboard.press('Home');
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBe(0);
  await expectFixed(dialog, original);
  await reachable(next);
  await reachable(close);

  await activate(next);
  await selectedBoss(0);
  await expect(browser).toHaveAttribute('data-direction', 'next');
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBe(0);
  await activate(previous);
  await selectedBoss(roster.length - 1);
  await expect(browser).toHaveAttribute('data-direction', 'previous');
  // The shortcut also works while focus is on the Modal's close control.
  await close.focus();
  await page.keyboard.press('ArrowRight');
  await selectedBoss(0);
  await expect(close).toBeFocused();
  for (let index = 1; index < roster.length; index++) {
    await activate(next);
    await selectedBoss(index);
  }

  // A card is removed on navigation; focus must transfer to the stable arrow.
  await dialog.locator('.bestiary-cards [data-card]').first().focus();
  await page.keyboard.press('ArrowRight');
  await selectedBoss(0);
  await expect(next).toBeFocused();
  await expect.poll(() => details.evaluate(element => element.scrollTop)).toBe(0);
  await page.keyboard.press('ArrowLeft');
  await selectedBoss(roster.length - 1);
  await expect(dialog.locator('.bestiary-portrait-in')).toHaveCSS('animation-name', 'none');

  const bounds = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight,
      regions: [element, element.querySelector('[data-testid="bestiary-selector"]')!, element.querySelector('[data-testid="bestiary-details"]')!]
        .map(region => ({ width: region.clientWidth, scrollWidth: region.scrollWidth })),
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
  for (const region of bounds.regions) expect(region.scrollWidth).toBeLessThanOrEqual(region.width + 1);
  await noPageOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

interface MotionRecord {
  name: string;
  direction: string;
  kind: 'in' | 'out';
  duration: number;
  fromX: number;
  toX: number | null;
  ended: boolean;
}
type MotionWindow = Window & { __colossusMenuMotion?: MotionRecord[] };

async function reduceMotion(page: Page, value: boolean) {
  await activate(page.getByRole('button', { name: 'Settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('checkbox', { name: 'Reduce motion', exact: true }).setChecked(value);
  await activate(dialog.getByRole('button', { name: 'Close / Закрыть', exact: true }));
}

test('bestiary renders both slide directions and stops CSS animations when motion is reduced', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'The full viewport matrix is covered above; native CSS motion is observed once.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openEnglish(page);
  await reduceMotion(page, false);
  // Observe native CSS events and actual matrices without pausing, seeking,
  // replacing or extending animations to make the assertions pass.
  await page.evaluate(() => {
    const records: MotionRecord[] = [];
    const active = new WeakMap<Element, MotionRecord>();
    (window as MotionWindow).__colossusMenuMotion = records;
    document.addEventListener('animationstart', event => {
      const element = event.target;
      if (!(element instanceof HTMLElement) || !element.matches('.bestiary-portrait-in, .bestiary-portrait-out')) return;
      const style = getComputedStyle(element);
      const record: MotionRecord = {
        name: event.animationName,
        direction: element.closest<HTMLElement>('[data-testid="bestiary-browser"]')!.dataset.direction!,
        kind: element.classList.contains('bestiary-portrait-in') ? 'in' : 'out',
        duration: parseFloat(style.animationDuration) * 1_000,
        fromX: style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m41,
        toX: null,
        ended: false,
      };
      records.push(record);
      active.set(element, record);
    });
    document.addEventListener('animationend', event => {
      if (!(event.target instanceof HTMLElement)) return;
      const record = active.get(event.target);
      if (record) {
        const transform = getComputedStyle(event.target).transform;
        record.toX = transform === 'none' ? 0 : new DOMMatrix(transform).m41;
        record.ended = true;
      }
    });
  });
  const open = () => activate(page.getByRole('button', { name: 'Bestiary', exact: true }));
  await open();
  const browser = page.getByTestId('bestiary-browser');
  await expect(browser).toHaveAttribute('data-reduced-motion', 'false');
  for (const [step, direction] of ['next', 'previous'].entries()) {
    await activate(page.getByTestId(`bestiary-${direction}`));
    await expect.poll(() => page.evaluate(() => (window as MotionWindow).__colossusMenuMotion!.filter(record => record.ended).length),
      { message: 'Both native portrait animations must finish' }).toBe((step + 1) * 2);
    const records = await page.evaluate(() => (window as MotionWindow).__colossusMenuMotion!);
    const incoming = records.find(record => record.direction === direction && record.kind === 'in')!;
    const outgoing = records.find(record => record.direction === direction && record.kind === 'out')!;
    expect(incoming.name).toBe('bestiary-enter');
    expect(outgoing.name).toBe('bestiary-exit');
    for (const record of [incoming, outgoing]) {
      expect(record.duration).toBeGreaterThanOrEqual(120);
      expect(record.duration).toBeLessThanOrEqual(600);
      expect(Math.abs(record.toX! - record.fromX), 'The rendered portrait actually translated').toBeGreaterThan(4);
    }
    const sign = direction === 'next' ? 1 : -1;
    expect(incoming.fromX * sign, 'The new boss enters from the chosen side').toBeGreaterThan(4);
    expect(Math.abs(incoming.toX!)).toBeLessThan(1);
    expect(outgoing.toX! * -sign, 'The old boss leaves through the opposite side').toBeGreaterThan(4);
  }
  await page.keyboard.press('Escape');
  await reduceMotion(page, true);
  await open();
  await expect(browser).toHaveAttribute('data-reduced-motion', 'true');
  await activate(page.getByTestId('bestiary-next'));
  await expect(browser.locator('.bestiary-portrait-in')).toHaveCSS('animation-name', 'none');
  await expect(browser.locator('.bestiary-detail-in')).toHaveCSS('animation-name', 'none');
  await expect(browser.locator('.bestiary-portrait-out')).toHaveCSS('display', 'none');
  expect(await browser.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  expect(await page.evaluate(() => (window as MotionWindow).__colossusMenuMotion!.length)).toBe(4);
});
