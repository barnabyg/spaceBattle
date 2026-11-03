import { el } from './el';
import { formatDuration, formatKm } from './format';
import { MAP_LAYERS, type MapLayer, type MapLayers } from './mapLayers';
import {
  ANTI_MISSILE_PALENESS,
  ANTI_MISSILE_SIZE,
  BEAM_OPACITY,
  BEAM_STYLES,
  BURST_COLOUR,
  HEADING_COLOUR,
  INTERCEPT_COLOUR,
  MISSILE_SIZE,
  MUNITION_SIZE,
  PLANNED_BURN_COLOUR,
  PROJECTION_COLOUR,
  RING_COLOURS,
  RING_SPACING_KM,
  TRAIL_OPACITY,
  VECTOR_SECONDS,
} from './mapStyle';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Samples are drawn in a box this many units wide and high. */
const WIDTH = 40;
const HEIGHT = 16;
const DASHED = '3 2';

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
};

const line = (
  [x1, y1]: readonly [number, number],
  [x2, y2]: readonly [number, number],
  colour: string,
  { dashed = false, opacity = 1 } = {},
) =>
  svg('line', {
    x1,
    y1,
    x2,
    y2,
    stroke: colour,
    'stroke-width': 1.5,
    'stroke-opacity': opacity,
    ...(dashed ? { 'stroke-dasharray': DASHED } : {}),
  });

/** A solid arrow along the sample, from `x1` to its head at `x2`. */
const arrow = (x1: number, x2: number, y: number, colour: string) => [
  line([x1, y], [x2 - 4, y], colour),
  svg('polygon', { points: `${x2},${y} ${x2 - 5},${y - 3} ${x2 - 5},${y + 3}`, fill: colour }),
];

const dot = (cx: number, size: number, fill: string) =>
  svg('circle', { cx, cy: HEIGHT / 2, r: size / 2, style: `fill: ${fill}` });

const glow = (cx: number, radius: number, colour: string) => [
  svg('circle', { cx, cy: HEIGHT / 2, r: radius, fill: colour, 'fill-opacity': 0.3 }),
  svg('circle', { cx, cy: HEIGHT / 2, r: radius / 2, fill: colour }),
];

/** Each side's colour, own ship first. */
type Colours = readonly string[];

interface LegendEntry {
  readonly name: string;
  readonly description: string;
  /** How the layer is drawn, in each side's colour where it is drawn for both ships. */
  readonly sample: (colours: Colours) => readonly SVGElement[];
}

const bothShips = (colours: Colours, draw: (colour: string, y: number) => SVGElement[]) =>
  colours.slice(0, 2).flatMap((colour, i) => draw(colour, i === 0 ? 5 : 11));

const ENTRIES: Readonly<Record<MapLayer, LegendEntry>> = {
  velocity: {
    name: 'Velocity',
    description: `Where each ship would drift in ${formatDuration(VECTOR_SECONDS)}, in the battle's fixed frame rather than relative to your ship. The longer the arrow, the faster.`,
    sample: (colours) => bothShips(colours, (colour, y) => arrow(4, 36, y, colour)),
  },
  heading: {
    name: 'Heading',
    description:
      "The way each ship's nose points; its length means nothing. Shown for a contact once its silhouette is made out.",
    sample: (colours) => bothShips(colours, (_, y) => [line([12, y], [28, y], HEADING_COLOUR)]),
  },
  trail: {
    name: 'Trail',
    description: 'Where each ship has been.',
    sample: (colours) =>
      bothShips(colours, (colour, y) => [
        svg('path', {
          d: `M 3 ${y + 2} Q 20 ${y - 3} 37 ${y + 1}`,
          fill: 'none',
          stroke: colour,
          'stroke-width': 1.5,
          'stroke-opacity': TRAIL_OPACITY,
        }),
      ]),
  },
  'drop-lines': {
    name: 'Drop lines',
    description: "How far each ship is above or below your ship's plane.",
    sample: (colours) =>
      colours
        .slice(0, 2)
        .map((colour, i) => line([14 + 12 * i, 1], [14 + 12 * i, 15], colour, { dashed: true })),
  },
  'projected-path': {
    name: 'Projected path',
    description: 'Where your ship will go, through its planned burns.',
    sample: () => [
      svg('path', {
        d: 'M 3 13 Q 20 -2 37 9',
        fill: 'none',
        stroke: PROJECTION_COLOUR,
        'stroke-width': 1.5,
        'stroke-dasharray': DASHED,
      }),
    ],
  },
  'planned-burns': {
    name: 'Planned burns',
    description:
      'Where, when and which way the autopilot will burn; the arrow’s length means nothing.',
    sample: () => arrow(10, 30, HEIGHT / 2, PLANNED_BURN_COLOUR),
  },
  'range-rings': {
    name: 'Range rings',
    description: `Range from your ship in its plane, a ring every ${formatKm(RING_SPACING_KM * 1000)}.`,
    sample: () => [
      line([2, 15], [38, 15], RING_COLOURS.spokes),
      line([2, 15], [26, 1], RING_COLOURS.spokes),
      ...[12, 24, 36].map((r) =>
        svg('path', {
          d: `M ${2 + r} 15 A ${r} ${r} 0 0 0 ${2 + r * Math.cos(0.53)} ${15 - r * Math.sin(0.53)}`,
          fill: 'none',
          stroke: RING_COLOURS.rings,
          'stroke-width': 1.5,
        }),
      ),
    ],
  },
  beams: {
    name: 'Beams',
    description:
      'Your beams while they fire at the target: laser solid green, charged-particle solid purple, neutral-particle dashed cyan.',
    sample: () =>
      Object.values(BEAM_STYLES).map(({ colour, dashed }, i) =>
        line([3, 3 + 5 * i], [37, 3 + 5 * i], colour, { dashed, opacity: BEAM_OPACITY }),
      ),
  },
  munitions: {
    name: 'Munitions',
    description:
      'Munitions in flight, in the colour of the side that fired them: small for a slug, large for a missile, pale for an anti-missile missile.',
    sample: ([colour = '#ffffff']) => [
      dot(7, MUNITION_SIZE, colour),
      dot(19, MISSILE_SIZE, colour),
      // The map pales them by mixing in linear colour, as three.js does.
      dot(
        32,
        ANTI_MISSILE_SIZE,
        `color-mix(in srgb-linear, ${colour}, #ffffff ${ANTI_MISSILE_PALENESS * 100}%)`,
      ),
    ],
  },
  flashes: {
    name: 'Flashes',
    description:
      'A large white flash for a nuclear burst; a small amber one for a missile shot down.',
    sample: () => [...glow(12, 7, BURST_COLOUR), ...glow(30, 3.5, INTERCEPT_COLOUR)],
  },
};

let legends = 0;

/**
 * The tactical map's legend: how each layer is drawn and what it means, each with a switch to
 * show or hide it. It collapses to a single button so it does not hide the map.
 */
export const createMapLegend = (
  colours: Colours,
  initial: MapLayers,
  onChange: (layers: MapLayers) => void,
) => {
  const id = `map-legend-${++legends}`;
  let layers = initial;
  const items = MAP_LAYERS.map((layer) => {
    const entry = ENTRIES[layer];
    const descriptionId = `${id}-${layer}`;
    const toggle = el('input', {
      attrs: { type: 'checkbox', 'aria-describedby': descriptionId },
    });
    toggle.checked = layers[layer];
    toggle.addEventListener('change', () => {
      layers = { ...layers, [layer]: toggle.checked };
      onChange(layers);
    });
    const sample = svg('svg', {
      class: 'map-legend__sample',
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      'aria-hidden': 'true',
    });
    sample.append(...entry.sample(colours));
    return el(
      'li',
      { className: 'map-legend__entry', attrs: { 'data-layer': layer } },
      el('label', {}, toggle, sample, el('span', { text: entry.name })),
      el('p', {
        className: 'map-legend__description',
        text: entry.description,
        attrs: { id: descriptionId },
      }),
    );
  });
  const body = el(
    'ul',
    { className: 'map-legend__entries', attrs: { id, 'aria-label': 'Map layers' } },
    ...items,
  );
  body.hidden = true;
  const button = el('button', {
    className: 'map-legend__button',
    text: 'Legend',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': id },
  });
  button.addEventListener('click', () => {
    body.hidden = !body.hidden;
    button.setAttribute('aria-expanded', String(!body.hidden));
  });

  return { element: el('div', { className: 'map-legend' }, button, body) };
};
