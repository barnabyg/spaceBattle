import type { BattleEvent, SideObservation } from '../sim/battle';

type DetonationEvent = Extract<BattleEvent, { type: 'detonation' }>;
type InterceptEvent = Extract<BattleEvent, { type: 'intercept' }>;

/** A burst further back than this in battle time when first seen is not shown, s. */
const STALE = 1;

/**
 * Follows the latest event of a kind for a view, such as a nuclear burst: the event and how bright
 * its flash is now, 1 as it is first seen and fading to 0 over `duration` real seconds, so it
 * fades whatever the time compression, and after the battle has ended. Null when no flash is
 * showing.
 */
const createEventFlash = <T extends DetonationEvent | InterceptEvent>(
  type: T['type'],
  duration: number,
) => {
  let latest: T | null = null;
  let seenAt = 0;
  return (
    observation: SideObservation,
  ): { readonly event: T; readonly strength: number } | null => {
    const event = observation.events.findLast((e): e is T => e.type === type);
    const isNew = event && (event.munition !== latest?.munition || event.time !== latest.time);
    if (event && isNew) {
      latest = event;
      seenAt = observation.time - event.time <= STALE ? performance.now() : -Infinity;
    }
    if (!latest) return null;
    const age = (performance.now() - seenAt) / 1000;
    return age < duration ? { event: latest, strength: (1 - age / duration) ** 2 } : null;
  };
};

/** How long a nuclear burst's flash lasts in the views, in real seconds. */
const BURST_FLASH_TIME = 1.5;
/** How long the flash of a missile shot down lasts in the views, in real seconds. */
const INTERCEPT_FLASH_TIME = 0.8;

/** Follows the latest nuclear burst for a view (see `createEventFlash`). */
export const createBurstFlash = () => {
  const flash = createEventFlash<DetonationEvent>('detonation', BURST_FLASH_TIME);
  return (observation: SideObservation) => {
    const shown = flash(observation);
    return shown && { detonation: shown.event, strength: shown.strength };
  };
};

/** Follows the latest missile shot down for a view (see `createEventFlash`). */
export const createInterceptFlash = () => {
  const flash = createEventFlash<InterceptEvent>('intercept', INTERCEPT_FLASH_TIME);
  return (observation: SideObservation) => {
    const shown = flash(observation);
    return shown && { intercept: shown.event, strength: shown.strength };
  };
};
