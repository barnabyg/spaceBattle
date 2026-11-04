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
