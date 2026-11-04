import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';
import { SIMULATION_EXPECT_TIMEOUT, SIMULATION_TEST_TIMEOUT } from './timeouts';

test('setup offers a captain skill only for a computer side', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Free battle' }).click();
  const blue = page.getByRole('region', { name: 'Blue side' });
  const red = page.getByRole('region', { name: 'Red side' });
  await expect(blue.getByLabel('Captain skill')).toBeHidden();
  await expect(red.getByLabel('Captain skill')).toBeVisible();
  await red.getByLabel('Captain skill').selectOption({ label: 'High' });
  await blue.getByLabel('Commander').selectOption({ label: 'Computer' });
  await expect(blue.getByLabel('Captain skill')).toBeVisible();
});

test('ordinary play explains the resolved contact stage without revealing the enemy design', async ({
  page,
}) => {
  await startFreeBattle(page);
  const telescope = page.getByLabel('Contact through telescope');
  await expect(telescope.getByLabel('Resolved contact detail')).toBeVisible();
  await expect(telescope.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(telescope).not.toContainText('Bastion');
  await expect(telescope).not.toContainText('Test mode');
  const stage = await telescope.getAttribute('data-detail');
  await expect(telescope.locator('[aria-current="step"]')).toHaveAttribute(
    'data-detail',
    stage ?? '',
  );
});

test('contact stage review renders representative observations without WebGL errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/docs/research/contact-detail-review.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas')).toHaveCount(4);
  for (const canvas of await page.locator('canvas').all()) {
    const litPixels = await canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing contact image');
      const context = element.getContext('2d');
      if (!context) throw new Error('Missing review image');
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i] ?? 0) > 40) lit++;
      }
      return lit;
    });
    expect(litPixels).toBeGreaterThan(5);
  }
  expect(errors).toEqual([]);
  const path = testInfo.outputPath('contact-detail-stages.png');
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach('Contact stages', { path, contentType: 'image/png' });
});

test('the player withdraws and sees the result', async ({ page }) => {
  test.setTimeout(SIMULATION_TEST_TIMEOUT);
  await startFreeBattle(page);
  // The contact shows only what Blue's sensor makes out of it.
  await expect(page.getByRole('region', { name: 'Tactical map' })).toContainText(/Red · .* · /);
  const withdraw = page.getByRole('button', { name: 'Withdraw', exact: true });
  await expect(withdraw).toHaveAttribute('aria-pressed', 'false');
  await withdraw.click();
  // Waiting for confirmation is not yet the order.
  const confirm = page.getByRole('button', { name: 'Confirm withdrawal' });
  await expect(confirm).toHaveAttribute('aria-pressed', 'false');
  await confirm.click();
  // Out of reach of the Bastion's weapons at the start, Blue is gone at once.
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result).toBeVisible({ timeout: SIMULATION_EXPECT_TIMEOUT });
  await expect(result.getByRole('heading')).toHaveText('Red wins');
  await expect(result).toContainText('Blue withdrew');
});
