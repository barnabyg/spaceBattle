import type { Scenario } from '../sim/battle';
import { fromAxisAngle, IDENTITY } from '../sim/quaternion';
import { vec3 } from '../sim/vector';

/**
 * A scenario free battle setup offers: where the two ships start, Blue then Red, in empty deep
 * space, and the geometry that sets up between them.
 */
export interface StartingScenario extends Scenario {
  readonly id: string;
  /** What the start looks like, for setup. */
  readonly description: string;
  /** How far apart the ships start, m. */
  readonly separation: number;
  /** How fast each ship moves relative to the other at the start, m/s. */
  readonly relativeSpeed: number;
  /** How fast the separation falls at the start, m/s. */
  readonly closingSpeed: number;
}

const KM = 1_000;
/** Turns the nose (+x) to point back along −x. */
const FACING_MINUS_X = fromAxisAngle(vec3(0, 0, 1), Math.PI);
/** Turns the nose (+x) to point along −y. */
const FACING_MINUS_Y = fromAxisAngle(vec3(0, 0, 1), -Math.PI / 2);

/** Two ships about 300 000 km apart, drifting past each other. */
export const OPENING_PASS: StartingScenario = {
  id: 'opening-pass',
  name: 'Opening pass',
  description: 'The ships drift past each other at an angle.',
  starts: [
    { position: vec3(-150_000 * KM, 0, 0), velocity: vec3(2_000, 1_200, 0) },
    { position: vec3(150_000 * KM, 20_000 * KM, 10_000 * KM), velocity: vec3(-1_500, -800, -300) },
  ],
  separation: 300_832 * KM,
  relativeSpeed: 4_042,
  closingSpeed: 3_633,
};

/** Two ships 300 000 km apart flying straight at each other, nose to nose. */
export const HEAD_ON: StartingScenario = {
  id: 'head-on',
  name: 'Head-on',
  description: 'The ships fly straight at each other, nose to nose.',
  starts: [
    { position: vec3(-150_000 * KM, 0, 0), velocity: vec3(2_000, 0, 0), orientation: IDENTITY },
    {
      position: vec3(150_000 * KM, 0, 0),
      velocity: vec3(-2_000, 0, 0),
      orientation: FACING_MINUS_X,
    },
  ],
  separation: 300_000 * KM,
  relativeSpeed: 4_000,
  closingSpeed: 4_000,
};

/**
 * Two ships 300 000 km apart on courses at right angles. Blue reaches the point where the courses
 * cross well before Red does, so left alone they pass 84 000 km apart.
 */
export const CROSSING: StartingScenario = {
  id: 'crossing',
  name: 'Crossing',
  description: 'The ships fly on courses that cross at right angles, Blue ahead of Red.',
  starts: [
    { position: vec3(-180_000 * KM, 0, 0), velocity: vec3(2_400, 0, 0), orientation: IDENTITY },
    {
      position: vec3(0, 240_000 * KM, 0),
      velocity: vec3(0, -1_800, 0),
      orientation: FACING_MINUS_Y,
    },
  ],
  separation: 300_000 * KM,
  relativeSpeed: 3_000,
  closingSpeed: 2_880,
};

/** Blue 300 000 km behind Red on the same course and gaining, each nose along it. */
export const PURSUIT: StartingScenario = {
  id: 'pursuit',
  name: 'Pursuit',
  description: 'Blue chases Red along the same course, gaining; Red runs nose away.',
  starts: [
    { position: vec3(-150_000 * KM, 0, 0), velocity: vec3(3_000, 0, 0), orientation: IDENTITY },
    { position: vec3(150_000 * KM, 0, 0), velocity: vec3(1_000, 0, 0), orientation: IDENTITY },
  ],
  separation: 300_000 * KM,
  relativeSpeed: 2_000,
  closingSpeed: 2_000,
};

/** The scenarios free battle setup offers, the opening pass first. */
export const STARTING_SCENARIOS: readonly StartingScenario[] = [
  OPENING_PASS,
  HEAD_ON,
  CROSSING,
  PURSUIT,
];

/** The starting scenario with this id. */
export const startingScenario = (id: string): StartingScenario => {
  const scenario = STARTING_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`No starting scenario ${id}`);
  return scenario;
};
