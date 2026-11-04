import * as THREE from 'three';
import type { SurfaceDamage, WeaponFiring } from '../sim/observation';
import type { ShapePart } from '../sim/shape';
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
  const scars = new Map<
    string,
    {
      outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
      flash: THREE.Sprite;
      until: number;
    }
  >();
  let previous = new Map<string, number>();
  const damageBox = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  return {
    element,
    update(
      firing: readonly WeaponFiring[] = [],
      damage: readonly SurfaceDamage[] = [],
      time = 0,
      parts: readonly ShapePart[] = [],
    ) {
      for (const sprite of sources.values()) sprite.visible = false;
      for (const source of firing) {
        const key = `${source.section}/${source.mount}`;
        let sprite = sources.get(key);
        if (!sprite) {
          sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: softGlowTexture(),
              blending: THREE.AdditiveBlending,
              depthTest: false,
              depthWrite: false,
            }),
          );
          sprite.name = 'Weapon discharge';
          sprite.renderOrder = 2;
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
      const current = new Map(parts.map((p) => [`${p.section}/${p.mount}`, 0]));
      for (const scar of scars.values()) {
        scar.outline.visible = false;
        scar.flash.visible = false;
      }
      for (const hit of damage) {
        const key = `${hit.section}/${hit.mount}`;
        let scar = scars.get(key);
        if (!scar) {
          const outline = new THREE.LineSegments(
            damageBox,
            new THREE.LineBasicMaterial({ color: '#bb4928', transparent: true, depthWrite: false }),
          );
          const flash = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: softGlowTexture(),
              color: '#ff542a',
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          outline.name = 'Surface damage';
          flash.name = 'Damage flash';
          outline.layers.mask = flash.layers.mask = element.layers.mask;
          element.add(outline, flash);
          scar = { outline, flash, until: -Infinity };
          scars.set(key, scar);
        }
        const before = previous.get(key);
        if (before !== undefined && hit.wear > before + 1e-12) scar.until = time + 0.5;
        current.set(key, hit.wear);
        scar.outline.visible = !hit.destroyed;
        scar.outline.position.set(hit.point.x, hit.point.y, hit.point.z);
        scar.outline.scale.set(hit.size.x * 1.015, hit.size.y * 1.015, hit.size.z * 1.015);
        scar.outline.material.opacity = Math.min(1, Math.max(0.4, hit.wear));
        scar.flash.position.copy(scar.outline.position);
        scar.flash.scale.setScalar(
          Math.max(10, Math.min(24, Math.max(hit.size.y, hit.size.z) * 2)),
        );
        scar.flash.visible = time < scar.until;
        scar.flash.material.opacity = Math.max(0, (scar.until - time) / 0.5);
      }
      previous = current;
    },
    dispose() {
      for (const sprite of sources.values()) sprite.material.dispose();
      sources.clear();
      for (const scar of scars.values()) {
        scar.outline.material.dispose();
        scar.flash.material.dispose();
      }
      damageBox.dispose();
      scars.clear();
      element.clear();
    },
  };
};
