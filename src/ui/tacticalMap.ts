import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { projectBurns, projectPath } from '../game/projection';
import type { MunitionObservation, SideId, SideObservation, SideSetup } from '../sim/battle';
import { designComponent } from '../sim/design';
import { rotate, type Quat } from '../sim/quaternion';
import { length, vec3, type Vec3 } from '../sim/vector';
import { disposeRenderer, disposeScene } from './dispose';
import { el } from './el';
import { formatDuration, formatKm, formatKmPerS } from './format';

/** Scene units are kilometres; the simulation works in metres. */
const KM = 1000;
const RING_SPACING_KM = 50_000;
const RING_COUNT = 10;
/** Velocity vectors show where a ship would drift in this many seconds. */
const VECTOR_SECONDS = 20_000;
/** Simulated seconds between points on a ship's trail. */
const TRAIL_INTERVAL = 30;
const TRAIL_POINTS = 2_000;
/** How far ahead the own ship's projected path reaches at least, s. */
const PROJECTION_HORIZON = 7_200;
/** It reaches further to take in a manoeuvre's planned burns, up to this, s. */
const MAX_PROJECTION_HORIZON = 24 * 3_600;
const PROJECTION_POINTS = 121;
/** Planned burns shown on the map, in order. */
const MAX_PLANNED_BURNS = 4;
const PLANNED_BURN_COLOUR = '#ffb347';
const BEAM_COLOUR = '#7dffb0';
/** Heading lines are this fraction of the camera's distance from the own ship. */
const HEADING_SCALE = 0.06;
/** Munitions in flight are drawn as dots this many pixels across. */
const MUNITION_SIZE = 5;
/** Missiles are drawn larger than slugs, px. */
const MISSILE_SIZE = 9;

export const SIDE_COLOURS = ['#4fa3ff', '#ff5a4f'] as const;

const toScene = (v: Vec3) => new THREE.Vector3(v.x / KM, v.y / KM, v.z / KM);

interface ShipMarker {
  readonly symbol: CSS2DObject;
  readonly label: HTMLElement;
  readonly velocity: THREE.ArrowHelper;
  readonly dropLine: THREE.Line;
  readonly heading: THREE.Line;
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

/**
 * The captain's main working view: symbols and exact data, centred on their own ship. The own
 * ship's side comes first; `colours` gives each side's colour in the same order.
 */
export const createTacticalMap = (
  sides: readonly SideSetup[],
  colours: readonly string[] = SIDE_COLOURS,
) => {
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
    const colour = colours[index] ?? '#ffffff';
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
    const heading = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff' }),
    );
    scene.add(symbol, velocity, dropLine, heading, trail);
    markers.set(side.id, {
      symbol,
      label,
      velocity,
      dropLine,
      heading,
      trail,
      trailPositions,
      trailCount: 0,
      lastTrailTime: -Infinity,
    });
  });

  // The own ship's projected path, through its planned burns.
  const projectionPositions = new Float32Array(PROJECTION_POINTS * 3);
  const projectionGeometry = new THREE.BufferGeometry();
  projectionGeometry.setAttribute('position', new THREE.BufferAttribute(projectionPositions, 3));
  const projection = new THREE.Line(
    projectionGeometry,
    new THREE.LineDashedMaterial({ color: '#9fd0ff', dashSize: 2_000, gapSize: 2_000 }),
  );
  scene.add(projection);

  // Where and which way the autopilot plans to burn, along the projected path.
  const plannedBurnMarkers = Array.from({ length: MAX_PLANNED_BURNS }, () => {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      1,
      PLANNED_BURN_COLOUR,
    );
    const text = el('span', { className: 'planned-burn' });
    const label = new CSS2DObject(text);
    arrow.visible = false;
    label.visible = false;
    scene.add(arrow, label);
    return { arrow, label, text };
  });
  const ownDrive = sides[0] ? designComponent(sides[0].design, 'drive') : undefined;

  // The own ship's laser beam, while it is firing.
  const beam = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: BEAM_COLOUR, transparent: true, opacity: 0.8 }),
  );
  beam.visible = false;
  scene.add(beam);

  // Munitions in flight: a dot each, in the colour of the side that fired it; missiles larger.
  const munitionColours = new Map(
    sides.map((side, index) => [side.id, new THREE.Color(colours[index] ?? '#ffffff')]),
  );
  const munitionDots = (size: number) => {
    const geometry = new THREE.BufferGeometry();
    let capacity = 0;
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }),
    );
    points.frustumCulled = false;
    scene.add(points);
    return (shown: readonly MunitionObservation[]) => {
      if (shown.length > capacity) {
        capacity = Math.max(256, 2 * shown.length);
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
        );
        geometry.setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
        );
      }
      if (capacity === 0) return;
      const positions = geometry.getAttribute('position');
      const tints = geometry.getAttribute('color');
      shown.forEach((munition, i) => {
        positions.setXYZ(
          i,
          munition.position.x / KM,
          munition.position.y / KM,
          munition.position.z / KM,
        );
        const tint = munitionColours.get(munition.attacker);
        tints.setXYZ(i, tint?.r ?? 1, tint?.g ?? 1, tint?.b ?? 1);
      });
      positions.needsUpdate = true;
      tints.needsUpdate = true;
      geometry.setDrawRange(0, shown.length);
    };
  };
  const showSlugs = munitionDots(MUNITION_SIZE);
  const showMissiles = munitionDots(MISSILE_SIZE);
  const showMunitions = (observation: SideObservation) => {
    showSlugs(observation.munitions.filter((m) => m.kind === 'slug'));
    showMissiles(observation.munitions.filter((m) => m.kind === 'missile'));
  };

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
    ship: { position: Vec3; velocity: Vec3; orientation: Quat },
    planeZ: number,
    text: string,
    time: number,
  ) => {
    const { position, velocity } = ship;
    const p = toScene(position);
    const headingLength = camera.position.distanceTo(controls.target) * HEADING_SCALE;
    const nose = toScene(rotate(ship.orientation, vec3(1, 0, 0))).normalize();
    marker.heading.geometry.setFromPoints([p, p.clone().addScaledVector(nose, headingLength)]);

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
          own,
          centre.z,
          `${sideName(own.sideId)} · ${formatKmPerS(length(own.velocity))} · Δv ${formatKmPerS(own.deltaV)}`,
          observation.time,
        );
      }
      for (const contact of observation.contacts) {
        const marker = markers.get(contact.sideId);
        if (!marker) continue;
        placeShip(
          marker,
          contact,
          centre.z,
          `${sideName(contact.sideId)} · ${formatKmPerS(length(contact.velocity))}`,
          observation.time,
        );
      }
      const target = observation.contacts.find((c) => c.sideId === own.weapons.target);
      beam.visible = target !== undefined && own.weapons.lasers.some((l) => l.firing);
      if (target && beam.visible) {
        beam.geometry.setFromPoints([centre, toScene(target.position)]);
      }
      showMunitions(observation);

      if (ownDrive) {
        const lastBurnEnd = Math.max(
          0,
          ...(own.manoeuvre?.plannedBurns ?? []).map((b) => b.start + b.duration),
        );
        const horizon = Math.min(
          MAX_PROJECTION_HORIZON,
          Math.max(PROJECTION_HORIZON, lastBurnEnd * 1.2),
        );
        const path = projectPath(own, ownDrive, horizon, horizon / (PROJECTION_POINTS - 1)).slice(
          0,
          PROJECTION_POINTS,
        );
        path.forEach((point, i) => {
          projectionPositions.set([point.x / KM, point.y / KM, point.z / KM], i * 3);
        });
        projectionGeometry.setDrawRange(0, path.length);
        projectionGeometry.getAttribute('position').needsUpdate = true;
        projectionGeometry.computeBoundingSphere();
        projection.computeLineDistances();

        const burns = projectBurns(own, ownDrive, horizon);
        const arrowLength = camera.position.distanceTo(controls.target) * HEADING_SCALE * 1.5;
        plannedBurnMarkers.forEach((marker, i) => {
          const planned = burns[i];
          marker.arrow.visible = planned !== undefined;
          marker.label.visible = planned !== undefined;
          if (!planned) return;
          const at = toScene(planned.position);
          marker.arrow.position.copy(at);
          marker.arrow.setDirection(toScene(planned.burn.direction).normalize());
          marker.arrow.setLength(arrowLength, arrowLength * 0.3, arrowLength * 0.15);
          marker.label.position.copy(at);
          marker.text.textContent =
            planned.burn.start < 1
              ? `Burn ${formatDuration(planned.burn.duration)}`
              : `Burn ${formatDuration(planned.burn.duration)} in ${formatDuration(planned.burn.start)}`;
        });
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
      disposeScene(scene);
      disposeRenderer(renderer);
    },
  };
};
