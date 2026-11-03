import { describe, expect, it } from 'vitest';
import { runBatch } from './batch';
import { freeBattleBatch } from './freeBattle';

describe('test mode batch runs between captains of different skill', () => {
  it('see a high-skill captain beat a low-skill captain in identical designs most of the time', () => {
    // Head-on, so neither side starts better placed; each skill takes each side in turn.
    let high = 0;
    let low = 0;
    for (const [blue, red] of [
      ['high', 'low'],
      ['low', 'high'],
    ] as const) {
      const summary = runBatch(
        freeBattleBatch(
          {
            sides: [
              { designId: 'lance', commander: 'computer', skill: blue },
              { designId: 'lance', commander: 'computer', skill: red },
            ],
            scenarioId: 'head-on',
          },
          { battles: 3, seed: 5, timeLimit: 12 * 3_600 },
        ),
      );
      const [first, second] = summary.sides.map((side) => side.wins);
      high += (blue === 'high' ? first : second) ?? 0;
      low += (blue === 'high' ? second : first) ?? 0;
    }
    expect(high).toBeGreaterThanOrEqual(5);
    expect(low).toBeLessThanOrEqual(1);
  }, 120_000); // Simulates a day of battles; takes several seconds.
});
