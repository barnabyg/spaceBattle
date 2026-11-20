import { describe, expect, it } from 'vitest';
import type { SurfaceDamage } from '../sim/observation';
import { vec3 } from '../sim/vector';
import { plumeFlicker } from './shipModel';
import { createWreckage } from './wreckage';

const section = (changes: Partial<SurfaceDamage> = {}): SurfaceDamage => ({
  section: 'forward',
  mount: null,
  wear: 0.5,
  destroyed: false,
  breached: false,
  point: vec3(25, 0, 0),
  size: vec3(20, 12, 12),
  ...changes,
});

const radiator = (destroyed: boolean): SurfaceDamage => ({
  section: 'middle',
  mount: 0,
  wear: destroyed ? 1 : 0.5,
  destroyed,
  breached: false,
  point: vec3(0, 10, 0),
  size: vec3(30, 0.2, 8),
});

/** A wreckage on a clock the test sets. */
const withClock = () => {
  let now = 0;
  const wreckage = createWreckage(() => now);
  return {
    wreckage,
    at: (time: number) => {
      now = time;
    },
  };
};

describe('wreckage', () => {
  it('takes the damage first seen as it is, with nothing thrown', () => {
    const { wreckage } = withClock();
    wreckage.update([section({ destroyed: true }), section({ breached: true, section: 'engine' })]);
    expect(wreckage.counts()).toEqual({});
  });

  it('vents and throws debris when a section is breached', () => {
    const { wreckage } = withClock();
    wreckage.update([section()]);
    wreckage.update([section({ breached: true })]);
    expect(wreckage.counts()).toEqual({ vent: 1, debris: 6 });
  });

  it('sends a lost section tumbling away with debris, but not its mounts separately', () => {
    const { wreckage } = withClock();
    const mount = { ...radiator(false), section: 'forward' as const };
    wreckage.update([section(), mount]);
    wreckage.update([section({ destroyed: true }), { ...mount, destroyed: true }]);
    expect(wreckage.counts()).toEqual({ breakaway: 1, debris: 16 });
  });

  it('shatters a wrecked radiator, and throws debris from any other mount lost', () => {
    const { wreckage } = withClock();
    wreckage.update([radiator(false)]);
    wreckage.update([radiator(true)], () => 'radiator');
    expect(wreckage.counts()).toEqual({ shard: 14 });
    const other = withClock().wreckage;
    other.update([radiator(false)]);
    other.update([radiator(true)], () => 'laser');
    expect(other.counts()).toEqual({ debris: 8 });
  });

  it('throws the same pieces the same way for the same damage', () => {
    const positions = () => {
      const { wreckage, at } = withClock();
      wreckage.update([section()]);
      wreckage.update([section({ destroyed: true })]);
      at(5);
      wreckage.update([section({ destroyed: true })]);
      return wreckage.element.children.map((c) => c.position.toArray());
    };
    expect(positions()).toEqual(positions());
  });

  it('clears away once every piece has run its course', () => {
    const { wreckage, at } = withClock();
    wreckage.update([section()]);
    wreckage.update([section({ destroyed: true })]);
    at(60);
    wreckage.update([section({ destroyed: true })]);
    expect(wreckage.counts()).toEqual({});
    expect(wreckage.element.children).toHaveLength(0);
  });
});

describe('a faltering drive plume', () => {
  it('keeps its full length on a sound drive and stutters on a damaged one', () => {
    expect(plumeFlicker(0, 1.234)).toBe(1);
    const samples = Array.from({ length: 50 }, (_, i) => plumeFlicker(0.6, i * 0.037));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
    expect(
      Math.max(...Array.from({ length: 50 }, (_, i) => plumeFlicker(1, i * 0.05))),
    ).toBeLessThan(1);
  });
});
