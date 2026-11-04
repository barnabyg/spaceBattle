import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HAND_MADE_DESIGNS, handMadeDesign } from '../data/designs';
import type { Design } from '../sim/design';
import { catalogueComponent } from '../data/components';
import { buildDesign, specificationOf } from '../shipyard/shipyard';
import { shipShape } from '../sim/shape';
import { createBattle } from '../sim/battle';
import { armedTestDesign, duelSetup, testDesign } from '../sim/testing';
import {
  createShipModel,
  createResolvedShipModel,
  updateResolvedShipModel,
  shipModelNeedsRebuild,
  disposeShipModel,
  heatGlow,
  updateShipModel,
  type ShipModelPartData,
} from './shipModel';

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

/** Section fittings are visual only; their core is the simulation's hit envelope. */
const coreBounds = (object: THREE.Object3D): THREE.Box3 => {
  if (object instanceof THREE.Mesh && object.userData.kind === 'section') {
    const geometry = object.geometry as THREE.BufferGeometry;
    geometry.computeBoundingBox();
    return (geometry.boundingBox?.clone() ?? new THREE.Box3()).applyMatrix4(object.matrixWorld);
  }
  return new THREE.Box3().setFromObject(object);
};

describe('ship model', () => {
  it('draws a resolved contact with the same appearance without its private design or stores', () => {
    const design = armedTestDesign();
    const battle = createBattle(duelSetup(design, design, 1_000_000));
    const seen = battle.observe('blue').contacts[0]?.detailedAppearance;
    if (!seen) throw new Error('Expected fully resolved exterior');
    const own = createShipModel(design);
    const contact = createResolvedShipModel(seen);
    expect(new THREE.Box3().setFromObject(contact)).toEqual(new THREE.Box3().setFromObject(own));
    const remaining = {
      ...seen,
      parts: seen.parts.filter((p) => p.section !== 'forward'),
      throttle: 0.5,
    };
    updateResolvedShipModel(contact, remaining);
    expect(
      meshesOf(contact, 'section').find((part) => part.userData.section === 'forward')?.visible,
    ).toBe(false);
    expect(meshesOf(contact, 'exhaust')[0]?.visible).toBe(true);
    const rebuilt = createResolvedShipModel(remaining);
    expect(meshesOf(rebuilt, 'section').some((part) => part.userData.section === 'forward')).toBe(
      false,
    );
    battle.giveOrder('red', { type: 'radiators', deployed: true });
    battle.advance(2.5);
    const midway = battle.observe('blue').contacts[0]?.detailedAppearance;
    if (!midway) throw new Error('Expected resolved deploying exterior');
    const midwayContact = createResolvedShipModel(midway);
    const midwayOwn = createShipModel(design, battle.observe('red').ownShip.appearance);
    expect(new THREE.Box3().setFromObject(midwayContact)).toEqual(
      new THREE.Box3().setFromObject(midwayOwn),
    );
    disposeShipModel(midwayContact);
    disposeShipModel(midwayOwn);
    battle.advance(2.5);
    const deployed = battle.observe('blue').contacts[0]?.detailedAppearance;
    if (!deployed) throw new Error('Expected resolved deployed exterior');
    expect(shipModelNeedsRebuild(contact, deployed)).toBe(true);
    const deployedContact = createResolvedShipModel(deployed);
    const deployedOwn = createShipModel(design, { radiatorsDeployed: true });
    expect(new THREE.Box3().setFromObject(deployedContact)).toEqual(
      new THREE.Box3().setFromObject(deployedOwn),
    );
    disposeShipModel(rebuilt);
    disposeShipModel(deployedContact);
    disposeShipModel(deployedOwn);
    disposeShipModel(own);
    disposeShipModel(contact);
  });

  it('accents shared designs independently while preserving the hull and equipment', () => {
    const design = handMadeDesign('lance');
    const coloursOf = (model: THREE.Group) => {
      const colours: string[] = [];
      model.traverseVisible((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) {
          colours.push(object.material.color.getHexString());
        }
      });
      return colours;
    };
    const blue = createShipModel(design, {}, '#4fa3ff');
    const red = createShipModel(design, {}, '#ff5a4f');
    expect(coloursOf(blue)).toContain('4fa3ff');
    expect(coloursOf(blue)).not.toContain('ff5a4f');
    expect(coloursOf(red)).toContain('ff5a4f');
    expect(coloursOf(red)).not.toContain('4fa3ff');
    expect(coloursOf(red)).toContain('737d86');
    expect(coloursOf(red)).toContain('3a4250');
    updateShipModel(red, {
      propellantMass: design.propellantMass,
      radiatorsDeployed: true,
      temperature: 300,
      thrust: 0,
    });
    expect(coloursOf(red)).toContain('ff5a4f');
    expect(coloursOf(red)).not.toContain('4fa3ff');
    disposeShipModel(red);
    expect(coloursOf(blue)).toContain('4fa3ff');
    disposeShipModel(blue);
  });

  it('extends observed radiators in place through deployment and cancellation without rebuilding', () => {
    const design = handMadeDesign('rime');
    const battle = createBattle(duelSetup(design, testDesign(), 1_000_000));
    const model = createShipModel(design);
    const meshes = meshesOf(model, 'mount').filter((mesh) => {
      const data = mesh.userData as ShipModelPartData;
      return (
        design.sections.find((s) => s.kind === data.section)?.mounts[data.mount ?? -1]?.type ===
        'radiator'
      );
    });
    expect(meshes).toHaveLength(3);
    const geometries = meshes.map((mesh) => (mesh as THREE.Mesh).geometry);
    const check = () => {
      const look = battle.observe('blue').ownShip.appearance;
      updateShipModel(model, look);
      model.updateMatrixWorld(true);
      meshes.forEach((mesh, i) => {
        const data = mesh.userData as ShipModelPartData;
        const part = look.parts.find((p) => p.section === data.section && p.mount === data.mount);
        if (!part) throw new Error('Missing radiator');
        const bounds = coreBounds(mesh);
        expect(
          bounds.min.distanceTo(new THREE.Vector3(part.min.x, part.min.y, part.min.z)),
        ).toBeLessThan(1e-5);
        expect(
          bounds.max.distanceTo(new THREE.Vector3(part.max.x, part.max.y, part.max.z)),
        ).toBeLessThan(1e-5);
        expect((mesh as THREE.Mesh).geometry).toBe(geometries[i]);
      });
    };
    check();
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    battle.giveOrder('blue', { type: 'burn', throttle: 1, duration: 20 });
    for (let second = 0; second < 5; second++) {
      battle.advance(1);
      check();
    }
    battle.giveOrder('blue', { type: 'radiators', deployed: false });
    check();
    battle.giveOrder('blue', { type: 'radiators', deployed: true });
    battle.advance(2.5);
    check();
    battle.giveOrder('blue', { type: 'radiators', deployed: false });
    check();
    const look = battle.observe('blue').ownShip.appearance;
    updateShipModel(model, {
      ...look,
      parts: look.parts.filter(
        (p) =>
          !meshes.some(
            (mesh) => mesh.userData.section === p.section && mesh.userData.mount === p.mount,
          ),
      ),
    });
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
    disposeShipModel(model);
  });

  it('gives every stock design distinct proportions and derives player silhouettes from equipment', () => {
    const outline = (design: Design) => {
      const model = createShipModel(design);
      const sizes = meshesOf(model, 'section').map((section) =>
        new THREE.Box3()
          .setFromObject(section)
          .getSize(new THREE.Vector3())
          .toArray()
          .map((value) => value.toFixed(2)),
      );
      disposeShipModel(model);
      return JSON.stringify(sizes);
    };
    expect(new Set(HAND_MADE_DESIGNS.map(outline)).size).toBe(HAND_MADE_DESIGNS.length);
    const base = specificationOf(handMadeDesign('lance'));
    const laser = buildDesign({ ...base, name: 'Player laser' }).design;
    const gun = buildDesign({
      ...base,
      name: 'Player gun',
      components: base.components
        .map((entry) =>
          entry.component.type === 'laser'
            ? { component: catalogueComponent('kinetic-gun') }
            : entry,
        )
        .concat({ component: catalogueComponent('magazine-slugs') }),
    }).design;
    expect(outline(gun)).not.toBe(outline(laser));
    expect(outline({ ...laser, id: 'renamed', name: 'Renamed' })).toBe(outline(laser));
  });

  it('gives equipment families different primary silhouettes on the same hull', () => {
    const silhouette = (id: string, section: string) => {
      const model = createShipModel(handMadeDesign(id));
      const part = meshesOf(model, 'section').find((mesh) => mesh.userData.section === section);
      const size = new THREE.Box3().setFromObject(part ?? model).getSize(new THREE.Vector3());
      disposeShipModel(model);
      return size;
    };
    expect(silhouette('needle', 'forward').x).toBeGreaterThan(silhouette('lance', 'forward').x);
    expect(silhouette('sling', 'forward').z).toBeGreaterThan(silhouette('lance', 'forward').z);
    expect(silhouette('torch', 'engine').y).toBeGreaterThan(silhouette('lance', 'engine').y);
  });

  it.each(['lance', 'bastion'])('gives one mesh per section and per mount for %s', (id) => {
    const design = handMadeDesign(id);
    const model = createShipModel(design);
    expect(meshesOf(model, 'section')).toHaveLength(design.sections.length);
    expect(meshesOf(model, 'mount')).toHaveLength(mountCount(design));
    expect(meshesOf(model, 'nozzle')).toHaveLength(1);
  });

  it('keeps the core hit envelopes with radiators folded or deployed, independently of decoration', () => {
    for (const design of HAND_MADE_DESIGNS) {
      for (const radiatorsDeployed of [false, true]) {
        const model = createShipModel(design, { radiatorsDeployed });
        model.updateMatrixWorld();
        const shape = shipShape(design, design.propellantMass, radiatorsDeployed);
        const boxes = [...meshesOf(model, 'section'), ...meshesOf(model, 'mount')].map((mesh) =>
          coreBounds(mesh),
        );
        for (const part of shape) {
          const match = boxes.find(
            (box) =>
              box.min.distanceTo(new THREE.Vector3(part.min.x, part.min.y, part.min.z)) < 1e-3 &&
              box.max.distanceTo(new THREE.Vector3(part.max.x, part.max.y, part.max.z)) < 1e-3,
          );
          expect(match, `${part.section} ${String(part.mount)}`).toBeDefined();
        }
        disposeShipModel(model);
      }
    }
  });

  it('keeps detail attached to its mount and section as parts are lost and the centre of mass moves', () => {
    const design = handMadeDesign('lance');
    const model = createShipModel(design);
    const mounts = meshesOf(model, 'mount');
    const detailed = mounts.find((mount) => mount.children.length > 0);
    expect(detailed).toBeDefined();
    const data = detailed?.userData as ShipModelPartData;
    const look = {
      propellantMass: design.propellantMass / 2,
      radiatorsDeployed: false,
      temperature: 1000,
      thrust: 0,
      parts: shipShape(design, design.propellantMass / 2, false).filter(
        (part) => !(part.section === data.section && part.mount === data.mount),
      ),
    };
    updateShipModel(model, look);
    model.updateMatrixWorld(true);
    const visible: THREE.Object3D[] = [];
    model.traverseVisible((object) => {
      visible.push(object);
    });
    expect(visible).not.toContain(detailed);
    for (const child of detailed?.children ?? []) expect(visible).not.toContain(child);
    const remainingShape = look.parts.find((part) => part.mount === null);
    const remainingModel = meshesOf(model, 'section').find(
      (mesh) => mesh.userData.section === remainingShape?.section,
    );
    expect(coreBounds(remainingModel ?? model).min.x).toBeCloseTo(remainingShape?.min.x ?? 0, 3);
    disposeShipModel(model);
  });

  it('adds exterior fittings that disappear with their section and leave mounts clear', () => {
    for (const design of HAND_MADE_DESIGNS) {
      const model = createShipModel(design);
      model.updateMatrixWorld(true);
      const shapes = [false, true].flatMap((deployed) =>
        shipShape(design, design.propellantMass, deployed),
      );
      for (const section of meshesOf(model, 'section')) {
        const fittings = section.getObjectByName('Decorative hull fittings');
        expect(fittings?.children.length).toBeGreaterThan(0);
        expect(fittings?.children.length).toBeLessThanOrEqual(4);
        const bounds = new THREE.Box3().setFromObject(fittings ?? section);
        expect(coreBounds(section).containsBox(bounds)).toBe(false);
        for (const child of fittings?.children ?? []) {
          if (!(child instanceof THREE.Mesh)) continue;
          const vertices = (child.geometry as THREE.BufferGeometry).getAttribute('position');
          const point = new THREE.Vector3();
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(child.matrixWorld);
            expect(
              shapes.some(
                (part) =>
                  part.mount !== null &&
                  part.section === section.userData.section &&
                  point.x > part.min.x &&
                  point.x < part.max.x &&
                  point.y > part.min.y &&
                  point.y < part.max.y &&
                  point.z > part.min.z &&
                  point.z < part.max.z,
              ),
            ).toBe(false);
          }
        }
      }
      const section = meshesOf(model, 'section')[0];
      updateShipModel(model, {
        propellantMass: design.propellantMass,
        radiatorsDeployed: false,
        temperature: 300,
        thrust: 0,
        parts: shipShape(design, design.propellantMass, false).filter(
          (part) => part.section !== section?.userData.section,
        ),
      });
      const visible: THREE.Object3D[] = [];
      model.traverseVisible((object) => {
        visible.push(object);
      });
      expect(visible).not.toContain(section?.getObjectByName('Decorative hull fittings'));
      disposeShipModel(model);
    }
  });

  it('disposes each model resource once while keeping shared surface textures usable', () => {
    const model = createShipModel(handMadeDesign('bastion'));
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    const textures = new Set<THREE.Texture>();
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        resources.add(object.geometry as THREE.BufferGeometry);
        const material = object.material as THREE.MeshStandardMaterial;
        resources.add(material);
        if (material.map) textures.add(material.map);
      } else if (object instanceof THREE.Sprite) resources.add(object.material);
    });
    const disposed = new Map<unknown, number>();
    for (const resource of [...resources, ...textures]) {
      resource.addEventListener('dispose', () => {
        disposed.set(resource, (disposed.get(resource) ?? 0) + 1);
      });
    }
    disposeShipModel(model);
    for (const resource of resources) expect(disposed.get(resource)).toBe(1);
    for (const texture of textures) expect(disposed.has(texture)).toBe(false);
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
    const parts = shipShape(design, design.propellantMass, false).filter(
      (p) => !(p.section === 'middle' && p.mount === 0),
    );
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
