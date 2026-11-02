import type { Design, MountedComponentDesign, SectionKind } from './design';
import { HULLS } from './hull';
import { massProperties, NO_AMMUNITION_SPENT, type AmmunitionSpent } from './ship';
import { vec3, type Vec3 } from './vector';

/** Thickness of a radiator panel, m. */
const RADIATOR_THICKNESS = 0.2;
/** A laser turret is a box this much wider than its mirror, m. */
const TURRET_MARGIN = 1;
/** A kinetic gun is a box this wide and high round its barrel, m... */
const GUN_GIRTH = 3;
/** ...and at most this long, its barrel along the ship, m. */
const GUN_LENGTH = 16;
/**
 * A particle beam is a box round its accelerator, lying along the ship: this much wider and higher
 * than its emitter...
 */
const ACCELERATOR_MARGIN = 2;
/** ...and at most this long, m. */
const ACCELERATOR_LENGTH = 24;
/** A launcher is a box this wide and high round its rail... */
const LAUNCHER_GIRTH = 2.5;
/** ...and at most this long, along the ship, m. */
const LAUNCHER_LENGTH = 8;
/** A point defence gun is a turret, a cube this size, m. */
const POINT_DEFENCE_TURRET = 2.5;

/**
 * One box of a ship's outline, in its body frame with the centre of mass at the origin and the
 * nose along +x: a section, or the mount numbered `mount` on that section.
 */
export interface ShapePart {
  readonly section: SectionKind;
  readonly mount: number | null;
  readonly min: Vec3;
  readonly max: Vec3;
}

type Axis = 'x' | 'y' | 'z';

/** The faces a section's mounts go on, in turn: sides first, so the nose and tail stay clear. */
const MOUNT_FACES: readonly { readonly axis: 'y' | 'z'; readonly sign: 1 | -1 }[] = [
  { axis: 'y', sign: 1 },
  { axis: 'y', sign: -1 },
  { axis: 'z', sign: 1 },
  { axis: 'z', sign: -1 },
];

const box = (lo: Record<Axis, number>, hi: Record<Axis, number>) => ({
  min: vec3(Math.min(lo.x, hi.x), Math.min(lo.y, hi.y), Math.min(lo.z, hi.z)),
  max: vec3(Math.max(lo.x, hi.x), Math.max(lo.y, hi.y), Math.max(lo.z, hi.z)),
});

/**
 * The box a mounted component fills, standing out from a face of its section. `slot` is its
 * stretch of the section along x; `half` the half-size of the section across each axis.
 */
const mountBox = (
  component: MountedComponentDesign,
  face: (typeof MOUNT_FACES)[number],
  slot: readonly [number, number],
  half: { readonly y: number; readonly z: number },
  deployed: boolean,
) => {
  const across: Axis = face.axis === 'y' ? 'z' : 'y';
  const surface = face.sign * half[face.axis];
  const length = slot[1] - slot[0];
  let outward: number;
  let width: number;
  let lo: number;
  let hi: number;
  if (component.type === 'laser' || component.type === 'point-defence') {
    // A turret: a cube around the mirror or gun, centred in its slot.
    const side =
      component.type === 'laser' ? component.aperture + TURRET_MARGIN : POINT_DEFENCE_TURRET;
    const centre = (slot[0] + slot[1]) / 2;
    lo = centre - side / 2;
    hi = centre + side / 2;
    outward = side;
    width = side;
  } else if (
    component.type === 'charged-particle-beam' ||
    component.type === 'neutral-particle-beam'
  ) {
    // An accelerator lying along the ship, centred in its slot, its emitter at the front.
    const half = Math.min(ACCELERATOR_LENGTH, length) / 2;
    const centre = (slot[0] + slot[1]) / 2;
    lo = centre - half;
    hi = centre + half;
    outward = component.aperture + ACCELERATOR_MARGIN;
    width = outward;
  } else if (component.type === 'kinetic-gun' || component.type === 'launcher') {
    // A gun or launch rail lying along the ship, centred in its slot.
    const gun = component.type === 'kinetic-gun';
    const half = Math.min(gun ? GUN_LENGTH : LAUNCHER_LENGTH, length) / 2;
    const centre = (slot[0] + slot[1]) / 2;
    lo = centre - half;
    hi = centre + half;
    outward = gun ? GUN_GIRTH : LAUNCHER_GIRTH;
    width = outward;
  } else if (deployed) {
    // A fin standing straight out from the face, edge-on to the nose; both faces radiate.
    lo = slot[0];
    hi = slot[1];
    outward = component.deployedArea / 2 / length;
    width = RADIATOR_THICKNESS;
  } else {
    // A panel folded flat against the face.
    lo = slot[0];
    hi = slot[1];
    outward = RADIATOR_THICKNESS;
    width = Math.min(2 * half[across], component.retractedArea / length);
  }
  const a = { x: lo, y: 0, z: 0 };
  const b = { x: hi, y: 0, z: 0 };
  a[face.axis] = surface;
  b[face.axis] = surface + face.sign * outward;
  a[across] = -width / 2;
  b[across] = width / 2;
  return box(a, b);
};

/**
 * A ship's actual shape: its section boxes along the body x axis, nose first, and each mount as a
 * box on a side of its section. Mounts take the faces +y, −y, +z, −z in turn, sharing a face's
 * length equally when there are more than four.
 */
export const shipShape = (
  design: Design,
  propellantMass: number,
  radiatorsDeployed: boolean,
  ammunitionSpent: AmmunitionSpent = NO_AMMUNITION_SPENT,
): readonly ShapePart[] => {
  const hull = HULLS[design.hullSize];
  const { centreOfMass } = massProperties(design, propellantMass, ammunitionSpent);
  const parts: ShapePart[] = [];
  let front = centreOfMass;
  hull.sections.forEach((shape) => {
    const back = front - shape.length;
    const half = { y: shape.width / 2, z: shape.height / 2 };
    parts.push({
      section: shape.kind,
      mount: null,
      ...box({ x: back, y: -half.y, z: -half.z }, { x: front, y: half.y, z: half.z }),
    });
    const mounts = design.sections.find((s) => s.kind === shape.kind)?.mounts ?? [];
    mounts.forEach((component, i) => {
      const face = MOUNT_FACES[i % MOUNT_FACES.length] ?? { axis: 'y', sign: 1 };
      const onFace = Math.ceil((mounts.length - (i % MOUNT_FACES.length)) / MOUNT_FACES.length);
      const place = Math.floor(i / MOUNT_FACES.length);
      const length = shape.length / onFace;
      const slot = [front - (place + 1) * length, front - place * length] as const;
      parts.push({
        section: shape.kind,
        mount: i,
        ...mountBox(component, face, slot, half, radiatorsDeployed),
      });
    });
    front = back;
  });
  return parts;
};

/** Where a ray first meets a part, and how large the part looks along the ray. */
export interface RayHit {
  readonly part: ShapePart;
  /** Distance along the ray to the point of entry, m. */
  readonly distance: number;
  /** The part's silhouette seen along the ray, m². */
  readonly projectedArea: number;
}

/** Distance along the ray to where it enters the box, or null if it misses (slab method). */
const entry = (origin: Vec3, direction: Vec3, part: ShapePart): number | null => {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = direction[axis];
    const lo = part.min[axis];
    const hi = part.max[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  return near <= far && far >= 0 ? Math.max(near, 0) : null;
};

/** A box's silhouette along a unit direction: Σ |dᵢ| × the area of the faces across axis i. */
const silhouette = (part: ShapePart, d: Vec3): number => {
  const sx = part.max.x - part.min.x;
  const sy = part.max.y - part.min.y;
  const sz = part.max.z - part.min.z;
  return Math.abs(d.x) * sy * sz + Math.abs(d.y) * sx * sz + Math.abs(d.z) * sx * sy;
};

/** The first part a ray from `origin` along the unit vector `direction` reaches, if any. */
export const firstHit = (
  parts: readonly ShapePart[],
  origin: Vec3,
  direction: Vec3,
): RayHit | null => {
  let best: RayHit | null = null;
  for (const part of parts) {
    const distance = entry(origin, direction, part);
    if (distance === null || (best && distance >= best.distance)) continue;
    best = { part, distance, projectedArea: silhouette(part, direction) };
  }
  return best;
};
