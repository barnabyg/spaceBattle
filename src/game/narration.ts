import type {
  BattleEvent,
  ContactObservation,
  SideId,
  SideObservation,
  SideSetup,
} from '../sim/battle';
import type { ComponentType, SectionKind } from '../sim/design';
import { targetsMissile } from '../sim/missile';
import { dot, length, sub } from '../sim/vector';
import { knownEnemyReach, ownReach, separationOf } from './advance';

/** One line of the battle's story, as the viewing side's captain hears it. */
export interface NarrationLine {
  /** Battle time, s. */
  readonly time: number;
  readonly text: string;
  /** Whose ship it is about, or the battle as a whole. */
  readonly about: 'own' | 'enemy' | 'battle';
  /** Whether it needs the captain: it stays up longer. */
  readonly major: boolean;
}

const SECTION: Readonly<Record<SectionKind, string>> = {
  forward: 'forward',
  middle: 'middle',
  engine: 'engine',
};

const COMPONENT: Readonly<Record<ComponentType, string>> = {
  drive: 'drive',
  thrusters: 'thrusters',
  reactor: 'reactor',
  capacitor: 'capacitor',
  magazine: 'magazine',
  'magnetic-shield': 'magnetic shield',
  'coolant-shield': 'coolant shield',
  'long-range-scanner': 'long-range scanner',
  'signal-interceptor': 'signal interceptor',
  radiator: 'radiator',
  laser: 'laser',
  'charged-particle-beam': 'charged particle beam',
  'neutral-particle-beam': 'neutral particle beam',
  'kinetic-gun': 'kinetic gun',
  'point-defence': 'point defence gun',
  launcher: 'launcher',
  sensor: 'sensor',
};

/** What losing a component means, for the components whose loss changes the fight. */
const CONSEQUENCE: Partial<Readonly<Record<ComponentType, { own: string; enemy: string }>>> = {
  radiator: { own: 'our heat will rise', enemy: 'its heat will rise' },
  sensor: { own: 'we see less of the enemy', enemy: 'it sees less of us' },
  drive: { own: 'we cannot manoeuvre', enemy: 'it cannot manoeuvre' },
  thrusters: { own: 'we cannot turn', enemy: 'it cannot turn' },
  laser: { own: 'one weapon fewer', enemy: 'one weapon fewer' },
  'charged-particle-beam': { own: 'one weapon fewer', enemy: 'one weapon fewer' },
  'neutral-particle-beam': { own: 'one weapon fewer', enemy: 'one weapon fewer' },
  'kinetic-gun': { own: 'one weapon fewer', enemy: 'one weapon fewer' },
  launcher: { own: 'one launcher fewer', enemy: 'one launcher fewer' },
};

/** A duration in battle seconds as minutes and seconds, e.g. "3 min 20 s". */
const duration = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
};

/** km, to the nearest whole one, grouped. */
const km = (metres: number) => `${Math.round(metres / 1_000).toLocaleString('en-GB')} km`;

/**
 * Tells the story of a battle for the captain of `viewer`: from each update's events and the side's
 * observation after it, short plain lines about the own ship, the enemy and the battle. It says of
 * the enemy only what the sensors make out, as they did just before: a part they had not made out
 * is "enemy combat damage". It also notes each time the ships come into or out of reach of the own
 * weapons and of the enemy's weapons the sensors have made out.
 */
export const createNarrator = (viewer: SideId, sides: readonly SideSetup[]) => {
  /** The contact as last observed, for what the sensors had made out before a part was lost. */
  let lastContact: ContactObservation | undefined;
  let inOwnReach: boolean | null = null;
  let inEnemyReach: boolean | null = null;
  const name = (id: string) => sides.find((side) => side.id === id)?.name ?? id;

  /** Whether the sensors had made out a part of the contact: a section, or one of its mounts. */
  const madeOut = (section: SectionKind, mount: number | null) =>
    mount === null
      ? (lastContact?.sections.some((s) => s.kind === section) ?? false)
      : (lastContact?.mounts.some((m) => m.section === section && m.mount === mount) ?? false);

  const describe = (event: BattleEvent): NarrationLine | null => {
    const at = (text: string, about: NarrationLine['about'], major: boolean): NarrationLine => ({
      time: event.time,
      text,
      about,
      major,
    });
    switch (event.type) {
      case 'armour-breached':
        return event.side === viewer
          ? at(`Our ${SECTION[event.section]} armour breached.`, 'own', true)
          : madeOut(event.section, null)
            ? at(`Enemy ${SECTION[event.section]} armour breached.`, 'enemy', false)
            : at('Enemy combat damage.', 'enemy', false);
      case 'component-lost': {
        const thing = COMPONENT[event.component];
        if (event.side === viewer) {
          const then = CONSEQUENCE[event.component]?.own;
          return at(
            `Our ${thing} lost (${SECTION[event.section]})${then ? ` — ${then}` : ''}.`,
            'own',
            true,
          );
        }
        // Only a mount the sensors made out shows what it was; inside, nothing does.
        if (!event.mounted || !madeOut(event.section, event.index)) {
          return at('Enemy combat damage.', 'enemy', false);
        }
        const then = CONSEQUENCE[event.component]?.enemy;
        return at(`Enemy ${thing} torn away${then ? ` — ${then}` : ''}.`, 'enemy', false);
      }
      case 'structural-failure':
        return event.side === viewer
          ? at(`Our ${SECTION[event.section]} section is lost!`, 'own', true)
          : madeOut(event.section, null)
            ? at(`Enemy ${SECTION[event.section]} section destroyed.`, 'enemy', true)
            : at('Enemy combat damage.', 'enemy', true);
      case 'magazine-explosion':
        return event.side === viewer
          ? at(`Our ${SECTION[event.section]} magazine exploded!`, 'own', true)
          : at('An explosion aboard the enemy!', 'enemy', true);
      case 'detonation':
        return event.target === viewer
          ? at(`Nuclear warhead went off ${km(event.distance)} from us!`, 'own', true)
          : at(`Our nuclear warhead went off ${km(event.distance)} from the enemy.`, 'enemy', true);
      case 'withdrawal':
        return event.side === viewer
          ? at('We are withdrawing.', 'own', true)
          : at(`${name(event.side)} is withdrawing.`, 'enemy', true);
      case 'battle-ended': {
        const winner = event.outcome.winner;
        return at(
          winner === null
            ? 'The battle is over: no winner.'
            : `The battle is over: ${name(winner)} wins.`,
          'battle',
          true,
        );
      }
      case 'intercept':
        return event.side === viewer
          ? at('We shot down an enemy missile.', 'own', false)
          : at('The enemy shot down one of our missiles.', 'enemy', false);
      case 'launch':
      case 'hit':
      case 'impact':
      case 'miss':
        // Launches are told together below; hits and misses are too many to tell.
        return null;
    }
  };

  /** The salvos launched in this update: ours, and the enemy's at us with when they strike. */
  const launches = (events: readonly BattleEvent[], observation: SideObservation) => {
    const lines: NarrationLine[] = [];
    const time = observation.time;
    const ships = events.flatMap((e) =>
      e.type === 'launch' && !targetsMissile(e.target) ? [e] : [],
    );
    const atUs = ships.filter((e) => e.target === viewer).length;
    const ours = ships.filter((e) => e.attacker === viewer).length;
    if (atUs > 0) {
      const ship = observation.ownShip;
      const soonest = Math.min(
        ...observation.munitions.flatMap((m) => {
          if (m.kind !== 'missile' || m.target !== viewer) return [];
          // At its present closing speed: missiles still boosting arrive sooner.
          const offset = sub(m.position, ship.position);
          const distance = length(offset);
          const closing = -dot(offset, sub(m.velocity, ship.velocity)) / distance;
          return closing > 0 ? [distance / closing] : [];
        }),
      );
      const when = Number.isFinite(soonest) ? ` Impact in about ${duration(soonest)}.` : '';
      lines.push({
        time,
        text: `${atUs === 1 ? 'A missile' : `Salvo of ${atUs} missiles`} launched at us.${when}`,
        about: 'own',
        major: true,
      });
    }
    if (ours > 0) {
      lines.push({
        time,
        text: `We launched ${ours === 1 ? 'a missile' : `${ours} missiles`} at the enemy.`,
        about: 'enemy',
        major: false,
      });
    }
    return lines;
  };

  /** Coming into or out of reach of the own weapons, and of the enemy's made out. */
  const reaches = (observation: SideObservation): NarrationLine[] => {
    const separation = separationOf(observation);
    if (separation === null) return [];
    const lines: NarrationLine[] = [];
    const time = observation.time;
    const own = ownReach(observation);
    const nowOwn = own > 0 && separation <= own;
    if (inOwnReach !== null && nowOwn !== inOwnReach) {
      lines.push({
        time,
        text: nowOwn
          ? 'The enemy is now within reach of our weapons.'
          : 'The enemy has drawn out of our weapons’ reach.',
        about: 'battle',
        major: false,
      });
    }
    inOwnReach = nowOwn;
    const theirs = knownEnemyReach(observation);
    const nowEnemy = theirs > 0 && separation <= theirs;
    if (inEnemyReach !== null && nowEnemy !== inEnemyReach) {
      lines.push({
        time,
        text: nowEnemy
          ? 'We are now within reach of the enemy’s weapons.'
          : 'We are out of the enemy’s known reach.',
        about: 'battle',
        major: nowEnemy,
      });
    }
    inEnemyReach = nowEnemy;
    return lines;
  };

  return {
    /**
     * The lines for one update: its `events`, then the side's `observation` after it. Each line
     * is told once; the same enemy damage in one update is told once.
     */
    narrate(observation: SideObservation, events: readonly BattleEvent[]): NarrationLine[] {
      const told = events.flatMap((event) => {
        const line = describe(event);
        return line ? [line] : [];
      });
      const lines = [...told, ...launches(events, observation), ...reaches(observation)];
      lastContact = observation.contacts[0];
      // The same line twice in one update, such as several unseen enemy parts lost, is told once.
      return lines.filter((line, i) => lines.findIndex((other) => other.text === line.text) === i);
    },
  };
};
