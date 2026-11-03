import * as THREE from 'three';
import type { Design } from '../sim/design';
import { HULLS, hullLength } from '../sim/hull';
import { disposeRenderer, disposeScene } from './dispose';
import { el } from './el';
import { createShipModel, disposeShipModel } from './shipModel';

/** How fast the previewed model turns, rad/s. */
const TURN_RATE = 0.3;

/**
 * A slowly turning 3D model of a design, as the shipyard builds it: its sections, armour and
 * every mount where it was placed.
 */
export const createDesignPreview = () => {
  const element = el('section', {
    className: 'design-preview',
    attrs: { 'aria-label': 'Model preview' },
  });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  element.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070d');
  const sunlight = new THREE.DirectionalLight('#fff4e0', 3);
  sunlight.position.set(300, 500, 400);
  scene.add(sunlight, new THREE.AmbientLight('#8090b0', 0.5));
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 10_000);
  let model: THREE.Group | null = null;
  const turntable = new THREE.Group();
  scene.add(turntable);

  const resize = () => {
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);

  let frame = 0;
  let last = performance.now();
  const render = (now: number) => {
    turntable.rotation.y += (TURN_RATE * (now - last)) / 1000;
    last = now;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return {
    element,
    /** Shows a design, or nothing for one the shipyard could not build into a ship. */
    show(design: Design | null) {
      if (model) {
        turntable.remove(model);
        disposeShipModel(model);
        model = null;
      }
      if (!design) return;
      try {
        model = createShipModel(design);
      } catch {
        // A design without a drive has no tail to draw; show nothing until it has one.
        return;
      }
      turntable.add(model);
      const length = hullLength(HULLS[design.hullSize]);
      camera.position.set(length * 0.65, length * 0.5, length * 1.05);
      camera.lookAt(0, 0, 0);
    },
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      if (model) disposeShipModel(model);
      disposeScene(scene);
      disposeRenderer(renderer);
    },
  };
};
