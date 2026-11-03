import { expect, test } from '@playwright/test';
import { chooseSide } from './freeBattle';

test('a design made in the shipyard is saved and fights a free battle', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shipyard' }).click();
  await expect(page.getByRole('heading', { name: 'Shipyard' })).toBeVisible();

  // A new design starts as a laser frigate waiting for a name.
  const problems = page.getByRole('list', { name: 'Problems' });
  await expect(problems).toContainText('Name the design.');
  const save = page.getByRole('button', { name: 'Save design' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Class name').fill('Heron');
  await expect(problems).toBeHidden();

  // Adding a component shows in its cost and volume at once; a gun with no slugs is refused.
  const cost = page.getByLabel('Cost', { exact: true });
  const before = await cost.textContent();
  await page.getByLabel('Component', { exact: true }).selectOption({ label: 'Kinetic gun' });
  await page.getByRole('button', { name: 'Add component' }).click();
  await expect(cost).not.toHaveText(before ?? '');
  await expect(problems).toContainText('Kinetic guns need a magazine of slugs.');
  await page
    .getByLabel('Component', { exact: true })
    .selectOption({ label: 'Magazine, 600 slugs' });
  await page.getByRole('button', { name: 'Add component' }).click();
  await expect(problems).toBeHidden();
  await expect(page.getByLabel('Middle volume')).toHaveText(/^[\d,]+ of 2,880 m³$/);
  await expect(page.getByRole('region', { name: 'Model preview' }).locator('canvas')).toBeVisible();

  await save.click();
  await expect(page.getByRole('status')).toHaveText('Saved Heron class.');
  await expect(page.getByRole('region', { name: 'Saved designs' })).toContainText('Heron class');

  // The saved design is offered in free battle setup and fought with.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Free battle' }).click();
  await chooseSide(page, 'Blue', { design: 'Heron class' });
  await expect(
    page.getByRole('region', { name: 'Blue side' }).getByLabel('Kinetic guns'),
  ).toContainText('600 slugs');
  await page.getByRole('button', { name: 'Start battle' }).click();
  await expect(page.getByLabel('Own ship')).toContainText('Blue · Heron class');
});
