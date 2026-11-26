import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/fixtures';

type Start = { id: number; at: number; perf: number; offset: number; duration: number; buffer: number };
type Formation = { kind: string; epoch: number };
type Trace = { starts: Start[]; stops: { id: number; at: number }[]; formations: Formation[];
  peak: number; copies: string[]; storage: string[] };
const root = (page: Page) => page.getByTestId('audition');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function trace(page: Page) {
  return page.evaluate(() => Reflect.get(window, 'auditionTrace') as Trace);
}

async function load(page: Page) {
  await page.addInitScript(() => {
    const stats: Trace = { starts: [], stops: [], formations: [], peak: 0, copies: [], storage: [] };
    Object.assign(window, { auditionTrace: stats });
    const observer = new MutationObserver(() => {
      const kind = document.querySelector('.remorse-scene')?.getAttribute('data-promotion-scene');
      const epoch = Number(document.querySelector('.audition')?.getAttribute('data-epoch'));
      if (kind && epoch && stats.formations.at(-1)?.epoch !== epoch) stats.formations.push({ kind, epoch });
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-promotion-scene', 'data-epoch'] });
    const ids = new WeakMap<AudioBufferSourceNode, number>();
    const proto = AudioBufferSourceNode.prototype;
    const start = proto.start;
    proto.start = function (...args) {
      const [when = 0, offset = 0, duration = 0] = args;
      const id = stats.starts.length;
      ids.set(this, id);
      stats.starts.push({ id, at: when, perf: performance.now() + (when - this.context.currentTime) * 1000,
        duration, offset, buffer: this.buffer?.duration ?? 0 });
      start.apply(this, args);
    };
    const stop = proto.stop;
    proto.stop = function (...args) {
      const [when = 0] = args;
      const id = ids.get(this);
      if (id !== undefined) stats.stops.push({ id, at: when });
      stop.apply(this, args);
    };
    const compressor = BaseAudioContext.prototype.createDynamicsCompressor;
    BaseAudioContext.prototype.createDynamicsCompressor = function () {
      const node = compressor.call(this);
      const analyser = this.createAnalyser();
      analyser.fftSize = 512;
      const data = new Float32Array(analyser.fftSize);
      node.connect(analyser);
      function sample() {
        analyser.getFloatTimeDomainData(data);
        for (const value of data) stats.peak = Math.max(stats.peak, Math.abs(value));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      return node;
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (database, version) {
      stats.storage.push(database);
      return open.call(this, database, version);
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text: string) => { stats.copies.push(text); } } });
  });
  await page.goto('');
  await expect(button(page, 'Проиграть')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('[data-renderer="3d"][data-scene-ready="true"] canvas')).toBeVisible();
}

async function play(page: Page, name = 'Проиграть') {
  const length = (await trace(page)).starts.length;
  await button(page, name).click();
  await expect.poll(async () => (await trace(page)).starts.length).toBeGreaterThan(length);
}

async function done(page: Page) {
  await expect(root(page)).toHaveAttribute('data-status', 'done');
}

const scenarios = [
  ['reaction.guilt', 2, 'guilt'], ['reaction.devastated', 1, 'devastated'], ['reaction.berserk', 6, 'berserk'],
  ['reaction.bloodlust', null, 'bloodlust'], ['promotion.formation', null, 'bishop'],
  ['promotion.rook', null, 'rook'], ['promotion.queen', null, 'queen'],
] as const;

test('every prepared sound is a single recording on a real rules event and nothing autoplays', async ({ page }) => {
  const assets: string[] = [];
  page.on('request', request => { if (/\.mp3$/.test(request.url())) assets.push(new URL(request.url()).pathname.split('/').at(-1)!); });
  await load(page);
  await page.getByRole('checkbox').check();
  expect(assets).toHaveLength(15);
  expect(assets.every(name => /^(reaction-r[12]-|promotion-p[12]-)/.test(name))).toBe(true);
  await button(page, 'Проиграть').dispatchEvent('click');
  expect((await trace(page)).starts).toHaveLength(0);
  for (const [group, face, result] of scenarios) {
    await page.getByRole('combobox').selectOption(group);
    for (const variant of group.startsWith('reaction.') ? ['Текущий', 'R1', 'R2'] : ['Текущий', 'P1', 'P2']) {
      const previous = await trace(page);
      const before = previous.starts.length;
      await button(page, variant).click();
      expect((await trace(page)).starts).toHaveLength(before);
      await play(page);
      await done(page);
      if (group.startsWith('reaction.')) await expect(root(page)).toHaveAttribute('data-affliction', result);
      else expect((await trace(page)).formations.slice(previous.formations.length).map(frame => frame.kind)).toEqual([result]);
      if (face) await expect(page.getByLabel(`Результат кубика: ${face}`)).toBeVisible();
      else await expect(root(page)).toHaveAttribute('data-dice', 'none');
      const bytes = (await trace(page)).starts.slice(before);
      expect(bytes.filter(cue => cue.buffer >= 1.18)).toHaveLength(variant === 'Текущий' ? 0 : 1);
      if (group === 'reaction.bloodlust' && variant === 'R2') expect(bytes.at(-1)?.duration).toBeCloseTo(1.54, 3);
    }
  }
  const stats = await trace(page);
  expect(stats.peak).toBeGreaterThan(.015);
  expect(stats.storage).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('queen plays full or isolated tracks with the same normal and reduced contact clock', async ({ page }) => {
  await load(page);
  await page.getByRole('combobox').selectOption('promotion.queen');
  for (const reduced of [false, true]) {
    await page.getByRole('checkbox').setChecked(reduced);
    for (const variant of ['P1', 'P2', 'P1-STONE-SOLO']) {
      const solo = variant === 'P1-STONE-SOLO';
      if (solo) await button(page, 'Только звук раскола').click();
      await button(page, variant).click();
      const previous = await trace(page);
      const before = previous.starts.length;
      await play(page);
      await done(page);
      const captured = await trace(page);
      const frames = captured.formations.slice(previous.formations.length);
      expect(frames.map(frame => frame.kind)).toEqual(['queen']);
      const clip = captured.starts.slice(before).find(cue => cue.buffer > 3);
      expect(clip).toBeDefined();
      const { epoch } = frames[0];
      expect(Math.abs((clip!.perf - epoch) + (.420 - clip!.offset) * 1000 - (reduced ? 275 : 1010))).toBeLessThan(25);
      expect(captured.starts.slice(before)).toHaveLength(solo ? 1 : 2);
    }
    await button(page, 'Вся сцена').click();
  }
});

test('stop, repeat, hiding and a new scene cancel scheduled voices', async ({ page }) => {
  await load(page);
  await button(page, 'R1').click();
  await play(page);
  const firstRun = (await trace(page)).starts;
  const first = firstRun.at(-1)!;
  await button(page, 'Повторить').press('Enter');
  await expect.poll(async () => (await trace(page)).starts.length).toBe(firstRun.length * 2);
  expect((await trace(page)).stops.some(edge => edge.id === first.id && edge.at < first.at)).toBe(true);
  const second = (await trace(page)).starts.at(-1)!;
  await button(page, 'Стоп').press('Enter');
  await expect(root(page)).toHaveAttribute('data-stage', 'idle');
  expect((await trace(page)).stops.some(edge => edge.id === second.id && edge.at < second.at)).toBe(true);
  await play(page);
  await page.getByRole('combobox').selectOption('reaction.devastated');
  await expect(root(page)).toHaveAttribute('data-status', 'idle');
  await play(page);
  const last = (await trace(page)).starts.at(-1)!;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(root(page)).toHaveAttribute('data-stage', 'idle');
  expect((await trace(page)).stops.some(edge => edge.id === last.id && edge.at < last.at)).toBe(true);
});

test('the six-second raw chant requires its own click and closes with the dialog', async ({ page }) => {
  await load(page);
  await page.getByRole('combobox').selectOption('reaction.bloodlust');
  await button(page, 'R2').click();
  await button(page, 'О записи').click();
  expect((await trace(page)).starts).toEqual([]);
  await play(page, 'Исходное заклинание · 6 с');
  expect((await trace(page)).starts).toMatchObject([{ duration: 6, offset: 0 }]);
  await expect(root(page)).toHaveAttribute('data-stage', 'idle');
  await button(page, 'Закрыть').click();
  await expect.poll(async () => (await trace(page)).stops.map(edge => edge.id)).toContain(0);
});

test('both languages, mobile portrait and landscape, and an isolated copyable choice', async ({ page }) => {
  await load(page);
  await button(page, 'EN').click();
  await expect(page.getByRole('heading', { name: 'Compare sounds' })).toBeVisible();
  await page.getByRole('combobox').selectOption('promotion.queen');
  await button(page, 'Fracture sound only').click();
  for (const [width, height] of [[1280, 800], [390, 844], [844, 390], [360, 640], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.audition-transport button, .audition-actions button, .audition-picks-bar button, .audition-event select, .board-stage'));
      const actions = document.querySelector('.audition-actions')!.getBoundingClientRect();
      const choices = document.querySelector('.audition-picks-bar')!.getBoundingClientRect();
      return [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight,
        buttons.every(el => { const b = el.getBoundingClientRect(); return b.left >= -1 && b.right <= innerWidth + 1 && b.top >= 0 && b.bottom <= innerHeight + 1; }),
        choices.top >= actions.bottom];
    })).toEqual([0, 0, true, true]);
  }
  await button(page, 'Choose this sound').click();
  await button(page, 'Copy selections').click();
  await expect.poll(async () => (await trace(page)).copies).toEqual(['Queen P1-STONE-SOLO']);
  expect((await trace(page)).storage).toEqual([]);
  expect((await trace(page)).starts).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['remorse-audition-choices-v1']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ваш выбор 1/7' })).toBeVisible();
  await page.getByRole('button', { name: 'Ваш выбор 1/7' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('Ферзь P1-STONE-SOLO');
  expect((await trace(page)).starts).toEqual([]);
});
