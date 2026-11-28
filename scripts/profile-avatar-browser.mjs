/** Real browser + HTTP + SQLite profile-photo acceptance. Synthetic accounts only.
 * Run after npm run build:portal; no external messages and no real user files. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { encode } from 'jpeg-js';
import { createFeedbackHarness } from './district-feedback-fixtures.mjs';

const harness = await createFeedbackHarness({ scenarioIds: ['trade-draft'] });
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const [owner, friend] = await Promise.all(harness.manifest.accounts.map(account => browser.newContext({ storageState: account.storageState })));
  const page = await owner.newPage();
  await page.goto(`${harness.origin}/profile`);
  await page.getByRole('button', { name: 'Аватар: Конь' }).click();
  await expect(page.locator('.profile-identity .avatar-piece')).toHaveText('♞');
  await page.getByRole('button', { name: 'Аватар: Лис' }).click();
  await expect(page.locator('.profile-identity .avatar-art')).toBeVisible();
  const pixels = Buffer.alloc(128 * 96 * 4);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4;
    pixels[i] = x * 2; pixels[i + 1] = y * 2; pixels[i + 2] = 110; pixels[i + 3] = 255;
  }
  const image = encode({ width: 128, height: 96, data: pixels }, 80).data;
  await page.getByLabel('Загрузить фото').setInputFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: image });
  const crop = page.getByRole('group', { name: /Положение фото/ });
  await expect(crop).toBeVisible();
  await page.getByLabel('Масштаб').fill('1.5');
  const before = await crop.locator('img').getAttribute('style');
  await crop.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await crop.locator('img').getAttribute('style'), before);
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.locator('.profile-identity .avatar-photo')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/platform/v1/profile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  assert.equal((await saved).status(), 200);
  await expect(page.getByText('Профиль сохранён.')).toBeVisible();
  await harness.stop();
  await harness.start();
  await page.reload();
  const id = harness.manifest.accounts[0].playerId;
  await expect(page.locator('.profile-identity .avatar-photo')).toHaveAttribute('src', new RegExp(`/api/platform/v1/avatars/${id}\\?v=`));
  await expect.poll(() => page.locator('.profile-identity .avatar-photo').evaluate(image => image.complete && image.naturalWidth)).toBe(256);
  const room = (await harness.clients[0].request(`/rooms/${harness.manifest.scenarios[0].roomId}`)).room;
  assert.equal(room.members.find(member => member.playerId === id).avatar, 'photo');
  const other = await friend.newPage();
  await other.goto(`${harness.origin}/friends`);
  await expect(other.locator(`img.avatar-photo[src*="${id}"]`)).toBeVisible();
  await expect.poll(() => other.locator(`img.avatar-photo[src*="${id}"]`).evaluate(image => image.complete && image.naturalWidth)).toBe(256);
  console.log(JSON.stringify({ passed: 'profile photo and characters in real browser, restart, friend and room', syntheticAccounts: true, realHttp: true }));
} finally {
  if (browser) await browser.close();
  await harness.dispose();
}
