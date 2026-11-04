import { describe, expect, it } from 'vitest';
import { createBattle } from './battle';
import { designComponentsOfType } from './design';
import { shipShape } from './shape';
import { duelSetup, testDesign, testSetup, withSection } from './testing';

describe('radiator deployment', () => {
  it('extends all four mount faces visually while retaining folded cooling and sensor resolution', () => {
    const radiator = designComponentsOfType(testDesign(), 'radiator')[0];
    if (!radiator) throw new Error('Missing test radiator');
    const design = withSection(testDesign(), 'middle', {
      mounts: Array.from({ length: 4 }, () => radiator),
    });
    const battle = createBattle(duelSetup(design, testDesign(), 1_000_000));
    const before = battle.observe('blue').ownShip;
    const folded = before.appearance.parts;
    const deployed = shipShape(design, design.propellantMass, true);
    const contactBefore = battle.observe('red').contacts[0];
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    expect(battle.observe('blue').ownShip.appearance.parts).toEqual(folded);
    battle.advance(2.5);
    const halfway = battle.observe('blue').ownShip;
    const contact = battle.observe('red').contacts[0];
    expect(halfway.heat.radiatorArea).toBe(before.heat.radiatorArea);
    expect(contact?.detail).toBe(contactBefore?.detail);
    expect(contact?.appearance.parts).toHaveLength(halfway.appearance.parts.length);
    expect(contact?.appearance.parts).toEqual(
      expect.arrayContaining([...halfway.appearance.parts]),
    );
    expect(contact?.appearance.outline).toEqual(halfway.appearance.parts);
    for (const [index, part] of halfway.appearance.parts.entries()) {
      const start = folded[index];
      const end = deployed[index];
      if (!start || !end) throw new Error('Missing endpoint');
      for (const edge of ['min', 'max'] as const) {
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(part[edge][axis]).toBeCloseTo((start[edge][axis] + end[edge][axis]) / 2);
        }
      }
    }
    battle.advance(2.5);
    expect(battle.observe('blue').ownShip.appearance.parts).toEqual(deployed);
    battle.giveOrder('blue', { type: 'radiators', deployed: false });
    expect(battle.observe('blue').ownShip.appearance.parts).toEqual(folded);
  });

  it('does not reveal radiator geometry on an unresolved contact during deployment', () => {
    const battle = createBattle(duelSetup(testDesign(), testDesign(), 10_000_000_000));
    battle.giveOrder('red', { type: 'radiators', deployed: true });
    battle.advance(2.5);
    const contact = battle.observe('blue').contacts[0];
    expect(contact?.detail).toBe('position');
    expect(contact?.appearance.outline).toEqual([]);
    expect(contact?.appearance.parts).toEqual([]);
  });

  it('keeps folded cooling until five simulated seconds have passed', () => {
    const battle = createBattle(testSetup());
    const observe = () => battle.observe('blue').ownShip;
    const foldedArea = observe().heat.radiatorArea;
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    expect(observe().heat.radiatorDeploymentRemaining).toBe(5);
    expect(observe().heat.radiatorsDeployed).toBe(false);
    battle.advance(4.9);
    expect(observe().heat.radiatorDeploymentRemaining).toBeCloseTo(0.1);
    expect(observe().heat.radiatorArea).toBe(foldedArea);
    expect(observe().appearance.radiatorsDeployed).toBe(false);
    battle.step();
    expect(observe().heat.radiatorDeploymentRemaining).toBe(0);
    expect(observe().heat.radiatorsDeployed).toBe(true);
    expect(observe().heat.radiatorArea).toBeGreaterThan(foldedArea);
    expect(observe().appearance.radiatorsDeployed).toBe(true);
    expect(battle.observe('red').contacts[0]?.appearance.radiatorsDeployed).toBe(true);
  });

  it('does not restart deployment when the captain repeats the order', () => {
    const battle = createBattle(testSetup());
    for (let second = 0; second < 5; second++) {
      battle.giveOrder('blue', { type: 'radiators', deployed: true });
      battle.advance(1);
    }
    expect(battle.observe('blue').ownShip.heat.radiatorsDeployed).toBe(true);
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    expect(battle.observe('blue').ownShip.heat.radiatorDeploymentRemaining).toBe(0);
  });

  it('retracts immediately, cancels deployment and allows a fresh deployment', () => {
    const battle = createBattle(testSetup());
    const heat = () => battle.observe('blue').ownShip.heat;
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    battle.advance(2);
    battle.giveOrder('blue', { type: 'radiators', deployed: false });
    expect(heat().radiatorDeploymentRemaining).toBe(0);
    battle.advance(5);
    expect(heat().radiatorsDeployed).toBe(false);
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    expect(heat().radiatorDeploymentRemaining).toBe(5);
    battle.advance(5);
    expect(heat().radiatorsDeployed).toBe(true);
    battle.giveOrder('blue', { type: 'radiators', deployed: false });
    expect(heat().radiatorsDeployed).toBe(false);
    expect(heat().radiatorDeploymentRemaining).toBe(0);
  });
});
