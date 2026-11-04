import { expect, test } from '@playwright/test';
import {
  selectedTimeCompression,
  startFreeBattle,
  timeCompressionButton,
  timeCompressionButtons,
} from './freeBattle';

const kmOf = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''));

test('the game loads a battle and the ships move when time runs', async ({ page }) => {
  await startFreeBattle(page);
  const map = page.getByRole('region', { name: 'Tactical map' });
  await expect(map.locator('canvas')).toBeVisible();
  await expect(map.locator('[data-side="blue"]')).toBeVisible();
  await expect(map.locator('[data-side="red"]')).toBeVisible();

  const separation = page.getByLabel('Separation', { exact: true });
  await expect(separation).toContainText('km');
  const before = kmOf(await separation.textContent());

  await timeCompressionButton(page, '1000×').click();
  await expect(selectedTimeCompression(page)).toHaveText('1000×');
  await expect.poll(async () => kmOf(await separation.textContent())).not.toBe(before);
});

test('pause stops the battle clock', async ({ page }) => {
  await startFreeBattle(page);
  const clock = page.getByLabel('Battle time');
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const paused = (await clock.textContent()) ?? '';
  await page.waitForTimeout(1_500);
  await expect(clock).toHaveText(paused);

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(clock).not.toHaveText(paused);
});

test('a speed button sets the time compression, and stays selected while paused', async ({
  page,
}) => {
  await startFreeBattle(page);
  await expect(timeCompressionButtons(page)).toHaveText(['1×', '10×', '100×', '500×', '1000×']);
  await expect(page.getByRole('button', { name: /^(Slower|Faster)$/ })).toHaveCount(0);
  await expect(selectedTimeCompression(page)).toHaveText('1×');

  // Paused, so no significant event can drop the battle back to real time while it is checked.
  await page.keyboard.press(' ');
  await timeCompressionButton(page, '500×').click();
  await expect(timeCompressionButton(page, '500×')).toHaveAttribute('aria-pressed', 'true');
  await expect(timeCompressionButton(page, '1×')).toHaveAttribute('aria-pressed', 'false');
  await expect(selectedTimeCompression(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(selectedTimeCompression(page)).toHaveCount(1);
});

test('keys 1 to 5 choose a time compression and + / - step through them', async ({ page }) => {
  await startFreeBattle(page);
  await expect(page.getByRole('group', { name: 'Time controls' })).toContainText(
    'Space pause · 1–5 or + / − time compression',
  );
  await page.keyboard.press(' ');
  const selected = selectedTimeCompression(page);
  await page.keyboard.press('4');
  await expect(selected).toHaveText('500×');
  await page.keyboard.press('+');
  await expect(selected).toHaveText('1000×');
  await page.keyboard.press('+');
  await expect(selected).toHaveText('1000×');
  await page.keyboard.press('-');
  await expect(selected).toHaveText('500×');
  await page.keyboard.press('2');
  await expect(selected).toHaveText('10×');
  await page.keyboard.press('-');
  await expect(selected).toHaveText('1×');
  await page.keyboard.press('-');
  await expect(selected).toHaveText('1×');
  await page.keyboard.press('5');
  await expect(selected).toHaveText('1000×');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('a manoeuvre order shows its goal and planned burns on the map', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  await page.getByLabel('Range km').fill('150000');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(page.getByLabel('Manoeuvre state')).toContainText('Holding 150,000 km · error');
  await expect(page.getByRole('button', { name: 'Hold', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Manual' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const burns = page.getByRole('region', { name: 'Tactical map' }).locator('.planned-burn');
  await expect(burns.first()).toBeVisible();
  await expect(burns.first()).toContainText('Burn');

  await page.getByRole('button', { name: 'Manual' }).click();
  await expect(page.getByLabel('Manoeuvre state')).toHaveText('Manual control');
  await expect(page.getByRole('button', { name: 'Manual' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  await expect(page.getByLabel('Radiators')).toContainText('Deploying · 5.0 s');
  await page.waitForTimeout(1_000);
  await expect(page.getByLabel('Radiators')).toContainText('Deploying · 5.0 s');
  await expect(page.getByRole('button', { name: 'Deploy radiators' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Retract radiators' }).click();
  await expect(page.getByLabel('Radiators')).toContainText('Retracted');
  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Radiators')).toContainText('Deployed');
  await page.getByRole('button', { name: 'Retract radiators' }).click();
  await expect(page.getByLabel('Radiators')).toContainText('Retracted');
  await timeCompressionButton(page, '10×').click();
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
  await page.keyboard.press('3');
  await expect(selectedTimeCompression(page)).toHaveText('100×');
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
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await confirm.getByRole('button', { name: 'Continue battle' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(selectedTimeCompression(page)).toHaveText('1×');

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

test('a ship with launchers launches missiles by order, preserving time compression', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { design: 'Quiver' } });
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText('12 of 12 missiles');
  await expect(page.getByLabel('Missiles in flight', { exact: true })).toHaveText(
    '0 ours · 0 incoming',
  );
  await expect(
    page.getByRole('region', { name: 'Damage' }).getByText('Launcher (mount)'),
  ).toHaveCount(2);
  const launch = page.getByLabel('Launch state');
  await expect(launch).toContainText('12 missiles ready · reach');

  await page.getByLabel('Missiles', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Launch', exact: true }).click();
  await expect(launch).toHaveText('Launching · 2 to go · 12 missiles left');
  await timeCompressionButton(page, '10×').click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Missiles in flight', { exact: true })).toHaveText(
    '2 ours · 0 incoming',
  );
  await expect(selectedTimeCompression(page)).toHaveText('10×');
  await expect(page.getByLabel('Ammunition')).toHaveText('10 of 12 missiles');
  await expect(page.getByRole('list', { name: 'Battle log' })).toContainText('Missile launched');
});

test('a ship with anti-missile missiles shows them apart, and takes missile defence orders', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { design: 'Bulwark' }, red: { design: 'Quiver' } });
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText(
    '6 of 6 missiles · 16 of 16 anti-missile missiles',
  );
  await expect(page.getByLabel('Anti-missile missiles in flight')).toHaveText(
    '0 ours · 0 incoming',
  );
  await expect(page.getByLabel('Launch state')).toContainText('6 missiles ready · reach');
  const state = page.getByLabel('Anti-missile state');
  await expect(state).toHaveText('Automatic · 16 left');
  // No enemy missile is on its way yet.
  await expect(page.getByRole('button', { name: 'Launch at nearest missile' })).toBeDisabled();

  const automatic = page.getByRole('button', { name: 'Automatic', exact: true });
  const byOrder = page.getByRole('button', { name: 'By order only' });
  await expect(automatic).toHaveClass(/active/);
  await byOrder.click();
  await expect(byOrder).toHaveClass(/active/);
  await expect(automatic).not.toHaveClass(/active/);
  await expect(state).toHaveText('By order only · 16 left');
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

test('a shielded ship shows its shields, and they can be lowered and raised', async ({ page }) => {
  await startFreeBattle(page, { blue: { design: 'Rime' } });
  await page.keyboard.press(' ');
  const shields = page.getByLabel('Shields', { exact: true });
  await expect(shields).toContainText('Raised');
  await expect(shields).toContainText('coolant 300 MW forward, 300 MW engine');
  await expect(
    page.getByRole('region', { name: 'Damage' }).getByText('Coolant shield', { exact: true }),
  ).toHaveCount(2);

  await page.getByRole('button', { name: 'Shields down' }).click();
  await expect(shields).toHaveText('Lowered');
  await page.getByRole('button', { name: 'Shields up' }).click();
  await expect(shields).toContainText('Raised');
});

test('toggle orders show which is selected, to sight and to assistive tech', async ({ page }) => {
  await startFreeBattle(page, { blue: { design: 'Rime' } });
  await page.keyboard.press(' ');
  const up = page.getByRole('button', { name: 'Shields up' });
  const down = page.getByRole('button', { name: 'Shields down' });
  const state = page.getByLabel('Shields state');
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await expect(state).toHaveText('Shields raised');

  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(state).toHaveText('Shields lowered');
  // With the pointer over the button not selected, it still looks unlike the selected one.
  await up.hover();
  const look = (button: typeof up) =>
    button.evaluate((b) => {
      const style = getComputedStyle(b);
      return [style.backgroundColor, style.color, style.fontWeight].join(' ');
    });
  expect(await look(up)).not.toBe(await look(down));
  // Not by colour alone: the selected one is ticked, and the tick stays out of its name.
  const tick = (button: typeof up) =>
    button.evaluate((b) => getComputedStyle(b, '::before').content);
  expect(await tick(down)).toContain('✓');
  expect(await tick(up)).not.toContain('✓');
  await expect(down).toHaveAccessibleName('Shields down');

  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await expect(state).toHaveText('Shields raised');

  const deploy = page.getByRole('button', { name: 'Deploy radiators' });
  const retract = page.getByRole('button', { name: 'Retract radiators' });
  await expect(retract).toHaveAttribute('aria-pressed', 'true');
  await expect(deploy).toHaveAttribute('aria-pressed', 'false');
  await deploy.click();
  await expect(deploy).toHaveAttribute('aria-pressed', 'true');
  await expect(retract).toHaveAttribute('aria-pressed', 'false');

  const atEnemy = page.getByRole('button', { name: 'Point at enemy' });
  const away = page.getByRole('button', { name: 'Point away' });
  await atEnemy.click();
  await expect(atEnemy).toHaveAttribute('aria-pressed', 'true');
  await expect(away).toHaveAttribute('aria-pressed', 'false');
  await away.click();
  await expect(away).toHaveAttribute('aria-pressed', 'true');
  await expect(atEnemy).toHaveAttribute('aria-pressed', 'false');
});

test('a ship without shields disables shield orders and explains why', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  for (const name of ['Shields up', 'Shields down']) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.getByLabel('Shields state')).toHaveText('Shields unavailable · none installed');
});
