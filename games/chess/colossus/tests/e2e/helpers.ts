import { expect, test as base } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'uncaught browser JavaScript errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
export const board = (page: Page) => page.getByTestId('board-2d');
export const cell = (page: Page, square: string) => board(page).locator(`[data-square="${square}"]`);
export const lesson = (page: Page) => page.locator('.tutorial-banner');
export const commands = (page: Page) => page.locator('.command-resource .full');

export async function activate(locator: Locator) {
  if (test.info().project.use.hasTouch) await locator.tap();
  else await locator.click();
}
export async function mobileIntent(page: Page, expanded: boolean) {
  const toggle = page.locator('.intent-mobile-toggle');
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded') === 'true') !== expanded) await activate(toggle);
}
export async function openEnglish(page: Page, view: '2d' | '3d' = '2d') {
  await page.goto('/colossus/');
  await expect(page.locator('.setup-screen')).toBeVisible();
  if (await page.locator('.language-switch').textContent() === 'EN') await activate(page.locator('.language-switch'));
  await activate(page.getByRole('button', { name: 'Settings', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await activate(dialog.getByRole('button', { name: view.toUpperCase(), exact: true }));
  await dialog.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check();
  await activate(dialog.getByRole('button', { name: 'Close / Закрыть', exact: true }));
}
export async function beginHunt(page: Page, view: '2d' | '3d' = '2d') {
  await activate(page.getByTestId('start-game'));
  await expect(page.getByTestId('board-' + view)).toBeVisible();
}
export async function move(page: Page, from: string, to: string) {
  await mobileIntent(page, false);
  await activate(cell(page, from));
  await expect(cell(page, from)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, to)).toHaveClass(/\blegal\b/);
  await activate(cell(page, to));
}
export async function guard(page: Page, square: string) {
  await mobileIntent(page, false);
  await activate(cell(page, square));
  const button = page.locator('.piece-actions').getByRole('button', { name: 'Guard', exact: true });
  await expect(button).toBeEnabled();
  await activate(button);
}
export async function strike(page: Page, from: string, target: string) {
  await mobileIntent(page, false);
  await activate(cell(page, from));
  await activate(page.locator('.piece-actions').getByRole('button', { name: 'Strike', exact: true }));
  await expect(cell(page, target)).toHaveClass(/\battack-target\b/);
  await activate(cell(page, target));
}
export async function playCard(page: Page, id: string, target: string) {
  await mobileIntent(page, false);
  await activate(page.locator(`.hand-cards [data-card="${id}"]`));
  const targetCell = cell(page, target);
  await expect(targetCell).toBeVisible();
  await expect.poll(() => targetCell.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      receivesPointer: hit !== null && element.contains(hit),
      hitElement: hit?.tagName.toLowerCase() ?? 'outside viewport',
      hitClass: hit?.getAttribute('class') ?? '',
    };
  }), { message: `Card ${id}: target ${target} must remain reachable without an overlapping panel` })
    .toMatchObject({ receivesPointer: true });
  await activate(targetCell);
  await activate(page.locator('.card-target-panel').getByRole('button', { name: 'Apply', exact: true }));
}
export async function menu(page: Page) {
  await activate(page.locator('.top-rail').getByRole('button', { name: 'Menu', exact: true }));
  await expect(page.locator('.setup-screen')).toBeVisible();
}
export async function continueLocal(page: Page, mode: 'Hunt' | 'Practice' = 'Hunt') {
  await activate(page.locator('.mode-tabs').getByRole('button', { name: mode, exact: true }));
  await activate(page.locator('.start-actions').getByRole('button', { name: 'Continue', exact: true }));
  await expect(board(page)).toBeVisible();
}
export async function openTutorial(page: Page) {
  await activate(page.getByRole('button', { name: 'Rules', exact: true }));
  await activate(page.getByRole('dialog', { name: 'Rules', exact: true }).getByRole('button', { name: 'Replay tutorial', exact: true }));
  await expect(lesson(page)).toBeVisible();
  await expect(page.locator('.boss-heading h1')).toHaveText('The Warden');
}
export async function nextLesson(page: Page, name = 'Continue') {
  const button = lesson(page).getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  await activate(button);
}
export async function response(page: Page) {
  const button = page.locator('.end-button');
  await expect(button).toBeEnabled();
  await activate(button);
}
export async function fitsViewport(page: Page) {
  const measures = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, board: bounds('[data-testid="board-2d"]'), response: bounds('.end-button') };
  });
  expect(measures.scrollWidth).toBeLessThanOrEqual(measures.width + 1);
  expect(measures.scrollHeight).toBeLessThanOrEqual(measures.height + 1);
  for (const bounds of [measures.board, measures.response]) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(measures.width + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(measures.height + 1);
    expect(bounds.width).toBeGreaterThan(10);
    expect(bounds.height).toBeGreaterThan(10);
  }
}

interface AudioStart { name: string; duration: number; samples: number }
interface AudioProbe { starts: AudioStart[] }
type ProbeWindow = Window & { __colossusAudioProbe?: AudioProbe };

/** Observe native audio graph starts without replacing audio, actions or game state. */
export async function installAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { starts: [] as Array<{ name: string; duration: number; samples: number }> };
    (window as Window & { __colossusAudioProbe?: typeof probe }).__colossusAudioProbe = probe;
    const bytesToName = new WeakMap<ArrayBuffer, string>(), bufferToName = new WeakMap<AudioBuffer, string>();
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const result = await originalFetch(...args);
      const match = /\/assets\/colossus\/audio\/([^/]+)\.wav(?:\?|$)/.exec(result.url);
      if (match) {
        const originalRead = result.arrayBuffer.bind(result);
        result.arrayBuffer = async () => { const bytes = await originalRead(); bytesToName.set(bytes, match[1]); return bytes; };
      }
      return result;
    };
    const originalDecode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function(bytes, success, failure) {
      const name = bytesToName.get(bytes);
      return originalDecode.call(this, bytes, success, failure).then(buffer => { if (name) bufferToName.set(buffer, name); return buffer; });
    };
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof originalStart>) {
      const result = originalStart.apply(this, args);
      if (this.buffer) probe.starts.push({ name: bufferToName.get(this.buffer) ?? 'unknown', duration: this.buffer.duration, samples: this.buffer.length });
      return result;
    };
  });
}
export async function audioNames(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as ProbeWindow).__colossusAudioProbe?.starts ?? []).map(item => item.name));
}
export async function heardCue(page: Page, name: string) {
  // This asserts real decoded Web Audio starts; it is not a listening test.
  await expect.poll(() => audioNames(page), { message: 'native audio start: ' + name }).toContain(name);
  const sounds = await page.evaluate(() => (window as ProbeWindow).__colossusAudioProbe?.starts ?? []);
  expect(sounds.filter(sound => sound.name === name).every(sound => sound.samples > 0 && sound.duration > 0)).toBe(true);
}
