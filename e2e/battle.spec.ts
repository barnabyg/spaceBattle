import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

const kmOf = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''));

test('the game loads a battle and the ships move when time runs', async ({ page }) => {
  await startFreeBattle(page);
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
  await startFreeBattle(page);
  const clock = page.getByLabel('Battle time');
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Time compression')).toHaveText('Paused');
  const paused = (await clock.textContent()) ?? '';
  await page.waitForTimeout(1_500);
  await expect(clock).toHaveText(paused);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(clock).not.toHaveText(paused);
});

test('a manoeuvre order shows its goal and planned burns on the map', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  await page.getByLabel('Range km').fill('150000');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(page.getByLabel('Manoeuvre state')).toContainText('Holding 150,000 km · error');
  const burns = page.getByRole('region', { name: 'Tactical map' }).locator('.planned-burn');
  await expect(burns.first()).toBeVisible();
  await expect(burns.first()).toContainText('Burn');

  await page.getByRole('button', { name: 'Manual' }).click();
  await expect(page.getByLabel('Manoeuvre state')).toHaveText('Manual control');
  await expect(burns.filter({ visible: true })).toHaveCount(0);
});

test('power and radiator orders work while paused', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const priorities = page.getByRole('list', { name: 'Power priorities' }).getByRole('listitem');
  await expect(priorities.first()).toContainText('Shields');
  await page.getByRole('button', { name: 'Raise Drive' }).click();
  await page.getByRole('button', { name: 'Raise Drive' }).click();
  await expect(priorities.first()).toContainText('Drive');

  await expect(page.getByLabel('Radiators')).toContainText('Retracted');
  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await expect(page.getByLabel('Radiators')).toContainText('Deployed');
});

test('the ship heats up during a burn', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const temperature = page.getByLabel('Temperature');
  await expect(temperature).toHaveText('300 K');
  await page.getByLabel('Duration s').fill('600');
  await page.getByRole('button', { name: 'Burn', exact: true }).click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => kmOf(await temperature.textContent())).toBeGreaterThan(400);
});

test('weapons orders work while paused and the damage panel shows each section', async ({
  page,
}) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const damage = page.getByRole('region', { name: 'Damage' });
  await expect(damage.getByLabel('Forward section')).toHaveText(
    'ablative armour 50 mm of 50 mm · structure 100%',
  );
  await expect(damage.getByText('Laser (mount)')).toBeVisible();

  const weapons = page.getByLabel('Weapons state');
  await expect(weapons).toHaveText('Holding fire');
  await page.getByRole('button', { name: 'Fire freely' }).click();
  // The opening pass starts beyond laser range.
  await expect(weapons).toContainText('Out of range · reach');
  await page.getByRole('button', { name: 'Hold fire' }).click();
  await expect(weapons).toHaveText('Holding fire · enemy targeted');
});

test('End battle asks first, then shows the player forfeited', async ({ page }) => {
  await startFreeBattle(page);
  await page.getByRole('button', { name: 'End battle' }).click();
  const confirm = page.getByRole('dialog', { name: 'End battle' });
  await expect(confirm).toContainText('forfeit');
  await expect(page.getByLabel('Time compression')).toHaveText('Paused');
  await confirm.getByRole('button', { name: 'Continue battle' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByLabel('Time compression')).toHaveText('1×');

  await page.getByRole('button', { name: 'End battle' }).click();
  await confirm.getByRole('button', { name: 'Forfeit' }).click();
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result).toBeVisible();
  await expect(result.getByRole('heading')).toHaveText('Red wins');
  await expect(result).toContainText('Blue forfeited');
  await expect(page.getByRole('button', { name: 'End battle' })).toBeDisabled();
  const clock = await page.getByLabel('Battle time').textContent();
  await page.waitForTimeout(1_200);
  await expect(page.getByLabel('Battle time')).toHaveText(clock ?? '');
});
