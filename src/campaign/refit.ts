import { BALANCE } from '../data/balance';
import { sameComponent } from '../data/components';
import { armourCost, componentCost, componentsCost } from '../shipyard/cost';
import { componentSlots } from '../sim/components';
import { SECTION_KINDS, type Design } from '../sim/design';
import { fullCondition, type ShipCondition } from '../sim/ship';

/**
 * Which of the old design's component slots each of the new design's slots keeps: the first
 * unused old component of exactly the same model, wherever it was, or null for a new one.
 */
const keptSlots = (from: Design, to: Design): (number | null)[] => {
  const old = componentSlots(from);
  const used = new Set<number>();
  return componentSlots(to).map(({ component }) => {
    const slot = old.findIndex((s, i) => !used.has(i) && sameComponent(s.component, component));
    if (slot < 0) return null;
    used.add(slot);
    return slot;
  });
};

/** Whether a section keeps its armour through a refit: the same type and thickness. */
const keepsArmour = (from: Design, to: Design, kind: (typeof SECTION_KINDS)[number]): boolean => {
  const a = from.sections.find((s) => s.kind === kind)?.armour;
  const b = to.sections.find((s) => s.kind === kind)?.armour;
  return a !== undefined && a.type === b?.type && a.thickness === b.thickness;
};

/**
 * What refitting a ship of one design to another costs: every component (and section's armour)
 * the new design has that the old did not, plus labour of `BALANCE.refitLabourShare` of all the
 * new design's components and armour together. Components taken out are scrapped for nothing.
 */
export const refitPrice = (from: Design, to: Design): number => {
  const kept = keptSlots(from, to);
  const components = componentSlots(to).reduce(
    (total, { component }, i) => (kept[i] === null ? total + componentCost(component) : total),
    0,
  );
  const armour = to.sections.reduce(
    (total, section) =>
      keepsArmour(from, to, section.kind) ? total : total + armourCost(to, section),
    0,
  );
  return components + armour + BALANCE.refitLabourShare * componentsCost(to);
};

/**
 * A ship's condition after a refit: components and armour it keeps are as they were, new ones
 * as built; its structure keeps its damage, and its tanks keep what they held as far as the new
 * design's take it.
 */
export const refittedCondition = (
  from: Design,
  condition: ShipCondition,
  to: Design,
): ShipCondition => {
  const fresh = fullCondition(to);
  const kept = keptSlots(from, to);
  const oldMagazines = componentSlots(from).flatMap((s, i) =>
    s.component.type === 'magazine' ? [i] : [],
  );
  const newSlots = componentSlots(to);
  let magazine = 0;
  const magazines = newSlots.flatMap(({ component }, i) => {
    if (component.type !== 'magazine') return [];
    const full = fresh.magazines[magazine++];
    const old = kept[i];
    const held = old === null || old === undefined ? -1 : oldMagazines.indexOf(old);
    return [
      (held >= 0 ? condition.magazines[held] : undefined) ??
        full ?? { slugs: 0, rounds: 0, missiles: 0 },
    ];
  });
  return {
    integrity: newSlots.map((_, i) => {
      const old = kept[i];
      return old === null || old === undefined ? 1 : (condition.integrity[old] ?? 1);
    }),
    sections: Object.fromEntries(
      SECTION_KINDS.map((kind) => [
        kind,
        {
          armour: keepsArmour(from, to, kind)
            ? condition.sections[kind].armour
            : fresh.sections[kind].armour,
          structure: condition.sections[kind].structure,
        },
      ]),
    ) as ShipCondition['sections'],
    propellantMass: Math.min(condition.propellantMass, to.propellantMass),
    magazines,
  };
};
