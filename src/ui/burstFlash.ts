import type { BattleEvent, SideObservation } from '../sim/battle';

type DetonationEvent = Extract<BattleEvent, { type: 'detonation' }>;

/** How long a nuclear burst's flash lasts in the views, in real seconds. */
const BURST_FLASH_TIME = 1.5;
/** A burst further back than this in battle time when first seen is not shown, s. */
const STALE = 1;

/**
 * Follows the latest nuclear burst for a view: what it is and how bright its flash is now, 1 as
 * it is first seen and fading to 0 over `BURST_FLASH_TIME` of real time, so it fades whatever the
 * time compression, and after the battle has ended. Null when no flash is showing.
 */
export const createBurstFlash = () => {
  let latest: DetonationEvent | null = null;
  let seenAt = 0;
  return (
    observation: SideObservation,
  ): { readonly detonation: DetonationEvent; readonly strength: number } | null => {
    const detonation = observation.events.findLast((e) => e.type === 'detonation');
    const isNew =
      detonation && (detonation.munition !== latest?.munition || detonation.time !== latest.time);
    if (detonation && isNew) {
      latest = detonation;
      seenAt = observation.time - detonation.time <= STALE ? performance.now() : -Infinity;
    }
    if (!latest) return null;
    const age = (performance.now() - seenAt) / 1000;
    return age < BURST_FLASH_TIME
      ? { detonation: latest, strength: (1 - age / BURST_FLASH_TIME) ** 2 }
      : null;
  };
};
