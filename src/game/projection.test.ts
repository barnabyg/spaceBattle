import { describe, expect, it } from 'vitest';
import { createBattle } from '../sim/battle';
import { designComponent } from '../sim/design';
import { testDesign, testSetup } from '../sim/testing';
import { distance } from '../sim/vector';
import { projectBurns, projectPath } from './projection';

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

  it('follows the burns a manoeuvre plans', () => {
    const battle = createBattle(testSetup());
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'match-velocity' });
    const ship = battle.observe('blue').ownShip;
    const path = projectPath(ship, drive, 3_600, 3_600);
    const drift = projectPath({ ...ship, manoeuvre: null }, drive, 3_600, 3_600);
    battle.advance(3_600);
    const actual = battle.observe('blue').ownShip.position;
    const start = path[0] ?? actual;
    // The plan is an estimate of the autopilot's turns and throttle, so allow 1%.
    expect(distance(path.at(-1) ?? actual, actual)).toBeLessThan(distance(start, actual) * 1e-2);
    expect(distance(drift.at(-1) ?? actual, actual)).toBeGreaterThan(distance(start, actual) * 0.1);
  });

  it('marks where each planned burn starts', () => {
    const battle = createBattle(testSetup());
    battle.giveOrder('blue', { type: 'manoeuvre', goal: 'close', range: 50_000e3 });
    const ship = battle.observe('blue').ownShip;
    const burns = projectBurns(ship, drive, 48 * 3_600);
    expect(burns.map((b) => b.burn)).toStrictEqual(ship.manoeuvre?.plannedBurns);
    expect(distance(burns[1]?.position ?? ship.position, ship.position)).toBeGreaterThan(50_000e3);
  });
});
