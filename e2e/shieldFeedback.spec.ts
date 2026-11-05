import { expect, test, type Page } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

const showShields = async (page: Page, integrity: number) => {
  await page.goto('/');
  await page.evaluate(async (integrity) => {
    const battlePath = '/src/sim/battle.ts';
    const testingPath = '/src/sim/testing.ts';
    const panelPath = '/src/ui/ordersPanel.ts';
    const { createBattle } = (await import(battlePath)) as typeof import('../src/sim/battle');
    const {
      testSetup,
      testSides,
      withSection,
      withForwardWeapon,
      TEST_LASER,
      TEST_COOLANT_SHIELD,
    } = (await import(testingPath)) as typeof import('../src/sim/testing');
    const { createOrdersPanel } = (await import(
      panelPath
    )) as typeof import('../src/ui/ordersPanel');
    const design = withSection(withForwardWeapon(TEST_LASER), 'forward', {
      components: [TEST_COOLANT_SHIELD],
    });
    const sides = testSides([design, design]);
    const blue = sides[0];
    const red = sides[1];
    if (!blue || !red) throw new Error('Missing test sides');
    const full = createBattle(testSetup({ sides })).observe(blue.id).ownShip.condition;
    // The forward shield is the first component in this fixture.
    const condition = {
      ...full,
      integrity: full.integrity.map((value, i) => (i === 0 ? integrity : value)),
    };
    const battle = createBattle(testSetup({ sides: [{ ...blue, condition }, red] }));
    const panel = createOrdersPanel((order) => {
      battle.giveOrder(blue.id, order);
    });
    panel.update(battle.observe(blue.id));
    document.getElementById('app')?.replaceChildren(panel.element);
  }, integrity);
};

test('lost shields disable both controls and explain their loss', async ({ page }) => {
  await showShields(page, 0);
  await expect(page.getByLabel('Shields state')).toHaveText('Shields unavailable · all lost');
  for (const name of ['Shields up', 'Shields down']) {
    const button = page.getByRole('button', { name });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
});

test('damaged shields distinguish the raised order from unpowered protection', async ({ page }) => {
  await showShields(page, 0.5);
  await expect(page.getByLabel('Shields state')).toHaveText('Shields raised');
  await expect(page.getByRole('button', { name: 'Shields up' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Shields down' })).toBeEnabled();
  await expect(page.getByLabel('Shield protection')).toHaveText(
    'Protection last step: 0% power · damaged shields',
  );
});

test('shield orders apply while paused and protection waits for the next step', async ({
  page,
}) => {
  await page.clock.install();
  await startFreeBattle(page, { blue: { design: 'Rime' } });
  await page.getByRole('tab', { name: 'Weapons', exact: true }).click();
  const up = page.getByRole('button', { name: 'Shields up' });
  const down = page.getByRole('button', { name: 'Shields down' });
  const state = page.getByLabel('Shields state');
  const protection = page.getByLabel('Shield protection');
  const shields = page.getByLabel('Shields', { exact: true });
  await down.click();
  await expect(state).toHaveText('Shields lowered');
  await expect(shields).toHaveText('Lowered');
  await expect(protection).toHaveText('No protection while lowered');
  await page.clock.runFor(500);
  await page.keyboard.press(' ');
  const clock = await page.locator('.battle-clock').textContent();
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  await expect(state).toHaveText('Shields raised');
  await expect(shields).toContainText('Raised · 0% power');
  await expect(protection).toHaveText('Protection last step: 0% power');
  await expect(
    page.getByText('Orders apply while paused; protection updates when the battle advances.'),
  ).toBeVisible();
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(up).toHaveAttribute('aria-pressed', 'false');
  await expect(state).toHaveText('Shields lowered');
  await expect(page.locator('.battle-clock')).toHaveText(clock ?? '');
  await up.click();
  await page.keyboard.press(' ');
  await expect(protection).toHaveText('Protection last step: 100% power');
  await expect(shields).toContainText('Raised · 100% power');
});
