import { createSoundCues, type SoundFrame } from '../game/soundCues';
import type { SideSetup } from '../sim/battle';
import { el } from './el';
import { createShipAudio } from './shipAudio';
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from './soundSettings';

/**
 * Sound as heard inside a player side's ship, with its volume and mute controls. The settings
 * last for the browser session, so the next battle sounds the same.
 */
export const createShipSound = (side: SideSetup) => {
  let settings: SoundSettings = loadSoundSettings();
  const cues = createSoundCues(side);
  // Made while the captain's click that started the battle still counts, so it may start at once.
  const audio = createShipAudio();

  const mute = el('button', {
    className: 'time-button sound-mute',
    text: 'Mute',
    attrs: { type: 'button', title: 'Mute (M)' },
  });
  const volume = el('input', {
    className: 'sound-volume',
    attrs: { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Volume' },
  });
  const element = el(
    'div',
    { className: 'sound-controls', attrs: { role: 'group', 'aria-label': 'Sound' } },
    mute,
    volume,
  );

  const apply = () => {
    mute.setAttribute('aria-pressed', String(settings.muted));
    volume.value = String(Math.round(settings.volume * 100));
    audio?.setVolume(settings.muted ? 0 : settings.volume);
  };
  const change = (changes: Partial<SoundSettings>) => {
    settings = { ...settings, ...changes };
    saveSoundSettings(settings);
    apply();
  };
  apply();

  mute.addEventListener('click', () => {
    change({ muted: !settings.muted });
  });
  volume.addEventListener('input', () => {
    change({ volume: Number(volume.value) / 100, muted: false });
  });

  // Browsers start audio only after a user gesture; any click or key on the page will do.
  const onGesture = () => {
    if (!document.hidden) audio?.resume();
  };
  const onKey = (event: KeyboardEvent) => {
    onGesture();
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'm' || event.key === 'M') {
      change({ muted: !settings.muted });
      event.preventDefault();
    }
  };
  // A hidden page runs no frames, so its sounds would hang on their last level; pause them.
  const onVisibility = () => {
    if (document.hidden) audio?.suspend();
    else audio?.resume();
  };
  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    element,
    /** Plays what the captain hears in a frame. */
    update(frame: SoundFrame) {
      const heard = cues.next(frame);
      audio?.play(heard);
    },
    /** Stops all sound and frees the audio device and listeners. */
    dispose() {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      audio?.close();
    },
  };
};
