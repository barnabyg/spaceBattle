import type { BattleEvent, SideId, SideObservation } from '../sim/battle';
import { dot, sub } from '../sim/vector';

/** The side's own slugs: those in flight, when they will arrive, and what came of the rest. */
export interface OutgoingSlugs {
  /** Slugs in flight at the target. */
  readonly inFlight: number;
  /**
   * How long until the first and the last of them pass the target at their present closing
   * speed, s; null when none is closing on it.
   */
  readonly firstIn: number | null;
  readonly lastIn: number | null;
  /** Slugs that struck the target, and slugs that passed it, since the battle began. */
  readonly hits: number;
  readonly misses: number;
}

/**
 * Follows `viewer`'s slugs through the battle. A slug that leaves flight without an impact
 * counts as a miss; an impact does not name its slug, so hits are counted from impact events.
 */
export const createSlugTracker = (viewer: SideId) => {
  const flying = new Set<number>();
  let gone = 0;
  let hits = 0;
  return {
    /** Takes an update's `events` and the side's `observation` after it; null while it has fired none. */
    update(observation: SideObservation, events: readonly BattleEvent[]): OutgoingSlugs | null {
      for (const event of events) {
        if (event.type === 'impact' && event.attacker === viewer && event.munition === 'slug') {
          hits += 1;
        }
      }
      const slugs = observation.munitions.flatMap((m) =>
        m.kind === 'slug' && m.attacker === viewer ? [m] : [],
      );
      const now = new Set(slugs.map((slug) => slug.id));
      for (const id of flying) {
        if (!now.has(id)) {
          flying.delete(id);
          gone += 1;
        }
      }
      for (const id of now) flying.add(id);
      if (gone === 0 && flying.size === 0) return null;
      const times = slugs.flatMap((slug) => {
        const target = observation.contacts.find((c) => c.sideId === slug.target);
        if (!target) return [];
        const offset = sub(target.position, slug.position);
        const drift = sub(target.velocity, slug.velocity);
        const speed = dot(drift, drift);
        const time = speed > 0 ? -dot(offset, drift) / speed : -1;
        return time >= 0 ? [time] : [];
      });
      return {
        inFlight: slugs.length,
        firstIn: times.length > 0 ? Math.min(...times) : null,
        lastIn: times.length > 0 ? Math.max(...times) : null,
        hits,
        misses: Math.max(0, gone - hits),
      };
    },
  };
};
