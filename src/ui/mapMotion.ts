import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { el } from './el';
import { RELATIVE_VELOCITY_DASH } from './mapStyle';

/** A world-space motion shaft with an open, fixed-size arrowhead at its actual tip. */
export const createMotionVector = (colour: string, dashed = false) => {
  const head = el('span', { className: 'motion-tip', attrs: { 'aria-hidden': 'true' } });
  head.style.setProperty('--vector-colour', colour);
  const tip = new CSS2DObject(head);
  const shaft = new THREE.Line(
    new THREE.BufferGeometry(),
    dashed
      ? new THREE.LineDashedMaterial({ color: colour })
      : new THREE.LineBasicMaterial({ color: colour }),
  );
  const group = new THREE.Group().add(shaft, tip);
  group.visible = false;
  const direction = new THREE.Vector3();
  return {
    group,
    tip,
    head,
    direction,
    update(from: THREE.Vector3, displacement: THREE.Vector3) {
      const distance = displacement.length();
      group.visible = distance > 0;
      if (!group.visible) return;
      direction.copy(displacement).normalize();
      tip.position.copy(from).add(displacement);
      shaft.geometry.setFromPoints([from, tip.position]);
      if (shaft.material instanceof THREE.LineDashedMaterial) {
        shaft.material.dashSize = distance * RELATIVE_VELOCITY_DASH.dash;
        shaft.material.gapSize = distance * RELATIVE_VELOCITY_DASH.gap;
        shaft.computeLineDistances();
      }
    },
  };
};

export type MotionVector = ReturnType<typeof createMotionVector>;
