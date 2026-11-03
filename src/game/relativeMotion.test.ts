import { describe, expect, it } from 'vitest';
import { vec3 } from '../sim/vector';
import { relativeMotion } from './relativeMotion';

const KM = 1_000;

describe('relative motion', () => {
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
