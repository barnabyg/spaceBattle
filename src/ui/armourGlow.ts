import * as THREE from 'three';
import type { ArmourGlow, BeamLanding } from '../sim/observation';
import type { SectionKind } from '../sim/design';
import type { ShapePart } from '../sim/shape';
import type { Vec3 } from '../sim/vector';
import { softGlowTexture } from './shipModel';

/** Armour only starts to glow visibly, a dull red, at about this temperature, K. */
const DULL_RED = 700;
/** By this temperature it glows at its brightest, white-hot, K. */
const WHITE_HOT = 3_000;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The colour of a surface glowing at `temperature` K, as 0–1 red, green and blue: a black body's
 * colour, from dull red through orange and yellow towards white (after Tanner Helland's fit of
 * the Planckian locus).
 */
export const glowColour = (temperature: number): { r: number; g: number; b: number } => {
  const t = Math.max(1_000, Math.min(40_000, temperature)) / 100;
  const r = t <= 66 ? 1 : clamp((329.698727446 * (t - 60) ** -0.1332047592) / 255);
  const g =
    t <= 66
      ? clamp((99.4708025861 * Math.log(t) - 161.1195681661) / 255)
      : clamp((288.1221695283 * (t - 60) ** -0.0755148492) / 255);
  const b =
    t >= 66 ? 1 : t <= 19 ? 0 : clamp((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  return { r, g, b };
};

/** How brightly a surface at `temperature` K glows, 0 below a dull red to 1 when white-hot. */
export const glowStrength = (temperature: number): number =>
  clamp((temperature - DULL_RED) / (WHITE_HOT - DULL_RED));

/** The section box a body-frame point lies in, if any, with a metre to spare. */
const sectionAt = (parts: readonly ShapePart[], point: Vec3): SectionKind | null =>
  parts.find(
    (p) =>
      p.mount === null &&
      point.x >= p.min.x - 1 &&
      point.x <= p.max.x + 1 &&
      point.y >= p.min.y - 1 &&
      point.y <= p.max.y + 1 &&
      point.z >= p.min.z - 1 &&
      point.z <= p.max.z + 1,
  )?.section ?? null;

/**
 * Glowing armour on a ship, in its body frame: a soft blackbody glow at each glowing section, where
 * a beam last landed on it (or its middle until one is seen), or for a contact whose sections are
 * not made out, one glow over the whole ship. It brightens and whitens as the armour heats and
 * fades as it cools, following the observed surface temperature. Distinct from weapon discharges,
 * which glow in their beams' cool blues.
 */
export const createArmourGlow = () => {
  const element = new THREE.Group();
  element.name = 'Armour glow';
  const sprites = new Map<string, THREE.Sprite>();
  const lastLanding = new Map<SectionKind, Vec3>();
  const spriteFor = (key: string) => {
    let sprite = sprites.get(key);
    if (!sprite) {
      sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: softGlowTexture(),
          blending: THREE.AdditiveBlending,
          // Light from the struck surface, which faces the attacker: drawn over the hull.
          depthTest: false,
          depthWrite: false,
          transparent: true,
        }),
      );
      sprite.name = 'Armour glow';
      sprite.userData = { kind: 'armour-glow', section: key };
      sprite.renderOrder = 3;
      sprite.layers.mask = element.layers.mask;
      sprites.set(key, sprite);
      element.add(sprite);
    }
    return sprite;
  };
  return {
    element,
    /**
     * Shows `glow` on a ship whose visible parts are `parts`, placing each section's glow where a
     * beam last landed on it (`landings`, this step's).
     */
    update(
      glow: readonly ArmourGlow[],
      parts: readonly ShapePart[],
      landings: readonly BeamLanding[],
    ) {
      for (const landing of landings) {
        const section = sectionAt(parts, landing.point);
        if (section) lastLanding.set(section, landing.point);
      }
      for (const sprite of sprites.values()) sprite.visible = false;
      for (const { section, temperature } of glow) {
        const strength = glowStrength(temperature);
        if (!(strength > 0)) continue;
        const sprite = spriteFor(section ?? 'ship');
        const box = section ? parts.find((p) => p.section === section && p.mount === null) : null;
        const size = box
          ? Math.max(box.max.y - box.min.y, box.max.z - box.min.z)
          : Math.max(20, ...parts.map((p) => p.max.x - p.min.x));
        const at =
          (section && lastLanding.get(section)) ??
          (box
            ? {
                x: (box.min.x + box.max.x) / 2,
                y: (box.min.y + box.max.y) / 2,
                z: (box.min.z + box.max.z) / 2,
              }
            : { x: 0, y: 0, z: 0 });
        const { r, g, b } = glowColour(temperature);
        sprite.visible = true;
        sprite.position.set(at.x, at.y, at.z);
        // A hotter spot glows larger as well as brighter.
        sprite.scale.setScalar(size * (0.6 + 0.6 * strength));
        sprite.material.color.setRGB(r, g, b);
        sprite.material.opacity = 0.35 + 0.65 * strength;
      }
    },
    dispose() {
      for (const sprite of sprites.values()) sprite.material.dispose();
    },
  };
};
