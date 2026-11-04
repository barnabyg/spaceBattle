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
