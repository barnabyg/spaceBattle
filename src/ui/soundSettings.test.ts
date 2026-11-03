import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND_SETTINGS, loadSoundSettings, saveSoundSettings } from './soundSettings';

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

describe('sound settings', () => {
  it('start at the default volume, unmuted', () => {
    expect(loadSoundSettings(memoryStorage())).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(DEFAULT_SOUND_SETTINGS.muted).toBe(false);
  });

  it('keep the volume and mute for the session', () => {
    const storage = memoryStorage();
    saveSoundSettings({ volume: 0.25, muted: true }, storage);
    expect(loadSoundSettings(storage)).toEqual({ volume: 0.25, muted: true });
  });

  it('fall back to the defaults when storage is blocked or holds nonsense', () => {
    expect(loadSoundSettings(blockedStorage)).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(() => {
      saveSoundSettings({ volume: 1, muted: true }, blockedStorage);
    }).not.toThrow();
    expect(loadSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS);
    const storage = memoryStorage();
    storage.setItem('space-battle.sound', '{"volume":7,"muted":"yes"}');
    expect(loadSoundSettings(storage)).toEqual({ volume: 1, muted: false });
    storage.setItem('space-battle.sound', 'not json');
    expect(loadSoundSettings(storage)).toEqual(DEFAULT_SOUND_SETTINGS);
  });
});
