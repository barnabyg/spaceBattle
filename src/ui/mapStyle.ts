import type { BeamKind } from '../sim/events';

/**
 * How the tactical map draws each of its layers, shared with its legend so the legend's samples
 * cannot drift from the drawing.
 */

export const SIDE_COLOURS = ['#4fa3ff', '#ff5a4f'] as const;

/** Velocity vectors show where a ship would drift in this many seconds. */
export const VECTOR_SECONDS = 20_000;
/** Heading lines are drawn in this colour, whichever ship they belong to. */
export const HEADING_COLOUR = '#ffffff';
/** Trails are drawn in their side's colour, this opaque. */
export const TRAIL_OPACITY = 0.45;
/** Drop lines are dashed in their side's colour. */
export const DROP_LINE_DASH = { dashSize: 4_000, gapSize: 4_000 } as const;
/** The own ship's projected path is a dashed line in this colour. */
export const PROJECTION_COLOUR = '#9fd0ff';
export const PLANNED_BURN_COLOUR = '#ffb347';
/** Range rings around the own ship: the spokes and rings, every this many km. */
export const RING_SPACING_KM = 50_000;
export const RING_COLOURS = { spokes: '#2b3d5a', rings: '#1a2638' } as const;
export const RANGE_LABEL_COLOUR = '#4d6488';

/** How the own ship's beams are drawn while firing: lasers solid green, particle beams apart. */
export const BEAM_STYLES: Readonly<
  Record<BeamKind, { readonly colour: string; readonly dashed: boolean }>
> = {
  laser: { colour: '#7dffb0', dashed: false },
  'charged-particle': { colour: '#c890ff', dashed: false },
  'neutral-particle': { colour: '#7fe0ff', dashed: true },
};
export const BEAM_OPACITY = 0.8;

/** Munitions in flight are drawn as dots this many pixels across. */
export const MUNITION_SIZE = 5;
/** Missiles are drawn larger than slugs, px. */
export const MISSILE_SIZE = 9;
/**
 * Anti-missile missiles are drawn between the two, px, and paler: their side's colour this far
 * towards white.
 */
export const ANTI_MISSILE_SIZE = 7;
export const ANTI_MISSILE_PALENESS = 0.55;

/** A nuclear burst's flash, at its brightest this share of the map's height across. */
export const BURST_FLASH_SIZE = 0.12;
export const BURST_COLOUR = '#fffbe8';
/** A missile shot down flashes smaller, in amber. */
export const INTERCEPT_FLASH_SIZE = 0.04;
export const INTERCEPT_COLOUR = '#ffc24d';
