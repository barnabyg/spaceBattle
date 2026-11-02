import { HAND_MADE_DESIGNS, handMadeDesign } from '../data/designs';
import { DEFAULT_TIME_LIMIT } from '../game/batch';
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

/** Test mode's settings for battles and batch runs, kept between visits to setup. */
export interface TestSettings {
  /** The seed to fight from, or null for a new one each time. */
  readonly seed: number | null;
  /** Each battle ends with no result once this much simulated time has passed, s. */
  readonly timeLimit: number;
  /** How many battles a batch run fights. */
  readonly battles: number;
}

export const DEFAULT_TEST_SETTINGS: TestSettings = {
  seed: null,
  timeLimit: DEFAULT_TIME_LIMIT,
  battles: 100,
};

/** What the setup screen offers in test mode. */
export interface SetupScreenTestMode {
  readonly settings: TestSettings;
  /** Called with the settings as they stand before the screen starts a battle or goes back. */
  readonly onChange: (settings: TestSettings) => void;
  /** Runs a batch of battles between the chosen designs, both commanded by the computer. */
  readonly onRunBatch: (setup: FreeBattleSetup, settings: TestSettings) => void;
}

const HOUR = 3_600;
const MAX_SEED = 2 ** 32 - 1;
const MAX_BATTLES = 1_000;

const numberField = (label: string, value: string, attrs: Record<string, string>) => {
  const input = el('input', { attrs: { type: 'number', ...attrs } });
  input.value = value;
  return {
    input,
    element: el('label', { className: 'field' }, el('span', { text: label }), input),
  };
};

/** Test mode's settings: a seed, a time limit and the size of a batch run. */
const createTestChoices = (settings: TestSettings) => {
  const seed = numberField('Seed', settings.seed === null ? '' : String(settings.seed), {
    min: '0',
    max: String(MAX_SEED),
    step: '1',
    placeholder: 'New each time',
  });
  const timeLimit = numberField('Time limit h', String(settings.timeLimit / HOUR), {
    min: '0.01',
    step: 'any',
    required: '',
  });
  const battles = numberField('Battles', String(settings.battles), {
    min: '1',
    max: String(MAX_BATTLES),
    step: '1',
    required: '',
  });
  const runBatch = el('button', {
    className: 'menu-button',
    text: 'Run batch',
    attrs: { type: 'button' },
  });
  const element = el(
    'section',
    { className: 'setup-test', attrs: { 'aria-label': 'Test mode' } },
    el('h2', { text: 'Test mode' }),
    el(
      'div',
      { className: 'order-row' },
      seed.element,
      timeLimit.element,
      battles.element,
      runBatch,
    ),
    el('p', {
      className: 'menu-note',
      text: 'The same seed fights the same battle again, and Replay gives the same orders again at the same moments. A batch run fights the chosen designs against each other with the computer commanding both sides and no graphics, each battle from its own seed.',
    }),
  );

  return {
    element,
    runBatch,
    /** The settings, or null after pointing out any that are not valid. */
    value: (): TestSettings | null => {
      const fields = [seed.input, timeLimit.input, battles.input];
      if (!fields.every((input) => input.reportValidity())) return null;
      return {
        seed: seed.input.value === '' ? null : Number(seed.input.value),
        timeLimit: Number(timeLimit.input.value) * HOUR,
        battles: Number(battles.input.value),
      };
    },
  };
};

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
    commander,
    value: (): FreeBattleSide => ({
      designId: design.value,
      commander: commander.value === 'computer' ? 'computer' : 'player',
    }),
  };
};

/**
 * The free battle setup: a design and a commander for each of the two sides; in test mode, test
 * settings and batch runs too.
 */
export const createSetupScreen = (
  initial: FreeBattleSetup,
  actions: SetupScreenActions,
  testMode?: SetupScreenTestMode,
) => {
  const [blueSide, redSide] = FREE_BATTLE_SIDES;
  const blue = createSideChoice(blueSide, SIDE_COLOURS[0], initial.sides[0]);
  const red = createSideChoice(redSide, SIDE_COLOURS[1], initial.sides[1]);
  const setup = (): FreeBattleSetup => ({ sides: [blue.value(), red.value()] });

  // The player commands at most one side; the battle screen gives orders for one side only.
  const keepOnePlayer = (chosen: typeof blue, other: typeof blue) => {
    if (chosen.commander.value === 'player') other.commander.value = 'computer';
  };
  blue.commander.addEventListener('change', () => {
    keepOnePlayer(blue, red);
  });
  red.commander.addEventListener('change', () => {
    keepOnePlayer(red, blue);
  });
  keepOnePlayer(blue, red);

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
  const test = testMode ? createTestChoices(testMode.settings) : null;
  /** Hands over valid test settings first; false if they are not valid. */
  const settled = (): boolean => {
    if (!test || !testMode) return true;
    const settings = test.value();
    if (settings) testMode.onChange(settings);
    return settings !== null;
  };
  start.addEventListener('click', () => {
    if (settled()) actions.onStart(setup());
  });
  back.addEventListener('click', () => {
    settled();
    actions.onBack(setup());
  });
  test?.runBatch.addEventListener('click', () => {
    const settings = test.value();
    if (!settings || !testMode) return;
    testMode.onChange(settings);
    testMode.onRunBatch(setup(), settings);
  });

  const element = el(
    'main',
    { className: 'menu-screen setup-screen' },
    el('h1', { className: 'menu-title', text: 'Free battle' }),
    el('p', {
      className: 'menu-tagline',
      text: 'Choose a design for each side and who commands it. You command at most one side and see the battle from it, or from Blue if the computer commands both.',
    }),
    el('div', { className: 'setup-sides' }, blue.element, red.element),
    ...(test ? [test.element] : []),
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
