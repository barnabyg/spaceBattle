import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_LAYERS, loadMapLayers, MAP_LAYERS, saveMapLayers } from './mapLayers';

/** A session store in memory, like `sessionStorage`. */
const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

/** A store that refuses every read and write, like storage blocked by the browser. */
const blockedStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('Blocked');
  },
  setItem: () => {
    throw new Error('Blocked');
  },
};

describe('map layers', () => {
  it('start with auxiliary motion layers hidden', () => {
    expect(loadMapLayers(memoryStorage())).toEqual(DEFAULT_MAP_LAYERS);
    expect(MAP_LAYERS.filter((layer) => !DEFAULT_MAP_LAYERS[layer])).toEqual([
      'trail',
      'drop-lines',
      'projected-path',
      'planned-burns',
    ]);
  });

  it('keep each layer shown or hidden for the session, apart from the others', () => {
    const storage = memoryStorage();
    saveMapLayers({ ...DEFAULT_MAP_LAYERS, trail: true, beams: false }, storage);
    const kept = loadMapLayers(storage);
    expect(kept.trail).toBe(true);
    expect(kept.beams).toBe(false);
    expect(kept).toEqual({ ...DEFAULT_MAP_LAYERS, trail: true, beams: false });
  });

  it('fall back to defaults when storage is blocked', () => {
    expect(loadMapLayers(blockedStorage)).toEqual(DEFAULT_MAP_LAYERS);
    expect(() => {
      saveMapLayers({ ...DEFAULT_MAP_LAYERS, velocity: false }, blockedStorage);
    }).not.toThrow();
    expect(loadMapLayers(null)).toEqual(DEFAULT_MAP_LAYERS);
  });

  it('use defaults for any layer whose kept setting is missing or nonsense', () => {
    const storage = memoryStorage();
    storage.setItem('space-battle.map-layers', '{"trail":false,"heading":"no","beams":0}');
    expect(loadMapLayers(storage)).toEqual({ ...DEFAULT_MAP_LAYERS, trail: false });
    storage.setItem('space-battle.map-layers', 'not json');
    expect(loadMapLayers(storage)).toEqual(DEFAULT_MAP_LAYERS);
    storage.setItem('space-battle.map-layers', '[false]');
    expect(loadMapLayers(storage)).toEqual(DEFAULT_MAP_LAYERS);
  });
});
