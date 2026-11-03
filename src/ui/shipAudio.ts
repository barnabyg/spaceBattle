import type { AlarmKind, HullHitKind, SoundCues } from '../game/soundCues';

/**
 * The sounds of the own ship, synthesised with the Web Audio API: no recordings. Everything is
 * heard through the hull, so it is low, dull and resonant rather than crisp.
 */

/** How long a gun's thumps, a launch's clunks or a burst's rattles are spread apart, s. */
const REPEAT_SPACING = 0.07;
/** How quickly a continuous sound follows its level, s (time constant). */
const FOLLOW = 0.12;

/** How each alarm sounds and how often it repeats while it lasts. */
const ALARMS: Readonly<Record<AlarmKind, { readonly period: number }>> = {
  overheat: { period: 2.5 },
  'missile-inbound': { period: 1 },
  reserve: { period: 4 },
};

const noiseBuffer = (ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer => {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    // Brown noise: white noise integrated, with a leak to keep it centred.
    last = brown ? (last + 0.02 * white) / 1.02 : white;
    data[i] = brown ? last * 3.5 : white;
  }
  return buffer;
};

export interface ShipAudio {
  /** Overall loudness, 0–1; 0 silences everything. */
  setVolume(volume: number): void;
  /** Plays a frame's cues. */
  play(cues: SoundCues): void;
  /** Starts sound once the browser allows it: after the captain clicks or presses a key. */
  resume(): void;
  /** Pauses all sound, as while the page is hidden. */
  suspend(): void;
  /** Stops all sound and frees the audio device. */
  close(): void;
}

/** The ship's sounds, or null where the browser has no Web Audio. */
export const createShipAudio = (): ShipAudio | null => {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  master.connect(limiter).connect(ctx.destination);
  const white = noiseBuffer(ctx, 2, false);
  const brown = noiseBuffer(ctx, 4, true);

  const loop = (buffer: AudioBuffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
  };
  const silentGain = () => {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    return gain;
  };
  const filter = (type: BiquadFilterType, frequency: number, q = 0.7) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const osc = (type: OscillatorType, frequency: number) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.start();
    return node;
  };

  // The drive: a deep rumble of noise and two low tones beating against each other.
  const drive = silentGain();
  const driveFilter = filter('lowpass', 60);
  loop(brown).connect(driveFilter).connect(drive);
  const driveTones = ctx.createGain();
  driveTones.gain.value = 0.35;
  osc('sine', 31).connect(driveTones);
  osc('sine', 33.5).connect(driveTones);
  driveTones.connect(drive);

  // The own beam weapons: the hum of power pouring into them.
  const beams = silentGain();
  const beamFilter = filter('lowpass', 700);
  osc('sawtooth', 100).connect(beamFilter);
  osc('sine', 150).connect(beamFilter);
  beamFilter.connect(beams);

  // Enemy beams landing: armour boiling off, a hiss through the hull.
  const landing = silentGain();
  loop(white)
    .connect(filter('bandpass', 1_800, 0.8))
    .connect(landing);

  /** A short sound: a gain envelope that rises at `time` and dies away over `decay`. */
  const envelope = (time: number, peak: number, decay: number) => {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    gain.connect(master);
    return gain;
  };
  /** A tone sweeping from one frequency to another, for `decay` seconds. */
  const sweep = (
    time: number,
    type: OscillatorType,
    from: number,
    to: number,
    peak: number,
    decay: number,
  ) => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.setValueAtTime(from, time);
    node.frequency.exponentialRampToValueAtTime(to, time + decay);
    node.connect(envelope(time, peak, decay));
    node.start(time);
    node.stop(time + decay + 0.05);
  };
  /** A burst of white noise through a filter. */
  const noise = (time: number, peak: number, decay: number, shape: BiquadFilterNode) => {
    const source = ctx.createBufferSource();
    source.buffer = white;
    source.connect(shape).connect(envelope(time, peak, decay));
    source.start(time, Math.random());
    source.stop(time + decay + 0.05);
  };
  /** The hull ringing: a few inharmonic partials, as a struck plate rings. */
  const ring = (time: number, peak: number, decay: number) => {
    for (const frequency of [173, 287, 431, 619]) {
      sweep(time, 'sine', frequency, frequency * 0.98, peak, decay);
    }
  };

  const gunThump = (time: number) => {
    sweep(time, 'sine', 140, 45, 0.7, 0.35);
    noise(time, 0.3, 0.08, filter('lowpass', 400));
  };
  const pointDefenceRattle = (time: number) => {
    for (let i = 0; i < 6; i++) noise(time + i * 0.025, 0.25, 0.02, filter('bandpass', 1_100, 2));
  };
  const launch = (time: number) => {
    sweep(time, 'sine', 90, 45, 0.6, 0.4);
    const whoosh = filter('bandpass', 300, 1.5);
    whoosh.frequency.setValueAtTime(300, time);
    whoosh.frequency.exponentialRampToValueAtTime(1_500, time + 1.2);
    noise(time + 0.05, 0.35, 1.4, whoosh);
  };
  const hullHit = (time: number, kind: HullHitKind, strength: number) => {
    if (kind === 'beam') {
      noise(time, 0.4 * strength + 0.1, 0.5, filter('highpass', 1_500));
      ring(time, 0.03 * strength, 0.8);
      return;
    }
    const decay = 0.4 + 1.2 * strength;
    sweep(time, 'sine', 70, 28, 0.9 * strength + 0.1, decay);
    noise(
      time,
      0.6 * strength + 0.1,
      0.25 + 0.5 * strength,
      filter('lowpass', 500 + 2_500 * strength),
    );
    ring(time, 0.06 * strength, decay + 0.6);
  };
  const damageAlarm = (time: number) => {
    for (let i = 0; i < 4; i++) {
      sweep(time + i * 0.25, 'square', i % 2 ? 390 : 520, i % 2 ? 390 : 520, 0.08, 0.24);
    }
  };
  const alarm = (time: number, kind: AlarmKind) => {
    if (kind === 'overheat') {
      sweep(time, 'triangle', 880, 880, 0.15, 0.12);
      sweep(time + 0.2, 'triangle', 880, 880, 0.15, 0.12);
    } else if (kind === 'reserve') {
      // A slow falling tone, like a gauge running down.
      sweep(time, 'sine', 660, 440, 0.12, 0.6);
    } else {
      for (let i = 0; i < 3; i++) sweep(time + i * 0.12, 'sine', 1_320, 1_320, 0.12, 0.07);
    }
  };

  const nextAlarm = new Map<AlarmKind, number>();
  const repeat = (count: number, time: number, sound: (time: number) => void) => {
    for (let i = 0; i < count; i++) sound(time + i * REPEAT_SPACING);
  };

  return {
    setVolume(volume) {
      master.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), ctx.currentTime, 0.02);
    },
    play(cues) {
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      drive.gain.setTargetAtTime(0.8 * cues.drive, now, FOLLOW);
      driveFilter.frequency.setTargetAtTime(50 + 150 * cues.drive, now, FOLLOW);
      beams.gain.setTargetAtTime(0.06 * cues.beams, now, FOLLOW);
      landing.gain.setTargetAtTime(0.25 * cues.beamsLanding, now, FOLLOW);
      repeat(cues.gunShots, now, gunThump);
      repeat(cues.pointDefenceBursts, now, pointDefenceRattle);
      repeat(cues.launches, now, launch);
      cues.hullHits.forEach((hit, i) => {
        hullHit(now + i * REPEAT_SPACING, hit.kind, hit.strength);
      });
      if (cues.damage) damageAlarm(now);
      for (const kind of Object.keys(ALARMS) as AlarmKind[]) {
        if (!cues.alarms.includes(kind)) {
          nextAlarm.delete(kind);
        } else if (now >= (nextAlarm.get(kind) ?? 0)) {
          alarm(now, kind);
          nextAlarm.set(kind, now + ALARMS[kind].period);
        }
      }
    },
    resume() {
      if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    },
    suspend() {
      if (ctx.state === 'running') ctx.suspend().catch(() => undefined);
    },
    close() {
      if (ctx.state !== 'closed') ctx.close().catch(() => undefined);
    },
  };
};
