import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import type { Design } from '../sim/design';
import { shipShape } from '../sim/shape';
import { createShipModel, heatGlow, updateShipModel, type ShipModelPartData } from './shipModel';

const meshesOf = (model: THREE.Object3D, kind: ShipModelPartData['kind']) => {
  const found: THREE.Object3D[] = [];
  model.traverse((object) => {
    if (
      (object as Partial<THREE.Mesh>).isMesh &&
      (object.userData as ShipModelPartData).kind === kind
    ) {
      found.push(object);
    }
  });
  return found;
};

const mountCount = (design: Design) =>
  design.sections.reduce((total, section) => total + section.mounts.length, 0);

describe('ship model', () => {
  it.each(['lance', 'bastion'])('gives one mesh per section and per mount for %s', (id) => {
    const design = handMadeDesign(id);
    const model = createShipModel(design);
    expect(meshesOf(model, 'section')).toHaveLength(design.sections.length);
    expect(meshesOf(model, 'mount')).toHaveLength(mountCount(design));
    expect(meshesOf(model, 'nozzle')).toHaveLength(1);
  });

  it('matches the shape the simulation hits, with radiators folded or deployed', () => {
    const design = handMadeDesign('bastion');
    for (const radiatorsDeployed of [false, true]) {
      const model = createShipModel(design, { radiatorsDeployed });
      model.updateMatrixWorld();
      const shape = shipShape(design, design.propellantMass, radiatorsDeployed);
      const boxes = [...meshesOf(model, 'section'), ...meshesOf(model, 'mount')].map((mesh) =>
        new THREE.Box3().setFromObject(mesh),
      );
      for (const part of shape) {
        const match = boxes.find(
          (box) =>
            box.min.distanceTo(new THREE.Vector3(part.min.x, part.min.y, part.min.z)) < 1e-3 &&
            box.max.distanceTo(new THREE.Vector3(part.max.x, part.max.y, part.max.z)) < 1e-3,
        );
        expect(match, `${part.section} ${String(part.mount)}`).toBeDefined();
      }
    }
  });

  it('sizes the drive nozzle by thrust', () => {
    const radius = (id: string) => {
      const box = new THREE.Box3().setFromObject(
        meshesOf(createShipModel(handMadeDesign(id)), 'nozzle')[0] ?? new THREE.Object3D(),
      );
      return box.max.y - box.min.y;
    };
    expect(radius('bastion')).toBeGreaterThan(radius('lance'));
  });

  it('hides lost parts and shows exhaust only under thrust', () => {
    const design = handMadeDesign('lance');
    const model = createShipModel(design);
    const parts = shipShape(design, design.propellantMass, false).filter((p) => p.mount !== 0);
    updateShipModel(model, {
      propellantMass: design.propellantMass,
      radiatorsDeployed: false,
      temperature: 300,
      thrust: 0,
      parts,
    });
    const visibleMounts = meshesOf(model, 'mount').filter((m) => m.visible);
    expect(visibleMounts).toHaveLength(mountCount(design) - 1);
    expect(meshesOf(model, 'exhaust')[0]?.visible).toBe(false);
    updateShipModel(model, {
      propellantMass: design.propellantMass,
      radiatorsDeployed: false,
      temperature: 300,
      thrust: 1e6,
    });
    expect(meshesOf(model, 'exhaust')[0]?.visible).toBe(true);
  });

  it('makes radiators glow from dark through red and orange to white as they heat', () => {
    const glow = (k: number) => heatGlow(k).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    expect(heatGlow(300).getHex()).toBe(0x000000);
    const red = glow(800);
    expect(red.r).toBeGreaterThan(red.g * 5);
    const orange = glow(1000);
    expect(orange.g).toBeGreaterThan(red.g);
    const white = glow(1500);
    expect(Math.min(white.r, white.g, white.b)).toBeGreaterThan(0.85);
  });
});
