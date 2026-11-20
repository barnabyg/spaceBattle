import { expect, test } from '@playwright/test';

/** Where red's own ship is drawn, for close-up screenshots. */
const SHIP = { x: 150, y: 100, width: 500, height: 260 };

/** What the page keeps between steps: the battle, seen from the ship that comes apart. */
interface WreckHarness {
  /** Advances until an event of `type` happens to red, drawing as it goes; false if none came. */
  until(type: string, limit: number): boolean;
}

test('a ship visibly vents, throws debris and loses a section as it comes apart', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const battlePath = '/src/sim/battle.ts';
    const testingPath = '/src/sim/testing.ts';
    const viewPath = '/src/ui/instrumentView.ts';
    const { createBattle } = (await import(battlePath)) as typeof import('../src/sim/battle');
    const { armedTestDesign, duelSetup, testDesign, withSection } = (await import(
      testingPath
    )) as typeof import('../src/sim/testing');
    const { createInstrumentView } = (await import(
      viewPath
    )) as typeof import('../src/ui/instrumentView');
    // Red's thin nose gives way quickly to blue's laser close in.
    const red = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 0.003 },
    });
    const battle = createBattle(duelSetup(armedTestDesign(), red, 8_000e3));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    // Seen from red: its own ship is drawn in full, coming apart.
    const sides = [...battle.sides].reverse();
    const view = createInstrumentView(sides);
    view.element.style.cssText = 'position:fixed;inset:0;width:900px;height:900px';
    document.getElementById('app')?.replaceChildren(view.element);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const draw = () => {
      view.update(battle.observe('red'));
      view.render();
    };
    // As the battle screen does: every frame, so effects move while the battle waits.
    const frame = () => {
      draw();
      requestAnimationFrame(frame);
    };
    frame();
    const harness: WreckHarness = {
      until: (type, limit) => {
        for (let t = 0; t < limit; t += 0.5) {
          const events = battle.advance(0.5);
          draw();
          if (events.some((e) => e.type === type && 'side' in e && e.side === 'red')) {
            // A moment later, so the effects have spread a little.
            draw();
            return true;
          }
        }
        return false;
      },
    };
    (window as unknown as { wreck: WreckHarness }).wreck = harness;
  });
  const until = (type: string) =>
    page.evaluate(
      ([event, limit]) => (window as unknown as { wreck: WreckHarness }).wreck.until(event, limit),
      [type, 600] as const,
    );
  expect(await until('armour-breached')).toBe(true);
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: testInfo.outputPath('breach.png'), clip: SHIP });
  expect(await until('structural-failure')).toBe(true);
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: testInfo.outputPath('section-lost.png'), clip: SHIP });
  expect(errors).toEqual([]);
});
