import * as THREE from 'three';
import type { ContactDetail, ContactObservation } from '../sim/battle';
import type { SectionKind } from '../sim/design';
import type { ShapePart } from '../sim/shape';
import { heatGlow, softGlowTexture } from './shipModel';

/**
 * What a mesh or sprite of a contact model stands for: the dot of a contact made out only by its
 * position, a part of its silhouette, or a section or mount the sensors make out.
 */
export type ContactModelPartKind = 'dot' | 'silhouette' | 'section' | 'mount';

/** The `userData` of every part of a contact model. */
export interface ContactModelPartData {
  readonly kind: ContactModelPartKind;
  readonly section?: SectionKind;
  readonly mount?: number;
  /** For a mount: whether the sensors see it firing. */
  readonly firing?: boolean;
}

const EXHAUST_COLOUR = '#a9c8ff';
const FIRING_COLOUR = '#ffe2a8';

/** The meshes and materials a contact model reuses from one update to the next. */
interface ContactParts {
  detail: ContactDetail;
  readonly hull: THREE.Group;
  readonly box: THREE.BoxGeometry;
  /** Meshes by part, each made the first time the part shows. */
  readonly meshes: Map<string, THREE.Mesh>;
  readonly dot: THREE.Sprite;
  readonly exhaust: THREE.Sprite;
  readonly materials: {
    readonly silhouette: THREE.Material;
    readonly heavy: THREE.Material;
    readonly ablative: THREE.Material;
    readonly bare: THREE.Material;
    readonly turret: THREE.Material;
    readonly firing: THREE.Material;
    readonly radiator: THREE.MeshStandardMaterial;
  };
}

const models = new WeakMap<THREE.Group, ContactParts>();

/**
 * A contact as the telescope sees it, in its body frame, drawn only as far as the sensors make it
 * out: a bright dot while only its position is known, then a dark silhouette, then its sections
 * in their armour and its mounts, any of them that fire glowing. Its exhaust shows whenever its
 * drive burns. `updateContactModel` brings it up to date with each observation.
 */
export const createContactModel = (): THREE.Group => {
  const model = new THREE.Group();
  model.name = 'Contact';
  const hull = new THREE.Group();
  const glow = (colour: string, kind?: ContactModelPartKind) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softGlowTexture(),
        color: colour,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    sprite.visible = false;
    if (kind) sprite.userData = { kind } satisfies ContactModelPartData;
    return sprite;
  };
  const dot = glow('#ffffff', 'dot');
  dot.scale.setScalar(0.02);
  const exhaust = glow(EXHAUST_COLOUR);
  exhaust.scale.setScalar(0.03);
  model.add(hull, dot, exhaust);
  models.set(model, {
    detail: 'position',
    hull,
    box: new THREE.BoxGeometry(1, 1, 1),
    meshes: new Map(),
    dot,
    exhaust,
    materials: {
      silhouette: new THREE.MeshBasicMaterial({ color: '#15171b' }),
      heavy: new THREE.MeshStandardMaterial({ color: '#8b929c', metalness: 0.6, roughness: 0.45 }),
      ablative: new THREE.MeshStandardMaterial({
        color: '#5d564e',
        metalness: 0.1,
        roughness: 0.9,
      }),
      bare: new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.7, roughness: 0.4 }),
      turret: new THREE.MeshStandardMaterial({ color: '#3a4250', metalness: 0.5, roughness: 0.5 }),
      firing: new THREE.MeshStandardMaterial({
        color: '#3a4250',
        emissive: FIRING_COLOUR,
        emissiveIntensity: 1.5,
      }),
      radiator: new THREE.MeshStandardMaterial({
        color: '#202226',
        metalness: 0.3,
        roughness: 0.7,
        emissive: '#000000',
      }),
    },
  });
  return model;
};

/** The detail a contact model last drew its contact in. */
export const contactModelDetail = (model: THREE.Group): ContactDetail | null =>
  models.get(model)?.detail ?? null;

const keyOf = (part: ShapePart) => `${part.section}/${String(part.mount)}`;

/** Brings a contact model up to date with what the sensors make out of the contact. */
export const updateContactModel = (model: THREE.Group, contact: ContactObservation): void => {
  const parts = models.get(model);
  if (!parts) return;
  const { appearance } = contact;
  parts.detail = contact.detail;
  const shown = new Set<string>();
  const show = (
    key: string,
    part: ShapePart,
    material: THREE.Material,
    data: ContactModelPartData,
  ) => {
    let mesh = parts.meshes.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(parts.box, material);
      parts.meshes.set(key, mesh);
      parts.hull.add(mesh);
      mesh.layers.mask = model.layers.mask;
    }
    mesh.material = material;
    mesh.userData = data;
    mesh.scale.set(
      Math.max(1e-3, part.max.x - part.min.x),
      Math.max(1e-3, part.max.y - part.min.y),
      Math.max(1e-3, part.max.z - part.min.z),
    );
    mesh.position.set(
      (part.max.x + part.min.x) / 2,
      (part.max.y + part.min.y) / 2,
      (part.max.z + part.min.z) / 2,
    );
    mesh.visible = true;
    shown.add(key);
  };

  const { materials } = parts;
  materials.radiator.emissive.copy(heatGlow(appearance.temperature));
  const made = new Set(appearance.parts.map(keyOf));
  for (const part of appearance.outline) {
    if (!made.has(keyOf(part))) {
      show(`outline:${keyOf(part)}`, part, materials.silhouette, { kind: 'silhouette' });
    }
  }
  for (const part of appearance.parts) {
    if (part.mount === null) {
      const armour = contact.sections.find((s) => s.kind === part.section)?.armour;
      const material = armour && armour.thickness > 0 ? materials[armour.type] : materials.bare;
      show(keyOf(part), part, material, { kind: 'section', section: part.section });
    } else {
      const mount = contact.mounts.find(
        (m) => m.section === part.section && m.mount === part.mount,
      );
      const firing = mount?.firing ?? false;
      const material = firing
        ? materials.firing
        : mount?.component.type === 'radiator'
          ? materials.radiator
          : materials.turret;
      show(keyOf(part), part, material, {
        kind: 'mount',
        section: part.section,
        mount: part.mount,
        firing,
      });
    }
  }
  for (const [key, mesh] of parts.meshes) {
    if (!shown.has(key)) mesh.visible = false;
  }

  parts.dot.visible = contact.detail === 'position';
  // The exhaust shows at the tail of the silhouette, or on the dot.
  const tail = Math.min(0, ...appearance.outline.map((part) => part.min.x));
  parts.exhaust.visible = appearance.thrust > 0;
  parts.exhaust.position.set(tail, 0, 0);
};

/** Frees a contact model's geometry and materials; the glow texture is shared. */
export const disposeContactModel = (model: THREE.Group): void => {
  const parts = models.get(model);
  if (!parts) return;
  parts.box.dispose();
  Object.values(parts.materials).forEach((material) => {
    material.dispose();
  });
  parts.dot.material.dispose();
  parts.exhaust.material.dispose();
  models.delete(model);
};
