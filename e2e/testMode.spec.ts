import { expect, test, type Page } from '@playwright/test';
import { SIMULATION_EXPECT_TIMEOUT, SIMULATION_TEST_TIMEOUT } from './timeouts';
import {
  chooseSide,
  selectedTimeCompression,
  startFreeBattle,
  timeCompressionButtons,
} from './freeBattle';

/** Raises time compression as far as it goes: the last speed button. */
const fastest = async (page: Page) => {
  await timeCompressionButtons(page).last().click();
};

/** Switches test mode on from the main menu and goes to free battle setup. */
const setUpInTestMode = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Test mode' }).check();
  await page.getByRole('button', { name: 'Free battle' }).click();
  await expect(page.getByRole('region', { name: 'Test mode' })).toBeVisible();
};

test('no test mode feature is reachable with test mode off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('checkbox', { name: 'Test mode' })).not.toBeChecked();

  await startFreeBattle(page);
  // Setup offered no seed, time limit or batch run; the battle shows no test mode extras.
  await expect(page.getByLabel('Test mode')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Test log', includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Enemy design' })).toHaveCount(0);
  await expect(timeCompressionButtons(page)).toHaveText(['1×', '10×', '100×', '500×', '1000×']);
  await fastest(page);
  await expect(selectedTimeCompression(page)).toHaveText('1000×');

  await page.getByRole('button', { name: 'End battle' }).click();
  await page.getByRole('button', { name: 'Forfeit' }).click();
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result.getByRole('heading')).toHaveText('Red wins');
  await expect(result.getByRole('button', { name: 'Replay' })).toHaveCount(0);

  await result.getByRole('button', { name: 'Back to setup' }).click();
  await expect(page.getByRole('button', { name: 'Start battle' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Test mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run batch' })).toHaveCount(0);
  await expect(page.getByLabel('Seed')).toHaveCount(0);
  await expect(page.getByLabel('Time limit h')).toHaveCount(0);
});

test('test mode adds a time limit, the full enemy design, a test log, faster time compression and replay', async ({
  page,
}) => {
  test.setTimeout(SIMULATION_TEST_TIMEOUT);
  // The page's clock is ours to stop and run, so the battle cannot end before it is checked.
  await page.clock.install();
  await setUpInTestMode(page);
  await page.getByLabel('Seed').fill('42');
  await page.getByLabel('Time limit h').fill('0.5');
  await page.getByRole('button', { name: 'Start battle' }).click();
  await page.clock.pauseAt(Date.now() + 60_000);

  await expect(page.getByLabel('Test mode')).toHaveText(
    'Test mode · Seed 42 · Time limit 30 min 0 s',
  );
  await page.getByRole('tab', { name: 'Enemy', exact: true }).click();
  const enemy = page.getByRole('region', { name: 'Enemy design' });
  await expect(enemy).toContainText('Red · Bastion');
  await expect(enemy).toContainText('Hull size');
  await expect(enemy.getByLabel('Middle section')).toContainText('armour');
  await page.getByRole('tab', { name: 'Power', exact: true }).click();
  const radiators = page.getByLabel('Radiators', { exact: true });
  await expect(radiators).toContainText('Retracted');
  await page.getByRole('button', { name: 'Deploy radiators' }).click();
  await page.clock.runFor(1_000);
  await expect(radiators).toContainText('Deploying');
  await page.clock.runFor(5_000);
  await expect(radiators).toContainText('Deployed');

  await fastest(page);
  await page.clock.runFor(20);
  await expect(timeCompressionButtons(page)).toHaveText([
    '1×',
    '10×',
    '100×',
    '500×',
    '1000×',
    '2000×',
    '5000×',
    '10000×',
  ]);
  await expect(selectedTimeCompression(page)).toHaveText('10000×');
  // Half an hour of battle at 10000× takes less than a second.
  await page.clock.runFor(1_000);
  await page.clock.resume();
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result.getByRole('heading')).toHaveText('No result', {
    timeout: SIMULATION_EXPECT_TIMEOUT,
  });
  await expect(result).toContainText('T+00:30:00');
  await expect(page.getByRole('region', { name: 'Test log', includeHidden: true })).toContainText(
    'T+00:30:00 Battle over: No result',
  );

  await result.getByRole('button', { name: 'Replay' }).click();
  await expect(page.getByLabel('Battle time')).toHaveText(/T\+00:00:0\d/);
  await expect(page.getByLabel('Test mode')).toContainText('Seed 42');
  // The replay gives the player's orders again, at the same moments.
  await expect(radiators).toContainText('Deployed');

  // Switched off again on the main menu, test mode is gone from setup.
  await page.getByRole('button', { name: 'End battle' }).click();
  await page.getByRole('button', { name: 'Forfeit' }).click();
  await page.getByRole('button', { name: 'Back to setup' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('checkbox', { name: 'Test mode' }).uncheck();
  await page.getByRole('button', { name: 'Free battle' }).click();
  await expect(page.getByRole('button', { name: 'Start battle' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Test mode' })).toHaveCount(0);
});

test('a nuclear warhead going off near the enemy strips the mounts facing it', async ({ page }) => {
  test.setTimeout(SIMULATION_TEST_TIMEOUT);
  await setUpInTestMode(page);
  await page.getByLabel('Seed').fill('1');
  await chooseSide(page, 'Blue', { design: 'Pyre' });
  await chooseSide(page, 'Red', { design: 'Lance' });
  await page.getByRole('button', { name: 'Start battle' }).click();
  await page.keyboard.press(' ');
  await expect(page.getByLabel('Ammunition')).toHaveText('8 of 8 missiles');
  await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
  await page.getByLabel('Missiles', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Launch', exact: true }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Missiles in flight', { exact: true })).toHaveText(
    '1 ours · 0 incoming',
  );
  await fastest(page);

  // A near miss: the warhead goes off by its proximity fuse 1 km from the Lance, and its X-rays
  // wreck the laser facing the burst while the armour holds. The computer captain pulled the
  // Lance's radiators in against the hull as the missile closed, and they come through.
  const testLog = page.getByRole('region', { name: 'Test log', includeHidden: true });
  await expect(testLog).toContainText(/Blue missile \d+ detonated 10 kt 1\.00 km from Red/, {
    timeout: SIMULATION_EXPECT_TIMEOUT,
  });
  await expect(testLog).toContainText('Red laser lost (middle mount');
  await expect(testLog).not.toContainText('Red radiator lost');
  await expect(testLog).not.toContainText('armour breached');
  await expect(page.getByRole('list', { name: 'Battle log', includeHidden: true })).toContainText(
    'Nuclear warhead hit enemy · 10 kt at 1.0 km',
  );
  // With its only weapon gone, the Lance is disabled.
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result.getByRole('heading')).toHaveText('Blue wins');
});

test('anti-missile missiles intercept a salvo', async ({ page }) => {
  test.setTimeout(SIMULATION_TEST_TIMEOUT);
  await setUpInTestMode(page);
  await page.getByLabel('Seed').fill('1');
  await chooseSide(page, 'Blue', { design: 'Quiver' });
  await chooseSide(page, 'Red', { design: 'Bulwark' });
  await page.getByRole('button', { name: 'Start battle' }).click();
  await page.keyboard.press(' ');
  await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
  await page.getByLabel('Missiles', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Launch', exact: true }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByLabel('Missiles in flight', { exact: true })).toHaveText(
    '2 ours · 0 incoming',
  );

  // The Bulwark's automatic defence meets each missile with an anti-missile missile.
  const testLog = page.getByRole('region', { name: 'Test log', includeHidden: true });
  await expect(testLog).toContainText(/Red launched anti-missile missile \d+ at missile 1 /);
  await expect(testLog).toContainText(/Red launched anti-missile missile \d+ at missile 2 /);
  await expect(page.getByLabel('Anti-missile missiles in flight')).toHaveText(
    '0 ours · 2 incoming',
  );
  await fastest(page);
  await expect(testLog).toContainText(/Red anti-missile missile \d+ (shot down|missed) Blue/, {
    timeout: SIMULATION_EXPECT_TIMEOUT,
  });
  const battleLog = page.getByRole('list', { name: 'Battle log', includeHidden: true });
  await expect(battleLog).toContainText(/Our missile shot down by anti-missile missile|missed/);
});

test('a batch run reports an outcome for every battle and sums them up', async ({ page }) => {
  test.setTimeout(SIMULATION_TEST_TIMEOUT);
  await setUpInTestMode(page);
  await page.getByLabel('Seed').fill('7');
  await page.getByLabel('Time limit h').fill('0.25');
  await page.getByLabel('Battles').fill('3');
  await page.getByRole('button', { name: 'Run batch' }).click();

  await expect(page.getByRole('heading', { name: 'Batch run' })).toBeVisible();
  await expect(page.getByText('from batch seed 7')).toBeVisible();
  await expect(page.getByLabel('Batch progress')).toContainText('3 of 3 battles', {
    timeout: SIMULATION_EXPECT_TIMEOUT,
  });
  const summary = page.getByRole('region', { name: 'Batch summary' });
  // A quarter of an hour is too short for the ships to close from the opening pass.
  await expect(summary.getByLabel('No result')).toHaveText('3 (100%)');
  await expect(summary.getByLabel('Blue wins')).toHaveText('0 (0%)');
  await expect(summary.getByLabel('Red wins')).toHaveText('0 (0%)');
  await expect(summary.getByLabel('Draws')).toHaveText('0 (0%)');
  await summary.getByText('Each battle').click();
  await expect(summary.getByText(/^Battle \d · seed \d+ · No result/)).toHaveCount(3);

  await page.getByRole('button', { name: 'Back to setup' }).click();
  await expect(page.getByLabel('Battles')).toHaveValue('3');
});
