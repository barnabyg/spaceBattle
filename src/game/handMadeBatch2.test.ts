import { describe, expect, it } from 'vitest';
import { handMadeBatch, handMadePairsPart } from './testing';

// Part 2 of 6 of the hand-made designs' batch runs, split so the runner fights them in parallel.
describe('test mode batch runs of the hand-made designs, part 2', () => {
  it.each(handMadePairsPart(1, 6))(
    'fight %s against %s, the computer commanding both, to a result',
    (blue, red) => {
      expect(handMadeBatch(blue, red).noResults).toBe(0);
    },
    60_000, // Simulates hours of battle; takes a few seconds.
  );
});
