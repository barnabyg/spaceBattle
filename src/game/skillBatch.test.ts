import { describe, expect, it } from 'vitest';
import { HEAD_ON } from '../data/scenarios';
import { runBatch } from './batch';
import { freeBattleBatch } from './freeBattle';

describe('test mode batch runs between captains of different skill', () => {
  it('see a high-skill captain beat a low-skill captain in identical designs most of the time', () => {
    // Head-on, so neither side starts better placed; each skill takes each side in turn. It
    // keeps the original 300,000 km start: from the usual start just out of reach, the
    // high-skill captain's extra approach speed has it braking, engine section to the enemy,
    // as it enters laser range, and it loses (issue #114).
    let high = 0;
    let low = 0;
    for (const [blue, red] of [
      ['high', 'low'],
      ['low', 'high'],
    ] as const) {
      const batch = freeBattleBatch(
        {
          sides: [
            { designId: 'lance', commander: 'computer', skill: blue },
            { designId: 'lance', commander: 'computer', skill: red },
          ],
          scenarioId: 'head-on',
        },
        { battles: 3, seed: 5, timeLimit: 12 * 3_600 },
      );
      const summary = runBatch({ ...batch, scenario: HEAD_ON });
      const [first, second] = summary.sides.map((side) => side.wins);
      high += (blue === 'high' ? first : second) ?? 0;
      low += (blue === 'high' ? second : first) ?? 0;
    }
    expect(high).toBeGreaterThanOrEqual(5);
    expect(low).toBeLessThanOrEqual(1);
  }, 120_000); // Simulates a day of battles; takes several seconds.
});
