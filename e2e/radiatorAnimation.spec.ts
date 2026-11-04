import { expect, test } from '@playwright/test';
import { startFreeBattle, timeCompressionButton } from './freeBattle';

test('radiators visibly extend during deployment, freeze paused and fold on cancellation', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install();
  // Both sides idle: changes in this view must come from the radiator panels.
  await startFreeBattle(page, { red: { commander: 'Player' } });
  await page.clock.pauseAt(Date.now() + 60_000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.runFor(32);
  const own = page.getByLabel('Own ship', { exact: true });
  const status = page.getByLabel('Radiators', { exact: true });
  const capture = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    const buffer = await own.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
    return buffer;
  };
  const folded = await capture('folded');
  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.clock.runFor(2_500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.runFor(32);
  await expect(status).toContainText('Deploying');
  const halfway = await capture('halfway');
  expect(halfway.equals(folded)).toBe(false);
  await page.clock.runFor(1_000);
  expect((await own.screenshot()).equals(halfway)).toBe(true);

  await page.getByRole('button', { name: 'Retract radiators' }).click();
  await page.clock.runFor(32);
  await expect(status).toContainText('Retracted');
  expect((await own.screenshot()).equals(folded)).toBe(true);

  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.clock.runFor(5_200);
  await expect(status).toContainText('Deployed');
  const deployed = await capture('deployed');
  expect(deployed.equals(folded)).toBe(false);
  expect(deployed.equals(halfway)).toBe(false);
  await page.getByRole('button', { name: 'Retract radiators' }).click();
  await timeCompressionButton(page, '10×').click();
  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await page.clock.runFor(600);
  await expect(status).toContainText('Deployed');
  expect(errors).toEqual([]);
});
