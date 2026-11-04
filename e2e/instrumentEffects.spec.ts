import { expect, test } from '@playwright/test';

test('instrument images distinguish actual weapon sources and lasting damage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const counts = await page.evaluate(async () => {
    const battlePath = '/src/sim/battle.ts';
    const testingPath = '/src/sim/testing.ts';
    const viewPath = '/src/ui/instrumentView.ts';
    const { createBattle } = (await import(battlePath)) as typeof import('../src/sim/battle');
    const { armedTestDesign, duelSetup } = (await import(
      testingPath
    )) as typeof import('../src/sim/testing');
    const { createInstrumentView } = (await import(
      viewPath
    )) as typeof import('../src/ui/instrumentView');
    const battle = createBattle(duelSetup(armedTestDesign(), armedTestDesign(), 1e6));
    const view = createInstrumentView(battle.sides);
    view.element.style.cssText = 'position:fixed;inset:0;width:800px;height:900px';
    document.getElementById('app')?.replaceChildren(view.element);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const draw = () => {
      view.update(battle.observe('blue'));
      view.render();
      const canvas = view.element.querySelector('canvas');
      const gl = canvas?.getContext('webgl2');
      if (!canvas || !gl) throw new Error('Missing instrument renderer');
      const pixels = new Uint8Array(canvas.width * Math.floor(canvas.height / 2) * 4);
      gl.readPixels(
        0,
        Math.ceil(canvas.height / 2),
        canvas.width,
        Math.floor(canvas.height / 2),
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      let cyan = 0;
      let orange = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] ?? 0;
        const g = pixels[i + 1] ?? 0;
        const b = pixels[i + 2] ?? 0;
        if (g > 100 && b > 100 && r < g * 0.8) cyan++;
        if (r > 100 && r > g * 1.5 && g > b * 1.3) orange++;
      }
      return { cyan, orange };
    };
    const initial = draw();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(15.1);
    const firing = draw();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    battle.advance(15.1);
    const damaged = draw();
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'hold-fire' });
    battle.advance(1);
    const held = draw();
    view.dispose();
    return { initial, firing, damaged, held };
  });
  expect(counts.firing.cyan).toBeGreaterThan(counts.initial.cyan + 5);
  expect(counts.held.cyan).toBeLessThan(counts.firing.cyan);
  expect(counts.damaged.orange).toBeGreaterThan(counts.initial.orange + 5);
  expect(counts.held.orange).toBeGreaterThan(counts.initial.orange + 5);
  expect(errors).toEqual([]);
});
