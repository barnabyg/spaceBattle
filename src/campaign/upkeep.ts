import { BALANCE } from '../data/balance';
import { armourCost, hullCost, missileCost, propellantCost } from '../shipyard/cost';
import { componentSlots } from '../sim/components';
import { SECTION_KINDS, type Design, type SectionKind } from '../sim/design';
import { HULLS } from '../sim/hull';
import { fullCondition, type ShipCondition } from '../sim/ship';

/** What a design's component costs new, without the ammunition in a magazine, credits. */
const bareCost = (design: Design, slot: number): number => {
  const component = componentSlots(design)[slot]?.component;
  return component ? component.mass * BALANCE.componentPrice[component.type] : 0;
};

/** What a section's share of the hull's structure costs new: its share of the hull's volume. */
const structureCost = (design: Design, kind: SectionKind): number => {
  const volumes = HULLS[design.hullSize].sections.map((s) => ({
    kind: s.kind,
    volume: s.length * s.width * s.height,
  }));
  const total = volumes.reduce((sum, s) => sum + s.volume, 0);
  return (hullCost(design) * (volumes.find((s) => s.kind === kind)?.volume ?? 0)) / total;
};

/**
 * What repairing all of a ship's damage costs: each component, each section's armour and its
 * structure, at `BALANCE.repairPriceShare` of the price of new for the share of it that is
 * wrecked, credits. Spent ammunition is restocking, not repair.
 */
export const conditionRepairCost = (design: Design, condition: ShipCondition): number => {
  const full = fullCondition(design);
  const components = condition.integrity.reduce(
    (total, integrity, slot) => total + (1 - integrity) * bareCost(design, slot),
    0,
  );
  const sections = SECTION_KINDS.reduce((total, kind) => {
    const section = design.sections.find((s) => s.kind === kind);
    const designed = full.sections[kind].armour;
    const { armour, structure } = condition.sections[kind];
    const armourLost =
      section && designed > 0 ? ((designed - armour) / designed) * armourCost(design, section) : 0;
    return total + armourLost + (1 - structure) * structureCost(design, kind);
  }, 0);
  return BALANCE.repairPriceShare * (components + sections);
};

/** A condition with `share` (0–1) of every damage in it repaired. */
export const repairedCondition = (
  design: Design,
  condition: ShipCondition,
  share: number,
): ShipCondition => {
  const full = fullCondition(design);
  const mend = (value: number, whole: number) => value + share * (whole - value);
  return {
    ...condition,
    integrity: condition.integrity.map((value) => mend(value, 1)),
    sections: Object.fromEntries(
      SECTION_KINDS.map((kind) => [
        kind,
        {
          armour: mend(condition.sections[kind].armour, full.sections[kind].armour),
          structure: mend(condition.sections[kind].structure, 1),
        },
      ]),
    ) as ShipCondition['sections'],
  };
};

/** What filling a ship's tanks and magazines again costs: what it has used, credits. */
export const conditionRestockCost = (design: Design, condition: ShipCondition): number => {
  const full = fullCondition(design);
  const magazines = componentSlots(design).flatMap(({ component }) =>
    component.type === 'magazine' ? [component] : [],
  );
  const ammunition = magazines.reduce((total, magazine, i) => {
    const held = condition.magazines[i];
    if (!held) return total;
    return (
      total +
      (magazine.slugs - held.slugs) * BALANCE.slugPrice +
      (magazine.rounds - held.rounds) * BALANCE.roundPrice +
      (magazine.missile ? (magazine.missiles - held.missiles) * missileCost(magazine.missile) : 0)
    );
  }, 0);
  return propellantCost(full.propellantMass - condition.propellantMass) + ammunition;
};

/** A condition with the tanks and magazines full again. */
export const restockedCondition = (design: Design, condition: ShipCondition): ShipCondition => {
  const full = fullCondition(design);
  return { ...condition, propellantMass: full.propellantMass, magazines: full.magazines };
};
