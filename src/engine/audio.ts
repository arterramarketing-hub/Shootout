import type { AmbienceId } from "../maps/types";
import type { WeaponId } from "../sim/weapons";

/**
 * Game audio, synthesised at runtime.
 *
 * Every sound here is generated from noise and oscillators rather than loaded
 * from a file. That keeps the download small, lets each weapon's character be
 * tuned as numbers alongside its damage, and means the prototype ships without
 * depending on any sample library.
 */

/** One layer of a shot: filtered noise, shaped by an envelope. */
interface NoiseLayer {
  frequency: number;
  decay: number;
  gain: number;
}

interface BandLayer extends NoiseLayer {
  q: number;
}

interface DelayedLayer extends BandLayer {
  delay: number;
}

interface ToneLayer {
  frequency: number;
  /** What fraction of the starting pitch it falls to. */
  drop: number;
  decay: number;
  gain: number;
}

/**
 * What a weapon sounds like.
 *
 * Five layers, because a gunshot is five things happening at once and a
 * weapon's character is in the balance between them, not in one filter
 * frequency. The rifle cracks, the submachine gun clatters, the shotgun is
 * mostly blast and the pistol is mostly snap.
 */
interface ShotVoice {
  gain: number;
  /** How far each shot's pitch wanders, so a burst is not one sound repeated. */
  jitter: number;
  /** The hammer falling: a hard transient at the very front. */
  snap: NoiseLayer;
  /** The round going supersonic. */
  crack: BandLayer;
  /** The weight underneath it, a sine falling in pitch. */
  body: ToneLayer;
  /** The blast out of the muzzle: broadband, low-passed. */
  blast: NoiseLayer;
  /** The mechanism working, a moment later. */
  mech: DelayedLayer;
  /** The room answering back. */
  tail: NoiseLayer;
}

/*
 * A gunshot is violent, and the way that reads is a hard edge on the front
 * and a fast collapse behind it: almost all of the energy inside the first
 * twenty milliseconds. Long decays are what make a synthesised shot sound
 * like a door closing, so the crack is brief and the tails are kept short
 * and quiet enough to sit under the next round of a burst.
 */
const VOICES: Record<WeaponId, ShotVoice> = {
  // A rifle: the crack dominates, with real weight under it.
  ar: {
    gain: 0.95,
    jitter: 0.05,
    snap: { frequency: 4200, decay: 0.008, gain: 0.95 },
    crack: { frequency: 2100, q: 2.6, decay: 0.055, gain: 0.85 },
    body: { frequency: 124, drop: 0.3, decay: 0.09, gain: 0.72 },
    blast: { frequency: 760, decay: 0.05, gain: 0.6 },
    mech: { frequency: 5400, q: 2.5, delay: 0.045, decay: 0.03, gain: 0.16 },
    tail: { frequency: 1500, decay: 0.24, gain: 0.1 },
  },
  // A submachine gun: thin and fast, and the bolt is half the sound.
  smg: {
    gain: 0.82,
    jitter: 0.09,
    snap: { frequency: 5200, decay: 0.006, gain: 0.9 },
    crack: { frequency: 3000, q: 3, decay: 0.032, gain: 0.7 },
    body: { frequency: 205, drop: 0.36, decay: 0.045, gain: 0.5 },
    blast: { frequency: 1000, decay: 0.032, gain: 0.36 },
    mech: { frequency: 6300, q: 2.2, delay: 0.026, decay: 0.026, gain: 0.26 },
    tail: { frequency: 2100, decay: 0.12, gain: 0.07 },
  },
  // A shotgun: almost all blast and body, and the pump comes afterwards.
  shotgun: {
    gain: 1.15,
    jitter: 0.04,
    snap: { frequency: 1700, decay: 0.014, gain: 0.8 },
    crack: { frequency: 700, q: 0.7, decay: 0.16, gain: 0.85 },
    body: { frequency: 54, drop: 0.28, decay: 0.22, gain: 1.05 },
    blast: { frequency: 1500, decay: 0.13, gain: 1 },
    mech: { frequency: 2600, q: 1.4, delay: 0.16, decay: 0.06, gain: 0.26 },
    tail: { frequency: 760, decay: 0.5, gain: 0.18 },
  },
  // A pistol: a snap and a short metallic ring, gone almost at once.
  pistol: {
    gain: 0.86,
    jitter: 0.06,
    snap: { frequency: 3700, decay: 0.007, gain: 0.95 },
    crack: { frequency: 1750, q: 2, decay: 0.05, gain: 0.8 },
    body: { frequency: 158, drop: 0.32, decay: 0.07, gain: 0.6 },
    blast: { frequency: 820, decay: 0.04, gain: 0.44 },
    mech: { frequency: 4800, q: 2.8, delay: 0.042, decay: 0.026, gain: 0.2 },
    tail: { frequency: 1400, decay: 0.2, gain: 0.09 },
  },
};

/** The one-off sounds an ambience throws in between its beds. */
type Incidental =
  | "gunfire"
  | "groan"
  | "debris"
  | "bird"
  | "horn"
  | "relay"
  | "buzz"
  | "drip";

interface AmbienceProfile {
  /** How loud a gust of wind gets. Between gusts the wind is barely there. */
  wind: number;
  windCentre: number;
  /** Seconds between gusts, at the least and at the most. */
  gustGap: [number, number];
  /** The floor of the mix: everything below the wind, felt more than heard. */
  rumble: number;
  /** A mains hum, where there is something left running. */
  hum: number;
  /** Seconds between one-off sounds, at the least and at the most. */
  gap: [number, number];
  events: Incidental[];
}

/**
 * How loud the whole bed sits under the game.
 *
 * Ambience is meant to be noticed when you stop and listen for it and not
 * before. Anything louder and a wide band of noise stops being weather and
 * starts being the hiss of a broken speaker.
 */
const AMBIENCE_LEVEL = 0.5;

/** What the wind falls back to between gusts: present, but only just. */
const WIND_LULL = 0.12;

const AMBIENCES: Record<AmbienceId, AmbienceProfile> = {
  // An open plant with the weather coming through it: wind in the frame,
  // traffic somewhere beyond the wall, birds in the roof, and a fight
  // happening a few streets away.
  ruin: {
    wind: 0.05,
    windCentre: 470,
    gustGap: [7, 17],
    rumble: 0.014,
    hum: 0,
    gap: [4, 13],
    events: ["gunfire", "groan", "bird", "debris", "horn"],
  },
  // A switchyard: less weather, more electricity.
  substation: {
    wind: 0.03,
    windCentre: 640,
    gustGap: [9, 22],
    rumble: 0.012,
    hum: 0.016,
    gap: [3.5, 10],
    events: ["relay", "buzz", "groan", "debris", "gunfire", "drip"],
  },
  // A range. Quiet enough to hear your own weapon properly.
  range: {
    wind: 0.02,
    windCentre: 820,
    gustGap: [12, 26],
    rumble: 0.008,
    hum: 0.006,
    gap: [7, 18],
    events: ["debris", "drip", "gunfire"],
  },
};

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** A longer buffer for the beds: a one-second loop is audible as a pulse. */
  private bedNoise: AudioBuffer | null = null;
  private enabled = true;

  private ambience: AmbienceId | null = null;
  private ambienceNodes: AudioScheduledSourceNode[] = [];
  private ambienceGain: GainNode | null = null;
  private ambienceTimer: number | null = null;
  private gustTimer: number | null = null;
  private gustGain: GainNode | null = null;
  private windLull = 0;
  private windPeak = 0;

  /**
   * Browsers refuse to start audio without a user gesture, so this must be
   * called from a real tap, not at load.
   */
  start(): void {
    if (this.context) {
      void this.context.resume();
      this.startAmbience();
      return;
    }
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;

    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = 0.9;
    // A limiter on the way out. Shots are deliberately loud and hit hard at
    // the front, and several layers of several weapons can land in the same
    // millisecond; without this the sum runs past what the output can carry
    // and the edge that makes a shot sound violent turns into a crackle.
    // It also ducks the bed under gunfire, which is what a loud noise does
    // to everything quiet around it.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 9;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.16;
    master.connect(limiter).connect(context.destination);

    this.context = context;
    this.master = master;
    this.noise = createNoiseBuffer(context, 1);
    this.bedNoise = createNoiseBuffer(context, 4);
    this.startAmbience();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.9 : 0;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /* ------------------------------------------------------------------ *
   * The bed of sound a level sits in.
   * ------------------------------------------------------------------ */

  /**
   * Choose the level's ambience, and switch to it if something is playing.
   *
   * Silence is the loudest thing in an empty level: without a bed under it,
   * every sound in the game arrives out of nowhere and the place reads as a
   * diagram rather than somewhere weather gets into.
   */
  setAmbience(id: AmbienceId): void {
    if (this.ambience === id) return;
    this.ambience = id;
    if (this.context) {
      this.stopAmbience();
      this.startAmbience();
    }
  }

  /** Stop the beds and the one-off sounds. Safe to call at any time. */
  stopAmbience(): void {
    if (this.ambienceTimer !== null) {
      window.clearTimeout(this.ambienceTimer);
      this.ambienceTimer = null;
    }
    if (this.gustTimer !== null) {
      window.clearTimeout(this.gustTimer);
      this.gustTimer = null;
    }
    for (const node of this.ambienceNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      node.disconnect();
    }
    this.ambienceNodes = [];
    this.ambienceGain?.disconnect();
    this.ambienceGain = null;
    this.gustGain = null;
  }

  private startAmbience(): void {
    const context = this.context;
    const master = this.master;
    const bed = this.bedNoise;
    if (!context || !master || !bed || !this.ambience || this.ambienceGain) return;
    const profile = AMBIENCES[this.ambience];

    const output = context.createGain();
    output.gain.value = AMBIENCE_LEVEL;
    output.connect(master);
    this.ambienceGain = output;

    // Wind: a narrow band of noise, so it moans through the frame rather
    // than hissing. A wide band held at a steady level is not weather, it
    // is static, and the ear reads it as a fault in the speaker within
    // seconds. It sits at a lull and is only properly audible in gusts.
    const wind = context.createBufferSource();
    wind.buffer = bed;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = profile.windCentre;
    windFilter.Q.value = 2.2;
    const windGain = context.createGain();
    this.windPeak = profile.wind;
    this.windLull = profile.wind * WIND_LULL;
    windGain.gain.value = this.windLull;
    this.gustGain = windGain;
    wind.connect(windFilter).connect(windGain).connect(output);
    wind.start();
    this.ambienceNodes.push(wind);
    // Two drifts at unrelated rates, so the pattern never comes round.
    this.ambienceNodes.push(
      this.drift(windGain.gain, 0.055, this.windLull * 0.6),
      this.drift(windGain.gain, 0.017, this.windLull * 0.35),
      this.drift(windFilter.frequency, 0.037, profile.windCentre * 0.3),
    );

    // Rumble: the city, the weather, the building settling. Below anything
    // the player has to hear.
    const rumble = context.createBufferSource();
    rumble.buffer = bed;
    rumble.loop = true;
    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 140;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = profile.rumble;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(output);
    rumble.start();
    this.ambienceNodes.push(rumble, this.drift(rumbleGain.gain, 0.023, profile.rumble * 0.45));

    // Mains hum, where anything is still live: two tones a fifth apart, the
    // second one detuned so they beat against each other.
    if (profile.hum > 0) {
      for (const [frequency, share] of [[50, 1], [150, 0.5], [301, 0.22]] as const) {
        const hum = context.createOscillator();
        hum.type = frequency > 200 ? "triangle" : "sawtooth";
        hum.frequency.value = frequency;
        const humFilter = context.createBiquadFilter();
        humFilter.type = "lowpass";
        humFilter.frequency.value = 900;
        const humGain = context.createGain();
        humGain.gain.value = profile.hum * share;
        hum.connect(humFilter).connect(humGain).connect(output);
        hum.start();
        this.ambienceNodes.push(hum);
      }
    }

    this.scheduleIncidental(profile);
    this.scheduleGust(profile);
  }

  /**
   * Wind arrives and passes, rather than blowing at one level forever.
   *
   * The gaps are the point: a bed you can hear the whole time stops being
   * heard at all, and a gust only lands as weather if there was quiet
   * before it.
   */
  private scheduleGust(profile: AmbienceProfile): void {
    const [low, high] = profile.gustGap;
    const wait = (low + Math.random() * (high - low)) * 1000;
    this.gustTimer = window.setTimeout(() => {
      this.gustTimer = null;
      if (!this.ambienceGain) return;
      this.gust();
      this.scheduleGust(profile);
    }, wait);
  }

  /** A slow sine added to a parameter, for drift rather than repetition. */
  private drift(param: AudioParam, rate: number, depth: number): OscillatorNode {
    const context = this.context as AudioContext;
    const lfo = context.createOscillator();
    lfo.frequency.value = rate;
    const amount = context.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(param);
    lfo.start();
    return lfo;
  }

  private scheduleIncidental(profile: AmbienceProfile): void {
    const [low, high] = profile.gap;
    const wait = (low + Math.random() * (high - low)) * 1000;
    this.ambienceTimer = window.setTimeout(() => {
      this.ambienceTimer = null;
      if (this.ambienceGain) {
        const pick = profile.events[Math.floor(Math.random() * profile.events.length)];
        if (this.enabled) this.playIncidental(pick);
        this.scheduleIncidental(profile);
      }
    }, wait);
  }

  private playIncidental(kind: Incidental): void {
    switch (kind) {
      case "gunfire":
        return this.distantGunfire();
      case "groan":
        return this.metalGroan();
      case "debris":
        return this.debris();
      case "bird":
        return this.bird();
      case "horn":
        return this.distantHorn();
      case "relay":
        return this.relay();
      case "buzz":
        return this.electricBuzz();
      case "drip":
        return this.drip();
      default:
        return undefined;
    }
  }

  /** A firefight a few streets over: a short burst, dull with distance. */
  private distantGunfire(): void {
    const rounds = 2 + Math.floor(Math.random() * 5);
    const spacing = 0.07 + Math.random() * 0.06;
    for (let i = 0; i < rounds; i += 1) {
      const delay = i * spacing + Math.random() * 0.012;
      this.noiseLayer(
        { frequency: 520 + Math.random() * 180, decay: 0.1, gain: 0.05 },
        "lowpass",
        1,
        delay,
      );
      this.toneLayer({ frequency: 90, drop: 0.5, decay: 0.16, gain: 0.03 }, "sine", delay);
    }
    // The street answering it, well after the last round.
    this.noiseLayer(
      { frequency: 700, decay: 0.7, gain: 0.02 },
      "lowpass",
      1,
      rounds * spacing,
    );
  }

  /** Steel moving against steel somewhere above: long, low, unhurried. */
  private metalGroan(): void {
    const base = 70 + Math.random() * 90;
    this.toneLayer(
      { frequency: base, drop: 0.55 + Math.random() * 0.3, decay: 1.6, gain: 0.045 },
      "sawtooth",
      0,
      900,
    );
    this.toneLayer(
      { frequency: base * 2.02, drop: 0.6, decay: 1.3, gain: 0.02 },
      "triangle",
      0.05,
      1400,
    );
    this.noiseLayer({ frequency: 1100, decay: 0.9, gain: 0.012 }, "bandpass", 3, 0.2);
  }

  /** Grit letting go of a ledge and finding the floor. */
  private debris(): void {
    const pieces = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < pieces; i += 1) {
      this.noiseLayer(
        { frequency: 2400 + Math.random() * 2600, decay: 0.03, gain: 0.03 },
        "bandpass",
        6,
        Math.random() * 0.5,
      );
    }
  }

  /** Something nesting in the roof, complaining about the weather. */
  private bird(): void {
    const calls = 1 + Math.floor(Math.random() * 3);
    const base = 900 + Math.random() * 700;
    for (let i = 0; i < calls; i += 1) {
      const at = i * (0.14 + Math.random() * 0.12);
      this.chirp(base, base * 0.55, 0.11, 0.035, "sawtooth", at);
      this.chirp(base * 1.99, base * 1.1, 0.09, 0.012, "triangle", at);
    }
  }

  /** Traffic beyond the wall, which is how a ruin stays inside a city. */
  private distantHorn(): void {
    const base = 150 + Math.random() * 90;
    this.toneLayer({ frequency: base, drop: 0.98, decay: 0.75, gain: 0.03 }, "sawtooth", 0, 600);
    this.toneLayer(
      { frequency: base * 1.5, drop: 0.98, decay: 0.7, gain: 0.018 },
      "sawtooth",
      0.02,
      600,
    );
  }

  /** A contactor dropping out: a hard clack with a ring after it. */
  private relay(): void {
    this.noiseLayer({ frequency: 1800, decay: 0.035, gain: 0.07 }, "bandpass", 1.4, 0);
    this.noiseLayer({ frequency: 3400, decay: 0.02, gain: 0.04 }, "highpass", 1, 0.006);
    this.toneLayer({ frequency: 320, drop: 0.7, decay: 0.2, gain: 0.02 }, "triangle", 0.01);
  }

  /** Current finding a path it should not have: a rasp that cuts out. */
  private electricBuzz(): void {
    const length = 0.25 + Math.random() * 0.7;
    this.toneLayer({ frequency: 100, drop: 1, decay: length, gain: 0.028 }, "sawtooth", 0, 2600);
    this.noiseLayer({ frequency: 4200, decay: length, gain: 0.02 }, "bandpass", 0.8, 0.01);
  }

  /** A gust: the wind rising out of its lull and dying back into it. */
  private gust(): void {
    const gain = this.gustGain;
    const context = this.context;
    if (!gain || !context) return;
    const now = context.currentTime;
    const peak = this.windPeak * (0.55 + Math.random() * 0.45);
    const rise = 1.1 + Math.random() * 1.8;
    const fall = 2.2 + Math.random() * 3.5;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(this.windLull, now);
    gain.gain.linearRampToValueAtTime(peak, now + rise);
    gain.gain.linearRampToValueAtTime(this.windLull, now + rise + fall);
  }

  /** Water finding its way through a floor it used to run under. */
  private drip(): void {
    const drops = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < drops; i += 1) {
      const at = i * (0.3 + Math.random() * 0.5);
      this.chirp(1500 + Math.random() * 900, 520, 0.09, 0.03, "sine", at);
    }
  }

  /* ------------------------------------------------------------------ *
   * Weapons.
   * ------------------------------------------------------------------ */

  /**
   * A shot from this player's own weapon.
   *
   * Every layer is detuned a little on each shot. Without that, a burst is
   * one recording played back thirteen times a second, which is the single
   * clearest way a game gives away that its guns are synthetic.
   */
  shot(id: WeaponId): void {
    const context = this.context;
    if (!context || !this.enabled) return;
    const voice = VOICES[id];
    const wobble = (): number => 1 + (Math.random() * 2 - 1) * voice.jitter;
    const level = voice.gain * (0.94 + Math.random() * 0.12);

    this.noiseLayer(
      {
        frequency: voice.snap.frequency * wobble(),
        decay: voice.snap.decay,
        gain: voice.snap.gain * level,
      },
      "highpass",
      1,
      0,
    );
    this.noiseLayer(
      {
        frequency: voice.crack.frequency * wobble(),
        decay: voice.crack.decay,
        gain: voice.crack.gain * level,
      },
      "bandpass",
      voice.crack.q,
      0.001,
    );
    this.toneLayer(
      {
        frequency: voice.body.frequency * wobble(),
        drop: voice.body.drop,
        decay: voice.body.decay,
        gain: voice.body.gain * level,
      },
      "sine",
      0,
    );
    this.noiseLayer(
      {
        frequency: voice.blast.frequency * wobble(),
        decay: voice.blast.decay,
        gain: voice.blast.gain * level,
      },
      "lowpass",
      1,
      0,
    );
    this.noiseLayer(
      {
        frequency: voice.mech.frequency * wobble(),
        decay: voice.mech.decay,
        gain: voice.mech.gain * level,
      },
      "bandpass",
      voice.mech.q,
      voice.mech.delay,
    );
    // The room, brought up a moment behind the shot rather than struck with
    // it, which is what puts walls at a distance.
    this.noiseLayer(
      { frequency: voice.tail.frequency, decay: voice.tail.decay, gain: voice.tail.gain * level },
      "lowpass",
      1,
      0.012,
      0.02,
    );
  }

  /**
   * Someone else's weapon. Quieter and duller with distance, which is what
   * lets a player judge how far away a firefight is.
   *
   * Air eats the top of a shot first, so distance is mostly the loss of the
   * crack: what is left at a hundred metres is the body and the room.
   */
  remoteShot(id: WeaponId, distance: number): void {
    const context = this.context;
    if (!context || !this.enabled) return;
    const voice = VOICES[id];
    // Inverse falloff, floored so a distant shot stays just audible.
    const attenuation = Math.max(0.06, 1 / (1 + distance * 0.09));
    const wobble = 1 + (Math.random() * 2 - 1) * voice.jitter;
    const level = voice.gain * attenuation;

    this.noiseLayer(
      {
        frequency: Math.max(420, voice.crack.frequency * attenuation * 1.6 * wobble),
        decay: voice.crack.decay * 1.6,
        gain: voice.crack.gain * level * 0.9,
      },
      "lowpass",
      1,
      0,
    );
    this.toneLayer(
      {
        frequency: voice.body.frequency * wobble,
        drop: voice.body.drop,
        decay: voice.body.decay * 1.5,
        // Low end carries, so the thump falls away more slowly than the crack.
        gain: voice.body.gain * voice.gain * Math.max(0.1, Math.sqrt(attenuation)) * 0.7,
      },
      "sine",
      0,
    );
    this.noiseLayer(
      {
        frequency: Math.max(300, voice.tail.frequency * attenuation),
        decay: voice.tail.decay * 1.8,
        gain: voice.tail.gain * level * 1.4,
      },
      "lowpass",
      1,
      0.02,
      0.03,
    );
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
    // The material it went into, under the spall.
    this.noiseLayer({ frequency: 480, decay: 0.09, gain: 0.07 * attenuation }, "lowpass", 1, 0.004);
  }

  /**
   * A boot going down.
   *
   * `weight` runs from a crouched creep to a sprint. The scuff on top is
   * what stops it sounding like a drum: a step is grit moving, then the
   * floor taking the load.
   */
  footstep(weight: number): void {
    const level = Math.max(0.15, Math.min(1.6, weight));
    this.noiseLayer(
      { frequency: 260 + Math.random() * 120, decay: 0.075, gain: 0.075 * level },
      "lowpass",
      1,
      0,
    );
    this.noiseLayer(
      { frequency: 3200 + Math.random() * 1800, decay: 0.035, gain: 0.02 * level },
      "bandpass",
      1.6,
      0.008,
    );
  }

  /** Coming down off something. `force` runs from a hop to a long drop. */
  land(force: number): void {
    const level = Math.max(0.2, Math.min(1, force));
    this.toneLayer({ frequency: 90, drop: 0.5, decay: 0.16, gain: 0.22 * level }, "sine", 0);
    this.noiseLayer({ frequency: 420, decay: 0.12, gain: 0.12 * level }, "lowpass", 1, 0);
    this.noiseLayer(
      { frequency: 2600, decay: 0.05, gain: 0.05 * level },
      "bandpass",
      1.4,
      0.012,
    );
  }

  /**
   * The hit confirmed.
   *
   * Three sounds a player learns to tell apart without looking: a hit is a
   * short falling chirp with a click on the front; a headshot the same,
   * higher and doubled; a kill has weight under it, a thump and a rising
   * chime, so a kill in the middle of a burst is felt as well as seen.
   */
  hitMarker(headshot: boolean, killed = false): void {
    if (killed) {
      this.tick(900, 0.05, 0.3, "bandpass");
      this.chirp(180, 70, 0.16, 0.5, "sine");
      this.chirp(1400, 2400, 0.12, 0.28, "triangle", 0.04);
      this.chirp(2100, 2600, 0.16, 0.16, "sine", 0.1);
      return;
    }
    if (headshot) {
      this.tick(2400, 0.03, 0.22, "bandpass");
      this.chirp(2600, 1900, 0.05, 0.3, "triangle");
      this.chirp(2900, 2300, 0.06, 0.24, "triangle", 0.05);
      return;
    }
    this.tick(1500, 0.03, 0.22, "bandpass");
    this.chirp(1700, 1150, 0.06, 0.3, "triangle");
  }

  /** A plate going over. */
  targetDrop(): void {
    this.tick(420, 0.26, 0.34, "lowpass");
  }

  /* ------------------------------------------------------------------ *
   * The three ways a sound gets made.
   * ------------------------------------------------------------------ */

  /** A short pitched note sliding from one frequency to another. */
  private chirp(
    from: number,
    to: number,
    decay: number,
    gain: number,
    type: OscillatorType,
    delay = 0,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;
    const start = context.currentTime + delay;
    const voice = context.createOscillator();
    voice.type = type;
    voice.frequency.setValueAtTime(from, start);
    voice.frequency.exponentialRampToValueAtTime(to, start + decay);
    const amp = context.createGain();
    envelope(amp.gain, start, gain, decay);
    voice.connect(amp).connect(master);
    voice.start(start);
    voice.stop(start + decay + 0.05);
  }

  /**
   * A burst of filtered noise.
   *
   * `attack` is how long the level takes to arrive: zero for anything struck,
   * longer for a room answering back, which never starts at its loudest.
   */
  private noiseLayer(
    layer: NoiseLayer,
    type: BiquadFilterType,
    q: number,
    delay: number,
    attack = 0,
  ): void {
    const context = this.context;
    const master = this.master;
    const noise = this.noise;
    if (!context || !master || !noise || !this.enabled) return;
    if (layer.gain <= 0.0002) return;

    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = noise;
    // Start somewhere random in the buffer, so repeated shots are not the
    // same slice of noise over and over.
    const offset = Math.random() * Math.max(0, noise.duration - layer.decay - 0.1);
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = layer.frequency;
    filter.Q.value = q;
    const amp = context.createGain();
    if (attack > 0) {
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.linearRampToValueAtTime(layer.gain, start + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + attack + layer.decay);
    } else {
      envelope(amp.gain, start, layer.gain, layer.decay);
    }
    source.connect(filter).connect(amp).connect(master);
    source.start(start, offset);
    source.stop(start + attack + layer.decay + 0.05);
  }

  /** A pitched layer falling away, which is where a sound's weight lives. */
  private toneLayer(
    layer: ToneLayer,
    type: OscillatorType,
    delay: number,
    lowpass?: number,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;
    if (layer.gain <= 0.0002) return;

    const start = context.currentTime + delay;
    const voice = context.createOscillator();
    voice.type = type;
    voice.frequency.setValueAtTime(layer.frequency, start);
    if (layer.drop !== 1) {
      voice.frequency.exponentialRampToValueAtTime(
        Math.max(20, layer.frequency * layer.drop),
        start + layer.decay,
      );
    }
    const amp = context.createGain();
    envelope(amp.gain, start, layer.gain, layer.decay);
    if (lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      voice.connect(filter).connect(amp).connect(master);
    } else {
      voice.connect(amp).connect(master);
    }
    voice.start(start);
    voice.stop(start + layer.decay + 0.05);
  }

  private tick(
    frequency: number,
    decay: number,
    gain: number,
    filterType: BiquadFilterType,
  ): void {
    this.noiseLayer({ frequency, decay, gain }, filterType, 1.1, 0);
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
