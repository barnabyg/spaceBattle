import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('Lance makes unavailable defence controls visibly disabled and explains why', async ({
  page,
}) => {
  await startFreeBattle(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const [name, reason] of [
    ['Shields up', 'No shields installed'],
    ['Shields down', 'No shields installed'],
    ['Automatic', 'No anti-missile missiles installed'],
    ['By order only', 'No anti-missile missiles installed'],
    ['Launch at nearest missile', 'No anti-missile missiles installed'],
    ['Missiles only', 'No point defence installed'],
    ['Missiles, then ship', 'No point defence installed'],
  ]) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleDescription(reason ?? '');
    await button.hover({ force: true });
    expect(await button.evaluate((b) => getComputedStyle(b).cursor)).toBe('not-allowed');
    expect(await button.evaluate((b) => getComputedStyle(b).borderTopStyle)).toBe('dashed');
  }
  await expect(page.getByLabel('Shields state')).toContainText('none installed');
  await expect(page.getByLabel('Anti-missile state')).toContainText('No anti-missile missiles');
  await expect(page.getByLabel('Point defence state')).toHaveText('No point defence installed');
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
