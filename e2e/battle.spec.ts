import { expect, test } from '@playwright/test';

const kmOf = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''));

test('the game loads a battle and the ships move when time runs', async ({ page }) => {
  await page.goto('/');
  const map = page.getByRole('region', { name: 'Tactical map' });
  await expect(map.locator('canvas')).toBeVisible();
  await expect(map.locator('[data-side="blue"]')).toBeVisible();
  await expect(map.locator('[data-side="red"]')).toBeVisible();

  const separation = page.getByLabel('Separation');
  await expect(separation).toContainText('km');
  const before = kmOf(await separation.textContent());

  for (let i = 0; i < 9; i++) await page.keyboard.press('+');
  await expect(page.getByLabel('Time compression')).toHaveText('1000×');
  await expect.poll(async () => kmOf(await separation.textContent())).not.toBe(before);
});

test('pause stops the battle clock', async ({ page }) => {
  await page.goto('/');
  const clock = page.getByLabel('Battle time');
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Time compression')).toHaveText('Paused');
  const paused = (await clock.textContent()) ?? '';
  await page.waitForTimeout(1_500);
  await expect(clock).toHaveText(paused);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(clock).not.toHaveText(paused);
});
