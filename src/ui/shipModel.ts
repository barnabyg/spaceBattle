import * as THREE from 'three';
import type { ShipAppearance } from '../sim/battle';
import { designComponent, type Design, type SectionKind } from '../sim/design';
import { resolvedShipAppearance, type ResolvedShipAppearance } from '../sim/exterior';
import { shipShape, type ShapePart } from '../sim/shape';
import { NO_AMMUNITION_SPENT } from '../sim/ship';
import { mountDetail, sectionGeometry, shipSurface } from './shipDetail';
import { hullFittings } from './shipFittings';

/** What a mesh of a ship model stands for. */
export type ShipModelPartKind = 'section' | 'mount' | 'nozzle' | 'exhaust';

/** The `userData` of every mesh in a ship model. */
export interface ShipModelPartData {
  readonly kind: ShipModelPartKind;
  readonly section?: SectionKind;
  readonly mount?: number;
}

/** The state a model is drawn in; anything left out is taken as the ship at the start of a battle. */
export type ShipLook = Pick<
  ShipAppearance,
  'propellantMass' | 'radiatorsDeployed' | 'temperature' | 'thrust'
> &
  Partial<Pick<ShipAppearance, 'ammunitionSpent'>> & {
    /** The parts still there; the rest are hidden. All of them if left out. */
    readonly parts?: readonly ShapePart[];
  };

/** A nozzle is this many times longer than its exit radius. */
const NOZZLE_LENGTH = 1.6;
/** The exhaust plume at full thrust is this many nozzle radii long. */
const PLUME_LENGTH = 14;
const EXHAUST_COLOUR = '#a9c8ff';
const SRGB = THREE.SRGBColorSpace;

/**
 * Blackbody-ish glow by temperature (K → sRGB): dark below ~400 K, dull red at 800 K,
 * orange at 1000 K, yellow at 1200 K and white at 1500 K. Real metal only starts to glow visibly
 * near 800 K; the faint red from 600 K lets the captain see heat building earlier.
 */
const GLOW_STOPS: readonly (readonly [number, number, number, number])[] = [
  [400, 0, 0, 0],
  [600, 0.18, 0.01, 0],
  [800, 0.75, 0.08, 0.01],
  [1000, 1, 0.38, 0.06],
  [1200, 1, 0.72, 0.36],
  [1500, 1, 0.97, 0.9],
];

/** The colour a radiator glows at a temperature, written into `target`. */
export const heatGlow = (temperature: number, target = new THREE.Color()): THREE.Color => {
  const first = GLOW_STOPS[0] ?? [0, 0, 0, 0];
  const last = GLOW_STOPS.at(-1) ?? first;
  if (temperature <= first[0]) return target.setRGB(first[1], first[2], first[3], SRGB);
  if (temperature >= last[0]) return target.setRGB(last[1], last[2], last[3], SRGB);
  const upper = GLOW_STOPS.findIndex((stop) => stop[0] > temperature);
  const a = GLOW_STOPS[upper - 1] ?? first;
  const b = GLOW_STOPS[upper] ?? last;
  const f = (temperature - a[0]) / (b[0] - a[0]);
  const mix = (i: 1 | 2 | 3) => a[i] + f * (b[i] - a[i]);
  return target.setRGB(mix(1), mix(2), mix(3), SRGB);
};

let glowTexture: THREE.DataTexture | undefined;

/** A soft round glow for additive sprites, built once from data so it needs no canvas. */
export const softGlowTexture = (): THREE.DataTexture => {
  if (glowTexture) return glowTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, 1 - r) ** 2;
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  glowTexture = new THREE.DataTexture(data, size, size);
  glowTexture.magFilter = THREE.LinearFilter;
  glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  return glowTexture;
};

/** The meshes and materials a model updates as the ship changes, kept per model. */
interface ModelParts {
  design?: Design;
  fullThrust?: number;
  /** Reference geometry for tracking body-frame shifts without knowing a contact's stores. */
  readonly builtParts: readonly ShapePart[];
  readonly radiators: readonly THREE.Mesh[];
  readonly radiatorsDeployed: boolean;
  readonly hull: THREE.Group;
  readonly radiator: THREE.MeshStandardMaterial;
  readonly plume: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  readonly glow: THREE.Sprite;
  readonly nozzleRadius: number;
  readonly materials: readonly THREE.Material[];
}

const models = new WeakMap<THREE.Group, ModelParts>();

const boxMesh = (part: ShapePart, material: THREE.Material, data: ShipModelPartData) => {
  const size = new THREE.Vector3(
    part.max.x - part.min.x,
    part.max.y - part.min.y,
    part.max.z - part.min.z,
  );
  const mesh = new THREE.Mesh<THREE.BufferGeometry>(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material,
  );
  mesh.position.set(
    (part.max.x + part.min.x) / 2,
    (part.max.y + part.min.y) / 2,
    (part.max.z + part.min.z) / 2,
  );
  mesh.userData = data;
  return mesh;
};

/**
 * A ship model built from its design, in the ship's body frame (centre of mass at the origin, nose
 * along +x), with a core matching the simulation's section and mount envelopes. Exterior fittings
 * are purely decorative and belong to their section; they never change hits or mass properties.
 * `updateShipModel` moves the radiators without rebuilding the model.
 * Optional per-ship `accent` colours markings and trim; unassigned designs keep neutral paint.
 */
export const createShipModel = (
  design: Design,
  look: Partial<ShipLook> = {},
  accent?: string,
): THREE.Group => {
  const propellantMass = look.propellantMass ?? design.propellantMass;
  const ammunitionSpent = look.ammunitionSpent ?? NO_AMMUNITION_SPENT;
  const radiatorsDeployed = look.radiatorsDeployed ?? false;
  const shape = shipShape(design, propellantMass, radiatorsDeployed, ammunitionSpent);
  const exterior = resolvedShipAppearance(
    design,
    shape,
    propellantMass,
    radiatorsDeployed,
    look.temperature ?? 300,
    look.thrust ?? 0,
    ammunitionSpent,
  );
  const model = createResolvedShipModel(exterior, accent);
  const state = models.get(model);
  if (state) {
    state.design = design;
    state.fullThrust = designComponent(design, 'drive').thrust;
  }
  model.name = design.name;
  updateShipModel(model, {
    propellantMass,
    ammunitionSpent,
    radiatorsDeployed,
    temperature: look.temperature ?? 300,
    thrust: look.thrust ?? 0,
    parts: look.parts,
  });
  return model;
};

/** The same detailed renderer, supplied exclusively with permitted observed exterior data. */
export const createResolvedShipModel = (
  exterior: ResolvedShipAppearance,
  accent?: string,
): THREE.Group => {
  const shape = exterior.parts;
  const radiatorsDeployed = exterior.radiatorsDeployed;

  const armourMaterial = {
    heavy: new THREE.MeshStandardMaterial({
      color: '#8b929c',
      metalness: 0.6,
      roughness: 0.45,
      map: shipSurface('armour'),
    }),
    ablative: new THREE.MeshStandardMaterial({
      color: '#737d86',
      metalness: 0.1,
      roughness: 0.9,
      map: shipSurface('ablative'),
    }),
  };
  const bare = new THREE.MeshStandardMaterial({
    color: '#9aa0a8',
    metalness: 0.7,
    roughness: 0.4,
    map: shipSurface('armour'),
  });
  const turret = new THREE.MeshStandardMaterial({
    color: '#3a4250',
    metalness: 0.5,
    roughness: 0.5,
  });
  const radiator = new THREE.MeshStandardMaterial({
    color: '#42464e',
    map: shipSurface('radiator'),
    metalness: 0.3,
    roughness: 0.7,
    emissive: '#000000',
  });
  const trim = new THREE.MeshStandardMaterial({
    color: accent ?? '#9aa5b2',
    metalness: accent ? 0.15 : 0.75,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const optic = new THREE.MeshStandardMaterial({
    color: '#163e53',
    metalness: 0.8,
    roughness: 0.18,
  });
  const structure = new THREE.MeshStandardMaterial({
    color: '#303a46',
    metalness: 0.65,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const recess = new THREE.MeshStandardMaterial({
    color: '#111820',
    metalness: 0.25,
    roughness: 0.85,
  });
  const marking = new THREE.MeshStandardMaterial({
    color: accent ?? '#c1b58a',
    metalness: 0.15,
    roughness: 0.7,
  });

  const model = new THREE.Group();
  const hull = new THREE.Group();
  const radiators: THREE.Mesh[] = [];
  model.add(hull);

  for (const part of shape) {
    const section = exterior.sections.find((s) => s.kind === part.section);
    if (part.mount === null) {
      const armour = section?.armour;
      const material = armour && armour.thickness > 0 ? armourMaterial[armour.type] : bare;
      const mesh = boxMesh(part, material, { kind: 'section', section: part.section });
      mesh.geometry.dispose();
      mesh.geometry = sectionGeometry(
        new THREE.Vector3(
          part.max.x - part.min.x,
          part.max.y - part.min.y,
          part.max.z - part.min.z,
        ),
      );
      const mountClearance = exterior.clearance
        .filter((candidate) => candidate.section === part.section && candidate.mount !== null)
        .map((candidate) =>
          new THREE.Box3(
            new THREE.Vector3(candidate.min.x, candidate.min.y, candidate.min.z).sub(mesh.position),
            new THREE.Vector3(candidate.max.x, candidate.max.y, candidate.max.z).sub(mesh.position),
          ).expandByScalar(0.15),
        );
      mesh.add(
        hullFittings(
          new THREE.Vector3(
            part.max.x - part.min.x,
            part.max.y - part.min.y,
            part.max.z - part.min.z,
          ),
          part.section,
          mountClearance,
          [material, structure, recess, marking],
          section?.style ?? { length: 1, height: 1, width: 1, taper: 0.5 },
        ),
      );
      hull.add(mesh);
    } else {
      const component = section?.mounts.find((mount) => mount.index === part.mount);
      const data: ShipModelPartData = { kind: 'mount', section: part.section, mount: part.mount };
      if (!component || component.type === 'radiator') {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), radiator);
        mesh.userData = data;
        radiators.push(mesh);
        hull.add(mesh);
      } else {
        const mesh = mountDetail(component.type, turret, trim, optic);
        mesh.userData = data;
        mesh.position.set(
          (part.min.x + part.max.x) / 2,
          (part.min.y + part.max.y) / 2,
          (part.min.z + part.max.z) / 2,
        );
        const onY = Math.abs(mesh.position.y) > Math.abs(mesh.position.z);
        mesh.scale.set(
          part.max.x - part.min.x,
          onY ? part.max.y - part.min.y : part.max.z - part.min.z,
          onY ? part.max.z - part.min.z : part.max.y - part.min.y,
        );
        mesh.rotation.x = onY
          ? mesh.position.y < 0
            ? Math.PI
            : 0
          : mesh.position.z > 0
            ? Math.PI / 2
            : -Math.PI / 2;
        hull.add(mesh);
      }
    }
  }

  // The drive nozzle: a bell opening aft from the engine section's tail, its exit area in
  // proportion to thrust.
  const engine = shape.find((p) => p.section === 'engine' && p.mount === null);
  const tail = engine?.min.x ?? 0;
  const nozzleRadius = exterior.nozzleRadius;
  const nozzleLength = NOZZLE_LENGTH * nozzleRadius;
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(nozzleRadius, nozzleRadius * 0.35, nozzleLength, 32, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#6b5f55',
      metalness: 0.8,
      roughness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  // A cylinder's axis is +y; turning it a quarter about z puts its wide top towards −x, aft.
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.x = tail - nozzleLength / 2;
  nozzle.userData = { kind: 'nozzle' } satisfies ShipModelPartData;
  // Reinforcement rings follow the bell and disappear with the engine section.
  for (const fraction of [0.15, 0.5, 0.85]) {
    const radius = nozzleRadius * (1 - 0.65 * fraction);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, nozzleRadius * 0.035, 6, 24), trim);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = nozzleLength * (0.5 - fraction);
    nozzle.add(ring);
  }
  hull.add(nozzle);

  // The exhaust: an additive plume whose length follows the thrust, and a glow at the exit.
  const plumeGeometry = new THREE.ConeGeometry(nozzleRadius * 0.9, 1, 24, 1, true);
  // Base at the origin and tip 1 m aft (its +y turned to −x), so scaling x stretches it aft.
  plumeGeometry.translate(0, 0.5, 0);
  plumeGeometry.rotateZ(Math.PI / 2);
  const plume = new THREE.Mesh(
    plumeGeometry,
    new THREE.MeshBasicMaterial({
      color: EXHAUST_COLOUR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  plume.position.x = tail - nozzleLength;
  plume.userData = { kind: 'exhaust' } satisfies ShipModelPartData;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: EXHAUST_COLOUR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.position.x = tail - nozzleLength;
  glow.scale.setScalar(nozzleRadius * 5);
  hull.add(plume, glow);

  models.set(model, {
    builtParts: shape,
    radiators,
    radiatorsDeployed,
    hull,
    radiator,
    plume,
    glow,
    nozzleRadius,
    materials: [
      armourMaterial.heavy,
      armourMaterial.ablative,
      bare,
      turret,
      radiator,
      trim,
      optic,
      structure,
      recess,
      marking,
    ],
  });
  updateResolvedShipModel(model, exterior);
  return model;
};

/** Whether a model needs rebuilding to show this look: the radiators moved. */
export const shipModelNeedsRebuild = (
  model: THREE.Group,
  look: Pick<ShipLook, 'radiatorsDeployed'>,
): boolean => models.get(model)?.radiatorsDeployed !== look.radiatorsDeployed;

const scratch = new THREE.Color();

/**
 * Brings a model up to date without building anything: radiator extension and glow, exhaust
 * from thrust, lost parts hidden, and the hull shifted as burning propellant and spending
 * ammunition move the centre of mass.
 */
export const updateShipModel = (model: THREE.Group, look: ShipLook): void => {
  const parts = models.get(model);
  if (!parts) return;
  if (!parts.design) return;
  const shape = shipShape(
    parts.design,
    look.propellantMass,
    look.radiatorsDeployed,
    look.ammunitionSpent ?? NO_AMMUNITION_SPENT,
  );
  updateResolvedShipModel(model, {
    parts: look.parts ?? shape,
    temperature: look.temperature,
    throttle: Math.min(1, Math.max(0, look.thrust / (parts.fullThrust ?? 1))),
  });
  const intact = look.parts;
  for (const child of parts.hull.children) {
    const data = child.userData as Partial<ShipModelPartData>;
    // The nozzle goes with the engine section.
    const section = data.kind === 'nozzle' ? 'engine' : data.section;
    if (!section) continue;
    child.visible =
      !intact || intact.some((p) => p.section === section && p.mount === (data.mount ?? null));
  }
};

/** Updates a detailed contact from the current, restricted exterior observation. */
export const updateResolvedShipModel = (
  model: THREE.Group,
  look: Pick<ResolvedShipAppearance, 'parts' | 'temperature' | 'throttle'>,
): void => {
  const parts = models.get(model);
  if (!parts) return;
  const reference = parts.builtParts.find(
    (p) =>
      p.mount === null &&
      look.parts.some((current) => current.section === p.section && current.mount === null),
  );
  const current = look.parts.find((p) => p.section === reference?.section && p.mount === null);
  parts.hull.position.x = reference && current ? current.max.x - reference.max.x : 0;
  for (const mesh of parts.radiators) {
    const data = mesh.userData as ShipModelPartData;
    const part = look.parts.find((p) => p.section === data.section && p.mount === data.mount);
    if (!part) continue;
    mesh.scale.set(part.max.x - part.min.x, part.max.y - part.min.y, part.max.z - part.min.z);
    mesh.position.set(
      (part.min.x + part.max.x) / 2 - parts.hull.position.x,
      (part.min.y + part.max.y) / 2,
      (part.min.z + part.max.z) / 2,
    );
  }
  parts.radiator.emissive.copy(heatGlow(look.temperature, scratch));
  const throttle = look.throttle;
  const engine = look.parts.some((p) => p.section === 'engine' && p.mount === null);
  parts.plume.visible = throttle > 0 && engine;
  parts.glow.visible = throttle > 0 && engine;
  parts.plume.scale.x = Math.max(1e-3, throttle * PLUME_LENGTH * parts.nozzleRadius);
  parts.plume.material.opacity = 0.25 + 0.45 * throttle;
  parts.glow.material.opacity = 0.5 + 0.5 * throttle;
  for (const child of parts.hull.children) {
    const data = child.userData as Partial<ShipModelPartData>;
    const section = data.kind === 'nozzle' ? 'engine' : data.section;
    if (section)
      child.visible = look.parts.some(
        (p) => p.section === section && p.mount === (data.mount ?? null),
      );
  }
};

/** Frees a model's geometry and materials; the glow texture and sprite geometry are shared. */
export const disposeShipModel = (model: THREE.Group): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>(models.get(model)?.materials);
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry as THREE.BufferGeometry);
      materials.add(object.material as THREE.Material);
    } else if (object instanceof THREE.Sprite) {
      materials.add(object.material);
    }
  });
  geometries.forEach((geometry) => {
    geometry.dispose();
  });
  materials.forEach((material) => {
    material.dispose();
  });
  models.delete(model);
};
