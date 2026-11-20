import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('the battle story shows over the instrument view and stays in the Damage tab', async ({
  page,
}) => {
  await startFreeBattle(page, {
    blue: { design: 'Bastion', commander: 'Player' },
    red: { design: 'Lance', commander: 'Computer' },
  });
  // The Bastion outreaches the closing Lance: advancing until it is in reach tells of it.
  await page
    .getByRole('group', { name: 'Advance until' })
    .getByRole('combobox')
    .selectOption({ label: 'Enemy in our reach' });
  await page.getByRole('button', { name: 'Advance', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Advance' })).toHaveText(
    'Paused: the enemy is within our reach',
  );
  const overlay = page.getByRole('log', { name: 'Battle narration' });
  await expect(overlay).toContainText('The enemy is now within reach of our weapons.');
  await page.getByRole('tab', { name: 'Damage', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Battle story' })).toContainText(
    /T\+\d\d:\d\d:\d\d The enemy is now within reach of our weapons\./,
  );
});
