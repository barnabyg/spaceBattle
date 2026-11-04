import { expect, test } from '@playwright/test';

test('instrument view switches between full exterior and partial contacts while Test mode stays full', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs/research/resolved-contact-review.html');
  const telescope = page.getByLabel('Contact through telescope');
  await expect(telescope).toHaveAttribute('data-detail', 'full');
  await expect(telescope).toContainText('Full exterior detail');
  await expect(telescope).not.toContainText('Test mode');
  await page.getByRole('button', { name: 'Advance 10 seconds' }).click();
  await expect(telescope).toHaveAttribute('data-detail', 'full');
  await page.getByRole('button', { name: 'Advance 10 seconds' }).click();
  await expect(telescope).toHaveAttribute('data-detail', 'mounts');
  await expect(telescope).not.toContainText('Full exterior detail');
  await page.getByLabel('Test mode full detail').check();
  await expect(telescope).toHaveAttribute('data-detail', 'test-mode');
  await expect(telescope).toContainText('Test mode: full detail');
  await page.getByLabel('Test mode full detail').uncheck();
  await expect(telescope).toHaveAttribute('data-detail', 'mounts');
  await page.getByRole('button', { name: 'Reset approach' }).click();
  await expect(telescope).toHaveAttribute('data-detail', 'full');
  expect(errors).toEqual([]);
});
