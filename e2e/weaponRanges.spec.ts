import { expect, test } from '@playwright/test';
import {
  TEST_KINETIC_GUN,
  TEST_LASER,
  testDesign,
  testMagazine,
  withSection,
} from '../src/sim/testing';
import { startFreeBattle } from './freeBattle';

test('own weapons show independent ranges while holding fire, without enemy disclosure', async ({
  page,
}) => {
  const design = withSection(testDesign({ id: 'range-review', name: 'Range review' }), 'forward', {
    mounts: [{ ...TEST_LASER, wavelength: 25e-9 }, TEST_KINETIC_GUN],
    components: [testMagazine(10)],
  });
  await page.addInitScript((saved) => {
    localStorage.setItem('space-battle.designs', JSON.stringify([saved]));
  }, design);
  await startFreeBattle(page, {
    blue: { design: 'Range review' },
    red: { commander: 'Computer' },
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const ranges = page.getByRole('list', { name: 'Weapon ranges' });
  await expect(ranges.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByLabel('Weapon target separation')).toHaveText('No target selected');
  await page.getByRole('button', { name: 'Target enemy', exact: true }).click();
  await expect(page.getByLabel('Weapon target separation')).toContainText(
    /Separation to red: [\d,]+ km/,
  );
  const laser = ranges.getByRole('listitem').filter({ hasText: 'Laser' });
  const gun = ranges.getByRole('listitem').filter({ hasText: 'Kinetic gun' });
  await expect(laser).toContainText('In range');
  await expect(gun).toContainText('Out of range');
  await expect(laser).toContainText('Holding fire');
  await page.getByRole('button', { name: 'Fire freely', exact: true }).click();
  await expect(laser).not.toContainText('Holding fire');
  await page.getByRole('button', { name: 'Hold fire', exact: true }).click();
  await expect(laser).toContainText('In range');
  await expect(laser).toContainText('Holding fire');
  await page.getByRole('button', { name: 'No target', exact: true }).click();
  await expect(page.getByLabel('Weapon target separation')).toHaveText('No target selected');
  await expect(laser).not.toContainText('In range');
  await expect(page.getByRole('region', { name: 'Enemy design' })).toHaveCount(0);
});
