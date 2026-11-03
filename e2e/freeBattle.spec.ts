import { expect, test } from '@playwright/test';
import { chooseSide, startFreeBattle } from './freeBattle';

test('a free battle goes from the main menu through setup and the battle to its result', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Space Battle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Campaign' })).toBeDisabled();
  await page.getByRole('button', { name: 'Free battle' }).click();

  // Setup: a design and a commander for each side, with the design's key numbers.
  const blue = page.getByRole('region', { name: 'Blue side' });
  const red = page.getByRole('region', { name: 'Red side' });
  await expect(blue.getByLabel('Hull size')).toHaveText('Frigate');
  await expect(red.getByLabel('Hull size')).toHaveText('Cruiser');
  await expect(blue.getByLabel('Lasers')).toContainText('reach');
  await expect(blue.getByLabel('Charged particle beams')).toHaveText('None');
  await chooseSide(page, 'Blue', { design: 'Bastion' });
  await chooseSide(page, 'Red', { design: 'Lance' });
  await expect(blue.getByLabel('Hull size')).toHaveText('Cruiser');
  await expect(blue.getByLabel('Commander')).toHaveValue('player');
  await expect(red.getByLabel('Commander')).toHaveValue('computer');
  // The player commands one side at most.
  await red.getByLabel('Commander').selectOption('player');
  await expect(blue.getByLabel('Commander')).toHaveValue('computer');
  await blue.getByLabel('Commander').selectOption('player');
  await expect(red.getByLabel('Commander')).toHaveValue('computer');
  await page.getByRole('button', { name: 'Start battle' }).click();

  // The battle, seen from the player's side, fighting the chosen designs.
  const map = page.getByRole('region', { name: 'Tactical map' });
  await expect(map.locator('canvas')).toBeVisible();
  await expect(page.getByLabel('Own ship')).toContainText('Blue · Bastion');
  await expect(page.getByLabel('Contact through telescope')).toContainText('Red · Lance');

  await page.getByRole('button', { name: 'End battle' }).click();
  await page
    .getByRole('dialog', { name: 'End battle' })
    .getByRole('button', { name: 'Forfeit' })
    .click();
  const result = page.getByRole('dialog', { name: 'Battle result' });
  await expect(result.getByRole('heading')).toHaveText('Red wins');

  // Back to setup, with the choices kept; and from there back to the main menu.
  await result.getByRole('button', { name: 'Back to setup' }).click();
  await expect(blue.getByLabel('Design')).toHaveValue('bastion');
  await expect(red.getByLabel('Design')).toHaveValue('lance');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Free battle' })).toBeVisible();
});

test('the chosen scenario sets where the ships start and is kept for the next battle', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Free battle' }).click();
  const scenario = page.getByLabel('Scenario');
  await expect(scenario).toHaveValue('opening-pass');
  await scenario.selectOption({ label: 'Head-on' });
  await expect(page.getByText('The ships fly straight at each other, nose to nose.')).toBeVisible();
  await expect(page.getByLabel('Starting geometry')).toHaveText(
    '300,000 km apart · relative speed 4.00 km/s · closing at 4.00 km/s',
  );
  await page.getByRole('button', { name: 'Start battle' }).click();

  // The ships start 300 000 km apart and close at 2 km/s each.
  await expect(page.getByLabel('Separation')).toHaveText(/^(300,000|299,\d{3}) km$/);
  await expect(page.getByLabel('Own speed')).toHaveText(/^2\.\d\d km\/s$/);

  await page.getByRole('button', { name: 'End battle' }).click();
  await page.getByRole('button', { name: 'Forfeit' }).click();
  await page.getByRole('button', { name: 'Back to setup' }).click();
  await expect(scenario).toHaveValue('head-on');
});

test('a computer-vs-computer battle is watched, takes no orders and ends with no result', async ({
  page,
}) => {
  await startFreeBattle(page, { blue: { commander: 'Computer' } });
  await expect(page.getByRole('region', { name: 'Orders' })).toHaveCount(0);
  await expect(page.getByText('Blue is commanded by the computer.')).toBeVisible();

  await page.getByRole('button', { name: 'End battle' }).click();
  const confirm = page.getByRole('dialog', { name: 'End battle' });
  await expect(confirm).toContainText('no result');
  await confirm.getByRole('button', { name: 'End battle' }).click();
  await expect(page.getByRole('dialog', { name: 'Battle result' }).getByRole('heading')).toHaveText(
    'No result',
  );
});

test('battles fought one after another release the last one', async ({ page }) => {
  await startFreeBattle(page);
  const firstCanvases = await page.locator('canvas').elementHandles();
  expect(firstCanvases).toHaveLength(2);

  for (let battle = 0; battle < 2; battle++) {
    await page.getByRole('button', { name: 'End battle' }).click();
    await page.getByRole('button', { name: 'Forfeit' }).click();
    await page.getByRole('button', { name: 'Back to setup' }).click();
    await page.getByRole('button', { name: 'Start battle' }).click();
    await expect(page.locator('canvas')).toHaveCount(2);
  }

  // The first battle's WebGL contexts were given up, not left for the garbage collector.
  for (const canvas of firstCanvases) {
    expect(
      await canvas.evaluate((c: HTMLCanvasElement) => {
        const gl = c.getContext('webgl2') ?? c.getContext('webgl');
        return gl?.isContextLost() ?? false;
      }),
    ).toBe(true);
  }

  // One keyboard handler drives the battle on screen: Space pauses it, and again resumes it.
  const compression = page.getByLabel('Time compression');
  await page.keyboard.press(' ');
  await expect(compression).toHaveText('Paused');
  await page.keyboard.press(' ');
  await expect(compression).toHaveText('1×');
});
