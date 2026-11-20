import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('the Roll order toggles rolling from the Navigation tab', async ({ page }) => {
  await startFreeBattle(page);
  await page.getByRole('tab', { name: 'Navigation', exact: true }).click();
  const roll = page.getByRole('button', { name: 'Roll', exact: true });
  const state = page.getByLabel('Roll state');
  await expect(state).toHaveText('Not rolling');
  await expect(roll).toHaveAttribute('aria-pressed', 'false');
  await roll.click();
  await expect(state).toContainText('Rolling');
  await expect(roll).toHaveAttribute('aria-pressed', 'true');
  await roll.click();
  await expect(state).toHaveText('Not rolling');
});
