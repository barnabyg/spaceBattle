import { componentSlots } from './components';
import { effectiveRange } from './beams';
import { missileRole, type SectionKind } from './design';
import { firingSolution, kineticGunRange, shotEnergy, type Motion } from './kinetic';
import { TIME_STEP } from './time';
import { temperatureOf, type ShipState } from './ship';
import { thermalLimit } from './heat';
import { distance } from './vector';
import { designMissiles, missilesLeft, slugsLeft, weaponFireBlocker } from './weapons';
import { missileReach } from './missile';
import { pointDefenceRange } from './pointDefence';

/** Range and availability are independent: holding fire never makes a weapon out of range. */
export interface WeaponReadiness {
  readonly kind:
    | 'laser'
    | 'charged-particle-beam'
    | 'neutral-particle-beam'
    | 'kinetic-gun'
    | 'launcher'
    | 'point-defence';
  readonly section: SectionKind;
  readonly mount: number;
  /** Fire control's effective range in metres; useful damage or a hit is not guaranteed. */
  readonly range: number | null;
  readonly rangeKind: 'effective' | 'estimate' | 'defensive';
  readonly missile?: string;
  readonly inRange: boolean | null;
  /** Power/firing describe the last step; awaiting-step makes no readiness guarantee. */
  readonly status:
    | 'lost'
    | 'no-target'
    | 'hold-fire'
    | 'no-ammunition'
    | 'no-power'
    | 'no-solution'
    | 'heat-limited'
    | 'waiting-range'
    | 'firing'
    | 'charging'
    | 'awaiting-step'
    | 'by-order'
    | 'reloading'
    | 'defensive';
}

/** Own weapons only, using the same reach functions as fire control. */
export const observeWeaponReadiness = (
  ship: ShipState,
  target: Motion | null,
): WeaponReadiness[] => {
  const slots = componentSlots(ship.design);
  const range = target ? distance(ship.position, target.position) : null;
  const status = (slot: number, reach: number): WeaponReadiness['status'] =>
    weaponFireBlocker(ship, slot, range, reach) ??
    (thermalLimit(temperatureOf(ship)) < 1 ? 'heat-limited' : 'awaiting-step');
  const place = (slot: number) => ({
    section: slots[slot]?.section ?? 'forward',
    mount: slots[slot]?.index ?? 0,
  });
  const powered = (demand: number): boolean =>
    demand === 0 || ship.powerFlow.systems.weapons.supplied > 0;
  return [
    ...ship.weapons.beamWeapons.map((state): WeaponReadiness => {
      const reach = effectiveRange(state.weapon);
      const available = status(state.slot, reach);
      return {
        ...place(state.slot),
        kind: state.weapon.type,
        rangeKind: 'effective',
        range: reach,
        inRange: range === null ? null : range <= reach,
        status:
          available !== 'awaiting-step'
            ? available
            : !powered(state.demand)
              ? 'no-power'
              : state.beamPower > 0
                ? 'firing'
                : 'awaiting-step',
      };
    }),
    ...ship.weapons.kineticGuns.map((state): WeaponReadiness => {
      const reach = kineticGunRange(state.gun);
      const available = status(state.slot, reach);
      const gunStatus: WeaponReadiness['status'] =
        available !== 'awaiting-step'
          ? available
          : slugsLeft(ship) === 0
            ? 'no-ammunition'
            : target &&
                range !== null &&
                range <= reach &&
                !firingSolution(ship, target, state.gun.muzzleVelocity, TIME_STEP)
              ? 'no-solution'
              : state.charge < shotEnergy(state.gun) && !powered(state.demand)
                ? 'no-power'
                : state.firing
                  ? 'charging'
                  : 'awaiting-step';
      return {
        ...place(state.slot),
        kind: 'kinetic-gun',
        rangeKind: 'effective',
        range: reach,
        inRange: range === null ? null : range <= reach,
        status: gunStatus,
      };
    }),
    ...ship.weapons.launchers.flatMap((state): WeaponReadiness[] => {
      const missiles = designMissiles(ship.design).filter(
        (m, i, all) => all.findIndex((other) => other.name === m.name) === i,
      );
      const lost = (ship.integrity[state.slot] ?? 0) <= 0;
      if (missiles.length === 0)
        return [
          {
            ...place(state.slot),
            kind: 'launcher',
            rangeKind: 'estimate',
            range: null,
            inRange: null,
            status: lost ? 'lost' : 'no-ammunition',
          },
        ];
      return missiles.map((missile) => {
        const reach = missileReach(missile);
        const defensive = missileRole(missile) === 'anti-missile';
        return {
          ...place(state.slot),
          kind: 'launcher',
          missile: missile.name,
          rangeKind: defensive ? 'defensive' : 'estimate',
          range: reach,
          inRange: range === null || defensive ? null : range <= reach,
          status: lost
            ? 'lost'
            : missilesLeft(ship, missile.name) === 0
              ? 'no-ammunition'
              : !target && !defensive
                ? 'no-target'
                : state.reload > 0
                  ? 'reloading'
                  : defensive
                    ? 'defensive'
                    : 'by-order',
        };
      });
    }),
    ...ship.weapons.pointDefence.map((state): WeaponReadiness => ({
      ...place(state.slot),
      kind: 'point-defence',
      rangeKind: 'defensive',
      range: pointDefenceRange(state.gun),
      inRange: null,
      status: (ship.integrity[state.slot] ?? 0) <= 0 ? 'lost' : 'defensive',
    })),
  ];
};
