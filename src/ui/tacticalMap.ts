import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SideId, SideObservation } from '../sim/battle';
import { length, type Vec3 } from '../sim/vector';
import { el } from './el';
import { formatKm, formatKmPerS } from './format';

/** Scene units are kilometres; the simulation works in metres. */
const KM = 1000;
const RING_SPACING_KM = 50_000;
const RING_COUNT = 10;
/** Velocity vectors show where a ship would drift in this many seconds. */
const VECTOR_SECONDS = 20_000;
/** Simulated seconds between points on a ship's trail. */
const TRAIL_INTERVAL = 30;
const TRAIL_POINTS = 2_000;

export const SIDE_COLOURS = ['#4fa3ff', '#ff5a4f'] as const;

const toScene = (v: Vec3) => new THREE.Vector3(v.x / KM, v.y / KM, v.z / KM);

interface ShipMarker {
  readonly symbol: CSS2DObject;
  readonly label: HTMLElement;
  readonly velocity: THREE.ArrowHelper;
  readonly dropLine: THREE.Line;
  readonly trail: THREE.Line;
  readonly trailPositions: Float32Array;
  trailCount: number;
  lastTrailTime: number;
}

/** The smallest 1, 2 or 5 × 10ⁿ at least as long as `target`. */
const niceLength = (target: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= target) ?? 10;
  return step * magnitude;
};

/** The captain's main working view: symbols and exact data, centred on their own ship. */
export const createTacticalMap = (sides: readonly { id: SideId; name: string }[]) => {
  const element = el('section', {
    className: 'tactical-map',
    attrs: { 'aria-label': 'Tactical map' },
  });
  const scaleLabel = el('span', { className: 'scale-bar__label' });
  const scaleBar = el('div', { className: 'scale-bar' }, scaleLabel);
  element.append(scaleBar);

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  element.prepend(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'tactical-map__labels';
  element.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070d');
  const camera = new THREE.PerspectiveCamera(45, 1, 10, 1e8);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -500_000, 450_000);
  const controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 2_000;
  controls.maxDistance = 5_000_000;

  // Range rings around the captain's own ship, in the plane of the own ship.
  const grid = new THREE.Group();
  const polar = new THREE.PolarGridHelper(
    RING_SPACING_KM * RING_COUNT,
    12,
    RING_COUNT,
    128,
    '#2b3d5a',
    '#1a2638',
  );
  polar.rotation.x = Math.PI / 2;
  grid.add(polar);
  for (let ring = 2; ring <= RING_COUNT; ring += 2) {
    const label = new CSS2DObject(
      el('span', { className: 'range-label', text: formatKm(ring * RING_SPACING_KM * KM) }),
    );
    label.position.set(ring * RING_SPACING_KM, 0, 0);
    grid.add(label);
  }
  scene.add(grid);

  const markers = new Map<SideId, ShipMarker>();
  sides.forEach((side, index) => {
    const colour = SIDE_COLOURS[index % SIDE_COLOURS.length] ?? '#ffffff';
    const label = el('span', { className: 'ship-symbol__label' });
    const symbol = new CSS2DObject(
      el(
        'div',
        {
          className: `ship-symbol ship-symbol--${index === 0 ? 'own' : 'contact'}`,
          attrs: { 'data-side': side.id, style: `--side-colour: ${colour}` },
        },
        el('span', { className: 'ship-symbol__glyph', attrs: { 'aria-hidden': 'true' } }),
        label,
      ),
    );
    const velocity = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      colour,
    );
    const dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: colour, dashSize: 4_000, gapSize: 4_000 }),
    );
    const trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.45 }),
    );
    scene.add(symbol, velocity, dropLine, trail);
    markers.set(side.id, {
      symbol,
      label,
      velocity,
      dropLine,
      trail,
      trailPositions,
      trailCount: 0,
      lastTrailTime: -Infinity,
    });
  });

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = element;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);

  const placeShip = (
    marker: ShipMarker,
    position: Vec3,
    velocity: Vec3,
    planeZ: number,
    text: string,
    time: number,
  ) => {
    const p = toScene(position);
    marker.symbol.position.copy(p);
    marker.label.textContent = text;

    const v = toScene(velocity).multiplyScalar(VECTOR_SECONDS);
    const vLength = v.length();
    marker.velocity.visible = vLength > 0;
    if (vLength > 0) {
      marker.velocity.position.copy(p);
      marker.velocity.setDirection(v.normalize());
      marker.velocity.setLength(
        vLength,
        Math.min(vLength * 0.15, 8_000),
        Math.min(vLength * 0.08, 4_000),
      );
    }

    marker.dropLine.geometry.setFromPoints([p, new THREE.Vector3(p.x, p.y, planeZ)]);
    marker.dropLine.computeLineDistances();

    if (time - marker.lastTrailTime >= TRAIL_INTERVAL) {
      marker.lastTrailTime = time;
      if (marker.trailCount === TRAIL_POINTS) {
        marker.trailPositions.copyWithin(0, 3);
        marker.trailCount -= 1;
      }
      marker.trailPositions.set([p.x, p.y, p.z], marker.trailCount * 3);
      marker.trailCount += 1;
      marker.trail.geometry.getAttribute('position').needsUpdate = true;
      marker.trail.geometry.setDrawRange(0, marker.trailCount);
      marker.trail.geometry.computeBoundingSphere();
    }
  };

  const updateScaleBar = () => {
    const height = element.clientHeight;
    if (height === 0) return;
    const visibleKm =
      2 * camera.position.distanceTo(controls.target) * Math.tan((camera.fov * Math.PI) / 360);
    const kmPerPixel = visibleKm / height;
    const barKm = niceLength(kmPerPixel * 400);
    scaleBar.style.width = `${barKm / kmPerPixel}px`;
    scaleLabel.textContent = formatKm(barKm * KM);
  };

  const sideName = (id: SideId) => sides.find((s) => s.id === id)?.name ?? id;
  let previousCentre: THREE.Vector3 | undefined;

  return {
    element,
    update(observation: SideObservation) {
      const own = observation.ownShip;
      const centre = toScene(own.position);
      // Keep the camera's offset from the own ship as the ship drifts.
      if (previousCentre) camera.position.add(centre.clone().sub(previousCentre));
      previousCentre = centre;
      controls.target.copy(centre);
      grid.position.copy(centre);

      const ownMarker = markers.get(own.sideId);
      if (ownMarker) {
        placeShip(
          ownMarker,
          own.position,
          own.velocity,
          centre.z,
          `${sideName(own.sideId)} · ${formatKmPerS(length(own.velocity))}`,
          observation.time,
        );
      }
      for (const contact of observation.contacts) {
        const marker = markers.get(contact.sideId);
        if (!marker) continue;
        placeShip(
          marker,
          contact.position,
          contact.velocity,
          centre.z,
          `${sideName(contact.sideId)} · ${formatKmPerS(length(contact.velocity))}`,
          observation.time,
        );
      }
    },
    render() {
      controls.update();
      updateScaleBar();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
    dispose() {
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
};
