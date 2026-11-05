import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('Lance hides unfitted equipment and keeps incoming munition readouts', async ({ page }) => {
  await startFreeBattle(page);
  await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const name of [
    'Shields up',
    'Shields down',
    'Automatic',
    'By order only',
    'Launch at nearest missile',
    'Missiles only',
    'Missiles, then ship',
    'Launch',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  for (const label of ['Shields', 'Shields priority', 'Point defence', 'Ammunition']) {
    await expect(page.getByLabel(label, { exact: true })).toBeHidden();
  }
  await expect(page.getByLabel('Missiles in flight', { exact: true })).toBeVisible();
});

for (const { design, first, second } of [
  { design: 'Rime', first: 'Shields up', second: 'Shields down' },
  { design: 'Bulwark', first: 'Automatic', second: 'By order only' },
  { design: 'Rampart', first: 'Missiles only', second: 'Missiles, then ship' },
]) {
  test(`${design} keeps its installed defence selection highlighted like Target enemy`, async ({
    page,
  }, testInfo) => {
    await startFreeBattle(page, { blue: { design } });
    await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const target = page.getByRole('button', { name: 'Target enemy', exact: true });
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    const selectedBackground = await target.evaluate((b) => getComputedStyle(b).backgroundColor);
    const a = page.getByRole('button', { name: first, exact: true });
    const b = page.getByRole('button', { name: second, exact: true });
    for (const [selected, other] of [
      [b, a],
      [a, b],
    ]) {
      if (!selected || !other) throw new Error('Missing toggle pair');
      await expect(selected).toBeEnabled();
      await selected.click();
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      await expect(other).toHaveAttribute('aria-pressed', 'false');
      await other.hover();
      expect(await selected.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(
        selectedBackground,
      );
      expect(await other.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(
        selectedBackground,
      );
      expect(
        await selected.evaluate((button) => getComputedStyle(button, '::before').content),
      ).toContain('✓');
    }
    await testInfo.attach(`${design} selected controls`, {
      body: await a.locator('..').screenshot(),
      contentType: 'image/png',
    });
  });
}
