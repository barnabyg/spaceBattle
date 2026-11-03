import { BALANCE } from '../data/balance';
import { armourMass } from '../sim/armour';
import {
  missileMass,
  type ComponentDesign,
  type Design,
  type MagazineDesign,
  type MissileDesign,
  type SectionDesign,
} from '../sim/design';
import { HULLS } from '../sim/hull';

/** What one missile costs, credits. */
export const missileCost = (missile: MissileDesign): number =>
  missileMass(missile) * BALANCE.missilePrice;

/** What a magazine's ammunition costs when full, credits. */
export const ammunitionCost = (magazine: MagazineDesign): number =>
  magazine.slugs * BALANCE.slugPrice +
  magazine.rounds * BALANCE.roundPrice +
  (magazine.missile ? magazine.missiles * missileCost(magazine.missile) : 0);

/** What a component costs new, credits; a magazine comes full. */
export const componentCost = (component: ComponentDesign): number =>
  component.mass * BALANCE.componentPrice[component.type] +
  (component.type === 'magazine' ? ammunitionCost(component) : 0);

/** What a section's armour costs, credits. */
export const armourCost = (design: Design, section: SectionDesign): number =>
  armourMass(design, section) * BALANCE.armourPrice[section.armour.type];

/** What a hull's bare structure costs, credits. */
export const hullCost = (design: Design): number =>
  HULLS[design.hullSize].structureMass * BALANCE.structurePrice;

/** What `propellantMass` of propellant costs, credits. */
export const propellantCost = (propellantMass: number): number =>
  propellantMass * BALANCE.propellantPrice;

/** What a design's components cost together, armour and full magazines included, credits. */
export const componentsCost = (design: Design): number =>
  design.sections.reduce(
    (total, section) =>
      total +
      armourCost(design, section) +
      [...section.components, ...section.mounts].reduce((sum, c) => sum + componentCost(c), 0),
    0,
  );

/**
 * What a ship of a design costs to build: its hull, its components and armour, and a full load of
 * propellant and ammunition, credits.
 */
export const designCost = (design: Design): number =>
  hullCost(design) + componentsCost(design) + propellantCost(design.propellantMass);
