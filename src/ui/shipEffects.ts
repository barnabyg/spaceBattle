import * as THREE from 'three';
import type { WeaponFiring } from '../sim/observation';
import { softGlowTexture } from './shipModel';

const FIRING_COLOURS: Readonly<Record<WeaponFiring['kind'], string>> = {
  laser: '#80eaff',
  'charged-particle-beam': '#b18aff',
  'neutral-particle-beam': '#83afff',
  'kinetic-gun': '#ffffff',
  'point-defence': '#fff3b0',
  launcher: '#99ffcc',
};

/** Local source cues only; these never suggest a beam visible across vacuum or a hit. */
export const createShipEffects = () => {
  const element = new THREE.Group();
  const sources = new Map<string, THREE.Sprite>();
  return {
    element,
    update(firing: readonly WeaponFiring[] = []) {
      for (const sprite of sources.values()) sprite.visible = false;
      for (const source of firing) {
        const key = `${source.section}/${source.mount}`;
        let sprite = sources.get(key);
        if (!sprite) {
          sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: softGlowTexture(),
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          sprite.name = 'Weapon discharge';
          sprite.userData = { kind: 'firing', section: source.section, mount: source.mount };
          sprite.layers.mask = element.layers.mask;
          sources.set(key, sprite);
          element.add(sprite);
        }
        sprite.visible = true;
        sprite.position.set(source.point.x, source.point.y, source.point.z);
        // A generous local glow stays legible when the ship is framed as a whole.
        sprite.scale.setScalar(source.kind === 'launcher' ? 12 : 9);
        sprite.material.color.set(FIRING_COLOURS[source.kind]);
      }
    },
    dispose() {
      for (const sprite of sources.values()) sprite.material.dispose();
      sources.clear();
      element.clear();
    },
  };
};
