import type {
  BattleEvent,
  OwnShipObservation,
  SideId,
  SideObservation,
  SideSetup,
} from '../sim/battle';
import { designComponentsOfType } from '../sim/design';
import type { ImpactKind } from '../sim/events';
import { OVERHEAT_TEMPERATURE } from '../sim/heat';
import { dot, length, sub } from '../sim/vector';

/**
 * What can be heard inside a ship. There is no sound in vacuum, so a captain hears only what
 * reaches their own hull: their drive, their own weapons firing, whatever strikes the ship, and
 * the ship's alarms. Nothing an enemy does is heard until it lands.
 */

/** What struck the own hull: a beam starting to land, a munition, a nuclear burst, a magazine. */
export type HullHitKind = 'beam' | ImpactKind | 'nuclear' | 'magazine-explosion';

export interface HullHit {
  readonly kind: HullHitKind;
  /** How hard it struck, 0–1. */
  readonly strength: number;
}

/**
 * An alarm that sounds for as long as its condition lasts. The propellant reserve alarm joins
 * these when ships hold a reserve for withdrawal (#37).
 */
export type AlarmKind = 'overheat' | 'missile-inbound';

/** What a frame sounds like inside the own ship. */
export interface SoundCues {
  /** The drive's rumble: the share of its full thrust it applied, 0–1. */
  readonly drive: number;
  /** The hum of the own beam weapons: the share of their full beam power they fired, 0–1. */
  readonly beams: number;
  /** The sizzle of enemy beams landing on the own hull, 0–1. */
  readonly beamsLanding: number;
  /** Shots of the own kinetic guns to thump. */
  readonly gunShots: number;
  /** Bursts of the own point defence to rattle. */
  readonly pointDefenceBursts: number;
  /** Missiles the own launchers launched. */
  readonly launches: number;
  /** What struck the own hull, the hardest first. */
  readonly hullHits: readonly HullHit[];
  /** Whether the damage alarm sounds: the own ship lost armour, a component or a section. */
  readonly damage: boolean;
  /** The alarms sounding now. */
  readonly alarms: readonly AlarmKind[];
}

/** One frame of a battle as the screen saw it. */
export interface SoundFrame {
  /** The own side's observation after the frame. */
  readonly observation: SideObservation;
  /** Everything that happened in the frame, on any side. */
  readonly events: readonly BattleEvent[];
  /** Whether the battle is running: not paused, and not over. */
  readonly running: boolean;
  /** Real time now, s; it only increases. */
  readonly realTime: number;
}

/** A repeated sound plays at most this often, however compressed time is, s of real time. */
export const MIN_REPEAT = 0.1;
/** No sound repeats more than this many times in one frame. */
export const MAX_REPEATS = 3;
/** The damage alarm sounds at most this often, s of real time. */
const DAMAGE_ALARM_REPEAT = 2;
/** An incoming missile this close in time sounds the alarm, s of battle time. */
const MISSILE_WARNING_TIME = 60;
/** Allowance for rounding in real time. */
const EPSILON = 1e-6;

/** Where `value` lies on a logarithmic scale from `low` to `high`, 0–1. */
const logScale = (value: number, low: number, high: number): number =>
  value <= 0 ? 0 : Math.min(1, Math.max(0, Math.log10(value / low) / Math.log10(high / low)));

/** How hard a strike of this energy feels, J: a point defence burst is light, a missile heavy. */
const impactStrength = (energy: number) => Math.max(0.05, logScale(energy, 1e5, 1e12));
/** How hard a beam of this power feels, W. */
const beamStrength = (power: number) => Math.max(0.05, logScale(power, 1e6, 1e10));

const hullHitsOn = (events: readonly BattleEvent[], side: SideId): HullHit[] =>
  events.flatMap((event): HullHit[] => {
    switch (event.type) {
      case 'hit':
        return event.target === side ? [{ kind: 'beam', strength: beamStrength(event.power) }] : [];
      case 'impact':
        return event.target === side
          ? [{ kind: event.munition, strength: impactStrength(event.energy) }]
          : [];
      case 'detonation': {
        const energy = event.exposures
          .filter((e) => e.side === side)
          .reduce((sum, e) => sum + e.energy, 0);
        return energy > 0 ? [{ kind: 'nuclear', strength: impactStrength(energy) }] : [];
      }
      case 'magazine-explosion':
        return event.side === side ? [{ kind: 'magazine-explosion', strength: 1 }] : [];
      default:
        return [];
    }
  });

const isDamage = (event: BattleEvent, side: SideId): boolean =>
  (event.type === 'armour-breached' ||
    event.type === 'component-lost' ||
    event.type === 'structural-failure' ||
    event.type === 'magazine-explosion') &&
  event.side === side;

/** Whether the own ship lost ammunition other than by firing it: a magazine or its section. */
const lostAmmunition = (events: readonly BattleEvent[], side: SideId): boolean =>
  events.some(
    (event) =>
      ((event.type === 'component-lost' && event.component === 'magazine') ||
        event.type === 'structural-failure' ||
        event.type === 'magazine-explosion') &&
      event.side === side,
  );

const share = (weapons: readonly { beamPower: number; fullBeamPower: number }[]): number => {
  const full = weapons.reduce((sum, w) => sum + w.fullBeamPower, 0);
  return full > 0 ? Math.min(1, weapons.reduce((sum, w) => sum + w.beamPower, 0) / full) : 0;
};

/** Whether an enemy missile aimed at the own ship will arrive within the warning time. */
const missileInbound = ({ ownShip, munitions }: SideObservation): boolean =>
  munitions.some((m) => {
    if (m.kind !== 'missile' || m.target !== ownShip.sideId) return false;
    const offset = sub(m.position, ownShip.position);
    const range = length(offset);
    const closing = -dot(offset, sub(m.velocity, ownShip.velocity)) / Math.max(range, 1);
    return closing > 0 && range / closing < MISSILE_WARNING_TIME;
  });

/**
 * A sound that repeats, such as a gun's thump: at most `MAX_REPEATS` a frame and one every
 * `MIN_REPEAT` of real time, so time compression never turns it into a roar.
 */
const createRepeater = (minRepeat: number) => {
  let last = -Infinity;
  return (count: number, realTime: number): number => {
    if (count <= 0) return 0;
    const allowed = Math.floor((realTime - last) / minRepeat + EPSILON);
    const played = Math.min(count, allowed, MAX_REPEATS);
    if (played > 0) last = realTime;
    return played;
  };
};

/**
 * Derives what a side's captain hears, frame by frame. It remembers the previous frame, so the
 * shots its guns fire show up as the ammunition they use.
 */
export const createSoundCues = (side: SideSetup) => {
  const fullThrust = designComponentsOfType(side.design, 'drive').reduce(
    (sum, drive) => sum + drive.thrust,
    0,
  );
  const guns = createRepeater(MIN_REPEAT);
  const pointDefence = createRepeater(MIN_REPEAT);
  const launchers = createRepeater(MIN_REPEAT);
  const damageAlarm = createRepeater(DAMAGE_ALARM_REPEAT);
  let previous: OwnShipObservation | null = null;

  return {
    next({ observation, events, running, realTime }: SoundFrame): SoundCues {
      const own = observation.ownShip;
      const ammunition = own.weapons.ammunition;
      const before = previous?.weapons.ammunition;
      previous = own;
      const lost = lostAmmunition(events, side.id);
      const slugsFired = before && !lost ? Math.max(0, before.slugs - ammunition.slugs) : 0;
      const roundsFired = before && !lost ? Math.max(0, before.rounds - ammunition.rounds) : 0;
      const roundsPerBurst = Math.max(1, own.weapons.pointDefence[0]?.roundsPerBurst ?? 1);
      const launched = events.filter((e) => e.type === 'launch' && e.attacker === side.id).length;
      const alarms: AlarmKind[] = [];
      if (running && own.heat.temperature > OVERHEAT_TEMPERATURE) alarms.push('overheat');
      if (running && missileInbound(observation)) alarms.push('missile-inbound');
      const landing = own.appearance.beamsLanding.reduce((sum, b) => sum + b.power, 0);

      return {
        drive: running && fullThrust > 0 ? Math.min(1, own.thrust / fullThrust) : 0,
        beams: running ? share([...own.weapons.lasers, ...own.weapons.particleBeams]) : 0,
        beamsLanding: running && landing > 0 ? beamStrength(landing) : 0,
        gunShots: guns(slugsFired, realTime),
        pointDefenceBursts: pointDefence(Math.ceil(roundsFired / roundsPerBurst), realTime),
        launches: launchers(launched, realTime),
        hullHits: hullHitsOn(events, side.id)
          .sort((a, b) => b.strength - a.strength)
          .slice(0, MAX_REPEATS),
        damage: damageAlarm(events.some((e) => isDamage(e, side.id)) ? 1 : 0, realTime) > 0,
        alarms,
      };
    },
  };
};
