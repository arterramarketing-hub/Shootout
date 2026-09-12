import type { WeaponId } from "../sim/weapons";

/**
 * Weapon audio, synthesised at runtime.
 *
 * Every sound here is generated from noise and oscillators rather than loaded
 * from a file. That keeps the download small, lets each weapon's character be
 * tuned as numbers alongside its damage, and means the prototype ships without
 * depending on any sample library.
 */

interface ShotVoice {
  /** Centre of the crack, in hertz. */
  crackFrequency: number;
  crackQ: number;
  crackDecay: number;
  /** Low-end thump, which is what gives a shot its weight. */
  bodyFrequency: number;
  bodyDecay: number;
  /** Room tail, suggesting the warehouse around the player. */
  tailDecay: number;
  tailCutoff: number;
  gain: number;
}

const VOICES: Record<WeaponId, ShotVoice> = {
  ar: {
    crackFrequency: 1750, crackQ: 0.8, crackDecay: 0.115,
    bodyFrequency: 128, bodyDecay: 0.1, tailDecay: 0.34, tailCutoff: 1500, gain: 0.62,
  },
  smg: {
    crackFrequency: 2350, crackQ: 0.9, crackDecay: 0.075,
    bodyFrequency: 165, bodyDecay: 0.06, tailDecay: 0.22, tailCutoff: 1900, gain: 0.5,
  },
  shotgun: {
    crackFrequency: 780, crackQ: 0.6, crackDecay: 0.3,
    bodyFrequency: 72, bodyDecay: 0.24, tailDecay: 0.62, tailCutoff: 900, gain: 0.85,
  },
  pistol: {
    crackFrequency: 1500, crackQ: 0.85, crackDecay: 0.14,
    bodyFrequency: 142, bodyDecay: 0.11, tailDecay: 0.3, tailCutoff: 1400, gain: 0.56,
  },
};

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;

  /**
   * Browsers refuse to start audio without a user gesture, so this must be
   * called from a real tap, not at load.
   */
  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;

    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);

    this.context = context;
    this.master = master;
    this.noise = createNoiseBuffer(context, 1);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.9 : 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** A shot from this player's own weapon. */
  shot(id: WeaponId): void {
    const context = this.context;
    const master = this.master;
    const noise = this.noise;
    if (!context || !master || !noise || !this.enabled) return;

    const voice = VOICES[id];
    const now = context.currentTime;

    // The crack: a filtered noise burst with an almost instant attack.
    const crack = context.createBufferSource();
    crack.buffer = noise;
    const crackFilter = context.createBiquadFilter();
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = voice.crackFrequency;
    crackFilter.Q.value = voice.crackQ;
    const crackGain = context.createGain();
    envelope(crackGain.gain, now, voice.gain, voice.crackDecay);
    crack.connect(crackFilter).connect(crackGain).connect(master);
    crack.start(now);
    crack.stop(now + voice.crackDecay + 0.05);

    // The body: a low sine dropping in pitch, which reads as the weight
    // of the round rather than as a separate tone.
    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(voice.bodyFrequency, now);
    body.frequency.exponentialRampToValueAtTime(
      voice.bodyFrequency * 0.45,
      now + voice.bodyDecay,
    );
    const bodyGain = context.createGain();
    envelope(bodyGain.gain, now, voice.gain * 0.85, voice.bodyDecay);
    body.connect(bodyGain).connect(master);
    body.start(now);
    body.stop(now + voice.bodyDecay + 0.05);

    // The tail: the room answering back.
    const tail = context.createBufferSource();
    tail.buffer = noise;
    const tailFilter = context.createBiquadFilter();
    tailFilter.type = "lowpass";
    tailFilter.frequency.value = voice.tailCutoff;
    const tailGain = context.createGain();
    tailGain.gain.setValueAtTime(0, now);
    tailGain.gain.linearRampToValueAtTime(voice.gain * 0.2, now + 0.012);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, now + voice.tailDecay);
    tail.connect(tailFilter).connect(tailGain).connect(master);
    tail.start(now);
    tail.stop(now + voice.tailDecay + 0.05);
  }

  /** Mechanical clicks during a reload. */
  reloadClick(pitch = 1): void {
    this.tick(2600 * pitch, 0.05, 0.22, "bandpass");
  }

  /** The trigger coming down on an empty chamber. */
  dryFire(): void {
    this.tick(1800, 0.04, 0.18, "bandpass");
  }

  /** A round striking the level. Quieter with distance. */
  impact(distance: number): void {
    const attenuation = 1 / (1 + distance * 0.12);
    this.tick(3200, 0.035, 0.16 * attenuation, "highpass");
  }

  /** Confirmation that a shot landed on a target. */
  hitMarker(headshot: boolean): void {
    this.tick(headshot ? 2100 : 1400, 0.05, 0.3, "bandpass");
  }

  /** A plate going over. */
  targetDrop(): void {
    this.tick(420, 0.26, 0.34, "lowpass");
  }

  private tick(
    frequency: number,
    decay: number,
    gain: number,
    filterType: BiquadFilterType,
  ): void {
    const context = this.context;
    const master = this.master;
    const noise = this.noise;
    if (!context || !master || !noise || !this.enabled) return;

    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    const amp = context.createGain();
    envelope(amp.gain, now, gain, decay);
    source.connect(filter).connect(amp).connect(master);
    source.start(now);
    source.stop(now + decay + 0.05);
  }
}

/** Percussive envelope: near-instant attack, exponential decay. */
const envelope = (
  param: AudioParam,
  now: number,
  peak: number,
  decay: number,
): void => {
  param.setValueAtTime(0.0001, now);
  param.linearRampToValueAtTime(peak, now + 0.002);
  param.exponentialRampToValueAtTime(0.0001, now + decay);
};

const createNoiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
};
