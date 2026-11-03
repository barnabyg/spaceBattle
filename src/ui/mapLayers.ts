import { sessionStore, type SettingsStorage } from './sessionStore';

/**
 * The tactical map's layers the captain can show or hide, in the legend's order. Ship symbols,
 * their labels and the scale bar are always shown.
 */
export const MAP_LAYERS = [
  'velocity',
  'heading',
  'trail',
  'drop-lines',
  'projected-path',
  'planned-burns',
  'range-rings',
  'beams',
  'munitions',
  'flashes',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Whether each layer is shown. */
export type MapLayers = Readonly<Record<MapLayer, boolean>>;

export const DEFAULT_MAP_LAYERS: MapLayers = Object.fromEntries(
  MAP_LAYERS.map((layer) => [layer, true]),
) as Record<MapLayer, boolean>;

const KEY = 'space-battle.map-layers';

/**
 * The layers kept shown or hidden for this session; a layer with no valid setting kept, or every
 * layer where storage is blocked, is shown.
 */
export const loadMapLayers = (storage: SettingsStorage | null = sessionStore()): MapLayers => {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) {
      return DEFAULT_MAP_LAYERS;
    }
    const shown = kept as Partial<Record<MapLayer, unknown>>;
    return Object.fromEntries(
      MAP_LAYERS.map((layer) => {
        const value = shown[layer];
        return [layer, typeof value === 'boolean' ? value : DEFAULT_MAP_LAYERS[layer]];
      }),
    ) as Record<MapLayer, boolean>;
  } catch {
    return DEFAULT_MAP_LAYERS;
  }
};

/** Keeps the layers for the rest of the session; where storage is blocked, they last the page. */
export const saveMapLayers = (
  layers: MapLayers,
  storage: SettingsStorage | null = sessionStore(),
): void => {
  try {
    storage?.setItem(KEY, JSON.stringify(layers));
  } catch {
    // Blocked storage only means the layers are not kept.
  }
};
