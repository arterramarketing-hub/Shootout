import type { ZombieState } from "../sim/zombies";
import type { Vec3 } from "../sim/vec3";

/**
 * The sounds the dead make, synthesised like everything else.
 *
 * A voice is a buzz at the pitch of a throat, pushed through three band-pass
 * filters at the resonances of a vowel -- the same trick a speech
 * synthesiser uses, and the reason these read as something breathing rather
 * than as a synth pad. A slow wobble in the pitch and a fast flutter in the
 * level give it the rasp of a throat that no longer works properly, and a
 * breath of noise through the same vowel fills in what a buzz leaves out.
 *
 * Everything that happens at a place is placed: panned by where it is
 * relative to where the survivor is facing, quieter with distance, and
 * duller with it too, because the mist and the city eat the top end first.
 * A moan from behind is a warning, and that only works if it sounds behind.
 */

/** Three vowel resonances, in hertz. */
export type Vowel = readonly [number, number, number];

/** "uh", "ah", "oh" and "aw": the open, slack vowels of a jaw hanging loose. */
export const VOWELS: readonly Vowel[] = [
  [600, 1100, 2450],
  [760, 1220, 2600],
  [470, 830, 2500],
  [640, 950, 2400],
];

/** A shriek's vowel: "ee", thin and high. */
const SHRIEK: Vowel = [320, 2350, 3050];

export interface Utterance {
  /** Starting pitch of the throat, in hertz. */
  pitch: number;
  /** Where it ends up. */
  pitchEnd: number;
  duration: number;
  formants: Vowel;
  /** Nought to one: how much the level flutters, which is the rasp. */
  rasp: number;
  gain: number;
  /** Seconds to swell in. */
  attack: number;
  /** Seconds from now. */
  delay?: number;
}

/**
 * One utterance: a moan, a snarl, a shriek or a death rattle, depending on
 * the numbers. Plays into `destination` and cleans up after itself.
 */
export const speak = (
  context: AudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  voice: Utterance,
): void => {
  const start = context.currentTime + (voice.delay ?? 0);
  const end = start + voice.duration;

  const throat = context.createOscillator();
  throat.type = "sawtooth";
  throat.frequency.setValueAtTime(voice.pitch, start);
  throat.frequency.linearRampToValueAtTime(
    (voice.pitch + voice.pitchEnd) / 2 + voice.pitch * 0.06,
    start + voice.duration * 0.35,
  );
  throat.frequency.exponentialRampToValueAtTime(Math.max(20, voice.pitchEnd), end);

  // A slow, uneven wobble in the pitch.
  const wobble = context.createOscillator();
  wobble.frequency.value = 4 + Math.random() * 3;
  const wobbleDepth = context.createGain();
  wobbleDepth.gain.value = voice.pitch * 0.035;
  wobble.connect(wobbleDepth).connect(throat.frequency);

  // Breath, through the same vowel.
  const breath = context.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const breathLevel = context.createGain();
  breathLevel.gain.value = 0.35;

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.linearRampToValueAtTime(voice.gain, start + Math.max(0.01, voice.attack));
  envelope.gain.setValueAtTime(voice.gain, Math.max(start + voice.attack, end - voice.duration * 0.35));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  // The flutter: the level chopped at a rate too fast to hear as a rhythm.
  const flutter = context.createGain();
  flutter.gain.value = 1 - voice.rasp * 0.5;
  const flutterRate = context.createOscillator();
  flutterRate.type = "square";
  flutterRate.frequency.value = 26 + Math.random() * 18;
  const flutterDepth = context.createGain();
  flutterDepth.gain.value = voice.rasp * 0.5;
  flutterRate.connect(flutterDepth).connect(flutter.gain);

  const mix = context.createGain();
  mix.gain.value = 1;
  throat.connect(mix);
  breath.connect(breathLevel).connect(mix);
  const weights = [1, 0.55, 0.22];
  voice.formants.forEach((frequency, index) => {
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = frequency * (0.96 + Math.random() * 0.08);
    band.Q.value = 7 + index * 2;
    const weight = context.createGain();
    weight.gain.value = weights[index] * 2.2;
    mix.connect(band).connect(weight).connect(envelope);
  });
  envelope.connect(flutter).connect(destination);

  const offset = Math.random() * Math.max(0, noise.duration - voice.duration - 0.1);
  for (const node of [throat, wobble, flutterRate]) {
    node.start(start);
    node.stop(end + 0.05);
  }
  breath.start(start, offset);
  breath.stop(end + 0.05);
  throat.onended = () => {
    for (const node of [throat, wobble, flutterRate, breath, mix, envelope, flutter]) {
      node.disconnect();
    }
  };
};

/** The survivor's ears: where they are and which way they face. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** How a sound at a place reaches the listener. */
export interface Placement {
  /** -1 left to 1 right. */
  pan: number;
  /** Nought to one. */
  level: number;
  /** Low-pass cutoff, in hertz. */
  cutoff: number;
  distance: number;
}

/**
 * Pan, level and muffling for a sound at `at`.
 *
 * Right of the listener is `(cos yaw, -sin yaw)` when forward is
 * `(sin yaw, cos yaw)`. Behind is a little duller than in front, which is
 * most of what a head does to a sound and all that stereo can carry.
 */
export const placeSound = (listener: Listener, at: Vec3): Placement => {
  const dx = at.x - listener.x;
  const dz = at.z - listener.z;
  const distance = Math.hypot(dx, dz, at.y - listener.y);
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-3) return { pan: 0, level: 1, cutoff: 9000, distance };
  const right = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / flat;
  const ahead = (dx * Math.sin(listener.yaw) + dz * Math.cos(listener.yaw)) / flat;
  const level = 1 / (1 + distance * 0.11);
  const behind = Math.max(0, -ahead);
  const cutoff = Math.max(450, 9000 / (1 + distance * 0.09)) * (1 - behind * 0.35);
  return { pan: Math.max(-1, Math.min(1, right)) * 0.85, level, cutoff, distance };
};

/** How far a zombie can be and still be heard moaning, in metres. */
const HEARING = 42;
/** At most this many voices at once, however many are coming. */
const MAX_VOICES = 6;

interface Tracked {
  /** Seconds until it next makes a noise. */
  voiceIn: number;
  /** Seconds until its next footfall. */
  stepIn: number;
}

/**
 * Everything the horde sounds like.
 *
 * Moans and footfalls are scheduled here from the zombies' own state; the
 * rest is called from the game as things happen to them.
 */
export class ZombieVoices {
  private readonly tracked = new Map<string, Tracked>();
  private voices = 0;
  private listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    private readonly bus: () => { context: AudioContext; output: AudioNode; noise: AudioBuffer } | null,
  ) {}

  /** Forget everyone: a new run. */
  reset(): void {
    this.tracked.clear();
  }

  /**
   * The ambient part: every zombie in earshot moans now and then, and the
   * nearest few are heard dragging their feet.
   */
  update(listener: Listener, zombies: readonly ZombieState[], dt: number): void {
    this.listener = listener;
    const seen = new Set<string>();
    let steppers = 0;
    // Nearest first, so the few footfalls that are played are the ones that matter.
    const ordered = zombies
      .filter((zombie) => !zombie.dead)
      .map((zombie) => ({ zombie, placement: placeSound(listener, zombie.position) }))
      .sort((a, b) => a.placement.distance - b.placement.distance);
    for (const { zombie, placement } of ordered) {
      seen.add(zombie.id);
      let entry = this.tracked.get(zombie.id);
      if (!entry) {
        entry = { voiceIn: 0.4 + Math.random() * 2.5, stepIn: Math.random() * 0.5 };
        this.tracked.set(zombie.id, entry);
      }
      entry.voiceIn -= dt;
      if (entry.voiceIn <= 0) {
        entry.voiceIn = zombie.runner ? 1.6 + Math.random() * 2.2 : 3.2 + Math.random() * 5.5;
        if (placement.distance < HEARING) this.moan(zombie, placement);
      }
      const moving = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.3;
      if (moving && placement.distance < 11 && steppers < 4) {
        steppers += 1;
        entry.stepIn -= dt;
        if (entry.stepIn <= 0) {
          entry.stepIn = zombie.runner ? 0.28 : 0.55 + Math.random() * 0.12;
          this.footfall(zombie.runner, placement);
        }
      }
    }
    for (const id of [...this.tracked.keys()]) if (!seen.has(id)) this.tracked.delete(id);
  }

  /** A zombie has come in. Runners announce themselves. */
  spawn(zombie: ZombieState): void {
    if (!zombie.runner) return;
    this.shriek(placeSound(this.listener, zombie.position), 0.9);
  }

  /** A swing starting: a snarl, then the arm coming round. */
  swing(zombie: ZombieState): void {
    const placement = placeSound(this.listener, zombie.position);
    this.utter(placement, {
      pitch: 150 + Math.random() * 40,
      pitchEnd: 210 + Math.random() * 40,
      duration: 0.42,
      formants: VOWELS[1],
      rasp: 0.9,
      gain: 0.2,
      attack: 0.05,
    });
    this.noise(placement, { type: "bandpass", frequency: 900, q: 1.2, sweepTo: 2200, decay: 0.2, gain: 0.12, delay: 0.3 });
  }

  /** The blow landing on the survivor: weight, and nails. */
  strike(from: Vec3): void {
    const placement = placeSound(this.listener, from);
    const near = { ...placement, level: 1, cutoff: 8000 };
    this.tone(near, { frequency: 72, drop: 0.5, decay: 0.2, gain: 0.5 });
    this.noise(near, { type: "lowpass", frequency: 650, q: 1, decay: 0.12, gain: 0.35 });
    this.noise(near, { type: "highpass", frequency: 3200, q: 0.8, sweepTo: 2000, decay: 0.09, gain: 0.12, delay: 0.015 });
  }

  /** A round going into one of them. */
  flesh(at: Vec3, headshot: boolean): void {
    const placement = placeSound(this.listener, at);
    this.tone(placement, { frequency: headshot ? 150 : 110, drop: 0.55, decay: 0.07, gain: 0.3 });
    this.noise(placement, { type: "lowpass", frequency: 420, q: 1, decay: 0.08, gain: 0.3 });
    // The wet part: a band sliding down.
    this.noise(placement, { type: "bandpass", frequency: 1400, q: 3, sweepTo: 500, decay: 0.1, gain: 0.14, delay: 0.01 });
    if (headshot) {
      this.noise(placement, { type: "highpass", frequency: 2800, q: 1, decay: 0.04, gain: 0.2 });
    }
  }

  /** The last noise it makes: a rattle falling away, or cut off by a headshot. */
  death(zombie: ZombieState, headshot: boolean): void {
    const placement = placeSound(this.listener, zombie.position);
    if (headshot) {
      this.utter(placement, {
        pitch: 170,
        pitchEnd: 120,
        duration: 0.22,
        formants: VOWELS[1],
        rasp: 0.6,
        gain: 0.16,
        attack: 0.02,
      });
      return;
    }
    this.utter(placement, {
      pitch: zombie.runner ? 150 : 115,
      pitchEnd: 48,
      duration: 0.9 + Math.random() * 0.4,
      formants: VOWELS[Math.floor(Math.random() * VOWELS.length)],
      rasp: 1,
      gain: 0.2,
      attack: 0.03,
    });
  }

  /** A body hitting the ground, as hard as it hit it. */
  land(zombie: ZombieState, impact: number): void {
    const placement = placeSound(this.listener, zombie.position);
    const force = Math.max(0.25, Math.min(1, impact / 7));
    this.tone(placement, { frequency: 58, drop: 0.6, decay: 0.22, gain: 0.5 * force });
    this.noise(placement, { type: "lowpass", frequency: 320, q: 1, decay: 0.2, gain: 0.34 * force });
    this.noise(placement, { type: "bandpass", frequency: 2200, q: 1.5, decay: 0.06, gain: 0.06 * force, delay: 0.03 });
  }

  /** Ammunition falling out onto the ground. */
  drop(at: Vec3): void {
    const placement = placeSound(this.listener, at);
    for (let i = 0; i < 3; i += 1) {
      this.tone(placement, {
        frequency: 2400 + Math.random() * 1600,
        drop: 0.9,
        decay: 0.05,
        gain: 0.05,
        delay: 0.05 + i * (0.05 + Math.random() * 0.04),
      });
    }
  }

  /** Taking it: rounds going into pouches, and a click. */
  pickup(): void {
    const here = { pan: 0, level: 1, cutoff: 9000, distance: 0 };
    this.noise(here, { type: "bandpass", frequency: 3000, q: 2, decay: 0.03, gain: 0.25 });
    this.tone(here, { frequency: 1500, drop: 1.4, decay: 0.08, gain: 0.12, type: "triangle", delay: 0.03 });
    for (let i = 0; i < 4; i += 1) {
      this.tone(here, {
        frequency: 2600 + Math.random() * 1400,
        drop: 0.92,
        decay: 0.04,
        gain: 0.06,
        delay: 0.08 + i * 0.045,
      });
    }
  }

  /** A wave coming: the whole city answering, from every side. */
  waveStart(wave: number): void {
    const voices = Math.min(7, 3 + wave);
    for (let i = 0; i < voices; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 25 + Math.random() * 20;
      const at = {
        x: this.listener.x + Math.sin(angle) * distance,
        y: this.listener.y,
        z: this.listener.z + Math.cos(angle) * distance,
      };
      const placement = placeSound(this.listener, at);
      const vowel = VOWELS[i % VOWELS.length];
      this.utter(placement, {
        pitch: 65 + Math.random() * 45,
        pitchEnd: 50 + Math.random() * 20,
        duration: 1.6 + Math.random() * 1.3,
        formants: vowel,
        rasp: 0.5,
        gain: 0.22,
        attack: 0.4,
        delay: Math.random() * 1.6,
      }, true);
    }
  }

  /** The last of a wave down: the city goes quiet, and something low settles. */
  waveCleared(): void {
    const here = { pan: 0, level: 1, cutoff: 3000, distance: 0 };
    this.tone(here, { frequency: 110, drop: 0.98, decay: 1.4, gain: 0.07, type: "triangle" });
    this.tone(here, { frequency: 165, drop: 0.98, decay: 1.6, gain: 0.05, type: "triangle", delay: 0.12 });
  }

  private moan(zombie: ZombieState, placement: Placement): void {
    if (zombie.runner) {
      // Runners pant and snarl rather than moan.
      this.utter(placement, {
        pitch: 190 + Math.random() * 60,
        pitchEnd: 160,
        duration: 0.35 + Math.random() * 0.25,
        formants: VOWELS[1],
        rasp: 0.8,
        gain: 0.16,
        attack: 0.03,
      });
      return;
    }
    this.utter(placement, {
      pitch: 72 + Math.random() * 40,
      pitchEnd: 55 + Math.random() * 18,
      duration: 1 + Math.random() * 1.3,
      formants: VOWELS[Math.floor(Math.random() * VOWELS.length)],
      rasp: 0.35 + Math.random() * 0.4,
      gain: 0.2,
      attack: 0.2 + Math.random() * 0.2,
    });
  }

  private shriek(placement: Placement, gain: number): void {
    this.utter(placement, {
      pitch: 420 + Math.random() * 80,
      pitchEnd: 300,
      duration: 0.75,
      formants: SHRIEK,
      rasp: 0.7,
      gain: 0.22 * gain,
      attack: 0.04,
    }, true);
  }

  private footfall(runner: boolean, placement: Placement): void {
    // A dragged foot: a scrape, then the weight coming down on it.
    this.noise(placement, {
      type: "bandpass",
      frequency: 900 + Math.random() * 500,
      q: 1.2,
      decay: runner ? 0.05 : 0.14,
      gain: runner ? 0.05 : 0.06,
    });
    this.noise(placement, {
      type: "lowpass",
      frequency: 260,
      q: 1,
      decay: 0.08,
      gain: runner ? 0.12 : 0.08,
      delay: runner ? 0.01 : 0.09,
    });
  }

  /** A voice through the placement's panner and muffle, within the cap. */
  private utter(placement: Placement, voice: Utterance, force = false): void {
    const bus = this.bus();
    if (!bus) return;
    if (!force && this.voices >= MAX_VOICES) return;
    const route = this.chain(bus.context, bus.output, placement);
    this.voices += 1;
    speak(bus.context, route.input, bus.noise, { ...voice, gain: voice.gain * placement.level });
    window.setTimeout(
      () => {
        this.voices = Math.max(0, this.voices - 1);
        route.release();
      },
      ((voice.delay ?? 0) + voice.duration + 0.2) * 1000,
    );
  }

  private noise(
    placement: Placement,
    layer: {
      type: BiquadFilterType;
      frequency: number;
      q: number;
      decay: number;
      gain: number;
      sweepTo?: number;
      delay?: number;
    },
  ): void {
    const bus = this.bus();
    if (!bus) return;
    const { context } = bus;
    const route = this.chain(context, bus.output, placement);
    const start = context.currentTime + (layer.delay ?? 0);
    const source = context.createBufferSource();
    source.buffer = bus.noise;
    const filter = context.createBiquadFilter();
    filter.type = layer.type;
    filter.frequency.setValueAtTime(layer.frequency, start);
    if (layer.sweepTo) filter.frequency.exponentialRampToValueAtTime(layer.sweepTo, start + layer.decay);
    filter.Q.value = layer.q;
    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(layer.gain * placement.level, start + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + layer.decay);
    source.connect(filter).connect(amp).connect(route.input);
    source.start(start, Math.random() * Math.max(0, bus.noise.duration - layer.decay - 0.1));
    source.stop(start + layer.decay + 0.05);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      amp.disconnect();
      route.release();
    };
  }

  private tone(
    placement: Placement,
    layer: {
      frequency: number;
      drop: number;
      decay: number;
      gain: number;
      type?: OscillatorType;
      delay?: number;
    },
  ): void {
    const bus = this.bus();
    if (!bus) return;
    const { context } = bus;
    const route = this.chain(context, bus.output, placement);
    const start = context.currentTime + (layer.delay ?? 0);
    const voice = context.createOscillator();
    voice.type = layer.type ?? "sine";
    voice.frequency.setValueAtTime(layer.frequency, start);
    voice.frequency.exponentialRampToValueAtTime(Math.max(20, layer.frequency * layer.drop), start + layer.decay);
    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.linearRampToValueAtTime(layer.gain * placement.level, start + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + layer.decay);
    voice.connect(amp).connect(route.input);
    voice.start(start);
    voice.stop(start + layer.decay + 0.05);
    voice.onended = () => {
      voice.disconnect();
      amp.disconnect();
      route.release();
    };
  }

  /** Muffle, then pan: the path every placed sound takes to the output. */
  private chain(
    context: AudioContext,
    output: AudioNode,
    placement: Placement,
  ): { input: AudioNode; release: () => void } {
    const muffle = context.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = placement.cutoff;
    const pan = context.createStereoPanner();
    pan.pan.value = placement.pan;
    muffle.connect(pan).connect(output);
    return {
      input: muffle,
      release: () => {
        muffle.disconnect();
        pan.disconnect();
      },
    };
  }
}
