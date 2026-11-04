import { describe, expect, it } from 'vitest';
import { createBattle } from './battle';
import { testSetup } from './testing';

describe('radiator deployment', () => {
  it('keeps folded cooling and appearance until five simulated seconds have passed', () => {
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
