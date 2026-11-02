import { HAND_MADE_DESIGNS, handMadeDesign } from '../data/designs';
import { FREE_BATTLE_SIDES, type FreeBattleSetup, type FreeBattleSide } from '../game/freeBattle';
import type { Commander } from '../sim/battle';
import { designSummary } from './designSummary';
import { el } from './el';
import { SIDE_COLOURS } from './tacticalMap';

const COMMANDERS: readonly (readonly [Commander, string])[] = [
  ['player', 'Player'],
  ['computer', 'Computer'],
];

export interface SetupScreenActions {
  /** Starts the battle with these choices. */
  readonly onStart: (setup: FreeBattleSetup) => void;
  /** Goes back to the main menu; the choices so far come along so they can be kept. */
  readonly onBack: (setup: FreeBattleSetup) => void;
}

const select = (options: readonly (readonly [string, string])[], value: string) => {
  const element = el(
    'select',
    {},
    ...options.map(([id, text]) => el('option', { text, attrs: { value: id } })),
  );
  element.value = value;
  return element;
};

/** One side's choices: its design, with that design's key numbers, and who commands it. */
const createSideChoice = (
  side: (typeof FREE_BATTLE_SIDES)[number],
  colour: string,
  initial: FreeBattleSide,
) => {
  const design = select(
    HAND_MADE_DESIGNS.map((d) => [d.id, d.name]),
    initial.designId,
  );
  const commander = select(COMMANDERS, initial.commander);
  const summary = el('dl', { className: 'status-list design-summary' });
  const showSummary = () => {
    summary.replaceChildren(
      ...designSummary(handMadeDesign(design.value)).flatMap(([label, value]) => [
        el('dt', { text: label }),
        el('dd', { text: value, attrs: { 'aria-label': label } }),
      ]),
    );
  };
  design.addEventListener('change', showSummary);
  showSummary();

  const element = el(
    'section',
    {
      className: 'setup-side',
      attrs: {
        'aria-label': `${side.name} side`,
        style: `--side-colour: ${colour}`,
      },
    },
    el('h2', { className: 'setup-side__name', text: side.name }),
    el('label', { className: 'field' }, el('span', { text: 'Design' }), design),
    summary,
    el('label', { className: 'field' }, el('span', { text: 'Commander' }), commander),
  );

  return {
    element,
    value: (): FreeBattleSide => ({
      designId: design.value,
      commander: commander.value === 'computer' ? 'computer' : 'player',
    }),
  };
};

/** The free battle setup: a design and a commander for each of the two sides. */
export const createSetupScreen = (initial: FreeBattleSetup, actions: SetupScreenActions) => {
  const [blueSide, redSide] = FREE_BATTLE_SIDES;
  const blue = createSideChoice(blueSide, SIDE_COLOURS[0], initial.sides[0]);
  const red = createSideChoice(redSide, SIDE_COLOURS[1], initial.sides[1]);
  const setup = (): FreeBattleSetup => ({ sides: [blue.value(), red.value()] });

  const start = el('button', {
    className: 'menu-button menu-button--primary',
    text: 'Start battle',
    attrs: { type: 'button' },
  });
  const back = el('button', {
    className: 'menu-button',
    text: 'Back',
    attrs: { type: 'button' },
  });
  start.addEventListener('click', () => {
    actions.onStart(setup());
  });
  back.addEventListener('click', () => {
    actions.onBack(setup());
  });

  const element = el(
    'main',
    { className: 'menu-screen setup-screen' },
    el('h1', { className: 'menu-title', text: 'Free battle' }),
    el('p', {
      className: 'menu-tagline',
      text: 'Choose a design for each side and who commands it. You see the battle from the first side you command, or from Blue if the computer commands both.',
    }),
    el('div', { className: 'setup-sides' }, blue.element, red.element),
    el('div', { className: 'setup-actions' }, back, start),
  );

  return {
    element,
    /** Puts the keyboard on the start button. */
    focus() {
      start.focus();
    },
  };
};
