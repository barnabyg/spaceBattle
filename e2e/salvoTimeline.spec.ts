import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('an enemy salvo appears on the threat timeline and counts down to impact', async ({
  page,
}) => {
  await startFreeBattle(page, {
    blue: { design: 'Lance', commander: 'Player' },
    red: { design: 'Quiver', commander: 'Computer' },
  });
  const timeline = page.getByRole('region', { name: 'Incoming salvos' });
  await expect(timeline).toBeHidden();
  // Advance to the Quiver's first salvo; its launch at us stops the advance either way.
  await page
    .getByRole('group', { name: 'Advance until' })
    .getByRole('combobox')
    .selectOption({ label: 'Next missile launch' });
  await page.getByRole('button', { name: 'Advance', exact: true }).click();
  const entry = timeline.getByRole('listitem').first();
  await expect(entry).toContainText(/of \d+ kinetic missiles? · impact in /, { timeout: 60_000 });
  const seconds = async () => {
    const text = (await entry.textContent()) ?? '';
    const match = /impact in (?:(\d+) min )?(\d+) s/.exec(text);
    return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : NaN;
  };
  const before = await seconds();
  await page.getByRole('button', { name: '10×', exact: true }).click();
  await expect.poll(seconds, { timeout: 15_000 }).toBeLessThan(before);
});
