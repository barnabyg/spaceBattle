import * as THREE from 'three';
import type { HullProfile } from '../sim/exterior';
import { mapHullFaces } from './shipDetail';

type Outline = readonly (readonly [number, number])[];

/** Primary armour shapes in section-relative coordinates. The core spans −½ to +½.
 * In plan the second coordinate is starboard; in elevation it is up. */
export const buildShipProfile = (
  profile: HullProfile,
  size: THREE.Vector3,
  attach: (geometry: THREE.BufferGeometry, material: number) => void,
): void => {
  const plate = (
    outline: Outline,
    depth: number,
    offset: number,
    plan: boolean,
    material: number,
  ) => {
    const across = plan ? size.z : size.y;
    const through = plan ? size.y : size.z;
    const shape = new THREE.Shape(
      outline.map(([x, v]) => new THREE.Vector2(x * size.x, v * across)),
    );
    const thickness = depth * through;
    const bevel = Math.min(thickness * 0.21, across * 0.085);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness - 2 * bevel,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      steps: 1,
    });
    geometry.translate(0, 0, bevel - thickness / 2);
    if (plan) geometry.rotateX(Math.PI / 2);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    const centre = box.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    mapHullFaces(geometry, box.getSize(new THREE.Vector3()));
    geometry.translate(
      centre.x,
      centre.y + (plan ? offset * through : 0),
      centre.z + (plan ? 0 : offset * through),
    );
    attach(geometry, material);
  };
  const plan = (outline: Outline, depth: number, y = 0, material = 0) => {
    plate(outline, depth, y, true, material);
  };
  const elevation = (outline: Outline, depth: number, z = 0, material = 0) => {
    plate(outline, depth, z, false, material);
  };
  const pair = (outline: Outline, depth: number, y = 0) => {
    plan(outline, depth, y);
    plan(
      outline.map(([x, z]) => [x, -z]),
      depth,
      y,
    );
  };
  switch (profile) {
    case 'plain':
      break;
    case 'fork':
      // The tips diverge, leaving open space right through the bow.
      pair(
        [
          [-0.36, 0.24],
          [0.15, 0.27],
          [1.05, 0.86],
          [1.11, 1.02],
          [0.03, 0.72],
          [-0.4, 0.55],
        ],
        0.31,
      );
      break;
    case 'ram':
      elevation(
        [
          [-0.37, 0.23],
          [0.37, 0.28],
          [0.96, -0.31],
          [0.23, -1.17],
          [-0.37, -0.69],
        ],
        1.12,
      );
      break;
    case 'hammerhead':
      plan(
        [
          [-0.35, -0.39],
          [0.18, -0.55],
          [0.25, -1.68],
          [0.53, -1.81],
          [0.67, -1.49],
          [0.67, 1.49],
          [0.53, 1.81],
          [0.25, 1.68],
          [0.18, 0.55],
          [-0.35, 0.39],
        ],
        0.76,
      );
      break;
    case 'booms':
      // Long side bodies with open slots between them and the central hull.
      pair(
        [
          [-0.49, 0.27],
          [-0.17, 0.27],
          [-0.08, 0.95],
          [0.96, 0.95],
          [1.09, 1.17],
          [0.93, 1.49],
          [-0.44, 1.49],
          [-0.62, 1.17],
        ],
        0.72,
      );
      break;
    case 'lobes': {
      // Three banded drums nest together, with the lower one stepped forward.
      const drum = [
        new THREE.Vector2(0, -0.46),
        new THREE.Vector2(0.32, -0.42),
        new THREE.Vector2(0.56, -0.26),
        new THREE.Vector2(0.56, 0.39),
        new THREE.Vector2(0.46, 0.57),
        new THREE.Vector2(0.23, 0.7),
        new THREE.Vector2(0, 0.72),
      ];
      for (const side of [-1, 0, 1]) {
        const x = side === 0 ? size.x * 0.16 : 0;
        const y = size.y * (side === 0 ? -0.67 : -0.11);
        const z = size.z * side * 0.81;
        const body = new THREE.LatheGeometry(drum, 12).rotateZ(-Math.PI / 2);
        attach(body.scale(size.x, size.y, size.z).translate(x, y, z), 0);
        const band = new THREE.CylinderGeometry(0.575, 0.575, 0.075, 12, 1, true).rotateZ(
          -Math.PI / 2,
        );
        attach(band.scale(size.x, size.y, size.z).translate(x + 0.22 * size.x, y, z), 1);
      }
      break;
    }
    case 'keel':
      elevation(
        [
          [-0.35, 0.17],
          [0.44, 0.1],
          [0.74, -0.48],
          [0.63, -1.19],
          [0.32, -1.07],
          [-0.31, -0.45],
        ],
        0.59,
      );
      break;
    case 'spindle':
      plan(
        [
          [-0.43, -0.55],
          [0.35, -0.58],
          [0.9, -0.22],
          [1.68, -0.035],
          [1.68, 0.035],
          [0.9, 0.22],
          [0.35, 0.58],
          [-0.43, 0.55],
        ],
        0.21,
      );
      elevation(
        [
          [0.26, -0.35],
          [1.66, -0.035],
          [1.66, 0.035],
          [0.26, 0.35],
        ],
        0.14,
      );
      break;
    case 'wedge':
      plan(
        [
          [-0.46, -1.53],
          [-0.15, -1.49],
          [1.08, -0.12],
          [1.08, 0.12],
          [-0.15, 1.49],
          [-0.46, 1.53],
          [-0.28, 0.48],
          [-0.28, -0.48],
        ],
        0.66,
      );
      break;
    case 'tower':
      elevation(
        [
          [-0.45, 0.24],
          [0.42, 0.24],
          [0.38, 0.8],
          [0.19, 0.83],
          [0.13, 1.24],
          [-0.05, 1.24],
          [-0.09, 1.65],
          [-0.36, 1.65],
        ],
        0.82,
      );
      break;
    case 'shoulders':
      // Start aft of the broadside mounts and sweep out from the cruiser's waist.
      pair(
        [
          [-0.47, 0.24],
          [-0.11, 0.26],
          [-0.11, 0.57],
          [-0.38, 1.32],
          [-0.48, 1.25],
        ],
        0.7,
      );
      break;
    case 'collar': {
      // An open polygonal collar on two transverse supports, viewed down the drive axis.
      const radius = Math.min(size.y, size.z);
      const collar = new THREE.TorusGeometry(radius * 1.38, radius * 0.16, 6, 10);
      collar.rotateY(Math.PI / 2);
      attach(collar, 0);
      plan(
        [
          [-0.09, -1.36],
          [0.09, -1.36],
          [0.09, 1.36],
          [-0.09, 1.36],
        ],
        0.18,
        0,
        1,
      );
      break;
    }
    case 'mantle':
      // Swept aft vanes widen towards the trailing tips.
      pair(
        [
          [0.44, 0.28],
          [0.34, 0.77],
          [-0.57, 2.05],
          [-0.89, 2.16],
          [-0.64, 1.38],
          [-0.33, 0.77],
          [-0.41, 0.29],
        ],
        0.32,
      );
      break;
    case 'sail':
      elevation(
        [
          [0.32, 0.22],
          [0.36, 0.89],
          [-0.4, 1.98],
          [-0.62, 1.98],
          [-0.45, 0.72],
          [-0.44, 0.22],
        ],
        0.48,
      );
      break;
  }
};
