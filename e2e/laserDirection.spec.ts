import { expect, test } from '@playwright/test';

test('beam arrows identify both firing sides and clear with fire or the beam layer', async ({
  page,
}) => {
  await page.goto('/');
  const readings = await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { armedTestDesign, duelSetup } = await import('../src/sim/testing');
    const { createTacticalMap } = await import('../src/ui/tacticalMap');
    const setup = duelSetup(armedTestDesign(), armedTestDesign(), 1_000_000);
    const battle = createBattle(setup);
    const map = createTacticalMap(setup.sides);
    Object.assign(map.element.style, { width: '1000px', height: '700px' });
    document.body.replaceChildren(map.element);
    const update = () => {
      map.update(battle.observe('blue'));
      map.render();
    };
    const visible = () =>
      [...map.element.querySelectorAll('.beam-direction')]
        .filter((mark) => getComputedStyle(mark).display !== 'none')
        .map((mark) => {
          const chevrons = mark.querySelector('.beam-direction__chevrons');
          if (!(chevrons instanceof HTMLElement)) throw new Error('Missing beam arrow');
          return {
            label: mark.getAttribute('aria-label'),
            angle: chevrons.style.getPropertyValue('--angle'),
            size: getComputedStyle(chevrons).width,
          };
        });
    update();
    const idle = visible();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
    battle.advance(15.1);
    update();
    const firing = visible();
    // Move the ships and resize the viewport: labels and fixed-size chevrons still identify
    // the source and destination, independent of map scale.
    battle.giveOrder('blue', { type: 'burn', throttle: 0.5, duration: 1 });
    battle.advance(0.1);
    map.element.style.width = '800px';
    map.element
      .querySelector('.tactical-map__labels')
      ?.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true, cancelable: true }));
    update();
    const moving = visible();
    const toggle = map.element.querySelector('[data-layer="beams"] input');
    if (!(toggle instanceof HTMLInputElement)) throw new Error('Missing beam toggle');
    toggle.click();
    map.render();
    const hidden = visible();
    toggle.click();
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.advance(0.1);
    update();
    const incoming = visible();
    battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'hold-fire' });
    battle.advance(0.1);
    update();
    const stopped = visible();
    map.dispose();
    map.element.remove();
    return { idle, firing, moving, hidden, incoming, stopped };
  });
  expect(readings.idle).toEqual([]);
  expect(readings.firing.map((mark) => mark.label)).toEqual([
    'Blue laser fire toward Red',
    'Red laser fire toward Blue',
  ]);
  expect(readings.firing.every((mark) => mark.angle.endsWith('rad'))).toBe(true);
  expect(readings.firing[0]?.angle).not.toBe(readings.firing[1]?.angle);
  expect(readings.moving.map((mark) => mark.label)).toEqual(
    readings.firing.map((mark) => mark.label),
  );
  expect(readings.moving.map((mark) => mark.size)).toEqual(['20px', '20px']);
  expect(readings.hidden).toEqual([]);
  expect(readings.incoming.map((mark) => mark.label)).toEqual(['Red laser fire toward Blue']);
  expect(readings.stopped).toEqual([]);
});
