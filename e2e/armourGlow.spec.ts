import { expect, test } from '@playwright/test';

/** What the page keeps between steps: the battle and a way to count the contact's glow. */
interface GlowHarness {
  advance(seconds: number): void;
  holdFire(): void;
  /**
   * Glowing pixels in the contact's half of the view, the lower one: bright orange to white, not
   * the contact's own red.
   */
  draw(): number;
  noseTemperature(): number;
  landings(): number;
}

test('struck armour glows on the contact after the beam stops, then fades as it cools', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const initial = await page.evaluate(async () => {
    const battlePath = '/src/sim/battle.ts';
    const testingPath = '/src/sim/testing.ts';
    const beamsPath = '/src/sim/beams.ts';
    const viewPath = '/src/ui/instrumentView.ts';
    const { createBattle } = (await import(battlePath)) as typeof import('../src/sim/battle');
    const { armedTestDesign, duelSetup, TEST_LASER, testDesign, withSection } = (await import(
      testingPath
    )) as typeof import('../src/sim/testing');
    const { effectiveRange } = (await import(beamsPath)) as typeof import('../src/sim/beams');
    const { createInstrumentView } = (await import(
      viewPath
    )) as typeof import('../src/ui/instrumentView');
    // At 70% of its reach the laser lands below what ablative armour sheds: it only glows.
    const target = withSection(testDesign(), 'forward', {
      armour: { type: 'ablative', thickness: 0.05 },
    });
    const battle = createBattle(
      duelSetup(armedTestDesign(), target, 0.7 * effectiveRange(TEST_LASER)),
    );
    const view = createInstrumentView(battle.sides);
    view.element.style.cssText = 'position:fixed;inset:0;width:800px;height:900px';
    document.getElementById('app')?.replaceChildren(view.element);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const harness: GlowHarness = {
      advance: (seconds) => {
        battle.advance(seconds);
      },
      holdFire: () => {
        battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
      },
      draw: () => {
        view.update(battle.observe('blue'));
        view.render();
        const canvas = view.element.querySelector('canvas');
        const gl = canvas?.getContext('webgl2');
        if (!canvas || !gl) throw new Error('Missing instrument renderer');
        const rows = Math.floor(canvas.height / 2);
        const pixels = new Uint8Array(canvas.width * rows * 4);
        gl.readPixels(0, 0, canvas.width, rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let warm = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] ?? 0;
          const g = pixels[i + 1] ?? 0;
          const b = pixels[i + 2] ?? 0;
          if (r > 200 && g > 120 && g > b) warm++;
        }
        return warm;
      },
      noseTemperature: () =>
        battle.observe('red').ownShip.sections.find((s) => s.kind === 'forward')
          ?.surfaceTemperature ?? 0,
      landings: () => battle.observe('blue').contacts[0]?.appearance.beamsLanding.length ?? -1,
    };
    (window as unknown as { glow: GlowHarness }).glow = harness;
    const before = harness.draw();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    return before;
  });
  const glowing = await page.evaluate(() => {
    const { glow } = window as unknown as { glow: GlowHarness };
    glow.advance(30);
    glow.holdFire();
    // The last light lands well within a second; then only the armour's glow is left.
    glow.advance(1);
    return { warm: glow.draw(), temperature: glow.noseTemperature(), landings: glow.landings() };
  });
  await page.screenshot({ path: testInfo.outputPath('armour-glow.png') });
  const cooled = await page.evaluate(() => {
    const { glow } = window as unknown as { glow: GlowHarness };
    glow.advance(120);
    return { warm: glow.draw(), temperature: glow.noseTemperature() };
  });
  expect(glowing.landings).toBe(0);
  expect(glowing.temperature).toBeGreaterThan(1_500);
  expect(glowing.warm).toBeGreaterThan(initial + 20);
  expect(cooled.temperature).toBeLessThan(500);
  expect(cooled.warm).toBeLessThan(glowing.warm);
  expect(errors).toEqual([]);
});
