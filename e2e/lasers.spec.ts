import { expect, test } from '@playwright/test';
import { TEST_LASER, testDesign, withSection } from '../src/sim/testing';
import { startFreeBattle } from './freeBattle';

test('lasers fire a continuous beam and hold fire through the battle controls', async ({
  page,
}) => {
  // Long reach lets the player test firing immediately in the ordinary opening scenario.
  const design = withSection(testDesign({ id: 'beam-review', name: 'Beam review' }), 'forward', {
    mounts: [{ ...TEST_LASER, wavelength: 25e-9 }],
  });
  await page.addInitScript((saved) => {
    localStorage.setItem('space-battle.designs', JSON.stringify([saved]));
  }, design);
  await startFreeBattle(page, {
    blue: { design: 'Beam review', commander: 'Player' },
    red: { commander: 'Computer' },
  });
  await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
  const laser = page.getByRole('list', { name: 'Weapon ranges' }).getByRole('listitem');
  await expect(laser).not.toContainText('Charge');
  await page.getByRole('button', { name: 'Fire freely', exact: true }).click();
  await expect(laser).toContainText('In range');
  await expect(laser).toContainText('Firing in last step');
  // Still firing a moment later: no recharge between shots.
  await page.waitForTimeout(2_000);
  await expect(laser).toContainText('Firing in last step');
  await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
  await expect(laser).toContainText('Holding fire');
});
