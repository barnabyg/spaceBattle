import { componentSlots } from './components';
import {
  designComponent,
  SECTION_KINDS,
  type ArmourDesign,
  type ComponentType,
  type Design,
  type HullSize,
  type SectionKind,
  type ShieldType,
} from './design';
import type { Random } from './random';
import { deltaVOf, type ShipState } from './ship';
import { missilesLeft } from './weapons';

/** One fact about an enemy design that a signal interceptor can learn. */
export type IntelligenceFact =
  | { readonly kind: 'hull-size'; readonly hullSize: HullSize }
  /** Its drive's full thrust, N. */
  | { readonly kind: 'drive-thrust'; readonly thrust: number }
  /** Its reactor's full electrical output, W. */
  | { readonly kind: 'reactor-output'; readonly output: number }
  /** Its delta-v as it comes into the battle, m/s. */
  | { readonly kind: 'delta-v'; readonly deltaV: number }
  | { readonly kind: 'armour'; readonly section: SectionKind; readonly armour: ArmourDesign }
  /** Its weapons, each type with how many it carries. */
  | {
      readonly kind: 'weapons';
      readonly weapons: readonly { readonly type: ComponentType; readonly count: number }[];
    }
  /** How many missiles its magazines hold as it comes into the battle. */
  | { readonly kind: 'missiles'; readonly missiles: number }
  /** The kinds of shield it carries; none if it has none. */
  | { readonly kind: 'shields'; readonly shields: readonly ShieldType[] };

/** How many facts there are to learn about an enemy design. */
export const INTELLIGENCE_FACTS = 10;

/** What one side knows about an enemy before the battle, from its intelligence components. */
export interface IntelligenceReport {
  readonly enemy: string;
  /** The enemy's whole design, seen by a long-range scanner; null without one working. */
  readonly design: Design | null;
  /** What a signal interceptor learned, in no particular order; none without one working. */
  readonly facts: readonly IntelligenceFact[];
}

const WEAPON_TYPES: readonly ComponentType[] = [
  'laser',
  'charged-particle-beam',
  'neutral-particle-beam',
  'kinetic-gun',
  'point-defence',
  'launcher',
];

/** Every fact there is to learn about an enemy ship as it comes into the battle. */
const allFacts = (enemy: ShipState): readonly IntelligenceFact[] => {
  const { design } = enemy;
  const types = componentSlots(design).map((slot) => slot.component.type);
  return [
    { kind: 'hull-size', hullSize: design.hullSize },
    { kind: 'drive-thrust', thrust: designComponent(design, 'drive').thrust },
    { kind: 'reactor-output', output: designComponent(design, 'reactor').output },
    { kind: 'delta-v', deltaV: deltaVOf(enemy) },
    ...SECTION_KINDS.map((section): IntelligenceFact => ({
      kind: 'armour',
      section,
      armour: design.sections.find((s) => s.kind === section)?.armour ?? {
        type: 'heavy',
        thickness: 0,
      },
    })),
    {
      kind: 'weapons',
      weapons: WEAPON_TYPES.flatMap((type) => {
        const count = types.filter((t) => t === type).length;
        return count > 0 ? [{ type, count }] : [];
      }),
    },
    { kind: 'missiles', missiles: missilesLeft(enemy) },
    {
      kind: 'shields',
      shields: (['magnetic-shield', 'coolant-shield'] as const).filter((t) => types.includes(t)),
    },
  ];
};

/** The best working intelligence component of a type, scaled by its integrity. */
const working = (ship: ShipState, value: (slot: number) => number): number =>
  Math.max(0, ...componentSlots(ship.design).map((_, i) => value(i) * (ship.integrity[i] ?? 0)));

/**
 * What a side whose ship is `own` learns about an enemy before the battle. A working long-range
 * scanner shows the enemy's whole design. A signal interceptor learns a random selection of the
 * facts about it: its quality's share of them, as far as its integrity allows, for the best one
 * working. Without either the side goes in blind.
 */
export const gatherIntelligence = (
  own: ShipState,
  enemyId: string,
  enemy: ShipState,
  random: Random,
): IntelligenceReport => {
  const slots = componentSlots(own.design);
  const scanning = working(own, (i) => (slots[i]?.component.type === 'long-range-scanner' ? 1 : 0));
  const quality = working(own, (i) => {
    const component = slots[i]?.component;
    return component?.type === 'signal-interceptor' ? component.quality : 0;
  });
  const facts = [...allFacts(enemy)];
  // Fisher–Yates, so every selection of the facts is as likely.
  for (let i = facts.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const [a, b] = [facts[i], facts[j]];
    if (a && b) [facts[i], facts[j]] = [b, a];
  }
  return {
    enemy: enemyId,
    design: scanning > 0 ? enemy.design : null,
    facts: facts.slice(0, Math.round(quality * INTELLIGENCE_FACTS)),
  };
};
