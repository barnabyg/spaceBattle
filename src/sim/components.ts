import type { ComponentDesign, ComponentType, Design, SectionKind } from './design';

/** Where a component sits: inside a section's armour or on one of its mounts. */
export interface ComponentSlot {
  readonly section: SectionKind;
  readonly mounted: boolean;
  /** Its place in the section's components or mounts list. */
  readonly index: number;
  readonly component: ComponentDesign;
}

const slots = new WeakMap<Design, readonly ComponentSlot[]>();

/**
 * Every component of a design, section by section from nose to tail, those inside before those
 * on mounts. A ship keeps each component's integrity in this order.
 */
export const componentSlots = (design: Design): readonly ComponentSlot[] => {
  const cached = slots.get(design);
  if (cached) return cached;
  const result = design.sections.flatMap((section) => [
    ...section.components.map((component, index) => ({
      section: section.kind,
      mounted: false,
      index,
      component,
    })),
    ...section.mounts.map((component, index) => ({
      section: section.kind,
      mounted: true,
      index,
      component,
    })),
  ]);
  slots.set(design, result);
  return result;
};

/** The slot number of the design's first component of a type, or -1. */
export const slotOfType = (design: Design, type: ComponentType): number =>
  componentSlots(design).findIndex((slot) => slot.component.type === type);

/** The integrity (0–1) of the design's single component of a type. */
export const integrityOfType = (
  design: Design,
  integrity: readonly number[],
  type: 'drive' | 'thrusters' | 'reactor',
): number => integrity[slotOfType(design, type)] ?? 0;

/**
 * What a design's components of one type give together, each scaled by its integrity: a
 * component works in proportion to its integrity and not at all at zero.
 */
export const workingTotal = <T extends ComponentType>(
  design: Design,
  integrity: readonly number[],
  type: T,
  value: (component: Extract<ComponentDesign, { type: T }>) => number,
): number =>
  componentSlots(design).reduce(
    (total, slot, i) =>
      slot.component.type === type
        ? total +
          value(slot.component as Extract<ComponentDesign, { type: T }>) * (integrity[i] ?? 0)
        : total,
    0,
  );
