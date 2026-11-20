import * as THREE from 'three';
import type { ComponentType, SectionKind } from '../sim/design';
import type { SurfaceDamage } from '../sim/observation';
import type { Vec3 } from '../sim/vector';
import { softGlowTexture } from './shipModel';

/** How long each effect lasts, real s: they show at any time compression. */
const DEBRIS_LIFE = 12;
const VENT_LIFE = 4;
const BREAKAWAY_LIFE = 25;
const SHARD_LIFE = 10;

/** A small, fast, seeded generator (mulberry32): the same part always throws the same pieces. */
const seeded = (key: string) => {
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Outward from the centre of mass through `point`, or up if it is the centre itself. */
const outwardOf = (point: Vec3) => {
  const out = new THREE.Vector3(point.x, point.y, point.z);
  return out.lengthSq() > 1e-9 ? out.normalize() : new THREE.Vector3(0, 1, 0);
};

/** What the wreckage of a ship is: each piece, when it began and how it moves. */
interface Piece {
  readonly object: THREE.Mesh | THREE.Sprite;
  /** Its own material, faded as it goes. */
  readonly material: THREE.Material;
  readonly start: number;
  readonly life: number;
  readonly from: THREE.Vector3;
  /** m per real s */
  readonly velocity: THREE.Vector3;
  /** rad per real s, about each axis */
  readonly spin: THREE.Vector3;
  /** For a vent: how far it grows, m. */
  readonly grow: number;
  readonly kind: 'debris' | 'vent' | 'breakaway' | 'shard';
}

/**
 * Ships visibly coming apart, in their body frame: debris thrown out when a part is lost or a
 * section's armour is broken through, a puff of venting gas from a breach, a lost section going
 * dark and tumbling away, and the panels of a radiator wrecked while deployed shattering. Each
 * effect starts when the observed damage first shows the change, and is shaped by the part it came
 * from, so the same damage always looks the same. Damage seen at the start is taken as it is.
 */
export const createWreckage = (clock: () => number = () => performance.now() / 1000) => {
  const element = new THREE.Group();
  element.name = 'Wreckage';
  const debris = new THREE.BoxGeometry(1, 1, 1);
  const shard = new THREE.PlaneGeometry(1, 1);
  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: '#8a929e',
    roughness: 0.8,
    transparent: true,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: '#14181e',
    roughness: 0.95,
    transparent: true,
  });
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: '#c9d4e0',
    metalness: 0.7,
    roughness: 0.3,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const pieces: Piece[] = [];
  let previous: Map<string, SurfaceDamage> | null = null;

  const add = (piece: Piece) => {
    piece.object.layers.mask = element.layers.mask;
    piece.object.position.copy(piece.from);
    element.add(piece.object);
    pieces.push(piece);
  };

  /** `count` pieces of `kind` flung outward from `point`, spread by `spread`. */
  const fling = (
    key: string,
    kind: 'debris' | 'shard',
    point: Vec3,
    size: Vec3,
    count: number,
    now: number,
  ) => {
    const random = seeded(`${kind}:${key}`);
    const out = outwardOf(point);
    const span = Math.max(size.x, size.y, size.z);
    for (let i = 0; i < count; i++) {
      const direction = out
        .clone()
        .add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(1.6))
        .normalize();
      const material = (kind === 'debris' ? debrisMaterial : shardMaterial).clone();
      const object = new THREE.Mesh(kind === 'debris' ? debris : shard, material);
      const scale = span * (kind === 'debris' ? 0.05 + 0.07 * random() : 0.08 + 0.1 * random());
      object.scale.set(scale, scale * (0.4 + random()), kind === 'debris' ? scale * 0.7 : 1);
      object.name = kind === 'debris' ? 'Debris' : 'Radiator shard';
      add({
        object,
        material,
        start: now,
        life: kind === 'debris' ? DEBRIS_LIFE : SHARD_LIFE,
        from: new THREE.Vector3(point.x, point.y, point.z),
        velocity: direction.multiplyScalar(span * (0.08 + 0.12 * random())),
        spin: new THREE.Vector3(random() * 3, random() * 3, random() * 3),
        grow: 0,
        kind,
      });
    }
  };

  const vent = (point: Vec3, size: Vec3, now: number) => {
    const material = new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: '#dfe9f5',
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const object = new THREE.Sprite(material);
    object.name = 'Venting';
    const out = outwardOf(point);
    const span = Math.max(size.y, size.z);
    add({
      object,
      material,
      start: now,
      life: VENT_LIFE,
      from: new THREE.Vector3(point.x, point.y, point.z).addScaledVector(out, span / 2),
      velocity: out.multiplyScalar(span * 0.6),
      spin: new THREE.Vector3(),
      grow: span * 2.5,
      kind: 'vent',
    });
  };

  const breakaway = (point: Vec3, size: Vec3, key: string, now: number) => {
    const random = seeded(`breakaway:${key}`);
    const material = darkMaterial.clone();
    const object = new THREE.Mesh(debris, material);
    object.name = 'Lost section';
    object.scale.set(size.x, size.y, size.z);
    const out = outwardOf(point);
    add({
      object,
      material,
      start: now,
      life: BREAKAWAY_LIFE,
      from: new THREE.Vector3(point.x, point.y, point.z),
      velocity: out.multiplyScalar(Math.max(size.x, size.y, size.z) * 0.15),
      spin: new THREE.Vector3(0.1 + 0.2 * random(), 0.1 + 0.2 * random(), 0.05 * random()),
      grow: 0,
      kind: 'breakaway',
    });
  };

  return {
    element,
    /**
     * Starts the effects for what has changed since the last update in a ship's `damage`, as
     * observed; `mountType` tells what a mount the observer makes out is, if it can.
     */
    update(
      damage: readonly SurfaceDamage[] | undefined,
      mountType: (section: SectionKind, mount: number) => ComponentType | undefined = () =>
        undefined,
    ) {
      const now = clock();
      const current = new Map((damage ?? []).map((d) => [`${d.section}/${String(d.mount)}`, d]));
      if (previous) {
        const lostSections = new Set(
          (damage ?? []).filter((d) => d.mount === null && d.destroyed).map((d) => d.section),
        );
        for (const [key, d] of current) {
          const before = previous.get(key);
          if (d.destroyed && !before?.destroyed) {
            if (d.mount === null) {
              breakaway(d.point, d.size, key, now);
              fling(key, 'debris', d.point, d.size, 16, now);
            } else if (!lostSections.has(d.section)) {
              const radiator = mountType(d.section, d.mount) === 'radiator';
              fling(key, radiator ? 'shard' : 'debris', d.point, d.size, radiator ? 14 : 8, now);
            }
          } else if (d.breached && !before?.breached && !d.destroyed) {
            vent(d.point, d.size, now);
            fling(key, 'debris', d.point, d.size, 6, now);
          }
        }
      }
      previous = current;
      // Move and fade what is in flight; drop what is spent.
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i];
        if (!piece) continue;
        const age = now - piece.start;
        if (age >= piece.life) {
          element.remove(piece.object);
          piece.material.dispose();
          pieces.splice(i, 1);
          continue;
        }
        piece.object.position.copy(piece.from).addScaledVector(piece.velocity, age);
        const fade = Math.min(1, (piece.life - age) / Math.min(3, piece.life / 2));
        if (piece.kind === 'vent') {
          piece.object.scale.setScalar(1 + (piece.grow * age) / piece.life);
          piece.material.opacity = 0.7 * fade;
        } else {
          piece.object.rotation.set(piece.spin.x * age, piece.spin.y * age, piece.spin.z * age);
          piece.material.opacity = fade;
        }
      }
    },
    /** How many pieces of each kind are in flight: for tests. */
    counts() {
      const counted: Record<string, number> = {};
      for (const piece of pieces) counted[piece.kind] = (counted[piece.kind] ?? 0) + 1;
      return counted;
    },
    dispose() {
      for (const piece of pieces) piece.material.dispose();
      pieces.length = 0;
      debris.dispose();
      shard.dispose();
      debrisMaterial.dispose();
      darkMaterial.dispose();
      shardMaterial.dispose();
      element.clear();
    },
  };
};
