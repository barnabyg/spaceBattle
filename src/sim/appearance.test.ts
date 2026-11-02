import { describe, expect, it } from 'vitest';
import { createBattle, type Battle } from './battle';
import { fromAxisAngle } from './quaternion';
import { shipShape } from './shape';
import { armedTestDesign, duelSetup, testDesign, testSetup } from './testing';
import { vec3 } from './vector';

const KM = 1000;

const contactOf = (battle: Battle, viewer: string) => {
  const contact = battle.observe(viewer).contacts[0];
  if (!contact) throw new Error('No contact');
  return contact;
};

describe('ship appearance (shown in full until sensors arrive)', () => {
  it('shows each side how the other ship looks: radiators, temperature, thrust and shape', () => {
    const battle = createBattle(testSetup());
    battle.giveOrder('red', { type: 'radiators', deployed: true });
    battle.giveOrder('red', { type: 'burn', throttle: 0.5, duration: 600 });
    battle.advance(60);
    const red = battle.observe('red').ownShip;
    const seen = contactOf(battle, 'blue').appearance;
    expect(seen.radiatorsDeployed).toBe(true);
    expect(seen.temperature).toBe(red.heat.temperature);
    expect(seen.thrust).toBe(red.thrust);
    expect(seen.thrust).toBeGreaterThan(0);
    expect(seen.propellantMass).toBe(red.propellantMass);
    expect(seen.parts).toStrictEqual(shipShape(testDesign(), red.propellantMass, true));
    // A side sees its own ship the same way.
    expect(red.appearance).toStrictEqual(seen);
  });

  it('shows where a beam is landing on the ship, in its body frame', () => {
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000 * KM));
    expect(contactOf(battle, 'blue').appearance.beamsLanding).toEqual([]);
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    battle.advance(5);
    const red = contactOf(battle, 'blue').appearance;
    // Red faces blue nose-on, so the beam lands on the middle of its nose.
    const nose = red.parts.find((p) => p.section === 'forward' && p.mount === null);
    expect(red.beamsLanding).toHaveLength(1);
    const landing = red.beamsLanding[0];
    expect(landing?.point.x).toBeCloseTo(nose?.max.x ?? NaN, 6);
    expect(landing?.point.y).toBeCloseTo(0, 6);
    expect(landing?.point.z).toBeCloseTo(0, 6);
    expect(landing?.power).toBeGreaterThan(0);
    expect(landing?.spotRadius).toBeGreaterThan(0);
    expect(battle.observe('red').ownShip.appearance.beamsLanding).toStrictEqual(red.beamsLanding);

    // Once blue holds fire and the last light has arrived, nothing is landing.
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'hold-fire' });
    battle.advance(1);
    expect(contactOf(battle, 'blue').appearance.beamsLanding).toEqual([]);
  });

  it('leaves out the parts that are lost', () => {
    // Red turned side-on so its +y face, with the radiator folded on it, faces blue's laser.
    const sideOn = fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
    const battle = createBattle(duelSetup(armedTestDesign(), testDesign(), 30_000 * KM, sideOn));
    battle.giveOrder('blue', { type: 'weapons', target: 'red', mode: 'fire-freely' });
    const radiator = (b: Battle) =>
      contactOf(b, 'blue').appearance.parts.some((p) => p.section === 'middle' && p.mount === 0);
    battle.advance(1);
    expect(radiator(battle)).toBe(true);
    let lost = false;
    for (let t = 0; t < 120 && !lost; t++) {
      lost = battle.advance(1).some((e) => e.type === 'component-lost' && e.side === 'red');
    }
    expect(lost).toBe(true);
    expect(radiator(battle)).toBe(false);
  });
});
