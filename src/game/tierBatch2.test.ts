import { describe, expect, it } from 'vitest';
import { tierBatch } from './testing';

// Split by tier so the runner fights them in parallel.
describe('test mode batch runs between opponents of tiers 2 and 1', () => {
  it('see the higher tier win most of the time', () => {
    const { wins, losses } = tierBatch(2);
    expect(wins).toBeGreaterThan(2 * losses);
  }, 300_000); // Simulates a few days of battles; takes about half a minute.
});
