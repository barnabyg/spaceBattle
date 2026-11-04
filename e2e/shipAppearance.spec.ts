import { expect, test } from '@playwright/test';

for (const custom of [false, true]) {
  test(`renders the ${custom ? 'player and damaged' : 'stock'} ship review without WebGL errors`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/docs/research/ship-identity-review.html${custom ? '?custom' : ''}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('canvas')).toHaveCount(custom ? 4 : 11);
    for (const canvas of await page.locator('canvas').all()) {
      const litPixels = await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
        const context = element.getContext('2d');
        if (!context) throw new Error('Missing review image');
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if ((pixels[i] ?? 0) > 40) lit++;
        }
        return lit;
      });
      expect(litPixels).toBeGreaterThan(1000);
    }
    expect(errors).toEqual([]);
    const screenshot = testInfo.outputPath(
      custom ? 'player-identities.png' : 'stock-identities.png',
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('Ship identity review', { path: screenshot, contentType: 'image/png' });
  });
}
