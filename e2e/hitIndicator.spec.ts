import { expect, test } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

test('hit schematic stays visible across sidebar tabs', async ({ page }, testInfo) => {
  await startFreeBattle(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const indicator = page.getByRole('region', { name: 'Own ship hit indicator' });
  await expect(indicator).toBeInViewport();
  await expect(indicator.locator('[data-section]')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('hit-indicator-layout.png') });
  for (const tab of ['Weapons', 'Power', 'Status', 'Damage', 'Navigation']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('tabpanel').evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight;
    });
    await expect(indicator).toBeInViewport();
  }
});

test('unresolved enemy hit pulses the struck section even when a shot falls between frames', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { armedTestDesign, duelSetup } = await import('../src/sim/testing');
    const { createHitIndicator } = await import('../src/ui/hitIndicator');
    const battle = createBattle(duelSetup(armedTestDesign(), armedTestDesign(), 30_000e3));
    const indicator = createHitIndicator();
    document.getElementById('app')?.replaceChildren(indicator.element);
    const active = () =>
      [...indicator.element.querySelectorAll('.is-hit')].map((s) => s.getAttribute('data-section'));
    indicator.update(battle.observe('blue'), [], 0);
    const initial = active();
    // Our own firing must not light our damage schematic.
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    indicator.update(battle.observe('blue'), battle.advance(16.5), 1);
    const outgoing = active();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    const events = battle.advance(16.5);
    const observation = battle.observe('blue');
    indicator.update(observation, events, 2);
    const incoming = active();
    const accessibleHit = indicator.element.querySelector('.is-hit')?.getAttribute('aria-label');
    // Red is no longer emitting at this snapshot, and its weapon mount is unresolved.
    const enemyFiring = observation.contacts[0]?.appearance.firing;
    const landed = observation.ownShip.appearance.beamsLanding.length;
    indicator.update(observation, [], 3);
    const held = active();
    indicator.update(observation, [], 3.6);
    const cleared = active();
    return {
      initial,
      outgoing,
      incoming,
      accessibleHit,
      enemyFiring,
      landed,
      held,
      cleared,
    };
  });
  expect(result.initial).toEqual([]);
  expect(result.outgoing).toEqual([]);
  expect(result.enemyFiring).toEqual([]);
  expect(result.landed).toBe(0);
  expect(result.incoming).toEqual(['forward']);
  expect(result.accessibleHit).toBe('Forward: hit');
  await expect(page.locator('.hit-indicator__section--forward')).toHaveCSS(
    'background-color',
    'rgb(23, 39, 55)',
  );
  expect(result.held).toEqual(['forward']);
  expect(result.cleared).toEqual([]);
});

test('battle screen shows incoming nuclear exposures on the schematic', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { createBattleRunner } = await import('../src/game/battleRunner');
    const { createBattleScreen } = await import('../src/ui/battleScreen');
    const { armedTestDesign, duelSetup, launchingTestDesign, TEST_NUCLEAR_MISSILE } =
      await import('../src/sim/testing');
    const setup = duelSetup(
      armedTestDesign(),
      launchingTestDesign(1, { missile: TEST_NUCLEAR_MISSILE }),
      1_000e3,
    );
    // Keep the launcher from withdrawing after spending its only missile and slowing time.
    const battle = createBattle({
      ...setup,
      sides: setup.sides.map((side) => ({ ...side, commander: 'player' })),
    });
    battle.giveOrder('red', { type: 'launch', target: 'blue', missiles: 1 });
    const runner = createBattleRunner(battle);
    runner.setTimeCompression(1000);
    const screen = createBattleScreen(runner);
    document.getElementById('app')?.replaceChildren(screen.element);
  });
  const indicator = page.getByRole('region', { name: 'Own ship hit indicator' });
  await expect(indicator.locator('.is-hit').first()).toBeVisible();
  await expect(indicator.locator('.is-hit').first()).toHaveCSS(
    'background-color',
    'rgb(166, 33, 49)',
  );
  await expect(indicator.locator('.is-hit .hit-indicator__state').first()).toHaveText('Hit');
  await page.screenshot({ path: testInfo.outputPath('incoming-hit.png') });
});
