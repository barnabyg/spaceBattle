import type { ArmourType, Design, SectionDesign, SectionKind } from './design';
import type { BeamKind } from './events';
import { HULLS, type Hull } from './hull';

/** What each kind of armour is made of. */
export interface ArmourMaterial {
  /** kg/m³ */
  readonly density: number;
  /**
   * Energy a laser must deposit to burn away each kilogram, J/kg. Heavy armour (steel-like) has
   * to be heated, melted and vaporised; ablative armour (carbon-phenolic-like) chars and boils
   * off, carrying its heat away with the vapour, so each kilogram soaks up several times more.
   */
  readonly ablationEnergy: number;
  /**
   * Energy a particle beam must deposit in each kilogram to wreck it, J/kg. Its particles pass
   * into the armour and heat it through its depth instead of boiling its surface away. Steel gives
   * way once heated through to melting and is blown out by the vapour beneath, on about half what
   * a laser needs; carbon-phenolic chars and its carbon must still be boiled off, which takes
   * most of what a laser needs.
   */
  readonly heatingEnergy: number;
  /**
   * Energy a slug must spend on each kilogram of armour in the hole it punches, J/kg. Tough steel
   * soaks up more per kilogram than brittle carbon-phenolic, which shatters; and being far less
   * dense, ablative armour puts much less in a slug's way for each metre it is thick.
   */
  readonly penetrationEnergy: number;
}

export const ARMOUR: Readonly<Record<ArmourType, ArmourMaterial>> = {
  heavy: { density: 7_800, ablationEnergy: 8e6, heatingEnergy: 4e6, penetrationEnergy: 4e6 },
  ablative: { density: 1_800, ablationEnergy: 30e6, heatingEnergy: 25e6, penetrationEnergy: 3e6 },
};

/**
 * Energy a beam of a kind must put into each square metre to burn through each metre of armour,
 * J/m³. Charged and neutral particle beams are both protons or hydrogen atoms at similar
 * energies, so armour stops them alike.
 */
export const beamResistance = (type: ArmourType, attack: BeamKind): number =>
  ARMOUR[type].density *
  (attack === 'laser' ? ARMOUR[type].ablationEnergy : ARMOUR[type].heatingEnergy);

/** A section's outer surface: its four sides, plus the nose or tail end of the ship, m². */
export const exposedArea = (hull: Hull, kind: SectionKind): number => {
  const shape = hull.sections.find((s) => s.kind === kind);
  if (!shape) return 0;
  const sides = 2 * shape.length * (shape.width + shape.height);
  const end = kind === 'middle' ? 0 : shape.width * shape.height;
  return sides + end;
};

/** Mass of a section's armour: its outer surface times thickness times density, kg. */
export const armourMass = (design: Design, section: SectionDesign): number =>
  exposedArea(HULLS[design.hullSize], section.kind) *
  section.armour.thickness *
  ARMOUR[section.armour.type].density;
