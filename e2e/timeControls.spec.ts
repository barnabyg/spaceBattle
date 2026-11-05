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
      const battle = createBattle(
        duelSetup(armedTestDesign(), testDesign(), damage ? 20_000e3 : 50_000e3, IDENTITY),
      );
      battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
      const runner = createBattleRunner(battle);
      const controls = createTimeControls(runner, scenario === 'own-damage' ? 'red' : 'blue');
      const viewer = scenario === 'own-damage' ? 'red' : 'blue';
      const panel = createDamagePanel(viewer);
      const initialSections = battle.observe(viewer).ownShip.sections;
      document.body.replaceChildren(controls.element, panel.element);
      runner.setTimeCompression(1000);
      runner.update(0.1);
      if (damage) {
        while (!runner.slowdownEvent && battle.time < 3600) runner.update(0.1);
      }
      panel.update(battle.observe(viewer));
      if (scenario === 'contact-damage') {
        // Reproduce the report: enemy damage slows time while the player's ship is intact.
        if (
          JSON.stringify(battle.observe(viewer).ownShip.sections) !==
          JSON.stringify(initialSections)
        ) {
          throw new Error('Reproduction requires an undamaged player ship');
        }
        if (
          !runner.slowdownEvent ||
          !('side' in runner.slowdownEvent) ||
          runner.slowdownEvent.side !== 'red'
        ) {
          throw new Error('Reproduction requires damage to the contact');
        }
      }
      // Render continuously as the battle screen does, with simulation time held fixed.
      const render = () => {
        controls.update();
        requestAnimationFrame(render);
      };
      render();
    }, scenario);
    const majorDamage = scenario !== 'routine';
    const reason = page.getByRole('status', { name: 'Time compression change' });
    await expect(selectedTimeCompression(page)).toHaveText(majorDamage ? '1×' : '1000×');
    if (majorDamage) {
      if (scenario === 'own-damage') {
        await expect(reason).toContainText('Slowed to 1×: Red:');
        await expect(reason).toContainText(/armour breached|lost/);
      } else {
        await expect(reason).toHaveText('Slowed to 1×: Enemy combat damage (details unavailable)');
        await expect(page.locator('.damage-integrity').filter({ hasText: /^100%$/ })).toHaveCount(
          await page.locator('.damage-integrity').count(),
        );
        await expect(page.getByRole('region', { name: 'Damage', exact: true })).not.toContainText(
          /armour breached|lost|structural failure/,
        );
      }
      const message = await reason.textContent();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(reason).toHaveText(message ?? '');
      await timeCompressionButton(page, '100×').click();
      await expect(selectedTimeCompression(page)).toHaveText('100×');
    }
    await expect(reason).toBeEmpty();
  });
}
