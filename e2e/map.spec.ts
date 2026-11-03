import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

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
  await expect(toggles).toHaveCount(10);
  for (const toggle of await toggles.all()) await expect(toggle).toBeChecked();

  // Hiding the range rings hides their labels too, and leaves every other layer shown.
  const rings = layers.getByRole('checkbox', { name: 'Range rings' });
  const ringLabels = map.locator('.range-label');
  await expect(ringLabels.first()).toBeVisible();
  await rings.uncheck();
  await expect(ringLabels.filter({ visible: true })).toHaveCount(0);
  await expect(layers.getByRole('checkbox', { checked: false })).toHaveCount(1);
  await rings.check();
  await expect(ringLabels.first()).toBeVisible();

  // Each entry says what its layer means.
  await expect(layers.getByRole('checkbox', { name: 'Velocity' })).toHaveAccessibleDescription(
    /fixed frame/,
  );

  await layers.getByRole('checkbox', { name: 'Trail' }).uncheck();
  await open.click();
  await expect(layers).toBeHidden();

  // A new battle in the same browser session keeps the choice.
  await page.reload();
  await startFreeBattle(page);
  await map.getByRole('button', { name: 'Legend' }).click();
  await expect(layers.getByRole('checkbox', { name: 'Trail' })).not.toBeChecked();
  await expect(layers.getByRole('checkbox', { name: 'Range rings' })).toBeChecked();
});

test('hiding planned burns hides their labels', async ({ page }) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  await page.getByLabel('Range km').fill('150000');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  const map = page.getByRole('region', { name: 'Tactical map' });
  const burns = map.locator('.planned-burn');
  await expect(burns.first()).toBeVisible();
  await map.getByRole('button', { name: 'Legend' }).click();
  const toggle = map.getByRole('checkbox', { name: 'Planned burns' });
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
