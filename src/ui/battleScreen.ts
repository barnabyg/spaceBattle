import type { BattleRunner } from '../game/battleRunner';
import { el } from './el';
import { createDamagePanel } from './damagePanel';
import { createOrdersPanel } from './ordersPanel';
import { createStatusPanel } from './statusPanel';
import { createTacticalMap } from './tacticalMap';
import { createTimeControls } from './timeControls';

/** The battle as one side's captain sees it, running in real time. */
export const createBattleScreen = (runner: BattleRunner) => {
  const { battle } = runner;
  const viewer = battle.sides.find((s) => s.commander === 'player') ?? battle.sides[0];
  if (!viewer) throw new Error('A battle needs at least one side');
  // The viewer's side comes first so it gets the own-ship colour.
  const ordered = [viewer, ...battle.sides.filter((s) => s !== viewer)];

  const timeControls = createTimeControls(runner);
  const map = createTacticalMap(ordered);
  const status = createStatusPanel();
  const damage = createDamagePanel(viewer.id);
  const orders = createOrdersPanel((order) => {
    battle.giveOrder(viewer.id, order);
  });

  const element = el(
    'div',
    { className: 'battle-screen' },
    el(
      'header',
      { className: 'top-bar' },
      el('h1', { text: 'Space Battle' }),
      timeControls.element,
    ),
    map.element,
    el('aside', { className: 'side-panel' }, status.element, damage.element, orders.element),
  );

  let last = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    runner.update((now - last) / 1000);
    last = now;
    const observation = battle.observe(viewer.id);
    timeControls.update();
    status.update(observation);
    damage.update(observation);
    orders.update(observation);
    map.update(observation);
    map.render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    element,
    dispose() {
      cancelAnimationFrame(frame);
      timeControls.dispose();
      map.dispose();
    },
  };
};
