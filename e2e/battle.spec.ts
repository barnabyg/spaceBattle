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

test('a ship with kinetic guns shows its guns, magazine and ammunition', async ({ page }) => {
  await startFreeBattle(page, { blue: { design: 'Sling' } });
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText('600 of 600 slugs');
  await expect(page.getByLabel('Slugs in flight')).toHaveText('0 ours · 0 incoming');
  const damage = page.getByRole('region', { name: 'Damage' });
  await expect(damage.getByText('Kinetic gun (mount)')).toHaveCount(2);
  await expect(damage.getByText('Magazine', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Fire freely' }).click();
  // The opening pass starts beyond the guns' reach.
  await expect(page.getByLabel('Weapons state')).toHaveText('Out of range · reach 30,000 km');
});

test('ships with particle beams show their beams, the charged one short-ranged', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { design: 'Torch' }, red: { design: 'Needle' } });
  await page.keyboard.press(' ');
  const damage = page.getByRole('region', { name: 'Damage' });
  await expect(damage.getByText('Charged particle beam (mount)')).toBeVisible();
  await expect(page.getByLabel('Beam power')).toHaveText('Charged particle beam 0 MW');

  await page.getByRole('button', { name: 'Fire freely' }).click();
  // The opening pass starts far beyond the charged beam's reach.
  const weapons = page.getByLabel('Weapons state');
  await expect(weapons).toContainText('Out of range · reach');
  expect(kmOf((await weapons.textContent())?.split('reach')[1] ?? null)).toBeLessThan(50_000);
});

test('a ship with launchers launches missiles by order, dropping to real time', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { design: 'Quiver' } });
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText('12 of 12 missiles');
  await expect(page.getByLabel('Missiles in flight')).toHaveText('0 ours · 0 incoming');
  await expect(
    page.getByRole('region', { name: 'Damage' }).getByText('Launcher (mount)'),
  ).toHaveCount(2);
  const launch = page.getByLabel('Launch state');
  await expect(launch).toContainText('12 missiles ready · reach');

  await page.getByLabel('Missiles', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Launch', exact: true }).click();
  await expect(launch).toHaveText('Launching · 2 to go · 12 missiles left');
  for (let i = 0; i < 9; i++) await page.keyboard.press('+');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Missiles in flight')).toHaveText('2 ours · 0 incoming');
  await expect(page.getByLabel('Time compression')).toHaveText('1×');
  await expect(page.getByLabel('Ammunition')).toHaveText('10 of 12 missiles');
  await expect(page.getByRole('list', { name: 'Battle log' })).toContainText('Missile launched');
});

test('a ship with point defence shows its guns and rounds, and takes priority orders', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { design: 'Rampart' }, red: { design: 'Quiver' } });
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText('40,000 of 40,000 rounds');
  await expect(page.getByLabel('Point defence', { exact: true })).toHaveText(
    '0 of 2 firing · 0 shot down',
  );
  await expect(
    page.getByRole('region', { name: 'Damage' }).getByText('Point defence (mount)'),
  ).toHaveCount(2);
  const state = page.getByLabel('Point defence state');
  await expect(state).toHaveText('Ready · reach 25 km · 0 shot down');

  const missilesOnly = page.getByRole('button', { name: 'Missiles only' });
  const thenShip = page.getByRole('button', { name: 'Missiles, then ship' });
  await expect(missilesOnly).toHaveClass(/active/);
  await thenShip.click();
  await expect(thenShip).toHaveClass(/active/);
  await expect(missilesOnly).not.toHaveClass(/active/);
});
