import { describe, expect, it } from 'vitest';
import { createBattle } from '../sim/battle';
import { designComponent } from '../sim/design';
import { testDesign, testSetup } from '../sim/testing';
import { distance } from '../sim/vector';
import { projectPath } from './projection';

const drive = designComponent(testDesign(), 'drive');

describe('projected path', () => {
  it('is a straight line for a drifting ship', () => {
    const battle = createBattle(testSetup());
    const ship = battle.observe('blue').ownShip;
    const path = projectPath(ship, drive, 1_000, 100);
    expect(path).toHaveLength(11);
    const end = path.at(-1);
    expect(end?.x).toBeCloseTo(ship.position.x + 1_000 * ship.velocity.x, 3);
    expect(end?.y).toBeCloseTo(ship.position.y + 1_000 * ship.velocity.y, 3);
  });

  it('predicts where a burning ship ends up', () => {
    const battle = createBattle(testSetup());
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 300 });
    const path = projectPath(battle.observe('blue').ownShip, drive, 600, 600);
    battle.advance(600);
    const actual = battle.observe('blue').ownShip.position;
    // Within 0.1% of the distance travelled; the projection integrates more coarsely.
    expect(distance(path.at(-1) ?? actual, actual)).toBeLessThan(
      distance(path[0] ?? actual, actual) * 1e-3,
    );
  });
});
