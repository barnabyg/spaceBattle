import { expect, test } from '@playwright/test';
import { selectedTimeCompression, timeCompressionButton } from './freeBattle';

for (const scenario of ['routine', 'own-damage', 'contact-damage']) {
  test(`time compression and accessible slowdown reason: ${scenario}`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (scenario) => {
      const damage = scenario !== 'routine';
      const { createBattle } = await import('../src/sim/battle');
      const { armedTestDesign, testDesign, duelSetup } = await import('../src/sim/testing');
      const { IDENTITY } = await import('../src/sim/quaternion');
      const { createBattleRunner } = await import('../src/game/battleRunner');
      const { createTimeControls } = await import('../src/ui/timeControls');
      const { createDamagePanel } = await import('../src/ui/damagePanel');
      const viewer = scenario === 'own-damage' ? 'red' : 'blue';
      // Facing blue, red loses its forward section well before the battle ends.
      const setup = duelSetup(
        armedTestDesign(),
        testDesign(),
        damage ? 20_000e3 : 50_000e3,
        scenario === 'contact-damage' ? undefined : IDENTITY,
      );
      // The viewer is the player's side; the other is the computer's.
      const battle = createBattle({
        ...setup,
        sides: setup.sides.map((side) => ({
          ...side,
          commander: side.id === viewer ? 'player' : 'computer',
        })),
      });
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      const runner = createBattleRunner(battle);
      const controls = createTimeControls(runner, viewer);
      const panel = createDamagePanel(viewer);
      const initialSections = battle.observe(viewer).ownShip.sections;
      document.body.replaceChildren(controls.element, panel.element);
      runner.setTimeCompression(1000);
      runner.update(0.1);
      if (scenario === 'own-damage') {
        while (!runner.slowdownEvent && battle.time < 3600) runner.update(0.1);
      }
      if (scenario === 'contact-damage') {
        // The player's lasers damage the contact, which no longer slows time.
        let enemyDamaged = false;
        while (!enemyDamaged && !battle.outcome && battle.time < 3600) {
          enemyDamaged = runner
            .update(0.1)
            .some(
              (e) =>
                (e.type === 'armour-breached' ||
                  e.type === 'component-lost' ||
                  e.type === 'structural-failure') &&
                e.side === 'red',
            );
        }
        if (!enemyDamaged) throw new Error('Reproduction requires damage to the contact');
        if (
          JSON.stringify(battle.observe(viewer).ownShip.sections) !==
          JSON.stringify(initialSections)
        ) {
          throw new Error('Reproduction requires an undamaged player ship');
        }
      }
      panel.update(battle.observe(viewer));
      // Render continuously as the battle screen does, with simulation time held fixed.
      const render = () => {
        controls.update();
        requestAnimationFrame(render);
      };
      render();
    }, scenario);
    const reason = page.getByRole('status', { name: 'Time compression change' });
    if (scenario === 'own-damage') {
      await expect(selectedTimeCompression(page)).toHaveText('1×');
      await expect(reason).toContainText('Slowed to 1×: Red:');
      await expect(reason).toContainText(/armour breached|lost/);
      const message = await reason.textContent();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(reason).toHaveText(message ?? '');
      await timeCompressionButton(page, '100×').click();
      await expect(selectedTimeCompression(page)).toHaveText('100×');
    } else {
      await expect(selectedTimeCompression(page)).toHaveText('1000×');
    }
    if (scenario === 'contact-damage') {
      await expect(page.locator('.damage-integrity').filter({ hasText: /^100%$/ })).toHaveCount(
        await page.locator('.damage-integrity').count(),
      );
    }
    await expect(reason).toBeEmpty();
  });
}
