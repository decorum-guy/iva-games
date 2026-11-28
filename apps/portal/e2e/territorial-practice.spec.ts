import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`training resource cards remain readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/district-training');
    await expect(page.getByRole('heading', { name: 'Первый дом' })).toBeVisible();
    const cards = page.locator('.territory-hand .ta-resource-cards > span');
    await expect(cards).toHaveCount(5);
    const boxes = await cards.evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    }));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].width).toBeGreaterThan(40);
      if (i) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
