import { catalogueComponent, catalogueEntryOf, COMPONENT_CATALOGUE } from '../data/components';
import {
  ARMOUR_TYPES,
  HULL_SIZES,
  SECTION_KINDS,
  type ArmourType,
  type ComponentDesign,
  type Design,
  type HullSize,
  type SectionKind,
} from '../sim/design';
import { designComponent } from '../sim/design';
import { deltaVWith } from '../sim/ship';
import { componentCost } from '../shipyard/cost';
import {
  buildDesign,
  componentVolume,
  specificationOf,
  type ShipSpecification,
  type SpecifiedComponent,
} from '../shipyard/shipyard';
import type { DesignLibrary } from './designLibrary';
import { createDesignPreview } from './designPreview';
import { designSummary } from './designSummary';
import { el } from './el';
import { formatCredits, formatKmPerS, formatTonnes } from './format';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a new design starts from: a modest laser frigate, waiting for a name. */
const NEW_SPECIFICATION: ShipSpecification = {
  name: '',
  hullSize: 'frigate',
  components: [
    'drive-light',
    'thrusters-light',
    'reactor-light',
    'capacitor-light',
    'sensor-4',
    'radiator-light',
    'radiator-light',
    'laser-500',
  ].map((id) => ({ component: catalogueComponent(id) })),
  armour: {
    forward: { type: 'ablative', thickness: 0.05 },
    middle: { type: 'ablative', thickness: 0.02 },
    engine: { type: 'ablative', thickness: 0.01 },
  },
  propellantMass: 400e3,
  reserve: 10e3,
};

const TYPE_NAMES: Readonly<Record<ComponentDesign['type'], string>> = {
  drive: 'Drive',
  thrusters: 'Thrusters',
  reactor: 'Reactor',
  capacitor: 'Capacitor',
  magazine: 'Magazine',
  'magnetic-shield': 'Magnetic shield',
  'coolant-shield': 'Coolant shield',
  radiator: 'Radiator',
  laser: 'Laser',
  'charged-particle-beam': 'Charged particle beam',
  'neutral-particle-beam': 'Neutral particle beam',
  'kinetic-gun': 'Kinetic gun',
  'point-defence': 'Point defence',
  launcher: 'Launcher',
  sensor: 'Sensor',
};

/** A component's catalogue name, or what type it is for one not in the catalogue. */
export const componentName = (component: ComponentDesign): string =>
  catalogueEntryOf(component)?.name ?? TYPE_NAMES[component.type];

/** A labelled control; the control is named by the label alone, not the label and its value. */
const field = (label: string, control: HTMLElement) => {
  control.setAttribute('aria-label', label);
  return el('label', { className: 'field' }, el('span', { text: label }), control);
};

const numberInput = (value: number, attrs: Record<string, string>) => {
  const input = el('input', { attrs: { type: 'number', ...attrs } });
  input.value = String(value);
  return input;
};

const select = <T extends string>(options: readonly (readonly [T, string])[], value: T) => {
  const element = el(
    'select',
    {},
    ...options.map(([id, text]) => el('option', { text, attrs: { value: id } })),
  );
  element.value = value;
  return element;
};

export interface ShipyardScreenActions {
  readonly onBack: () => void;
}

/**
 * The shipyard: the player chooses a hull size, components, armour for each section, propellant
 * and a reserve, and the shipyard places the components and checks the design as they go,
 * showing its volume, mass and cost, anything wrong with it and a model of it. Valid designs are
 * saved, as "<name> class", to the library, which free battles choose from.
 */
export const createShipyardScreen = (library: DesignLibrary, actions: ShipyardScreenActions) => {
  let components: SpecifiedComponent[] = [...NEW_SPECIFICATION.components];

  const name = el('input', { attrs: { type: 'text', maxlength: '40', placeholder: 'Name' } });
  const hullSize = select<HullSize>(
    HULL_SIZES.map((size) => [size, capitalise(size)]),
    NEW_SPECIFICATION.hullSize,
  );
  const armour = SECTION_KINDS.map((kind) => {
    const type = select<ArmourType>(
      ARMOUR_TYPES.map((t) => [t, capitalise(t)]),
      NEW_SPECIFICATION.armour[kind].type,
    );
    const thickness = numberInput(NEW_SPECIFICATION.armour[kind].thickness * 1000, {
      min: '0',
      max: '1000',
      step: '1',
    });
    return { kind, type, thickness };
  });
  const propellant = numberInput(NEW_SPECIFICATION.propellantMass / 1000, {
    min: '0',
    step: '10',
  });
  const reserve = numberInput(NEW_SPECIFICATION.reserve / 1000, { min: '0', step: '0.5' });
  const catalogue = select(
    COMPONENT_CATALOGUE.map((entry) => [entry.id, entry.name] as const),
    COMPONENT_CATALOGUE[0]?.id ?? '',
  );
  const add = el('button', {
    className: 'menu-button',
    text: 'Add component',
    attrs: { type: 'button' },
  });
  const componentList = el('ol', {
    className: 'shipyard-components',
    attrs: { 'aria-label': 'Components' },
  });

  const specification = (): ShipSpecification => ({
    name: name.value,
    hullSize: hullSize.value as HullSize,
    components,
    armour: Object.fromEntries(
      armour.map(({ kind, type, thickness }) => [
        kind,
        { type: type.value as ArmourType, thickness: Number(thickness.value) / 1000 },
      ]),
    ) as Record<SectionKind, { type: ArmourType; thickness: number }>,
    propellantMass: Number(propellant.value) * 1000,
    reserve: Number(reserve.value) * 1000,
  });

  const numbers = el('dl', { className: 'status-list', attrs: { 'aria-label': 'Design numbers' } });
  const problems = el('ul', {
    className: 'shipyard-problems',
    attrs: { 'aria-label': 'Problems' },
  });
  const summary = el('dl', { className: 'status-list design-summary' });
  const preview = createDesignPreview();
  const save = el('button', {
    className: 'menu-button menu-button--primary',
    text: 'Save design',
    attrs: { type: 'button' },
  });
  const saved = el('p', { className: 'menu-note', attrs: { role: 'status' } });
  let built = buildDesign(specification());

  const entry = (label: string, value: string) => [
    el('dt', { text: label }),
    el('dd', { text: value, attrs: { 'aria-label': label } }),
  ];

  const showComponents = () => {
    componentList.replaceChildren(
      ...components.map((specified, i) => {
        const { component } = specified;
        const label = componentName(component);
        const remove = el('button', {
          className: 'order-button',
          text: 'Remove',
          attrs: { type: 'button', 'aria-label': `Remove ${label}` },
        });
        remove.addEventListener('click', () => {
          components = components.filter((_, j) => j !== i);
          refresh();
        });
        return el(
          'li',
          { className: 'shipyard-component' },
          el('span', { className: 'shipyard-component__name', text: label }),
          el('span', {
            className: 'shipyard-component__numbers',
            text: `${Math.round(componentVolume(component)).toLocaleString('en-GB')} m³ · ${formatTonnes(component.mass)} · ${formatCredits(componentCost(component))}`,
          }),
          el('span', {
            className: 'shipyard-component__section',
            text: capitalise(built.placement[i] ?? ''),
          }),
          remove,
        );
      }),
    );
  };

  const showResult = () => {
    const { design, errors, mass, cost, sections } = built;
    const valid = errors.length === 0;
    let driveNumbers: (readonly [string, string])[] = [];
    try {
      const drive = designComponent(design, 'drive');
      driveNumbers = [
        ['Delta-v', formatKmPerS(deltaVWith(design))],
        [
          'Acceleration',
          `${(drive.thrust / mass).toLocaleString('en-GB', { maximumFractionDigits: 2 })} m/s²`,
        ],
      ];
    } catch {
      // No drive yet: nothing to say about delta-v or acceleration.
    }
    numbers.replaceChildren(
      ...[
        ['Cost', formatCredits(cost)] as const,
        ['Mass', formatTonnes(mass)] as const,
        ...driveNumbers,
        ...sections.map(
          ({ kind, used, volume }) =>
            [
              `${capitalise(kind)} volume`,
              `${Math.round(used).toLocaleString('en-GB')} of ${Math.round(volume).toLocaleString('en-GB')} m³`,
            ] as const,
        ),
      ].flatMap(([label, value]) => entry(label, value)),
    );
    problems.replaceChildren(...errors.map((error) => el('li', { text: error })));
    problems.hidden = valid;
    summary.replaceChildren(
      ...(valid ? designSummary(design).flatMap(([label, value]) => entry(label, value)) : []),
    );
    save.disabled = !valid;
    preview.show(
      design.sections.some((s) => s.components.some((c) => c.type === 'drive')) ? design : null,
    );
  };

  const refresh = () => {
    built = buildDesign(specification());
    saved.textContent = '';
    showComponents();
    showResult();
  };

  const libraryList = el('ul', { className: 'shipyard-library-list' });
  const showLibrary = () => {
    const designs = library.designs();
    libraryList.replaceChildren(
      ...designs.map((design) => {
        const edit = el('button', {
          className: 'order-button',
          text: 'Edit',
          attrs: { type: 'button', 'aria-label': `Edit ${design.name}` },
        });
        edit.addEventListener('click', () => {
          load(specificationOf(design));
        });
        const remove = el('button', {
          className: 'order-button',
          text: 'Delete',
          attrs: { type: 'button', 'aria-label': `Delete ${design.name}` },
        });
        remove.addEventListener('click', () => {
          library.remove(design.id);
          showLibrary();
        });
        return el('li', {}, el('span', { text: design.name }), edit, remove);
      }),
    );
    if (designs.length === 0) {
      libraryList.append(el('li', { className: 'menu-note', text: 'No saved designs yet.' }));
    }
  };

  /** Puts a specification into the editor. */
  const load = (spec: ShipSpecification) => {
    name.value = spec.name;
    hullSize.value = spec.hullSize;
    components = [...spec.components];
    for (const { kind, type, thickness } of armour) {
      type.value = spec.armour[kind].type;
      thickness.value = String(Math.round(spec.armour[kind].thickness * 1e6) / 1000);
    }
    propellant.value = String(spec.propellantMass / 1000);
    reserve.value = String(spec.reserve / 1000);
    refresh();
  };

  for (const input of [
    name,
    hullSize,
    propellant,
    reserve,
    ...armour.flatMap((a) => [a.type, a.thickness]),
  ]) {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  }
  add.addEventListener('click', () => {
    components = [...components, { component: catalogueComponent(catalogue.value) }];
    refresh();
  });
  save.addEventListener('click', () => {
    if (built.errors.length > 0) return;
    const design: Design = built.design;
    library.save(design);
    showLibrary();
    saved.textContent = `Saved ${design.name}.`;
  });
  const newDesign = el('button', {
    className: 'menu-button',
    text: 'New design',
    attrs: { type: 'button' },
  });
  newDesign.addEventListener('click', () => {
    load(NEW_SPECIFICATION);
  });
  const back = el('button', { className: 'menu-button', text: 'Back', attrs: { type: 'button' } });
  back.addEventListener('click', actions.onBack);

  const element = el(
    'main',
    { className: 'menu-screen shipyard-screen' },
    el('h1', { className: 'menu-title', text: 'Shipyard' }),
    el(
      'div',
      { className: 'shipyard' },
      el(
        'section',
        { className: 'shipyard-panel', attrs: { 'aria-label': 'Saved designs' } },
        el('h2', { text: 'Saved designs' }),
        libraryList,
        newDesign,
      ),
      el(
        'section',
        { className: 'shipyard-panel', attrs: { 'aria-label': 'Specification' } },
        el('h2', { text: 'Specification' }),
        el(
          'div',
          { className: 'order-row' },
          field('Class name', name),
          field('Hull size', hullSize),
        ),
        el('div', { className: 'order-row' }, field('Component', catalogue), add),
        componentList,
        ...armour.map(({ kind, type, thickness }) =>
          el(
            'div',
            { className: 'order-row' },
            field(`${capitalise(kind)} armour`, type),
            field(`${capitalise(kind)} armour mm`, thickness),
          ),
        ),
        el(
          'div',
          { className: 'order-row' },
          field('Propellant t', propellant),
          field('Reserve km/s', reserve),
        ),
      ),
      el(
        'section',
        { className: 'shipyard-panel', attrs: { 'aria-label': 'Design' } },
        el('h2', { text: 'Design' }),
        preview.element,
        numbers,
        problems,
        summary,
      ),
    ),
    el('div', { className: 'setup-actions' }, back, save, saved),
  );

  showLibrary();
  refresh();

  return {
    element,
    focus() {
      name.focus();
    },
    dispose() {
      preview.dispose();
    },
  };
};
