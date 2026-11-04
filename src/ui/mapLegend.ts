import { el } from './el';
import { formatDuration, formatKm } from './format';
import { MAP_LAYERS, type MapLayer, type MapLayers } from './mapLayers';
import {
  ANTI_MISSILE_PALENESS,
  ANTI_MISSILE_SIZE,
  BEAM_OPACITY,
  BEAM_STYLES,
  BURST_COLOUR,
  INTERCEPT_COLOUR,
  MISSILE_SIZE,
  MUNITION_SIZE,
  PLANNED_BURN_COLOUR,
  PROJECTION_COLOUR,
  RELATIVE_VELOCITY_PALENESS,
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
/** The map's scene units are km; formatting takes metres. */
const KM = 1_000;

const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
};

const line = (
  [x1, y1]: readonly [number, number],
  [x2, y2]: readonly [number, number],
  colour: string,
  { dashed = false, opacity = 1, width = 1.5 } = {},
) =>
  svg('line', {
    x1,
    y1,
    x2,
    y2,
    style: `stroke: ${colour}`,
    'stroke-width': width,
    'stroke-opacity': opacity,
    ...(dashed ? { 'stroke-dasharray': DASHED } : {}),
  });

/** An arrow along the sample, from `x1` to its head at `x2`. */
const arrow = (x1: number, x2: number, y: number, colour: string, { dashed = false } = {}) => [
  line([x1, y], [x2 - 4, y], colour, { dashed }),
  svg('polyline', {
    // Open chevron, with its vertex at the end of the shaft.
    points: `${x2 - 5},${y - 3} ${x2},${y} ${x2 - 5},${y + 3}`,
    fill: 'none',
    stroke: colour,
    'stroke-width': 1.5,
  }),
];

/** `colour` paled by `share` towards white, mixed in linear colour as the map's three.js does. */
const pale = (colour: string, share: number) =>
  `color-mix(in srgb-linear, ${colour}, #ffffff ${share * 100}%)`;

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
    description: `Starts at the position symbol; its open arrowhead shows where each ship would drift in ${formatDuration(VECTOR_SECONDS)}, in the battle's fixed frame rather than relative to your ship. Longer means faster; the arrowhead is not a ship.`,
    sample: (colours) => bothShips(colours, (colour, y) => arrow(4, 36, y, colour)),
  },
  'relative-velocity': {
    name: 'Relative velocity',
    description: `Where the contact will be relative to your ship in ${formatDuration(VECTOR_SECONDS)}, on the velocity arrows' scale. Pointing at your ship means closing; none means the ships are not moving relative to each other.`,
    sample: ([, contact = '#ffffff']) => {
      const colour = pale(contact, RELATIVE_VELOCITY_PALENESS);
      return arrow(4, 36, HEIGHT / 2, colour, { dashed: true });
    },
  },
  heading: {
    name: 'Heading',
    description:
      "The way each ship's nose points: a tick on its symbol, in its side's colour. It keeps its size; it shortens only as the nose turns towards or away from you. Shown for a contact once its silhouette is made out.",
    sample: ([own = '#ffffff', contact = '#ffffff']) => [
      svg('circle', { cx: 8, cy: 9, r: 3.5, fill: 'none', stroke: own, 'stroke-width': 1.5 }),
      line([11, 7], [17, 3], own, { width: 2 }),
      svg('rect', {
        x: 25,
        y: 6,
        width: 6,
        height: 6,
        transform: 'rotate(45 28 9)',
        fill: 'none',
        stroke: contact,
        'stroke-width': 1.5,
      }),
      line([32, 9], [38, 9], contact, { width: 2 }),
    ],
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
      'Where, when and which way the autopilot will burn: chevrons pointing the way the drive will push. Their size means nothing.',
    sample: () =>
      [14, 21].map((x) =>
        svg('polyline', {
          points: `${x},3 ${x + 5},8 ${x},13`,
          fill: 'none',
          stroke: PLANNED_BURN_COLOUR,
          'stroke-width': 2,
        }),
      ),
  },
  'range-rings': {
    name: 'Range rings',
    description: `Range from your ship in its plane, a ring every ${formatKm(RING_SPACING_KM * KM)}.`,
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
      'Beams while firing, including resolved enemy weapons: laser solid green, charged-particle solid purple, neutral-particle dashed cyan. Double chevrons point from the named firing ship towards its target. This indicates fire, not a hit or damage.',
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
      dot(32, ANTI_MISSILE_SIZE, pale(colour, ANTI_MISSILE_PALENESS)),
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
    el(
      'li',
      { className: 'map-legend__entry' },
      el('strong', { text: 'Ship positions' }),
      el('p', {
        className: 'map-legend__description',
        text: 'Own ship: circle with a white centre. Contact: diamond with a white centre. These stay at the actual positions; labels belong to these symbols. Thin open arrowheads show motion, never another ship. Position symbols are always shown.',
      }),
      (() => {
        const sample = svg('svg', {
          class: 'map-legend__sample',
          viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
          'aria-hidden': 'true',
        });
        const own = colours[0] ?? '#ffffff';
        const contact = colours[1] ?? '#ffffff';
        sample.append(
          svg('circle', { cx: 10, cy: 8, r: 5, fill: 'none', stroke: own, 'stroke-width': 2.5 }),
          svg('polygon', {
            points: '28,1 35,8 28,15 21,8',
            fill: 'none',
            stroke: contact,
            'stroke-width': 2.5,
          }),
          svg('circle', { cx: 10, cy: 8, r: 1.5, fill: '#ffffff' }),
          svg('circle', { cx: 28, cy: 8, r: 1.5, fill: '#ffffff' }),
        );
        return sample;
      })(),
    ),
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
