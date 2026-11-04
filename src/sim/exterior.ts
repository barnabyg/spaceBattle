import {
  designComponents,
  designComponent,
  type Design,
  type SectionKind,
  type ArmourDesign,
  type MountedComponentDesign,
} from './design';
import type { ShapePart } from './shape';
import { shipShape } from './shape';
import { NO_AMMUNITION_SPENT, type AmmunitionSpent } from './ship';

/** Permitted exterior geometry and decoration, without interior equipment, stores or design IDs. */
export interface ResolvedShipAppearance {
  readonly parts: readonly ShapePart[];
  readonly clearance: readonly ShapePart[];
  readonly sections: readonly {
    readonly kind: SectionKind;
    readonly armour: ArmourDesign;
    readonly style: HullIdentity;
    readonly mounts: readonly {
      readonly index: number;
      readonly type: MountedComponentDesign['type'];
    }[];
  }[];
  readonly nozzleRadius: number;
  readonly throttle: number;
  readonly radiatorsDeployed: boolean;
  readonly temperature: number;
}

/** Observed geometry is supplied by the caller, so destroyed parts never appear in the descriptor. */
export const resolvedShipAppearance = (
  design: Design,
  parts: readonly ShapePart[],
  propellantMass: number,
  radiatorsDeployed: boolean,
  temperature: number,
  thrust: number,
  ammunitionSpent: AmmunitionSpent = NO_AMMUNITION_SPENT,
): ResolvedShipAppearance => {
  const engine = parts.find((p) => p.section === 'engine' && p.mount === null);
  const across = engine ? Math.min(engine.max.y - engine.min.y, engine.max.z - engine.min.z) : 10;
  const drive = designComponent(design, 'drive');
  return {
    parts,
    clearance: [false, true].flatMap((deployed) =>
      shipShape(design, propellantMass, deployed, ammunitionSpent).filter((part) =>
        parts.some((p) => p.section === part.section && p.mount === part.mount),
      ),
    ),
    sections: design.sections
      .filter((section) => parts.some((p) => p.section === section.kind && p.mount === null))
      .map((section) => ({
        kind: section.kind,
        armour: section.armour,
        style: hullIdentity(design, section.kind),
        mounts: section.mounts.flatMap((mount, index) =>
          parts.some((p) => p.section === section.kind && p.mount === index)
            ? [{ index, type: mount.type }]
            : [],
        ),
      })),
    nozzleRadius: Math.min(0.45 * across, (3 / Math.sqrt(2e6)) * Math.sqrt(drive.thrust)),
    throttle: Math.min(1, Math.max(0, thrust / drive.thrust)),
    radiatorsDeployed,
    temperature,
  };
};

/** Render-only proportions outside the unchanged structural hull and mount envelopes. */
export interface HullIdentity {
  readonly length: number;
  readonly height: number;
  readonly width: number;
  readonly taper: number;
}

/**
 * Equipment gives stock and player designs the same visual grammar. No IDs, names, random
 * numbers or persisted style fields: loading an old design or renaming it keeps its identity.
 * Only exterior fittings use these proportions; they never affect battle outcomes.
 */
export const hullIdentity = (design: Design, section: SectionKind): HullIdentity => {
  const components = designComponents(design).map(({ component }) => component);
  const count = (type: (typeof components)[number]['type']) =>
    components.filter((component) => component.type === type).length;
  const nuclear = Number(
    components.some(
      (component) => component.type === 'magazine' && component.missile?.warhead.type === 'nuclear',
    ),
  );
  const kinetic = count('kinetic-gun');
  const launchers = count('launcher');
  const charged = count('charged-particle-beam');
  const neutral = count('neutral-particle-beam');
  const defence = count('point-defence');
  const magnetic = count('magnetic-shield');
  const coolant = count('coolant-shield');
  const lasers = count('laser');
  const cap = (value: number) => Math.min(2.4, value);

  switch (section) {
    case 'forward':
      return {
        length: cap(1 + 0.85 * neutral + 0.22 * lasers + 0.12 * charged),
        height: cap(0.75 + 0.3 * kinetic + 0.45 * nuclear + 0.3 * defence),
        width: cap(0.65 + 0.3 * kinetic + 0.35 * launchers + 0.35 * nuclear + 0.3 * coolant),
        taper: Math.min(0.9, 0.14 + 0.2 * kinetic + 0.18 * launchers + 0.1 * defence),
      };
    case 'middle':
      return {
        length: 1,
        height: cap(0.8 + 1.3 * magnetic + 0.4 * charged + 0.35 * defence),
        width: cap(0.7 + 0.3 * launchers + 0.65 * coolant + 0.12 * lasers),
        taper: 0.65,
      };
    case 'engine':
      return {
        length: 1,
        height: cap(0.8 + 0.95 * charged + 0.22 * lasers + 0.15 * magnetic),
        width: cap(0.75 + 0.25 * kinetic + 0.2 * launchers + 0.55 * coolant),
        taper: 0.45,
      };
  }
};
