import type { BattleRunner } from '../game/battleRunner';
import type { SideSetup } from '../sim/battle';
import { el } from './el';
import { createDamagePanel } from './damagePanel';
import { designSummary } from './designSummary';
import { createEndBattle } from './endBattle';
import { createInstrumentView } from './instrumentView';
import { createOrdersPanel } from './ordersPanel';
import { createResultScreen } from './resultScreen';
import { createShipSound } from './shipSound';
import { createStatusPanel } from './statusPanel';
import { formatDuration } from './format';
import { createTacticalMap, SIDE_COLOURS } from './tacticalMap';
import { createTestLog } from './testLog';
import { createTimeControls } from './timeControls';

export interface BattleScreenOptions {
  /** Called when the captain goes on from the result screen; by default, reloads the page. */
  readonly onContinue?: () => void;
  /** What the result screen's button says. */
  readonly continueLabel?: string;
  /** Test mode: what the battle was set up with, and how to fight it again. */
  readonly test?: BattleScreenTestMode;
}

export interface BattleScreenTestMode {
  readonly seed: number;
  /** s */
  readonly timeLimit: number;
  /** Fights the battle again from the same seed. */
  readonly onReplay: () => void;
}

/** Test mode's view of the enemy: its full design and the state of its ship. */
const createEnemyPanel = (enemy: SideSetup) => {
  const intro = el(
    'div',
    {},
    el('p', { className: 'order-state', text: `${enemy.name} · ${enemy.design.name}` }),
    el(
      'dl',
      { className: 'status-list design-summary' },
      ...designSummary(enemy.design).flatMap(([label, value]) => [
        el('dt', { text: label }),
        el('dd', { text: value }),
      ]),
    ),
  );
  return createDamagePanel(enemy.id, { title: 'Enemy design', intro, log: false });
};

/** The battle as one side's captain sees it, running in real time. */
export const createBattleScreen = (runner: BattleRunner, options: BattleScreenOptions = {}) => {
  const { battle } = runner;
  const viewer = battle.sides.find((s) => s.commander === 'player') ?? battle.sides[0];
  if (!viewer) throw new Error('A battle needs at least one side');
  // The viewer's side comes first so it gets the own-ship colour.
  const ordered = [viewer, ...battle.sides.filter((s) => s !== viewer)];

  const timeControls = createTimeControls(runner);
  // Each side keeps its own colour, whichever side the viewer is.
  const map = createTacticalMap(
    ordered,
    ordered.map((s) => SIDE_COLOURS[battle.sides.indexOf(s) % SIDE_COLOURS.length] ?? '#ffffff'),
  );
  const instruments = createInstrumentView(ordered);
  const status = createStatusPanel();
  const damage = createDamagePanel(viewer.id);
  const orders = createOrdersPanel((order) => {
    // The battle refuses orders the rules forbid, such as pursuing a withdrawing enemy.
    try {
      battle.giveOrder(viewer.id, order);
      orders.refused('');
    } catch (error) {
      orders.refused(error instanceof Error ? error.message : String(error));
    }
  });
  const { test } = options;
  const enemy = ordered[1];
  const enemyPanel = test && enemy ? createEnemyPanel(enemy) : null;
  const testLog = test ? createTestLog(battle.sides) : null;
  // Only a player side's captain hears their ship; a battle between computer sides is silent.
  const sound = viewer.commander === 'player' ? createShipSound(viewer) : null;
  const endBattle = createEndBattle(runner, viewer, () => {
    const events = battle.endBattle(viewer.id);
    testLog?.add(events);
  });
  const result = createResultScreen(
    battle.sides,
    options.onContinue ??
      (() => {
        location.reload();
      }),
    options.continueLabel,
    test?.onReplay,
  );

  const element = el(
    'div',
    { className: 'battle-screen' },
    el(
      'header',
      { className: 'top-bar' },
      el('h1', { text: 'Space Battle' }),
      timeControls.element,
      ...(test
        ? [
            el('span', {
              className: 'test-mode-info',
              text: `Test mode · Seed ${test.seed} · Time limit ${formatDuration(test.timeLimit)}`,
              attrs: { 'aria-label': 'Test mode' },
            }),
          ]
        : []),
      ...(sound ? [sound.element] : []),
      endBattle.button,
    ),
    map.element,
    instruments.element,
    el(
      'aside',
      { className: 'side-panel' },
      status.element,
      damage.element,
      // Only a player side takes orders from the screen; a computer side's captain gives its own.
      viewer.commander === 'player'
        ? orders.element
        : el('p', {
            className: 'order-state',
            text: `${viewer.name} is commanded by the computer.`,
          }),
      ...(enemyPanel ? [enemyPanel.element] : []),
      ...(testLog ? [testLog.element] : []),
    ),
    endBattle.dialog,
    result.element,
  );

  let last = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const events = runner.update((now - last) / 1000);
    last = now;
    testLog?.add(events);
    const observation = battle.observe(viewer.id);
    timeControls.update();
    status.update(observation);
    damage.update(observation);
    if (enemy) enemyPanel?.update(battle.observe(enemy.id));
    orders.update(observation);
    map.update(observation);
    map.render();
    endBattle.update(observation.outcome !== null);
    if (observation.outcome) result.show(observation.outcome);
    const running = !runner.paused && !observation.outcome;
    sound?.update({ observation, events, running, realTime: now / 1000 });
    instruments.update(observation, test && enemy ? battle.observe(enemy.id).ownShip : undefined);
    instruments.render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    element,
    /** Stops the battle's loop and frees its views, listeners and GPU resources. */
    dispose() {
      cancelAnimationFrame(frame);
      timeControls.dispose();
      map.dispose();
      instruments.dispose();
      sound?.dispose();
      element.remove();
    },
  };
};
