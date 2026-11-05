import { expect, test } from '@playwright/test';
import { chooseSide, startFreeBattle } from './freeBattle';

test('map uses observed height for separation and clears a lost contact', async ({ page }) => {
  await page.goto('/');
  const readings = await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { testSetup } = await import('../src/sim/testing');
    const { createTacticalMap } = await import('../src/ui/tacticalMap');
    const setup = testSetup();
    const battle = createBattle({
      ...setup,
      scenario: {
        name: 'Height difference',
        starts: [
          { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
          { position: { x: 0, y: 3_000_000, z: 4_000_000 }, velocity: { x: 0, y: 0, z: 0 } },
        ],
      },
    });
    const map = createTacticalMap(setup.sides);
    document.body.append(map.element);
    const observation = battle.observe('blue');
    map.update(observation);
    map.render();
    const readout = map.element.querySelector('[aria-label="Contact separation"]');
    const present = readout?.textContent;
    map.update({ ...observation, contacts: [] });
    map.render();
    const absent = readout?.textContent;
    const contact = map.element.querySelector('.ship-symbol--contact');
    const contactHidden = contact !== null && getComputedStyle(contact).display === 'none';
    map.dispose();
    map.element.remove();
    return { present, absent, contactHidden };
  });
  expect(readings).toEqual({
    present: 'Red · Separation 5,000 km',
    absent: 'No contact',
    contactHidden: true,
  });
});

test('contact separation updates in km, freezes paused and survives map controls', async ({
  page,
}) => {
  await startFreeBattle(page);
  const map = page.getByRole('region', { name: 'Tactical map' });
  const separation = map.getByLabel('Contact separation');
  await expect(separation).toHaveText(/Red · Separation [\d,]+ km/);
  await page.keyboard.press(' ');
  const paused = await separation.textContent();
  await page.getByRole('button', { name: '1000×', exact: true }).click();
  // A paused runner keeps the same observation even when compression changes.
  await expect(separation).toHaveText(paused ?? '');
  const surface = map.locator('.tactical-map__labels');
  await surface.hover();
  await page.mouse.wheel(0, 300);
  const box = await surface.boundingBox();
  if (!box) throw new Error('Map surface missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await expect(separation).toBeVisible();
  await expect(separation).toHaveText(paused ?? '');
  await page.keyboard.press(' ');
  await expect(separation).not.toHaveText(paused ?? '');
});

test('the map legend explains each layer and switches it off and on, kept for the session', async ({
  page,
}) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const map = page.getByRole('region', { name: 'Tactical map' });
  const open = map.getByRole('button', { name: 'Legend' });
  const layers = map.getByRole('list', { name: 'Map layers' });
  await expect(layers).toBeHidden();
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(layers).toBeVisible();
  const toggles = layers.getByRole('checkbox');
  await expect(toggles).toHaveCount(11);
  const hiddenByDefault = ['Trail', 'Drop lines', 'Projected path', 'Planned burns'];
  for (const name of hiddenByDefault) {
    await expect(layers.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
  }
  await expect(layers.getByRole('checkbox', { checked: true })).toHaveCount(7);

  // Hiding the range rings hides their labels too, without changing other layers.
  const rings = layers.getByRole('checkbox', { name: 'Range rings' });
  const ringLabels = map.locator('.range-label');
  await expect(ringLabels.first()).toBeVisible();
  await rings.uncheck();
  await expect(ringLabels.filter({ visible: true })).toHaveCount(0);
  await expect(layers.getByRole('checkbox', { checked: false })).toHaveCount(5);
  await rings.check();
  await expect(ringLabels.first()).toBeVisible();

  // Each entry says what its layer means.
  await expect(
    layers.getByRole('checkbox', { name: 'Velocity', exact: true }),
  ).toHaveAccessibleDescription(/fixed frame/);

  await layers.getByRole('checkbox', { name: 'Trail' }).check();
  await open.click();
  await expect(layers).toBeHidden();

  // A new battle in the same browser session keeps the choice.
  await page.reload();
  await startFreeBattle(page);
  await map.getByRole('button', { name: 'Legend' }).click();
  await expect(layers.getByRole('checkbox', { name: 'Trail' })).toBeChecked();
  await expect(layers.getByRole('checkbox', { name: 'Range rings' })).toBeChecked();
});

test('hiding planned burns hides their labels', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  await page.getByLabel('Range km').fill('150000');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  const map = page.getByRole('region', { name: 'Tactical map' });
  const burns = map.locator('.planned-burn');
  await expect(burns.filter({ visible: true })).toHaveCount(0);
  await map.getByRole('button', { name: 'Legend' }).click();
  const toggle = map.getByRole('checkbox', { name: 'Planned burns' });
  await toggle.check();
  await expect(burns.first()).toBeVisible();
  await toggle.uncheck();
  await expect(burns.filter({ visible: true })).toHaveCount(0);
  await toggle.check();
  await expect(burns.first()).toBeVisible();
});

test("each ship's heading is a nose marker on its symbol, hidden with the heading layer", async ({
  page,
}) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const map = page.getByRole('region', { name: 'Tactical map' });
  const ownHeading = map.locator('[data-side="blue"] .ship-symbol__heading');
  await expect(ownHeading).toBeVisible();
  await map.getByRole('button', { name: 'Legend' }).click();
  const toggle = map.getByRole('checkbox', { name: 'Heading' });
  await toggle.uncheck();
  await expect(ownHeading).toBeHidden();
  await toggle.check();
  await expect(ownHeading).toBeVisible();
});

test('the status panel shows closing and relative speed, with a relative velocity layer on the map', async ({
  page,
}) => {
  // Head-on, both sides left to the player so neither burns: they close at 2 km/s each.
  await page.goto('/');
  await page.getByRole('button', { name: 'Free battle' }).click();
  await page.getByLabel('Scenario').selectOption({ label: 'Head-on' });
  await chooseSide(page, 'Red', { commander: 'Player' });
  await page.getByRole('button', { name: 'Start battle' }).click();
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Closing speed')).toHaveText('4.00 km/s');
  await expect(page.getByLabel('Relative speed')).toHaveText('4.00 km/s');

  const map = page.getByRole('region', { name: 'Tactical map' });
  await map.getByRole('button', { name: 'Legend' }).click();
  const toggle = map.getByRole('checkbox', { name: 'Relative velocity' });
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(/closing/);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(map.getByRole('checkbox', { name: 'Velocity', exact: true })).toBeChecked();
});
