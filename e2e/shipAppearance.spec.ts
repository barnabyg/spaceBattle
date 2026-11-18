import { expect, test } from '@playwright/test';

/** Align the rendered hulls and compare their outlines at thumbnail size.
 * Normalising the length keeps the cruiser's larger hull from distinguishing it by itself. */
function thumbnailOutline(canvas: HTMLCanvasElement): number[] {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Missing review image');
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const foreground = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = (y * width + x) * 4;
    // The corner is empty sky. Ignore slight antialiasing at the contour.
    return [0, 1, 2].some((c) => Math.abs((data[i + c] ?? 0) - (data[c] ?? 0)) > 8);
  };
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!foreground(x, y)) continue;
      left = Math.min(x, left);
      right = Math.max(x, right);
      top = Math.min(y, top);
      bottom = Math.max(y, bottom);
    }
  }
  const stride = (right - left + 1) / 96;
  const pixels: number[] = [];
  for (let row = 0; row < 96; row++) {
    for (let col = 0; col < 96; col++) {
      const x = Math.floor(left + (col + 0.5) * stride);
      const y = Math.floor((top + bottom + 1) / 2 + (row - 47.5) * stride);
      if (foreground(x, y)) pixels.push(row * 96 + col);
    }
  }
  return pixels;
}

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
    if (!custom) {
      const outlines = [];
      for (const article of await page.locator('article').all()) {
        const name = await article.locator('h2').innerText();
        const pixels = new Set(await article.locator('canvas').evaluate(thumbnailOutline));
        for (const other of outlines) {
          const common = [...pixels].filter((pixel) => other.pixels.has(pixel)).length;
          const union = pixels.size + other.pixels.size - common;
          expect(1 - common / union, `${name} and ${other.name} silhouettes`).toBeGreaterThan(0.12);
        }
        outlines.push({ name, pixels });
      }
    }
    const screenshot = testInfo.outputPath(
      custom ? 'player-identities.png' : 'stock-identities.png',
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('Ship identity review', { path: screenshot, contentType: 'image/png' });
  });
}
