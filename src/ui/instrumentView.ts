import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  MunitionObservation,
  ShipAppearance,
  SideObservation,
  SideSetup,
} from '../sim/battle';
import type { BeamKind } from '../sim/events';
import { HULLS, hullLength } from '../sim/hull';
import type { Quat } from '../sim/quaternion';
import { add, distance, dot, normalize, scale, sub, type Vec3 } from '../sim/vector';
import { createBurstFlash, createInterceptFlash } from './burstFlash';
import { disposeRenderer, disposeScene } from './dispose';
import { el } from './el';
import { formatKm } from './format';
import {
  createShipModel,
  disposeShipModel,
  shipModelNeedsRebuild,
  softGlowTexture,
  updateShipModel,
} from './shipModel';

/** The sun, far off in this direction (world frame, z up as on the tactical map). */
const SUN_DIRECTION = new THREE.Vector3(0.55, -0.35, 0.75).normalize();
/** The sky (stars and sun) sits on a sphere this far from the camera, m. */
const SKY_RADIUS = 400_000;
const STAR_COUNT = 3_500;
/** Beam landings and slug impacts shown on each ship at once. */
const MAX_SPOTS = 4;
/** A slug's or missile's impact flash. */
const HIT_COLOUR = '#fff1c8';
/** A nuclear burst near a ship lights it from that side, and glows beside it. */
const BURST_COLOUR = '#fffbe8';
/** Brightest a burst lights its ship, against the sun's 3. */
const BURST_LIGHT = 40;
/** A missile shot down near a ship flashes beside it, in amber. */
const INTERCEPT_COLOUR = '#ffc24d';
/**
 * What glows where each kind of beam lands: a laser's burning spot, or the violet or blue glow of
 * the vapour a particle beam ionises as it bores in.
 */
const BEAM_SPOT_COLOURS: Readonly<Record<BeamKind, string>> = {
  laser: HIT_COLOUR,
  'charged-particle': '#c9a2ff',
  'neutral-particle': '#9fdcff',
};
/** Slugs or missiles in flight the telescope shows at once, of each. */
const MAX_GLINTS = 512;
const OUTGOING_COLOUR = new THREE.Color('#a8d8ff');
const INCOMING_COLOUR = new THREE.Color('#ff9a7a');
/** A missile's drive flame, which its glint takes on while it burns. */
const DRIVE_FLAME_COLOUR = new THREE.Color('#ffffff');
/** Pixels across: a slug's glint, and a missile's, which is larger and burns bright. */
const SLUG_GLINT_SIZE = 3;
const MISSILE_GLINT_SIZE = 7;
/** The contact's telescope view frames it at this many ship lengths, unless zoomed. */
const TELESCOPE_DISTANCE = 1.8;
const FOV = 35;
/** Layer 0 holds the sky, which both views see; each ship has a layer of its own. */
const SKY_LAYER = 0;

/** A small deterministic generator, so the star field is the same every time. */
const starRandom = (() => {
  let state = 0x2f6b1d;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
})();

const createSky = () => {
  const sky = new THREE.Group();
  const positions = new Float32Array(STAR_COUNT * 3);
  const colours = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform over the sphere: z uniform in [−1, 1], longitude uniform.
    const z = 2 * starRandom() - 1;
    const longitude = 2 * Math.PI * starRandom();
    const r = Math.sqrt(1 - z * z);
    positions.set([r * Math.cos(longitude), r * Math.sin(longitude), z], i * 3);
    // Most stars faint, a few bright; a slight spread of colour from blue-white to amber.
    const brightness = 0.15 + 0.85 * starRandom() ** 4;
    const warmth = starRandom() - 0.5;
    colours.set(
      [brightness * (1 + 0.15 * warmth), brightness, brightness * (1 - 0.25 * warmth)],
      i * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 2,
      sizeAttenuation: false,
      vertexColors: true,
      depthWrite: false,
    }),
  );
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: '#fff6e6',
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sun.position.copy(SUN_DIRECTION);
  sun.scale.setScalar(0.06);
  sky.add(stars, sun);
  sky.scale.setScalar(SKY_RADIUS);
  sky.renderOrder = -1;
  sky.traverse((object) => {
    object.layers.set(SKY_LAYER);
    object.renderOrder = -1;
  });
  return sky;
};

/** One ship as the view draws it, alone on its own layer at the origin. */
interface ShipView {
  readonly side: SideSetup;
  readonly layer: number;
  readonly length: number;
  /** Turned to the ship's orientation; holds its model and hit spots. */
  readonly anchor: THREE.Group;
  model: THREE.Group;
  readonly spots: readonly THREE.Sprite[];
  readonly hitLight: THREE.PointLight;
  /** A nuclear burst's light, from the burst's direction in the world frame. */
  readonly burstLight: THREE.DirectionalLight;
  /** Its glow, out beyond the ship in that direction. */
  readonly burstGlow: THREE.Sprite;
  /** The flash of a missile it shot down, out beyond the ship in that missile's direction. */
  readonly interceptGlow: THREE.Sprite;
}

const setLayer = (object: THREE.Object3D, layer: number) => {
  object.traverse((o) => {
    o.layers.set(layer);
  });
};

const createShipView = (scene: THREE.Scene, side: SideSetup, layer: number): ShipView => {
  const anchor = new THREE.Group();
  const model = createShipModel(side.design);
  const spots = Array.from({ length: MAX_SPOTS }, () => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softGlowTexture(),
        color: HIT_COLOUR,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.visible = false;
    return sprite;
  });
  // Always present, dark when nothing lands, so the number of lights (and shaders) never changes.
  const hitLight = new THREE.PointLight('#ffcf8a', 0, 0, 2);
  anchor.add(model, ...spots, hitLight);
  setLayer(anchor, layer);
  // The burst is placed in world axes, so it sits outside the anchor, which turns with the ship.
  const burstLight = new THREE.DirectionalLight(BURST_COLOUR, 0);
  const burstGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: BURST_COLOUR,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  burstGlow.visible = false;
  const interceptGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softGlowTexture(),
      color: INTERCEPT_COLOUR,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  interceptGlow.visible = false;
  burstLight.layers.set(layer);
  burstGlow.layers.set(layer);
  interceptGlow.layers.set(layer);
  scene.add(anchor, burstLight, burstGlow, interceptGlow);
  return {
    side,
    layer,
    length: hullLength(HULLS[side.design.hullSize]),
    anchor,
    model,
    spots,
    hitLight,
    burstLight,
    burstGlow,
    interceptGlow,
  };
};

const toQuaternion = (q: Quat, target: THREE.Quaternion) => target.set(q.x, q.y, q.z, q.w);

const outward = new THREE.Vector3();

/** Something glowing where it lands on a ship: a beam's spot or a slug's impact flash. */
interface Flash {
  readonly point: Vec3;
  /** Across, m. */
  readonly size: number;
  /** 0–1 */
  readonly strength: number;
  readonly colour: string;
}

/** What glows on a ship: each beam's spot, brighter the more intense, and each slug's impact. */
const flashesOf = (look: ShipAppearance): Flash[] => [
  ...look.impacts.map((impact) => ({
    point: impact.point,
    // A flash that grows with the energy released: about 14 m across for a gigajoule.
    size: Math.max(6, 14 * Math.cbrt(impact.energy / 1e9)),
    strength: 1,
    colour: HIT_COLOUR,
  })),
  ...look.beamsLanding.map((landing) => {
    const intensity = landing.power / (Math.PI * landing.spotRadius ** 2);
    return {
      point: landing.point,
      size: Math.max(4, 5 * landing.spotRadius),
      strength: Math.min(1, Math.max(0.35, (Math.log10(intensity) - 5.5) / 2.5)),
      colour: BEAM_SPOT_COLOURS[landing.attack],
    };
  }),
];

/** Brings a ship's model, orientation and hit spots up to date with what is observed. */
const updateShipView = (view: ShipView, orientation: Quat, look: ShipAppearance) => {
  toQuaternion(orientation, view.anchor.quaternion);
  if (shipModelNeedsRebuild(view.model, look)) {
    view.anchor.remove(view.model);
    disposeShipModel(view.model);
    view.model = createShipModel(view.side.design, look);
    setLayer(view.model, view.layer);
    view.anchor.add(view.model);
  } else {
    updateShipModel(view.model, look);
  }

  // Beams are invisible in vacuum and slugs too fast to see; only where they land glows.
  const flashes = flashesOf(look);
  let brightest = 0;
  view.spots.forEach((sprite, i) => {
    const flash = flashes[i];
    sprite.visible = flash !== undefined;
    if (!flash) return;
    const { point, size, strength, colour } = flash;
    // Beams land on the line of fire through the centre of mass, on the side they came from, so
    // outward from the centre of mass is back towards the attacker; slugs strike near it.
    outward.set(point.x, point.y, point.z).normalize();
    // Half a glow out from the surface, so the hull hides it only when the spot faces away.
    sprite.position.set(point.x, point.y, point.z).addScaledVector(outward, size / 2);
    sprite.scale.setScalar(size * (0.85 + 0.3 * Math.random()));
    sprite.material.opacity = strength;
    sprite.material.color.set(colour);
    if (strength > brightest) {
      brightest = strength;
      view.hitLight.position.copy(sprite.position).addScaledVector(outward, 3);
    }
  });
  view.hitLight.intensity = 600 * brightest;
};

/**
 * Lights a ship from a nuclear burst `offset` from it (world axes, m), `strength` from 1 fading to
 * 0, or puts the light out when there is none. Bursts go off kilometres away, far outside the
 * view, so the glow stands in for it a ship's length or so out in its direction.
 */
const showBurst = (view: ShipView, burst: { offset: Vec3; strength: number } | null) => {
  view.burstGlow.visible = burst !== null;
  view.burstLight.intensity = burst ? BURST_LIGHT * burst.strength : 0;
  if (!burst) return;
  const towards = normalize(burst.offset);
  view.burstLight.position.set(towards.x, towards.y, towards.z).multiplyScalar(1_000);
  view.burstGlow.position.set(towards.x, towards.y, towards.z).multiplyScalar(1.5 * view.length);
  view.burstGlow.scale.setScalar(view.length * (1 + 2 * burst.strength));
  view.burstGlow.material.opacity = burst.strength;
};

/**
 * Flashes beside a ship where a missile it shot down was, `offset` from it (world axes, m),
 * `strength` from 1 fading to 0; or hides the flash when there is none. Missiles are shot down
 * kilometres out, far outside the view, so the flash stands in a ship's length or so out in that
 * direction.
 */
const showIntercept = (view: ShipView, shot: { offset: Vec3; strength: number } | null) => {
  view.interceptGlow.visible = shot !== null;
  if (!shot) return;
  const towards = normalize(shot.offset);
  view.interceptGlow.position
    .set(towards.x, towards.y, towards.z)
    .multiplyScalar(1.2 * view.length);
  view.interceptGlow.scale.setScalar(view.length * (0.3 + 0.5 * shot.strength));
  view.interceptGlow.material.opacity = shot.strength;
};

const lineOfSight = new THREE.Vector3();

/**
 * Where the telescope, looking from `own` at the contact at `contact`, sees a munition against
 * the contact: where the line of sight through the munition meets the plane through the contact
 * square to the telescope, relative to the contact, m. Slugs on their way to the contact gather
 * on it, or where fire control expected it to be. Null when the munition is behind the telescope.
 */
const telescopePosition = (munition: MunitionObservation, own: Vec3, contact: Vec3) => {
  const sight = sub(contact, own);
  const towards = sub(munition.position, own);
  const along = dot(towards, sight);
  return along > 0 ? sub(add(own, scale(towards, dot(sight, sight) / along)), contact) : null;
};

/**
 * The instrument view: the battle as the ship's telescopes see it, beside the tactical map. Ships
 * tens of metres long, tens of thousands of kilometres apart, cannot share one frame, so it is
 * split: the own ship above, orbited freely, and the contact below as the telescope sees it,
 * along the line of sight from the own ship, with any slugs and missiles in flight seen against
 * it, missiles larger and flaring white while their drives burn. Both ships
 * are drawn in full until sensors limit what can be made out of the contact (a later phase). One
 * renderer draws both halves.
 */
export const createInstrumentView = (sides: readonly SideSetup[]) => {
  const ownSide = sides[0];
  const contactSide = sides[1];
  if (!ownSide || !contactSide) throw new Error('The instrument view needs two sides');

  const caption = (text: string) => el('span', { className: 'instrument-view__caption', text });
  const ownCaption = caption(`${ownSide.name} · ${ownSide.design.name}`);
  const contactCaption = caption(`${contactSide.name} · ${contactSide.design.name}`);
  const ownPane = el(
    'div',
    {
      className: 'instrument-view__pane instrument-view__pane--own',
      attrs: { 'aria-label': 'Own ship' },
    },
    ownCaption,
    el('span', { className: 'instrument-view__hint', text: 'Drag to orbit · wheel to zoom' }),
  );
  const contactPane = el(
    'div',
    {
      className: 'instrument-view__pane instrument-view__pane--contact',
      attrs: { 'aria-label': 'Contact through telescope' },
    },
    contactCaption,
    el('span', { className: 'instrument-view__hint', text: 'Telescope · wheel to zoom' }),
  );
  const element = el(
    'section',
    { className: 'instrument-view', attrs: { 'aria-label': 'Instrument view' } },
    ownPane,
    contactPane,
  );

  // Pixel ratio 1 and no shadows keep two views cheap at 4K.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);
  element.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const sky = createSky();
  scene.add(sky);
  const sunlight = new THREE.DirectionalLight('#fff4e0', 3);
  sunlight.position.copy(SUN_DIRECTION).multiplyScalar(1_000);
  const ambient = new THREE.AmbientLight('#8090b0', 0.3);
  sunlight.layers.enableAll();
  ambient.layers.enableAll();
  scene.add(sunlight, ambient);

  const own = createShipView(scene, ownSide, 1);
  const contact = createShipView(scene, contactSide, 2);

  // Slugs and missiles in flight as the telescope sees them against the contact, drawn over it.
  const glintsOf = (size: number) => {
    const positions = new THREE.BufferAttribute(new Float32Array(MAX_GLINTS * 3), 3);
    const colours = new THREE.BufferAttribute(new Float32Array(MAX_GLINTS * 3), 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setAttribute('color', colours);
    geometry.setDrawRange(0, 0);
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size,
        sizeAttenuation: false,
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = 1;
    points.layers.set(contact.layer);
    scene.add(points);
    let shown = 0;
    return {
      clear() {
        shown = 0;
      },
      add(at: Vec3, colour: THREE.Color) {
        if (shown === MAX_GLINTS) return;
        positions.setXYZ(shown, at.x, at.y, at.z);
        colours.setXYZ(shown, colour.r, colour.g, colour.b);
        shown += 1;
      },
      show() {
        positions.needsUpdate = true;
        colours.needsUpdate = true;
        geometry.setDrawRange(0, shown);
      },
    };
  };
  const slugGlints = glintsOf(SLUG_GLINT_SIZE);
  const missileGlints = glintsOf(MISSILE_GLINT_SIZE);
  const glintColour = new THREE.Color();
  const burstFlash = createBurstFlash();
  const interceptFlash = createInterceptFlash();

  const camera = (view: ShipView) => {
    const c = new THREE.PerspectiveCamera(FOV, 1, 0.5, SKY_RADIUS * 2);
    c.up.set(0, 0, 1);
    c.layers.enable(view.layer);
    return c;
  };
  const ownCamera = camera(own);
  ownCamera.position.set(-1.2, -1.6, 0.8).multiplyScalar(own.length);
  const controls = new OrbitControls(ownCamera, ownPane);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = own.length * 0.4;
  controls.maxDistance = own.length * 12;

  const contactCamera = camera(contact);
  let telescopeZoom = TELESCOPE_DISTANCE;
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    telescopeZoom = Math.min(12, Math.max(0.9, telescopeZoom * Math.exp(event.deltaY * 0.001)));
  };
  contactPane.addEventListener('wheel', onWheel, { passive: false });

  let width = 0;
  let height = 0;
  const resize = () => {
    width = element.clientWidth;
    height = element.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    const half = Math.floor(height / 2);
    ownCamera.aspect = width / half;
    ownCamera.updateProjectionMatrix();
    contactCamera.aspect = width / (height - half);
    contactCamera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);

  let ownPosition: Vec3 | null = null;
  let contactPosition: Vec3 | null = null;

  /** Draws one half: the sky around the camera, then the ship on the camera's layer. */
  const renderView = (view: THREE.PerspectiveCamera, y: number, h: number) => {
    sky.position.copy(view.position);
    renderer.setViewport(0, y, width, h);
    renderer.setScissor(0, y, width, h);
    renderer.render(scene, view);
  };

  return {
    element,
    update(observation: SideObservation) {
      const ship = observation.ownShip;
      updateShipView(own, ship.orientation, ship.appearance);
      ownPosition = ship.position;
      const seen = observation.contacts.find((c) => c.sideId === contactSide.id);
      contact.anchor.visible = seen !== undefined;
      contactPosition = seen?.position ?? null;
      slugGlints.clear();
      missileGlints.clear();
      if (seen) {
        updateShipView(contact, seen.orientation, seen.appearance);
        contactCaption.textContent = `${contactSide.name} · ${contactSide.design.name} · ${formatKm(distance(seen.position, ship.position))}`;
        for (const munition of observation.munitions) {
          const at = telescopePosition(munition, ship.position, seen.position);
          if (!at) continue;
          glintColour.copy(munition.attacker === ship.sideId ? OUTGOING_COLOUR : INCOMING_COLOUR);
          if (munition.kind === 'slug') {
            slugGlints.add(at, glintColour);
          } else {
            if (munition.thrust > 0) glintColour.lerp(DRIVE_FLAME_COLOUR, 0.6);
            missileGlints.add(at, glintColour);
          }
        }
      }
      slugGlints.show();
      missileGlints.show();
      const flash = burstFlash(observation);
      const shot = interceptFlash(observation);
      for (const view of [own, contact]) {
        const near = flash?.detonation.target === view.side.id ? flash : null;
        showBurst(view, near && { offset: near.detonation.offset, strength: near.strength });
        const at = view === own ? ship.position : seen?.position;
        const by = shot?.intercept.side === view.side.id && at ? shot : null;
        showIntercept(
          view,
          by && at ? { offset: sub(by.intercept.position, at), strength: by.strength } : null,
        );
      }
    },
    render() {
      if (width === 0 || height === 0) return;
      controls.update();
      if (ownPosition && contactPosition) {
        // The telescope looks from the own ship, so the contact is seen from that direction.
        const towardsOwn = normalize(sub(ownPosition, contactPosition));
        lineOfSight.set(towardsOwn.x, towardsOwn.y, towardsOwn.z);
        contactCamera.position.copy(lineOfSight).multiplyScalar(telescopeZoom * contact.length);
        // Keep the map's z up, unless looking straight along it.
        if (Math.abs(lineOfSight.z) > 0.999) contactCamera.up.set(0, 1, 0);
        else contactCamera.up.set(0, 0, 1);
        contactCamera.lookAt(0, 0, 0);
      }
      const half = Math.floor(height / 2);
      // Viewports count from the bottom: the own ship takes the top half.
      renderView(ownCamera, height - half, half);
      renderView(contactCamera, 0, height - half);
    },
    dispose() {
      resizeObserver.disconnect();
      contactPane.removeEventListener('wheel', onWheel);
      controls.dispose();
      disposeShipModel(own.model);
      disposeShipModel(contact.model);
      disposeScene(scene);
      disposeRenderer(renderer);
    },
  };
};
