import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('positions remain identifiable at vector origins with motion layers hidden and shown', async ({
  page,
}, testInfo) => {
  await startFreeBattle(page);
  await page.keyboard.press(' ');
  const map = page.getByRole('region', { name: 'Tactical map' });
  const own = map.getByRole('img', { name: 'Blue own ship position' });
  const contact = map.getByRole('img', { name: 'Red contact position' });
  await expect(own).toBeVisible();
  await expect(contact).toBeVisible();
  await expect(own).toBeInViewport({ ratio: 1 });
  await expect(contact).toBeInViewport({ ratio: 1 });
  await expect(own).toContainText('Blue');
  await expect(contact).toContainText('Red');
  const before = await own.boundingBox();
  await map.getByRole('button', { name: 'Legend' }).click();
  await expect(map.getByText('Ship positions', { exact: true })).toBeVisible();
  for (const name of ['Velocity', 'Relative velocity']) {
    const toggle = map.getByRole('checkbox', { name, exact: true });
    await toggle.uncheck();
    await expect(own).toBeVisible();
    await expect(contact).toBeVisible();
    expect(await own.boundingBox()).toEqual(before);
    await toggle.check();
  }
  await map.getByRole('button', { name: 'Legend' }).click();
  const surface = map.locator('.tactical-map__labels');
  await surface.hover();
  await page.mouse.wheel(0, 200);
  const box = await surface.boundingBox();
  if (!box) throw new Error('Missing map');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 10 });
  await page.mouse.up();
  await expect(own).toBeVisible();
  await expect(contact).toBeVisible();
  const screenshot = testInfo.outputPath('map-positions.png');
  await map.screenshot({ path: screenshot });
  await testInfo.attach('Positions and open motion arrowheads', {
    path: screenshot,
    contentType: 'image/png',
  });
});

test('overlapping stationary ships keep both position symbols and labels without motion arrows', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { testSetup } = await import('../src/sim/testing');
    const { createTacticalMap } = await import('../src/ui/tacticalMap');
    const setup = testSetup();
    const battle = createBattle({
      ...setup,
      scenario: {
        name: 'Stationary overlap',
        starts: [0, 1].map(() => ({
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        })),
      },
    });
    const map = createTacticalMap(setup.sides);
    map.element.style.cssText = 'position: fixed; inset: 0;';
    document.body.replaceChildren(map.element);
    map.update(battle.observe('blue'));
    map.render();
  });
  await expect(page.getByRole('img', { name: 'Blue own ship position' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Red contact position' })).toBeVisible();
  await expect(page.locator('.motion-tip')).toHaveCount(0);
  const labels = page.locator('.ship-symbol__label');
  const ownBox = await labels.nth(0).boundingBox();
  const contactBox = await labels.nth(1).boundingBox();
  if (!ownBox || !contactBox) throw new Error('Missing position labels');
  expect(Math.abs(ownBox.y - contactBox.y)).toBeGreaterThan(ownBox.height);
});
