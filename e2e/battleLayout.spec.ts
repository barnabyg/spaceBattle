import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('battle tabs keep essential status and actions visible and preserve inputs', async ({
  page,
}, testInfo) => {
  await startFreeBattle(page, { blue: { design: 'Rime' } });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Battle controls' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'Navigation',
    'Weapons',
    'Power',
    'Status',
    'Damage',
  ]);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Navigation');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeInViewport();
  await page.getByLabel('Range km').fill('123456');
  await page.getByLabel('Azimuth °').fill('17');
  const summary = page.getByRole('region', { name: 'Essential status' });
  const original = await summary.boundingBox();
  for (const name of ['Weapons', 'Power', 'Status', 'Damage']) {
    await tabs.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName(name);
    await page.getByRole('tabpanel').evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight;
    });
    await expect(summary).toBeInViewport();
    expect(await summary.boundingBox()).toEqual(original);
    for (const label of [
      'Separation',
      'Closing speed',
      'Delta-v',
      'Temperature',
      'Incoming missiles',
    ]) {
      await expect(summary.getByLabel(label, { exact: true })).toBeInViewport();
    }
    await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'End battle', exact: true })).toBeInViewport();
  }
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Navigation');
  await expect(page.getByLabel('Range km')).toHaveValue('123456');
  await expect(page.getByLabel('Azimuth °')).toHaveValue('17');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Damage');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Navigation');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Damage');
  await tabs.getByRole('tab', { name: 'Power', exact: true }).click();
  await page.getByRole('tabpanel').evaluate((panel) => {
    panel.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('battle-power.png') });
  const clock = await page.getByLabel('Battle time').textContent();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await tabs.getByRole('tab', { name: 'Weapons', exact: true }).click();
  await expect(page.getByLabel('Battle time')).not.toHaveText(clock ?? '');
});
