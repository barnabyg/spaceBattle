import { expect, test } from '@playwright/test';
import { selectedTimeCompression, startFreeBattle, timeCompressionButton } from './freeBattle';

test('advance until a separation runs the battle fast, then pauses there', async ({ page }) => {
  await startFreeBattle(page);
  await timeCompressionButton(page, '10×').click();
  const advance = page.getByRole('group', { name: 'Advance until' });
  const status = page.getByRole('status', { name: 'Advance' });
  const km = page.getByLabel('Advance until separation km');

  // The separation field shows only for that condition, and a bad entry is refused.
  await expect(km).toBeHidden();
  await advance
    .getByLabel('Advance until', { exact: true })
    .selectOption({ label: 'Separation (km)' });
  await expect(km).toBeVisible();
  await km.fill('0');
  await advance.getByRole('button', { name: 'Advance' }).click();
  await expect(status).toHaveText('Cannot advance: Enter a separation above 0 km');

  // Both ships start well beyond 250,000 km apart; Enter starts the advance from the field.
  await km.fill('250000');
  await expect(status).toBeEmpty();
  await km.press('Enter');
  await expect(status).toHaveText('Paused at 250,000 km separation');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const separation = await page.getByLabel('Separation', { exact: true }).textContent();
  const kmApart = Number((separation ?? '').replace(/[^\d]/g, ''));
  expect(kmApart).toBeLessThanOrEqual(250_000);
  expect(kmApart).toBeGreaterThan(249_000);
  // It resumes at the speed chosen before the advance.
  await expect(selectedTimeCompression(page)).toHaveText('10×');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(status).toBeEmpty();
});
