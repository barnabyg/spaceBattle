import { sessionStore, type SettingsStorage } from './sessionStore';

/** The captain's sound settings, kept for the browser session. */
export interface SoundSettings {
  /** 0–1 */
  readonly volume: number;
  readonly muted: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { volume: 0.5, muted: false };

const KEY = 'space-battle.sound';

/** The settings kept for this session, or the defaults if none are kept or storage is blocked. */
export const loadSoundSettings = (
  storage: SettingsStorage | null = sessionStore(),
): SoundSettings => {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (typeof kept !== 'object' || kept === null) return DEFAULT_SOUND_SETTINGS;
    const { volume, muted } = kept as Partial<Record<keyof SoundSettings, unknown>>;
    return {
      volume:
        typeof volume === 'number' && Number.isFinite(volume)
          ? Math.min(1, Math.max(0, volume))
          : DEFAULT_SOUND_SETTINGS.volume,
      muted: typeof muted === 'boolean' ? muted : DEFAULT_SOUND_SETTINGS.muted,
    };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
};

/** Keeps the settings for the rest of the session; where storage is blocked, they last the page. */
export const saveSoundSettings = (
  settings: SoundSettings,
  storage: SettingsStorage | null = sessionStore(),
): void => {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Blocked storage only means the settings are not kept.
  }
};
