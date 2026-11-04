import { expect, test, type Page } from '@playwright/test';
import { timeCompressionButtons } from './freeBattle';
import { CAMPAIGN_BATTLE_TIMEOUT, CAMPAIGN_TEST_TIMEOUT } from './timeouts';

/** The credits the hub shows, as a number. */
const credits = async (page: Page): Promise<number> =>
  Number((await page.getByLabel('Credits', { exact: true }).textContent())?.replace(/\D/g, ''));

/**
 * Fights the battle on screen as a missile frigate's captain who closes in, fires freely and
 * launches every missile, at the highest time compression, until it ends. Hits and launches drop
 * time compression back to 1×, so it is raised again until the result shows.
 */
const fightToTheEnd = async (page: Page) => {
  await page.getByRole('button', { name: 'Fire freely' }).click();
  await page.getByLabel('Range km').fill('2000');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Missiles', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Launch', exact: true }).click();
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(async () => {
    if (!(await result.isVisible())) await timeCompressionButtons(page).last().click();
    // A short probe lets us restore time compression promptly after hits and launches.
    // The enclosing retry has the generous battle-completion deadline.
    await expect(result).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: CAMPAIGN_BATTLE_TIMEOUT });
  return result;
};

test('a new campaign builds its first ship, fights tier 1 and is paid for the win', async ({
  page,
}) => {
  test.setTimeout(CAMPAIGN_TEST_TIMEOUT);
  await page.goto('/');
  // Test mode for its faster time compression; the campaign plays the same.
  await page.getByRole('checkbox', { name: 'Test mode' }).check();
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campaign' })).toBeVisible();
  await expect(page.getByLabel('Credits', { exact: true })).toHaveText('9,000,000 cr');
  await expect(page.getByRole('region', { name: 'Hangar' })).toContainText('No ships yet');
  await expect(page.getByRole('button', { name: 'Fight tier 1' })).toBeDisabled();

  await page.getByRole('button', { name: 'Build Quiver' }).click();
  const afterBuilding = await credits(page);
  expect(afterBuilding).toBeLessThan(9_000_000);
  await expect(page.getByRole('region', { name: 'Hangar' })).toContainText('Ship 1');
  // Too little is left for a second frigate.
  await expect(page.getByRole('button', { name: 'Build Lance' })).toBeDisabled();

  await page.getByRole('button', { name: 'Fight tier 1' }).click();
  // The starter designs carry no intelligence components: the report says the ship goes in blind.
  await expect(page.getByRole('region', { name: 'Intelligence report' })).toContainText(
    'you go in blind',
  );
  await page.getByRole('button', { name: 'Fight', exact: true }).click();
  await expect(page.getByLabel('Own ship')).toContainText('Ship 1 · Quiver');
  const result = await fightToTheEnd(page);
  await expect(result.getByRole('heading')).toHaveText('Ship 1 wins');

  await result.getByRole('button', { name: 'Back to campaign' }).click();
  await expect(page.getByRole('status')).toHaveText('Won: paid 3,000,000 cr.');
  expect(await credits(page)).toBe(afterBuilding + 3_000_000);
  await expect(page.getByText('1 battle fought')).toBeVisible();

  // The missiles it launched are paid for to restock it.
  const condition = page.getByLabel('Ship 1 condition');
  await expect(condition).toContainText('restocking');
  const beforeRestock = await credits(page);
  await page.getByRole('button', { name: 'Restock Ship 1' }).click();
  await expect(condition).toContainText('full');
  expect(await credits(page)).toBeLessThan(beforeRestock);
});

test('a forfeited ship leaves the hangar, and with nothing left to afford the campaign is over', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Build Lance' }).click();
  const left = await credits(page);
  await page.getByRole('button', { name: 'Fight tier 1' }).click();
  await page.getByRole('button', { name: 'Fight', exact: true }).click();
  await page.getByRole('button', { name: 'End battle' }).click();
  await page.getByRole('button', { name: 'Forfeit' }).click();
  await page.getByRole('button', { name: 'Back to campaign' }).click();

  await expect(page.getByRole('status')).toHaveText('Lost, and Ship 1 with it: no pay.');
  expect(await credits(page)).toBe(left);
  await expect(page.getByRole('region', { name: 'Hangar' })).toContainText('No ships yet');
  await expect(page.getByRole('alert')).toContainText('Campaign over');
  await expect(page.getByRole('button', { name: 'Fight tier 1' })).toBeDisabled();

  await page.getByRole('button', { name: 'New campaign' }).click();
  await expect(page.getByLabel('Credits', { exact: true })).toHaveText('9,000,000 cr');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a campaign saved to a file loads again after the page is reloaded, and carries on', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Build Sling' }).click();
  const saved = await credits(page);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save campaign' }).click();
  const file = await (await download).path();
  await expect(page.getByRole('status')).toHaveText('Campaign saved.');

  // Nothing is kept by the page itself: after a reload the campaign is only in the file.
  await page.reload();
  await page.getByLabel('Load campaign').setInputFiles(file);
  await expect(page.getByRole('status')).toHaveText('Campaign loaded.');
  expect(await credits(page)).toBe(saved);
  await expect(page.getByRole('region', { name: 'Hangar' })).toContainText('Ship 1');
  await expect(page.getByRole('region', { name: 'Hangar' })).toContainText('Sling');

  // And it carries on: the ship goes into its next battle.
  await page.getByRole('button', { name: 'Fight tier 1' }).click();
  await page.getByRole('button', { name: 'Fight', exact: true }).click();
  await expect(page.getByLabel('Own ship')).toContainText('Ship 1 · Sling');

  // A file that is not a campaign is refused on the main menu.
  await page.reload();
  await page.getByLabel('Load campaign').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": "world"}'),
  });
  await expect(page.getByRole('status')).toHaveText('This is not a campaign file.');
});
