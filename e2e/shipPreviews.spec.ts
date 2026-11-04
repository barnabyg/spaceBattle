import { expect, test } from '@playwright/test';

test('free battle previews follow both selections and release their renderers on leaving setup', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Free battle' }).click();
  const blue = page.getByRole('region', { name: 'Blue side' });
  const red = page.getByRole('region', { name: 'Red side' });
  const bluePreview = blue.getByRole('region', { name: 'Blue ship preview' });
  const redPreview = red.getByRole('region', { name: 'Red ship preview' });
  await expect(bluePreview).toBeInViewport({ ratio: 1 });
  await expect(redPreview).toBeInViewport({ ratio: 1 });
  for (const [side, preview, names] of [
    [blue, bluePreview, ['Bastion', 'Lance', 'Quiver']],
    [red, redPreview, ['Lance', 'Quiver', 'Bastion']],
  ] as const) {
    for (const name of names) {
      await side
        .getByRole('combobox', { name: 'Design', exact: true })
        .selectOption({ label: name });
      await expect(preview.getByRole('img', { name: `${name} ship preview` })).toBeVisible();
    }
  }
  await blue.getByRole('combobox', { name: 'Design', exact: true }).evaluate((element) => {
    (element as HTMLSelectElement).value = '';
    element.dispatchEvent(new Event('change'));
  });
  await expect(bluePreview.getByRole('img', { name: 'No design selected' })).toBeVisible();
  await expect(blue.getByLabel('Hull size')).toHaveCount(0);
  await blue
    .getByRole('combobox', { name: 'Design', exact: true })
    .selectOption({ label: 'Quiver' });
  await expect(bluePreview.getByRole('img', { name: 'Quiver ship preview' })).toBeVisible();
  const canvases = await page.locator('canvas').elementHandles();
  expect(canvases).toHaveLength(2);
  // Read on the next animation frame, after the preview draws its model.
  for (const canvas of canvases) {
    await expect
      .poll(() =>
        canvas.evaluate(
          (element) =>
            new Promise<number>((resolve) => {
              requestAnimationFrame(() => {
                const gl = (element as HTMLCanvasElement).getContext('webgl2');
                if (!gl) {
                  resolve(0);
                  return;
                }
                const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
                gl.readPixels(
                  0,
                  0,
                  gl.drawingBufferWidth,
                  gl.drawingBufferHeight,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  pixels,
                );
                let lit = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                  if ((pixels[i] ?? 0) > 40) lit++;
                }
                resolve(lit);
              });
            }),
        ),
      )
      .toBeGreaterThan(1000);
  }
  await page.screenshot({ path: testInfo.outputPath('free-battle-previews.png') });
  await page.getByRole('button', { name: 'Start battle' }).click();
  await expect(page.getByLabel('Own ship', { exact: true })).toContainText('Blue · Quiver');
  for (const canvas of canvases) {
    expect(
      await canvas.evaluate((element) =>
        (element as HTMLCanvasElement).getContext('webgl2')?.isContextLost(),
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
