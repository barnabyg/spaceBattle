import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { projectBurns, projectPath } from '../game/projection';
import { followedContact, relativeMotion } from '../game/relativeMotion';
import type { MunitionObservation, SideId, SideObservation, SideSetup } from '../sim/battle';
import { designComponent } from '../sim/design';
import type { BeamKind } from '../sim/events';
import { rotate, type Quat } from '../sim/quaternion';
import { length, vec3, type Vec3 } from '../sim/vector';
import { createBurstFlash, createInterceptFlash } from './burstFlash';
import { disposeRenderer, disposeScene } from './dispose';
import { el } from './el';
import { CONTACT_DETAIL_TEXT, formatDuration, formatKm, formatKmPerS } from './format';
import { createMapLegend } from './mapLegend';
import { createMotionVector, type MotionVector } from './mapMotion';
import { loadMapLayers, MAP_LAYERS, saveMapLayers, type MapLayer } from './mapLayers';
import {
  ANTI_MISSILE_PALENESS,
  ANTI_MISSILE_SIZE,
  BEAM_OPACITY,
  BEAM_STYLES,
  BURST_COLOUR,
  BURST_FLASH_SIZE,
  DROP_LINE_DASH,
  INTERCEPT_COLOUR,
  INTERCEPT_FLASH_SIZE,
  MISSILE_SIZE,
  MUNITION_SIZE,
  PLANNED_BURN_COLOUR,
  PROJECTION_COLOUR,
  RELATIVE_VELOCITY_PALENESS,
  RING_COLOURS,
  RING_SPACING_KM,
  SIDE_COLOURS,
  TRAIL_OPACITY,
  VECTOR_SECONDS,
} from './mapStyle';
import { softGlowTexture } from './shipModel';

/** Scene units are kilometres; the simulation works in metres. */
const KM = 1000;
const RING_COUNT = 10;
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
/** A heading shortens on screen as it turns towards or away from the camera, down to this share. */
const MIN_FORESHORTENING = 0.25;
const WHITE = new THREE.Color('#ffffff');

/**
 * Each layer the captain can hide draws on its own camera layer, so hiding it only stops it being
 * drawn: it keeps updating, and shows its current state when shown again. Layer 0, always drawn,
 * holds the ship symbols.
 */
const cameraLayer = (layer: MapLayer) => MAP_LAYERS.indexOf(layer) + 1;
const onLayer = <T extends THREE.Object3D>(object: T, layer: MapLayer): T => {
  object.traverse((part) => {
    part.layers.set(cameraLayer(layer));
  });
  return object;
};

const toScene = (v: Vec3) => new THREE.Vector3(v.x / KM, v.y / KM, v.z / KM);

interface ShipMarker {
  readonly symbol: CSS2DObject;
  readonly label: HTMLElement;
  readonly velocity: MotionVector;
  readonly dropLine: THREE.Line;
  /** The nose marker on the symbol, turned to the ship's heading as seen on screen. */
  readonly heading: HTMLElement;
  /** The ship's position and which way its nose points, or null if not made out. */
  readonly at: THREE.Vector3;
  nose: THREE.Vector3 | null;
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
  const separation = el('p', {
    className: 'map-separation',
    attrs: { 'aria-label': 'Contact separation' },
  });
  element.append(separation);

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

  let layers = loadMapLayers();
  const showLayers = () => {
    for (const layer of MAP_LAYERS) {
      if (layers[layer]) camera.layers.enable(cameraLayer(layer));
      else camera.layers.disable(cameraLayer(layer));
    }
  };
  showLayers();
  const legend = createMapLegend(colours, layers, (shown) => {
    layers = shown;
    showLayers();
    saveMapLayers(layers);
  });
  element.append(legend.element);

  // Range rings around the captain's own ship, in the plane of the own ship.
  const grid = new THREE.Group();
  const polar = new THREE.PolarGridHelper(
    RING_SPACING_KM * RING_COUNT,
    12,
    RING_COUNT,
    128,
    RING_COLOURS.spokes,
    RING_COLOURS.rings,
  );
  polar.rotation.x = Math.PI / 2;
  grid.add(polar);
  for (let ring = 2; ring <= RING_COUNT; ring += 2) {
    const label = new CSS2DObject(
      el('span', {
        className: 'range-label',
        text: formatKm(ring * RING_SPACING_KM * KM),
      }),
    );
    label.position.set(ring * RING_SPACING_KM, 0, 0);
    grid.add(label);
  }
  scene.add(onLayer(grid, 'range-rings'));

  const markers = new Map<SideId, ShipMarker>();
  sides.forEach((side, index) => {
    const colour = colours[index] ?? '#ffffff';
    const label = el('span', { className: 'ship-symbol__label' });
    const heading = el('span', {
      className: 'ship-symbol__heading',
      attrs: { 'aria-hidden': 'true' },
    });
    const symbol = new CSS2DObject(
      el(
        'div',
        {
          className: `ship-symbol ship-symbol--${index === 0 ? 'own' : 'contact'}`,
          attrs: {
            'data-side': side.id,
            style: `--side-colour: ${colour}`,
            role: 'img',
            'aria-label': `${side.name} ${index === 0 ? 'own ship' : 'contact'} position`,
          },
        },
        el('span', { className: 'ship-symbol__glyph', attrs: { 'aria-hidden': 'true' } }),
        heading,
        label,
      ),
    );
    const velocity = createMotionVector(colour);
    const dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: colour, ...DROP_LINE_DASH }),
    );
    const trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: TRAIL_OPACITY }),
    );
    scene.add(
      symbol,
      onLayer(velocity.group, 'velocity'),
      onLayer(dropLine, 'drop-lines'),
      onLayer(trail, 'trail'),
    );
    markers.set(side.id, {
      symbol,
      label,
      velocity,
      dropLine,
      heading,
      at: new THREE.Vector3(),
      nose: null,
      trail,
      trailPositions,
      trailCount: 0,
      lastTrailTime: -Infinity,
    });
  });

  const sideColours = new Map(
    sides.map((side, index) => [side.id, new THREE.Color(colours[index] ?? '#ffffff')]),
  );

  // The followed contact's velocity relative to the own ship: a dashed arrow from the contact, in
  // a pale tint of the contact's colour.
  const relativeColour = (colours[1] ? new THREE.Color(colours[1]) : WHITE.clone())
    .lerp(WHITE, RELATIVE_VELOCITY_PALENESS)
    .getStyle();
  const relativeArrow = createMotionVector(relativeColour, true);
  scene.add(onLayer(relativeArrow.group, 'relative-velocity'));
  const showRelativeVelocity = (observation: SideObservation) => {
    const contact = followedContact(observation);
    const v = contact
      ? toScene(relativeMotion(observation.ownShip, contact).relativeVelocity).multiplyScalar(
          VECTOR_SECONDS,
        )
      : new THREE.Vector3();
    relativeArrow.update(contact ? toScene(contact.position) : new THREE.Vector3(), v);
  };

  // The own ship's projected path, through its planned burns.
  const projectionPositions = new Float32Array(PROJECTION_POINTS * 3);
  const projectionGeometry = new THREE.BufferGeometry();
  projectionGeometry.setAttribute('position', new THREE.BufferAttribute(projectionPositions, 3));
  const projection = new THREE.Line(
    projectionGeometry,
    new THREE.LineDashedMaterial({ color: PROJECTION_COLOUR, dashSize: 2_000, gapSize: 2_000 }),
  );
  scene.add(onLayer(projection, 'projected-path'));

  // Where and which way the autopilot plans to burn, along the projected path: chevrons pointing
  // the way it will burn, unlike the velocity arrows, since their size means nothing.
  const plannedBurnMarkers = Array.from({ length: MAX_PLANNED_BURNS }, () => {
    const chevrons = el('span', {
      className: 'planned-burn__chevrons',
      attrs: { 'aria-hidden': 'true' },
    });
    const text = el('span', { className: 'planned-burn__text' });
    const label = new CSS2DObject(
      el(
        'div',
        { className: 'planned-burn', attrs: { style: `--burn-colour: ${PLANNED_BURN_COLOUR}` } },
        chevrons,
        text,
      ),
    );
    label.visible = false;
    scene.add(onLayer(label, 'planned-burns'));
    return {
      label,
      text,
      chevrons,
      at: new THREE.Vector3(),
      direction: new THREE.Vector3(),
    };
  });
  const ownDrive = sides[0] ? designComponent(sides[0].design, 'drive') : undefined;

  // Each observed firing side has its own cue, so simultaneous opposing beams stay distinct.
  const beamLines = sides.flatMap((side) =>
    (Object.keys(BEAM_STYLES) as BeamKind[]).map((kind) => {
      const { colour, dashed } = BEAM_STYLES[kind];
      const material = dashed
        ? new THREE.LineDashedMaterial({
            color: colour,
            transparent: true,
            opacity: BEAM_OPACITY,
            dashSize: 1_000,
            gapSize: 600,
          })
        : new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: BEAM_OPACITY });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        material,
      );
      line.visible = false;
      const chevrons = el('span', {
        className: 'beam-direction__chevrons',
        attrs: { 'aria-hidden': 'true' },
      });
      const text = el('span', { className: 'beam-direction__text' });
      const label = new CSS2DObject(
        el(
          'span',
          {
            className: 'beam-direction',
            attrs: { role: 'img', style: `--beam-colour: ${colour}` },
          },
          chevrons,
          text,
        ),
      );
      label.visible = false;
      scene.add(onLayer(line, 'beams'), onLayer(label, 'beams'));
      return { source: side.id, kind, line, label, chevrons, text, direction: new THREE.Vector3() };
    }),
  );

  // Munitions in flight: a dot each, in the colour of the side that fired it; missiles larger,
  // anti-missile missiles paler.
  const munitionDots = (size: number, paleness = 0) => {
    const tint = new THREE.Color();
    const geometry = new THREE.BufferGeometry();
    let capacity = 0;
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }),
    );
    points.frustumCulled = false;
    scene.add(onLayer(points, 'munitions'));
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
        tint.copy(sideColours.get(munition.attacker) ?? WHITE).lerp(WHITE, paleness);
        tints.setXYZ(i, tint.r, tint.g, tint.b);
      });
      positions.needsUpdate = true;
      tints.needsUpdate = true;
      geometry.setDrawRange(0, shown.length);
    };
  };
  /** A flash that keeps its size on screen, drawn over everything. */
  const flashSprite = (colour: string) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softGlowTexture(),
        color: colour,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
      }),
    );
    sprite.renderOrder = 2;
    sprite.visible = false;
    scene.add(onLayer(sprite, 'flashes'));
    return sprite;
  };
  // A nuclear burst flashes where it went off, fading in a second or two.
  const burst = flashSprite(BURST_COLOUR);
  const burstFlash = createBurstFlash();
  // So does a missile shot down, smaller and quicker.
  const intercept = flashSprite(INTERCEPT_COLOUR);
  const interceptFlash = createInterceptFlash();
  const showIntercept = (observation: SideObservation) => {
    const flash = interceptFlash(observation);
    intercept.visible = flash !== null;
    if (!flash) return;
    intercept.position.copy(toScene(flash.intercept.position));
    intercept.scale.setScalar(INTERCEPT_FLASH_SIZE * (0.4 + 0.6 * flash.strength));
    intercept.material.opacity = flash.strength;
  };
  const showBurst = (observation: SideObservation) => {
    const flash = burstFlash(observation);
    burst.visible = flash !== null;
    if (!flash) return;
    burst.position.copy(toScene(flash.detonation.position));
    burst.scale.setScalar(BURST_FLASH_SIZE * (0.4 + 0.6 * flash.strength));
    burst.material.opacity = flash.strength;
  };

  const showSlugs = munitionDots(MUNITION_SIZE);
  const showMissiles = munitionDots(MISSILE_SIZE);
  const showAntiMissiles = munitionDots(ANTI_MISSILE_SIZE, ANTI_MISSILE_PALENESS);
  const showMunitions = (observation: SideObservation) => {
    const { munitions } = observation;
    showSlugs(munitions.filter((m) => m.kind === 'slug'));
    showMissiles(munitions.filter((m) => m.kind === 'missile' && m.role === 'anti-ship'));
    showAntiMissiles(munitions.filter((m) => m.kind === 'missile' && m.role === 'anti-missile'));
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
    /** Its orientation is null for a contact whose silhouette is not made out yet. */
    ship: { position: Vec3; velocity: Vec3; orientation: Quat | null },
    planeZ: number,
    text: string,
    time: number,
  ) => {
    const { position, velocity } = ship;
    const p = toScene(position);
    marker.at.copy(p);
    marker.nose = ship.orientation
      ? toScene(rotate(ship.orientation, vec3(1, 0, 0))).normalize()
      : null;

    marker.symbol.position.copy(p);
    marker.label.textContent = text;

    const v = toScene(velocity).multiplyScalar(VECTOR_SECONDS);
    marker.velocity.update(p, v);

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

  /**
   * Turns a mark at `at` to point along `direction` (a unit vector) as seen on screen, shortened
   * as the direction turns towards or away from the camera.
   */
  const pointOnScreen = (mark: HTMLElement, at: THREE.Vector3, direction: THREE.Vector3) => {
    const view = at.clone().sub(camera.position).normalize();
    const across = Math.sqrt(Math.max(0, 1 - direction.dot(view) ** 2));
    const step = camera.position.distanceTo(at) * 0.01;
    const from = at.clone().project(camera);
    const to = at.clone().addScaledVector(direction, step).project(camera);
    // Screen y runs down, normalised device y up.
    const angle = Math.atan2(
      -(to.y - from.y) * element.clientHeight,
      (to.x - from.x) * element.clientWidth,
    );
    mark.style.setProperty('--angle', `${angle}rad`);
    mark.style.setProperty('--length', String(Math.max(across, MIN_FORESHORTENING)));
  };

  /** Turns the heading and planned-burn marks to the camera's view; run once it has moved. */
  const pointMarks = () => {
    for (const marker of markers.values()) {
      if (marker.velocity.group.visible)
        pointOnScreen(
          marker.velocity.head,
          marker.velocity.tip.position,
          marker.velocity.direction,
        );
      marker.heading.hidden = marker.nose === null || !layers.heading;
      if (marker.nose && !marker.heading.hidden)
        pointOnScreen(marker.heading, marker.at, marker.nose);
    }
    if (relativeArrow.group.visible)
      pointOnScreen(relativeArrow.head, relativeArrow.tip.position, relativeArrow.direction);
    // Separate labels when projected positions coincide; both glyphs stay at the true position.
    const ownMarker = sides[0] ? markers.get(sides[0].id) : undefined;
    if (ownMarker) {
      const ownScreen = ownMarker.at.clone().project(camera);
      for (const marker of markers.values()) {
        if (marker === ownMarker) continue;
        const contactScreen = marker.at.clone().project(camera);
        const close =
          marker.symbol.visible &&
          Math.hypot(
            ((ownScreen.x - contactScreen.x) * element.clientWidth) / 2,
            ((ownScreen.y - contactScreen.y) * element.clientHeight) / 2,
          ) < 80;
        ownMarker.label.classList.toggle('ship-symbol__label--above', close);
        marker.label.classList.toggle('ship-symbol__label--below', close);
      }
    }
    for (const marker of plannedBurnMarkers) {
      if (marker.label.visible) pointOnScreen(marker.chevrons, marker.at, marker.direction);
    }
    for (const beam of beamLines) {
      if (beam.label.visible) pointOnScreen(beam.chevrons, beam.label.position, beam.direction);
    }
  };

  const sideName = (id: SideId) => sides.find((s) => s.id === id)?.name ?? id;
  let previousCentre: THREE.Vector3 | undefined;
  let frameInitialPositions = true;

  return {
    element,
    update(observation: SideObservation) {
      const own = observation.ownShip;
      const followed = followedContact(observation);
      separation.textContent = followed
        ? `${sideName(followed.sideId)} · Separation ${formatKm(relativeMotion(own, followed).separation)}`
        : 'No contact';
      // Never leave a contact's old position or label on the map after it disappears.
      for (const [id, marker] of markers) {
        const visible = id === own.sideId || observation.contacts.some((c) => c.sideId === id);
        marker.symbol.visible = visible;
        marker.velocity.group.visible = visible;
        marker.dropLine.visible = visible;
        marker.trail.visible = visible;
      }
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
          `${sideName(contact.sideId)} · ${formatKmPerS(length(contact.velocity))} · ${CONTACT_DETAIL_TEXT[contact.detail]}`,
          observation.time,
        );
      }
      showRelativeVelocity(observation);
      const target = observation.contacts.find((c) => c.sideId === own.weapons.target);
      const firing = new Set<BeamKind>([
        ...(own.weapons.lasers.some((l) => l.firing) ? (['laser'] as const) : []),
        ...own.weapons.particleBeams.filter((b) => b.firing).map((b) => b.kind),
      ]);
      for (const beam of beamLines) {
        const { kind, line, label, source } = beam;
        const contact = observation.contacts.find((c) => c.sideId === source);
        // In this two-side battle an observed enemy beam fires towards the own ship. No
        // hidden enemy weapons or orders are consulted: only resolved mounts actually firing.
        const incoming =
          contact?.mounts.some(
            (mount) =>
              mount.firing &&
              ((kind === 'laser' && mount.component.type === 'laser') ||
                (kind === 'charged-particle' && mount.component.type === 'charged-particle-beam') ||
                (kind === 'neutral-particle' && mount.component.type === 'neutral-particle-beam')),
          ) ?? false;
        const destination = source === own.sideId ? target : incoming ? own : undefined;
        line.visible =
          destination !== undefined && (source === own.sideId ? firing.has(kind) : incoming);
        label.visible = line.visible;
        if (!destination || !line.visible) continue;
        const from = contact ? toScene(contact.position) : centre;
        const to = toScene(destination.position);
        line.geometry.setFromPoints([from, to]);
        line.computeLineDistances();
        beam.direction.copy(to).sub(from).normalize();
        label.position.copy(from).lerp(to, 0.65);
        label.element.setAttribute(
          'aria-label',
          `${sideName(source)} ${kind} fire toward ${sideName(destination.sideId)}`,
        );
        beam.text.textContent = `${sideName(source)} → ${sideName(destination.sideId)}`;
      }
      showMunitions(observation);
      showBurst(observation);
      showIntercept(observation);

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
        plannedBurnMarkers.forEach((marker, i) => {
          const planned = burns[i];
          marker.label.visible = planned !== undefined;
          if (!planned) return;
          marker.at.copy(toScene(planned.position));
          marker.direction.copy(toScene(planned.burn.direction)).normalize();
          marker.label.position.copy(marker.at);
          marker.text.textContent =
            planned.burn.start < 1
              ? `Burn ${formatDuration(planned.burn.duration)}`
              : `Burn ${formatDuration(planned.burn.duration)} in ${formatDuration(planned.burn.start)}`;
        });
      }
    },
    render() {
      if (
        frameInitialPositions &&
        previousCentre &&
        element.clientWidth > 0 &&
        element.clientHeight > 0
      ) {
        resize();
        const extent = Math.max(
          0,
          ...[...markers.values()]
            .filter((marker) => marker.symbol.visible)
            .map((marker) => marker.at.distanceTo(controls.target)),
        );
        // Fit the observed positions once, with room for fixed-size glyphs and labels.
        // Subsequent zoom and rotation belong entirely to the captain.
        const distance =
          (2 * extent) / (Math.sin((camera.fov * Math.PI) / 360) * Math.min(1, camera.aspect));
        const offset = camera.position.clone().sub(controls.target);
        offset.setLength(Math.min(controls.maxDistance, Math.max(offset.length(), distance)));
        camera.position.copy(controls.target).add(offset);
        frameInitialPositions = false;
      }
      controls.update();
      pointMarks();
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
