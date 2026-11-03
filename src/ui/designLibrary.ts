import { parseDesign, type Design } from '../sim/design';
import type { SettingsStorage } from './sessionStore';

/** Where the player's designs are kept, in the browser's local storage. */
const KEY = 'space-battle.designs';

/** The designs the player has saved from the shipyard, kept in the browser between visits. */
export interface DesignLibrary {
  /** The saved designs, in the order they were first saved. */
  designs(): readonly Design[];
  /** Saves a design, replacing any saved design with the same id. */
  save(design: Design): void;
  /** Deletes a saved design. */
  remove(id: string): void;
}

/** The browser's local storage, or null where the browser refuses it. */
export const localStore = (): SettingsStorage | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

/**
 * A library kept in `storage`, or in memory alone without it. Saved designs that no longer read
 * as valid designs are dropped.
 */
export const createDesignLibrary = (storage: SettingsStorage | null): DesignLibrary => {
  const load = (): Design[] => {
    try {
      const data: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
      if (!Array.isArray(data)) return [];
      return data.flatMap((entry: unknown) => {
        try {
          return [parseDesign(entry)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  };
  let designs = load();
  const store = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(designs));
    } catch {
      // Full or refused storage keeps the designs for this visit only.
    }
  };
  return {
    designs: () => designs,
    save(design) {
      const at = designs.findIndex((d) => d.id === design.id);
      designs = at < 0 ? [...designs, design] : designs.map((d, i) => (i === at ? design : d));
      store();
    },
    remove(id) {
      designs = designs.filter((d) => d.id !== id);
      store();
    },
  };
};
