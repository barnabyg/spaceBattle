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

test('a design exported, deleted and imported again is the same design', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shipyard' }).click();
  await page.getByLabel('Class name').fill('Plover');
  await page.getByRole('button', { name: 'Save design' }).click();
  const library = page.getByRole('region', { name: 'Saved designs' });

  const download = page.waitForEvent('download');
  await library.getByRole('button', { name: 'Export Plover class' }).click();
  const file = await (await download).path();
  await library.getByRole('button', { name: 'Delete Plover class' }).click();
  await expect(library).not.toContainText('Plover class');

  await library.getByLabel('Import design').setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('Imported Plover class.');
  await expect(library).toContainText('Plover class');
  await expect(page.getByLabel('Class name')).toHaveValue('Plover');

  // Something that is not a design is refused with a reason.
  await library.getByLabel('Import design').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": "world"}'),
  });
  await expect(page.getByRole('status')).toHaveText('This is not a design file.');
});
