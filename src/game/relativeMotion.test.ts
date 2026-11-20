import { describe, expect, it } from 'vitest';
import { vec3 } from '../sim/vector';
import { closestPass, relativeMotion, returnPassDeltaV } from './relativeMotion';

const KM = 1_000;

describe('relative motion', () => {
  it('reports full three-dimensional separation in metres', () => {
    const motion = relativeMotion(
      { position: vec3(1_000, 2_000, 3_000), velocity: vec3(0, 0, 0) },
      { position: vec3(1_000, 3_002_000, 4_003_000), velocity: vec3(0, 0, 0) },
    );
    // A 3,000 km by 4,000 km right triangle, entirely outside the x axis.
    expect(motion.separation).toBe(5_000_000);
  });

  it('is still when both ships have the same velocity, however fast', () => {
    const motion = relativeMotion(
      { position: vec3(0, 0, 0), velocity: vec3(5_000, 1_000, 0) },
      { position: vec3(100_000 * KM, 0, 0), velocity: vec3(5_000, 1_000, 0) },
    );
    expect(motion.relativeVelocity).toEqual(vec3(0, 0, 0));
    expect(motion.relativeSpeed).toBe(0);
    expect(motion.closingSpeed).toBe(0);
  });

  it('closes at the sum of their speeds when the ships fly straight at each other', () => {
    const motion = relativeMotion(
      { position: vec3(0, 0, 0), velocity: vec3(2_000, 0, 0) },
      { position: vec3(300_000 * KM, 0, 0), velocity: vec3(-1_500, 0, 0) },
    );
    // The contact's velocity relative to the own ship points back at the own ship.
    expect(motion.relativeVelocity).toEqual(vec3(-3_500, 0, 0));
    expect(motion.relativeSpeed).toBe(3_500);
    expect(motion.closingSpeed).toBe(3_500);
  });

  it('closes at a negative speed when the ships draw apart', () => {
    const motion = relativeMotion(
      { position: vec3(0, 0, 0), velocity: vec3(-1_000, 0, 0) },
      { position: vec3(0, 200_000 * KM, 0), velocity: vec3(0, 3_000, 0) },
    );
    expect(motion.closingSpeed).toBeCloseTo(-3_000);
    expect(motion.relativeSpeed).toBeCloseTo(Math.hypot(1_000, 3_000));
  });

  it('does not close when the contact moves sideways across the line between them', () => {
    const motion = relativeMotion(
      { position: vec3(0, 0, 0), velocity: vec3(0, 0, 0) },
      { position: vec3(100_000 * KM, 0, 0), velocity: vec3(0, 2_000, 1_000) },
    );
    expect(motion.closingSpeed).toBeCloseTo(0);
    expect(motion.relativeSpeed).toBeCloseTo(Math.hypot(2_000, 1_000));
  });

  it('does not close at zero separation, where there is no line between them', () => {
    const motion = relativeMotion(
      { position: vec3(1, 2, 3), velocity: vec3(1_000, 0, 0) },
      { position: vec3(1, 2, 3), velocity: vec3(-1_000, 0, 0) },
    );
    expect(motion.closingSpeed).toBe(0);
    expect(motion.relativeSpeed).toBe(2_000);
  });
});

describe('closest pass', () => {
  it('finds when and how near two coasting ships pass', () => {
    // The contact flies past 3,000 km off the own ship's track, 400,000 km away at 4 km/s.
    const pass = closestPass(
      { position: vec3(0, 0, 0), velocity: vec3(1_000, 0, 0) },
      { position: vec3(400_000 * KM, 3_000 * KM, 0), velocity: vec3(-3_000, 0, 0) },
    );
    expect(pass?.time).toBeCloseTo(100_000);
    expect(pass?.separation).toBeCloseTo(3_000 * KM);
  });

  it('meets head-on at zero separation', () => {
    const pass = closestPass(
      { position: vec3(0, 0, 0), velocity: vec3(0, 0, 0) },
      { position: vec3(0, 0, 10_000 * KM), velocity: vec3(0, 0, -2_000) },
    );
    expect(pass).toEqual({ time: 5_000, separation: 0 });
  });

  it('has no pass ahead for ships drawing apart or keeping station', () => {
    const own = { position: vec3(0, 0, 0), velocity: vec3(0, 0, 0) };
    expect(
      closestPass(own, { position: vec3(1_000 * KM, 0, 0), velocity: vec3(10, 0, 0) }),
    ).toBeNull();
    expect(
      closestPass(own, { position: vec3(1_000 * KM, 0, 0), velocity: vec3(0, 0, 0) }),
    ).toBeNull();
  });

  it('takes twice the relative speed to turn back for another pass', () => {
    const motion = relativeMotion(
      { position: vec3(0, 0, 0), velocity: vec3(0, 0, 0) },
      { position: vec3(1_000 * KM, 0, 0), velocity: vec3(3_000, 4_000, 0) },
    );
    expect(returnPassDeltaV(motion)).toBeCloseTo(10_000);
  });
});
