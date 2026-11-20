import { describe, expect, it } from 'vitest';
import { glowColour, glowStrength } from './armourGlow';

describe('armour glow colour', () => {
  it('glows a dull red when warm, through orange to near white when white-hot', () => {
    const dull = glowColour(1_000);
    expect(dull.r).toBe(1);
    expect(dull.g).toBeLessThan(0.3);
    expect(dull.b).toBe(0);
    const orange = glowColour(2_000);
    expect(orange.g).toBeGreaterThan(dull.g);
    expect(orange.b).toBeLessThan(0.2);
    const hot = glowColour(3_000);
    expect(hot.g).toBeGreaterThan(orange.g);
    expect(hot.b).toBeGreaterThan(orange.b);
    expect(hot.r).toBe(1);
  });

  it('brightens from nothing below a dull red to full when white-hot', () => {
    expect(glowStrength(300)).toBe(0);
    expect(glowStrength(700)).toBe(0);
    expect(glowStrength(1_850)).toBeCloseTo(0.5);
    expect(glowStrength(3_000)).toBe(1);
    expect(glowStrength(3_500)).toBe(1);
  });
});
