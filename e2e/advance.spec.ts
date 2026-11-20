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

  // 10,000 km closer than the ships start; Enter starts the advance from the field.
  const separation = page.getByLabel('Separation', { exact: true });
  const kmOf = async () => Number(((await separation.textContent()) ?? '').replace(/[^\d]/g, ''));
  const goal = (await kmOf()) - 10_000;
  await km.fill(String(goal));
  await expect(status).toBeEmpty();
  await km.press('Enter');
  await expect(status).toHaveText(`Paused at ${goal.toLocaleString('en-GB')} km separation`);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const kmApart = await kmOf();
  expect(kmApart).toBeLessThanOrEqual(goal);
  expect(kmApart).toBeGreaterThan(goal - 1_000);
  // It resumes at the speed chosen before the advance.
  await expect(selectedTimeCompression(page)).toHaveText('10×');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(status).toBeEmpty();
});
