import { expect, test } from '../e2e/fixtures';

test('compares three local recordings at real die contacts with explicit Play and Stop', async ({ page }) => {
  await page.addInitScript(() => {
    const starts: { at: number; offset: number; duration?: number }[] = [];
    const stops: number[] = [];
    Object.assign(window, { dieAudition: { starts, stops } });
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      starts.push({ at: args[0] ?? 0, offset: args[1] ?? 0, duration: args[2] });
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      stops.push(args[0] ?? 0);
      return stop.apply(this, args);
    };
  });
  const recordings: string[] = [];
  page.on('request', request => {
    if (/\/dice-auditions\/[^/]+\.mp3$/.test(request.url())) recordings.push(request.url().split('/').at(-1)!);
  });
  await page.goto('/dice.html');
  const play = page.getByRole('button', { name: 'Бросить' });
  const stop = page.getByRole('button', { name: 'Стоп' });
  const root = page.getByTestId('dice-comparison');
  const stats = () => page.evaluate(() => Reflect.get(window, 'dieAudition') as {
    starts: { at: number; offset: number; duration?: number }[]; stops: number[];
  });
  await expect(play).toBeEnabled({ timeout: 20000 });
  await expect(root).toHaveAttribute('data-choice', 'D2');
  await expect(page.getByRole('slider')).toHaveValue('40');
  await expect(page.getByTestId('die-throw').locator('canvas')).toBeVisible();
  expect(recordings.sort()).toEqual(['d1.mp3', 'd2.mp3', 'd3.mp3']);
  await play.dispatchEvent('click');
  expect((await stats()).starts).toEqual([]);
  for (const [index, id] of ['D1', 'D2', 'D3'].entries()) {
    await page.getByRole('button', { name: id, exact: true }).click();
    expect((await stats()).starts).toHaveLength(index * 5);
    await play.click();
    await expect(root).toHaveAttribute('data-playing', 'true');
    const contacts = (await stats()).starts.slice(index * 5);
    expect(contacts).toHaveLength(5);
    contacts.forEach((contact, i) => {
      expect(contact.at - contacts[0].at).toBeCloseTo([0, .400, .720, .960, 1.140][i], 3);
      expect(contact.offset).toBeCloseTo(i * .128, 3);
      expect(contact.duration).toBeCloseTo(.108, 3);
    });
    await stop.click();
    await expect(root).toHaveAttribute('data-playing', 'false');
  }
  expect((await stats()).stops.length).toBeGreaterThanOrEqual(15);
  await page.getByRole('checkbox').check();
  await play.click();
  await expect.poll(async () => (await stats()).starts.length).toBe(16);
  await stop.click();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
    await page.setViewportSize(size);
    await expect(play).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth,
      document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0]);
  }
});
