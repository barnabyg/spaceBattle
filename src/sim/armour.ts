import type { ArmourType, Design, SectionDesign, SectionKind } from './design';
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
}

export const ARMOUR: Readonly<Record<ArmourType, ArmourMaterial>> = {
  heavy: { density: 7_800, ablationEnergy: 8e6 },
  ablative: { density: 1_800, ablationEnergy: 30e6 },
};

/** Energy a beam must put into each square metre to burn through each metre of armour, J/m³. */
export const laserResistance = (type: ArmourType): number =>
  ARMOUR[type].density * ARMOUR[type].ablationEnergy;

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
