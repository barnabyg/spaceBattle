import type { BattleEvent, MissileObservation, SideId, SideObservation } from '../sim/battle';
import type { WarheadType } from '../sim/design';
import { targetsMissile } from '../sim/missile';
import { dot, length, sub } from '../sim/vector';

/** Missiles launched at the ship within this long of the salvo's latest are the same salvo, s. */
export const SALVO_WINDOW = 120;
/** A salvo with none left in flight stays on the timeline this long, s, then goes. */
export const SALVO_LINGER = 30;

/** One enemy salvo aimed at the side's ship, as its threat timeline shows it. */
export interface SalvoEntry {
  /** Battle time of its first launch, s: it names the salvo. */
  readonly launched: number;
  /** The missiles launched in it, and how many of them are still in flight. */
  readonly missiles: number;
  readonly inFlight: number;
  /** The ids of its missiles still in flight, to pick them out on the map. */
  readonly ids: readonly number[];
  /** Their warhead, as the side observes it. */
  readonly warhead: WarheadType | null;
  /**
   * How long until the first of them strikes at its present closing speed, s; null when none is
   * closing. A missile still under boost arrives sooner.
   */
  readonly impactIn: number | null;
  /** How long until the first comes within the side's working point defence, s; 0 once inside; null without one. */
  readonly pointDefenceIn: number | null;
  /** The side's anti-missile missiles in flight after its missiles. */
  readonly antiMissiles: number;
  readonly shotDown: number;
  /** Its missiles that struck the ship or went off by it. */
  readonly struck: number;
  /** 'incoming' while any is in flight; once none is, 'defeated' if none struck, else 'struck'. */
  readonly state: 'incoming' | 'defeated' | 'struck';
}

interface Salvo {
  readonly launched: number;
  last: number;
  readonly ids: Set<number>;
  shotDown: number;
  struck: number;
  /** When its last missile left flight, s; null while any is in flight. */
  over: number | null;
  /** Its missiles' warhead, once seen in flight. */
  warhead: WarheadType | null;
}

/** How long a missile takes to close `offset` at its present rate of closing, s; null if not closing. */
const timeToClose = (missile: MissileObservation, observation: SideObservation): number | null => {
  const ship = observation.ownShip;
  const offset = sub(missile.position, ship.position);
  const distance = length(offset);
  if (!(distance > 0)) return 0;
  const closing = -dot(offset, sub(missile.velocity, ship.velocity)) / distance;
  return closing > 0 ? distance / closing : null;
};

/**
 * The threat timeline for `viewer`'s ship: each enemy salvo aimed at it, grouped from launches no
 * more than `SALVO_WINDOW` apart, with how many are left, when the first strikes, when the ship's
 * defences can meet them, and what has come of them, until `SALVO_LINGER` after the last is gone.
 */
export const createSalvoTracker = (viewer: SideId) => {
  const salvos: Salvo[] = [];
  return {
    /** Takes an update's `events` and the side's `observation` after it; returns the timeline. */
    update(observation: SideObservation, events: readonly BattleEvent[]): SalvoEntry[] {
      const time = observation.time;
      for (const event of events) {
        if (event.type === 'launch' && event.target === viewer && !targetsMissile(event.target)) {
          const latest = salvos.at(-1);
          if (latest?.over === null && event.time - latest.last <= SALVO_WINDOW) {
            latest.ids.add(event.munition);
            latest.last = event.time;
          } else {
            salvos.push({
              launched: event.time,
              last: event.time,
              ids: new Set([event.munition]),
              shotDown: 0,
              struck: 0,
              over: null,
              warhead: null,
            });
          }
        }
        const salvo = (munition: number) => salvos.find((s) => s.ids.has(munition));
        if (event.type === 'intercept' && event.attacker !== viewer) {
          const found = salvo(event.munition);
          if (found) found.shotDown += 1;
        }
        if (event.type === 'impact' && event.target === viewer && event.munition === 'missile') {
          // An impact does not name the missile: it counts against the salvo nearest done.
          const found = salvos.find((s) => s.over === null);
          if (found) found.struck += 1;
        }
        if (event.type === 'detonation' && event.target === viewer) {
          const found = salvo(event.munition);
          if (found) found.struck += 1;
        }
      }
      const missiles = observation.munitions.flatMap((m) =>
        m.kind === 'missile' && m.target === viewer ? [m] : [],
      );
      const { weapons } = observation.ownShip;
      const defence = Math.max(
        0,
        ...weapons.pointDefence.filter((g) => g.integrity > 0).map((g) => g.effectiveRange),
      );
      const entries: SalvoEntry[] = [];
      for (const salvo of [...salvos]) {
        const flying = missiles.filter((m) => salvo.ids.has(m.id));
        salvo.warhead ??= flying[0]?.warhead ?? null;
        if (flying.length === 0 && salvo.over === null) salvo.over = time;
        if (flying.length > 0) salvo.over = null;
        if (salvo.over !== null && time - salvo.over > SALVO_LINGER) {
          salvos.splice(salvos.indexOf(salvo), 1);
          continue;
        }
        const times = flying.flatMap((m) => {
          const t = timeToClose(m, observation);
          return t === null ? [] : [t];
        });
        const nearest = Math.min(
          ...flying.map((m) => length(sub(m.position, observation.ownShip.position))),
        );
        const closing = times.length > 0 ? Math.min(...times) : null;
        const pointDefenceIn =
          defence === 0 || flying.length === 0
            ? null
            : nearest <= defence
              ? 0
              : closing === null
                ? null
                : (closing * (nearest - defence)) / nearest;
        entries.push({
          launched: salvo.launched,
          missiles: salvo.ids.size,
          inFlight: flying.length,
          ids: flying.map((m) => m.id),
          warhead: salvo.warhead,
          impactIn: closing,
          pointDefenceIn,
          antiMissiles: weapons.antiMissile.engagements.filter((e) => salvo.ids.has(e.target))
            .length,
          shotDown: salvo.shotDown,
          struck: salvo.struck,
          state: flying.length > 0 ? 'incoming' : salvo.struck > 0 ? 'struck' : 'defeated',
        });
      }
      return entries;
    },
  };
};
