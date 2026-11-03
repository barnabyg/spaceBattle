import * as THREE from 'three';
import type { MountedComponentDesign } from '../sim/design';

type Surface = 'armour' | 'ablative' | 'radiator';
const textures = new Map<Surface, THREE.DataTexture>();

/** Shared, deterministic surface detail, without image downloads or a DOM/canvas dependency. */
export const shipSurface = (surface: Surface): THREE.DataTexture => {
  const existing = textures.get(surface);
  if (existing) return existing;
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 64);
      const panelX = x % 128;
      const panelY = y % 64;
      const seam = surface === 'radiator' ? x % 8 < 2 || panelY < 2 : panelX < 1 || panelY < 1;
      const fastener = (panelX === 5 || panelX === 122) && (panelY === 5 || panelY === 58);
      const hatch =
        panelX > 48 &&
        panelX < 80 &&
        panelY > 18 &&
        panelY < 46 &&
        (panelX < 50 || panelX > 77 || panelY < 20 || panelY > 43);
      const shade = seam
        ? 120
        : fastener || hatch
          ? 165
          : 226 + ((row * 7 + Math.floor(x / 128) * 11) % 18);
      const value = surface === 'ablative' && !seam ? shade - 18 : shade;
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textures.set(surface, texture);
  return texture;
};

/** A chamfered section with the same overall extents as its simulation box. */
export const sectionGeometry = (size: THREE.Vector3): THREE.BufferGeometry => {
  const bevel = Math.min(size.x, size.y, size.z) * 0.1;
  const x = size.x / 2 - bevel;
  const y = size.y / 2 - bevel;
  const outline = new THREE.Shape();
  outline.moveTo(-x, -y);
  outline.lineTo(x, -y);
  outline.lineTo(x, y);
  outline.lineTo(-x, y);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: size.z - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -size.z / 2 + bevel);
  // Project each face independently: plating keeps its proportions on the long hull sides.
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const nx = Math.abs(normals.getX(i));
    const ny = Math.abs(normals.getY(i));
    const nz = Math.abs(normals.getZ(i));
    const u = nx > ny && nx > nz ? positions.getZ(i) / size.z : positions.getX(i) / size.x;
    const v = ny > nz ? positions.getZ(i) / size.z : positions.getY(i) / size.y;
    uv.setXY(i, u + 0.5, v + 0.5);
  }
  return geometry;
};

/**
 * Equipment in a unit box: +y faces out from the hull and +x points towards the nose.
 * Every child stays inside that box, so detail never expands the simulation's hit envelope.
 */
export const mountDetail = (
  type: Exclude<MountedComponentDesign['type'], 'radiator'>,
  body: THREE.Material,
  trim: THREE.Material,
  optic: THREE.Material,
): THREE.Mesh => {
  const root = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 1), body);
  root.geometry.translate(0, -0.42, 0);
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z = 0,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const box = (x: number, y: number, z: number, px: number, py: number, pz = 0) =>
    add(new THREE.BoxGeometry(x, y, z), body, px, py, pz);
  const cylinder = (radius: number, length: number, x: number, y: number, material = trim) =>
    add(new THREE.CylinderGeometry(radius, radius, length, 16), material, x, y);
  switch (type) {
    case 'laser':
    case 'sensor': {
      cylinder(0.39, 0.5, 0, -0.09);
      const rim = cylinder(0.48, 0.22, 0, 0.39);
      // A recessed optical surface inside the metal rim, facing away from the hull.
      rim.geometry.dispose();
      rim.geometry = new THREE.CylinderGeometry(0.48, 0.38, 0.22, 24, 1, true);
      const mirror = add(new THREE.CircleGeometry(0.4, 24), optic, 0, 0.35);
      mirror.rotation.x = -Math.PI / 2;
      if (type === 'sensor') box(0.05, 0.12, 0.85, 0, 0.43);
      break;
    }
    case 'kinetic-gun':
    case 'point-defence': {
      box(0.4, 0.65, 0.85, -0.3, -0.015);
      const barrels = type === 'point-defence' ? [-0.22, 0.22] : [0];
      for (const z of barrels) {
        const barrel = add(new THREE.CylinderGeometry(0.095, 0.13, 0.8, 12), trim, 0.1, 0.22, z);
        barrel.rotation.z = -Math.PI / 2;
        const bore = add(new THREE.CircleGeometry(0.075, 12), optic, 0.5, 0.22, z);
        bore.rotation.y = Math.PI / 2;
      }
      box(0.22, 0.12, 0.35, -0.2, 0.44);
      break;
    }
    case 'launcher':
      for (const z of [-0.37, 0.37]) box(1, 0.65, 0.16, 0, -0.015, z);
      box(0.25, 0.3, 0.65, -0.375, 0.35);
      box(0.9, 0.1, 0.12, 0.05, 0.05);
      break;
    case 'charged-particle-beam':
    case 'neutral-particle-beam': {
      box(1, 0.5, 0.65, 0, -0.09);
      for (const x of [-0.35, -0.1, 0.15]) box(0.1, 0.7, 0.85, x, 0.15);
      const emitter = add(new THREE.CylinderGeometry(0.24, 0.24, 0.22, 16), trim, 0.39, 0.14);
      emitter.rotation.z = -Math.PI / 2;
      const aperture = add(new THREE.CircleGeometry(0.18, 16), optic, 0.5, 0.14);
      aperture.rotation.y = Math.PI / 2;
      break;
    }
  }
  return root;
};
