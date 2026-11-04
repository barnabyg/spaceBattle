import { expect, test } from '@playwright/test';
import { TEST_LASER, testDesign, withSection } from '../src/sim/testing';
import { startFreeBattle } from './freeBattle';

test('lasers show charging progress, bursts and hold fire through the battle controls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Long reach lets the player test firing immediately in the ordinary opening scenario.
  const design = withSection(testDesign({ id: 'burst-review', name: 'Burst review' }), 'forward', {
    mounts: [{ ...TEST_LASER, wavelength: 25e-9 }],
  });
  await page.addInitScript((saved) => {
    localStorage.setItem('space-battle.designs', JSON.stringify([saved]));
  }, design);
  await startFreeBattle(page, {
    blue: { design: 'Burst review', commander: 'Player' },
    red: { commander: 'Computer' },
  });
  const laser = page.getByRole('list', { name: 'Weapon ranges' }).getByRole('listitem');
  await expect(laser).toContainText('Charge 0%');
  await page.getByRole('button', { name: 'Fire freely', exact: true }).click();
  await expect(laser).toContainText(/Charging · Charge [1-9]\d?%/);
  // Real-time charge is 15 s; leave 3× headroom for software-rendered CI contention.
  await expect(laser).toContainText('Firing in last step', { timeout: 45_000 });
  await expect(laser).toContainText(/Charging · Charge [1-9]\d?%/);
  await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
  await expect(laser).toContainText('Holding fire');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const held = await laser.textContent();
  await expect(laser).toHaveText(held ?? '');
});
