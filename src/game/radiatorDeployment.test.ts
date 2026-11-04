import { describe, expect, it } from 'vitest';
import { createBattle } from '../sim/battle';
import { testSetup } from '../sim/testing';
import { createBattleRunner } from './battleRunner';

describe('radiator deployment and battle speed', () => {
  it.each([1, 10] as const)(
    'takes five simulated seconds at %s× and freezes while paused',
    (speed) => {
      const runner = createBattleRunner(createBattle(testSetup()));
      const heat = () => runner.battle.observe('blue').ownShip.heat;
      runner.setTimeCompression(speed);
      runner.setPaused(true);
      runner.battle.giveOrder('blue', { type: 'radiators', deployed: true });
      for (let frame = 0; frame < 100; frame++) runner.update(0.1);
      expect(heat().radiatorDeploymentRemaining).toBe(5);
      runner.setPaused(false);
      // A tenth of a simulated second per update at either speed.
      for (let frame = 0; frame < 49; frame++) runner.update(0.1 / speed);
      expect(heat().radiatorsDeployed).toBe(false);
      runner.update(0.1 / speed);
      expect(heat().radiatorsDeployed).toBe(true);
    },
  );
});
