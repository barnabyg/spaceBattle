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
  const rect = (x: number, y: number, width: number, height: number, rgb: number) => {
    for (let row = y; row < y + height; row++) {
      for (let col = x; col < x + width; col++) {
        const i = (row * size + col) * 4;
        pixels[i] = rgb >> 16;
        pixels[i + 1] = (rgb >> 8) & 255;
        pixels[i + 2] = rgb & 255;
        pixels[i + 3] = 255;
      }
    }
  };
  if (surface === 'radiator') {
    // Framed banks of fins, with a copper header linking each row of cells.
    rect(0, 0, size, size, 0xb6c2c9);
    for (let y = 0; y < size; y += 64) {
      rect(4, y + 4, 248, 4, 0xc89d77);
      for (let x = 0; x < size; x += 64) {
        rect(x + 4, y + 10, 56, 50, 0x323f51);
        for (let fin = 0; fin < 8; fin++) {
          rect(x + 7, y + 12 + fin * 6, 50, 4, 0x65788b);
          rect(x + 7, y + 12 + fin * 6, 50, 1, 0x8f9eac);
        }
      }
    }
  } else {
    // Offset the joints between courses. Larger armour plates carry inspection
    // covers, while the replaceable ablative tiles have paired retaining clips.
    rect(0, 0, size, size, 0x5e6976);
    const plateWidth = surface === 'ablative' ? 64 : 128;
    const paints = [0xede9de, 0xc9cfd0, 0xe1e4e1, 0xf5f1e5, 0xd5d7d3];
    for (let row = 0; row < 4; row++) {
      const y = row * 64;
      const offset = (row % 2) * (plateWidth / 2);
      // Paint one complete course in local coordinates, wrapping across the edge.
      for (let col = 0; col < size / plateWidth; col++) {
        const origin = col * plateWidth + offset;
        const plate = (x: number, dy: number, width: number, height: number, rgb: number) => {
          const start = (origin + x) % size;
          const span = Math.min(width, size - start);
          rect(start, y + dy, span, height, rgb);
          if (span < width) rect(0, y + dy, width - span, height, rgb);
        };
        plate(2, 2, plateWidth - 3, 61, 0xf8f7ed);
        plate(4, 4, plateWidth - 5, 59, paints[(col + row * 2) % paints.length] ?? 0xe1e4e1);
        for (const x of [6, plateWidth - 11]) {
          plate(x, 8, 5, 3, 0x75808a);
          plate(x, 53, 5, 3, 0x75808a);
        }
        if ((row + col) % 3 === 0) {
          plate(15, 19, 32, 27, 0x7c868b);
          plate(17, 21, 28, 23, 0xb7bfc1);
          plate(35, 29, 7, 5, 0x56616e);
        } else if (surface === 'armour') {
          for (let slot = 0; slot < 5; slot++) plate(22 + slot * 7, 14, 4, 18, 0x929b9c);
        }
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
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
  mapHullFaces(geometry, size);
  return geometry;
};

/** Give each flat face usable UVs, including shell flanks and end caps. */
export const mapHullFaces = (geometry: THREE.BufferGeometry, size: THREE.Vector3): void => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const nx = Math.abs(normals.getX(i));
    const ny = Math.abs(normals.getY(i));
    const nz = Math.abs(normals.getZ(i));
    const end = nx >= ny && nx >= nz;
    const u = end ? positions.getZ(i) / size.z : positions.getX(i) / size.x;
    const v = !end && ny > nz ? positions.getZ(i) / size.z : positions.getY(i) / size.y;
    uv.setXY(i, u + 0.5, v + 0.5);
  }
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
      cylinder(0.35, 0.64, 0, -0.02, body);
      cylinder(0.41, 0.08, 0, -0.22);
      add(new THREE.CylinderGeometry(0.48, 0.36, 0.22, 24, 1, true), trim, 0, 0.39);
      const mirror = add(new THREE.CircleGeometry(0.4, 24), optic, 0, 0.35);
      mirror.rotation.x = -Math.PI / 2;
      if (type === 'sensor') {
        box(0.05, 0.12, 0.85, 0, 0.43);
        cylinder(0.09, 0.08, 0, 0.46, body);
      } else {
        for (const z of [-0.33, 0.33]) box(0.27, 0.41, 0.13, 0, 0.01, z);
      }
      break;
    }
    case 'kinetic-gun':
    case 'point-defence': {
      box(0.4, 0.65, 0.85, -0.3, -0.015);
      const barrels = type === 'point-defence' ? [-0.22, 0.22] : [0];
      for (const z of barrels) {
        const barrel = add(
          new THREE.CylinderGeometry(0.095, 0.13, 0.8, 12, 1, true),
          trim,
          0.1,
          0.22,
          z,
        );
        barrel.rotation.z = -Math.PI / 2;
        const jacket = add(new THREE.CylinderGeometry(0.14, 0.16, 0.29, 12), body, 0.14, 0.22, z);
        jacket.rotation.z = -Math.PI / 2;
        const bore = add(new THREE.CircleGeometry(0.095, 12), body, 0.47, 0.22, z);
        bore.rotation.y = Math.PI / 2;
      }
      box(0.22, 0.12, 0.35, -0.2, 0.44);
      break;
    }
    case 'launcher':
      for (const z of [-0.37, 0.37]) box(1, 0.65, 0.16, 0, -0.015, z);
      box(0.25, 0.3, 0.65, -0.375, 0.35);
      box(0.9, 0.1, 0.12, 0.05, 0.05);
      for (const x of [-0.18, 0.06, 0.3]) {
        add(new THREE.BoxGeometry(0.065, 0.07, 0.78), trim, x, -0.07);
      }
      break;
    case 'charged-particle-beam':
    case 'neutral-particle-beam': {
      box(1, 0.5, 0.65, 0, -0.09);
      for (const x of [-0.35, -0.1, 0.15]) {
        box(0.1, 0.65, 0.85, x, 0.125);
        add(new THREE.BoxGeometry(0.065, 0.05, 0.77), trim, x, 0.475);
      }
      const emitter = add(
        new THREE.CylinderGeometry(0.24, 0.24, 0.22, 16, 1, true),
        trim,
        0.39,
        0.14,
      );
      emitter.rotation.z = -Math.PI / 2;
      const aperture = add(new THREE.CircleGeometry(0.23, 16), optic, 0.47, 0.14);
      aperture.rotation.y = Math.PI / 2;
      break;
    }
  }
  return root;
};
