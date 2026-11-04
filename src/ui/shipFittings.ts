import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SectionKind } from '../sim/design';
import { sectionGeometry } from './shipDetail';
import type { HullIdentity } from '../sim/exterior';

/** Four octagonal stations form a substantial armour shell with tapered ends and flat facets. */
const armourShell = (size: THREE.Vector3, front: number, aft: number): THREE.BufferGeometry => {
  const outline = [
    [-0.5, -0.28],
    [-0.28, -0.5],
    [0.28, -0.5],
    [0.5, -0.28],
    [0.5, 0.28],
    [0.28, 0.5],
    [-0.28, 0.5],
    [-0.5, 0.28],
  ];
  const stations = [
    [-0.5, aft],
    [-0.28, 1],
    [0.18, 1],
    [0.5, front],
  ];
  const positions: number[] = [];
  const uv: number[] = [];
  for (const [x = 0, scale = 1] of stations) {
    for (const [y = 0, z = 0] of outline) {
      positions.push(x * size.x, y * size.y * scale, z * size.z * scale);
      uv.push(x + 0.5, z + 0.5);
    }
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station++) {
    for (let side = 0; side < outline.length; side++) {
      const a = station * 8 + side;
      const b = station * 8 + ((side + 1) % 8);
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  // The polygon runs clockwise looking forward; reverse the forward cap.
  for (let side = 1; side < 7; side++) {
    indices.push(0, side + 1, side, 24, 24 + side, 25 + side);
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  return geometry;
};

/** Render-only fittings may extend past the section's hit box. Nothing here enters the simulation. */
export const hullFittings = (
  size: THREE.Vector3,
  section: SectionKind,
  mounts: readonly THREE.Box3[],
  materials: readonly THREE.Material[],
  identity: HullIdentity,
): THREE.Group => {
  const group = new THREE.Group();
  group.name = 'Decorative hull fittings';
  const batches = materials.map(() => [] as THREE.BufferGeometry[]);
  const [length, height, width] = [size.x, size.y, size.z];
  const unit = Math.min(height, width);
  const clearance = { rejections: 0 };

  const add = (
    geometry: THREE.BufferGeometry,
    material: number,
    position: THREE.Vector3,
    rotation = new THREE.Euler(),
  ) => {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        position,
        new THREE.Quaternion().setFromEuler(rotation),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    // Stretch exterior forms around embedded roots, keeping their attachment to the core.
    // Do this before clearance testing, so changed silhouettes cannot cover installed mounts.
    const vertices = geometry.getAttribute('position');
    const stretch = (value: number, root: number, factor: number) =>
      Math.sign(value) *
      (Math.min(Math.abs(value), root) + Math.max(0, Math.abs(value) - root) * factor);
    for (let i = 0; i < vertices.count; i++) {
      vertices.setXYZ(
        i,
        stretch(vertices.getX(i), length * 0.25, identity.length),
        stretch(vertices.getY(i), height * 0.35, identity.height),
        stretch(vertices.getZ(i), width * 0.35, identity.width),
      );
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    // Leave installed weapons, sensors and both radiator positions unobstructed.
    if (mounts.some((mount) => geometry.boundingBox?.intersectsBox(mount))) {
      clearance.rejections++;
      geometry.dispose();
      return;
    }
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    batches[material]?.push(flat);
  };
  const block = (
    material: number,
    dimensions: readonly [number, number, number],
    position: readonly [number, number, number],
  ) => {
    add(
      sectionGeometry(new THREE.Vector3(...dimensions)),
      material,
      new THREE.Vector3(...position),
    );
  };
  const pipe = (radius: number, span: number, position: readonly [number, number, number]) => {
    add(
      new THREE.CylinderGeometry(radius, radius, span, 8),
      1,
      new THREE.Vector3(...position),
      new THREE.Euler(0, 0, Math.PI / 2),
    );
  };
  const shell = (
    material: number,
    dimensions: readonly [number, number, number],
    position: readonly [number, number, number],
    front = 0.4,
    aft = 0.8,
  ) => {
    add(
      armourShell(new THREE.Vector3(...dimensions), front, aft),
      material,
      new THREE.Vector3(...position),
    );
  };
  const assembly = (build: () => void) => {
    const starts = batches.map((batch) => batch.length);
    const rejections = clearance.rejections;
    build();
    if (clearance.rejections !== rejections) {
      batches.forEach((batch, i) => {
        batch.splice(starts[i] ?? 0).forEach((geometry) => {
          geometry.dispose();
        });
      });
    }
  };

  // A quiet structural spine remains visible between the larger armour masses.
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      shell(
        1,
        [length * 0.92, height * 0.16, width * 0.2],
        [0, sy * height * 0.36, sz * width * 0.48],
      );
      if (section === 'middle') {
        shell(
          0,
          [length * 0.84, height * 0.2, width * 0.26],
          [0, sy * height * 0.39, sz * width * 0.52],
          0.65,
          0.65,
        );
      }
    }
  }

  // Low armoured dorsal and ventral housings, offset from the centreline mount positions.
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      assembly(() => {
        block(
          2,
          [length * 0.6, height * 0.14, width * 0.2],
          [-length * 0.04, sy * height * 0.51, sz * width * 0.3],
        );
        for (let i = 0; i < 4; i++) {
          block(
            1,
            [length * 0.025, height * 0.025, width * 0.15],
            [(i - 1.5) * length * 0.1, sy * height * 0.588, sz * width * 0.3],
          );
        }
      });
    }
  }

  if (section === 'forward') {
    // Broad shoulders and a split armoured prow establish the primary silhouette.
    for (const sz of [-1, 1]) {
      assembly(() => {
        shell(
          2,
          [length * 0.98, height * 0.65, width * 0.48],
          [length * 0.02, -height * 0.03, sz * width * 0.55],
        );
        shell(
          0,
          [length * 1.04, height * 0.74, width * 0.6],
          [length * 0.05, -height * 0.03, sz * width * 0.68],
          identity.taper,
          0.85,
        );
        block(
          3,
          [length * 0.06, height * 0.28, width * 0.012],
          [-length * 0.1, -height * 0.03, sz * width * 0.985],
        );
      });
      shell(
        0,
        [length * 0.7, height * 0.28, width * 0.42],
        [length * 0.52, height * 0.44, sz * width * 0.28],
        0.12,
        0.8,
      );
    }
    shell(
      1,
      [length * 0.9, height * 0.3, width * 0.35],
      [length * 0.2, -height * 0.5, 0],
      0.25,
      0.75,
    );
    // A protected command/electronics housing and paired low-profile aerials.
    assembly(() => {
      block(
        1,
        [length * 0.28, height * 0.1, width * 0.42],
        [-length * 0.31, height * 0.52, -width * 0.18],
      );
      block(
        0,
        [length * 0.24, height * 0.24, width * 0.3],
        [-length * 0.31, height * 0.65, -width * 0.18],
      );
      block(
        2,
        [length * 0.2, height * 0.065, width * 0.23],
        [-length * 0.31, height * 0.8, -width * 0.18],
      );
      for (const offset of [-0.1, 0.1]) {
        add(
          new THREE.CylinderGeometry(unit * 0.008, unit * 0.018, height * 0.24, 6),
          1,
          new THREE.Vector3(-length * 0.31, height * 0.95, width * (-0.18 + offset)),
        );
      }
    });
    // Recessed dark apertures in the forward armour; no decorative glowing windows.
    for (const sz of [-1, 1]) {
      block(1, [length * 0.11, height * 0.27, width * 0.32], [length * 0.46, 0, sz * width * 0.25]);
      block(
        2,
        [length * 0.015, height * 0.12, width * 0.18],
        [length * 0.52, 0, sz * width * 0.25],
      );
    }
  } else if (section === 'engine') {
    // Heavy aft shoulders contrast with the quieter waist; dark beds show below the armour.
    for (const sz of [-1, 1]) {
      assembly(() => {
        shell(
          2,
          [length * 0.88, height * 0.72, width * 0.56],
          [-length * 0.04, -height * 0.04, sz * width * 0.57],
          0.65,
          0.9,
        );
        shell(
          0,
          [length * 0.96, height * 0.82, width * 0.62],
          [-length * 0.04, -height * 0.04, sz * width * 0.73],
          0.45,
          0.8,
        );
        block(
          3,
          [length * 0.08, height * 0.33, width * 0.012],
          [-length * 0.12, -height * 0.04, sz * width * 1.045],
        );
      });
    }
    for (const sy of [-1, 1]) {
      shell(
        0,
        [length * 0.78, height * 0.28, width * 0.7],
        [-length * 0.03, sy * height * 0.54, 0],
        0.45,
        0.85,
      );
    }
    // Exposed drive plumbing, cooling collars and four banks of small manoeuvring nozzles.
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pipe(unit * 0.065, length * 0.7, [-length * 0.05, sy * height * 0.43, sz * width * 0.48]);
        for (let i = 0; i < 4; i++) {
          block(
            1,
            [length * 0.045, height * 0.19, width * 0.23],
            [length * (-0.35 + i * 0.19), sy * height * 0.39, sz * width * 0.48],
          );
        }
        const location = new THREE.Vector3(-length * 0.32, sy * height * 0.44, sz * width * 0.55);
        add(
          new THREE.CylinderGeometry(unit * 0.045, unit * 0.025, unit * 0.12, 10, 1, true),
          1,
          location,
          new THREE.Euler((sz * Math.PI) / 2, 0, 0),
        );
      }
    }
  }

  // Merge static fittings by material: detail costs four draw calls per section, not one per bolt.
  batches.forEach((geometries, index) => {
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => {
      geometry.dispose();
    });
    const mesh = new THREE.Mesh(merged, materials[index]);
    mesh.userData = { decorative: true };
    group.add(mesh);
  });
  return group;
};
