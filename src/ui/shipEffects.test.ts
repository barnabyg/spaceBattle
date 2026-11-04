import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createShipEffects } from './shipEffects';
import { vec3 } from '../sim/vector';

it('anchors a discharge at its mount, follows the ship transform and clears after firing', () => {
  const effects = createShipEffects();
  const anchor = new THREE.Group();
  anchor.add(effects.element);
  effects.update([{ section: 'forward', mount: 2, kind: 'laser', point: vec3(10, 2, 0) }]);
  const cue = effects.element.children[0];
  expect(cue?.visible).toBe(true);
  anchor.position.set(100, 200, 0);
  anchor.rotation.z = Math.PI / 2;
  anchor.updateMatrixWorld(true);
  const at = cue?.getWorldPosition(new THREE.Vector3());
  expect(at?.x).toBeCloseTo(98);
  expect(at?.y).toBeCloseTo(210);
  effects.update([]);
  expect(cue?.visible).toBe(false);
  effects.dispose();
});

it('flashes only new damage, retains a damage outline, and clears when detail is lost', () => {
  const effects = createShipEffects();
  const part = {
    section: 'forward' as const,
    mount: null,
    min: vec3(0, -2, -2),
    max: vec3(10, 2, 2),
  };
  const damage = {
    section: 'forward' as const,
    mount: null,
    wear: 0.2,
    destroyed: false,
    point: vec3(5, 0, 0),
    size: vec3(10, 4, 4),
  };
  effects.update([], [], 0, [part]);
  effects.update([], [damage], 1, [part]);
  const flash = effects.element.getObjectByName('Damage flash');
  const scar = effects.element.getObjectByName('Surface damage');
  expect(flash?.visible).toBe(true);
  expect(scar?.visible).toBe(true);
  effects.update([], [damage], 2, [part]);
  expect(flash?.visible).toBe(false);
  expect(scar?.visible).toBe(true);
  effects.update([], [{ ...damage, wear: 1 }], 3, [part]);
  effects.update([], [{ ...damage, wear: 1 }], 4, [part]);
  expect(flash?.visible).toBe(false);
  effects.update([], [{ ...damage, wear: 1.1 }], 5, [part]);
  expect(flash?.visible).toBe(true);
  effects.update([], [], 6, []);
  expect(scar?.visible).toBe(false);
  effects.update([], [damage], 7, [part]);
  expect(flash?.visible).toBe(false);
  effects.dispose();
});
