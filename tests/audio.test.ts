import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameAudio } from "../src/engine/audio";
import type { WeaponId } from "../src/sim/weapons";

/**
 * The sound, exercised against a stub of the Web Audio API.
 *
 * There is nothing to listen to in a test, so what is checked is the shape of
 * what gets built: that every weapon is given a full voice, that no two of
 * them are the same voice with one number changed, that two shots from one
 * weapon differ, and that a level's ambience stops when the level does. The
 * last one matters most: beds are looping sources, and a leak is a wind that
 * never stops, one layer louder every time a round starts.
 */

interface Recorded {
  kind: "source" | "oscillator";
  frequency: number | null;
  filter: string | null;
  loop: boolean;
  started: boolean;
  stopped: boolean;
}

interface Knob {
  value: number;
  /** Every level this parameter has been asked to ramp to, in order. */
  ramps: number[];
}

interface Harness {
  nodes: Recorded[];
  gains: Knob[];
  timers: Map<number, () => void>;
  runTimers: () => void;
}

let harness: Harness;

const param = (initial = 0): AudioParam & Knob => {
  const self = {
    value: initial,
    ramps: [] as number[],
    setValueAtTime: (value: number) => {
      self.value = value;
      return self;
    },
    linearRampToValueAtTime: (value: number) => {
      self.ramps.push(value);
      return self;
    },
    exponentialRampToValueAtTime: (value: number) => {
      self.ramps.push(value);
      return self;
    },
    cancelScheduledValues: () => self,
  };
  return self as unknown as AudioParam & Knob;
};

const install = (): Harness => {
  const nodes: Recorded[] = [];
  const gains: Knob[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const connectable = <T extends object>(node: T): T =>
    Object.assign(node, {
      connect: (target: unknown) => target,
      disconnect: () => undefined,
    });

  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: () => Promise.resolve(),
    createGain: () => {
      const gain = param(1);
      gains.push(gain);
      return connectable({ gain });
    },
    createBiquadFilter: () => {
      const node = connectable({ type: "", frequency: param(0), Q: param(0) });
      return node;
    },
    createBufferSource: () => {
      const record: Recorded = {
        kind: "source",
        frequency: null,
        filter: null,
        loop: false,
        started: false,
        stopped: false,
      };
      nodes.push(record);
      // Not wrapped: this one keeps its own connect, which records the
      // filter it is routed through. That is what tells one weapon's layers
      // from another's.
      return {
        buffer: null as unknown,
        get loop() {
          return record.loop;
        },
        set loop(value: boolean) {
          record.loop = value;
        },
        start: () => {
          record.started = true;
        },
        stop: () => {
          record.stopped = true;
        },
        disconnect: () => undefined,
        connect: (target: { type?: string; frequency?: { value: number } }) => {
          if (target && typeof target.type === "string" && target.frequency) {
            record.filter = target.type;
            record.frequency = target.frequency.value;
          }
          return target;
        },
      };
    },
    createOscillator: () => {
      const record: Recorded = {
        kind: "oscillator",
        frequency: null,
        filter: null,
        loop: false,
        started: false,
        stopped: false,
      };
      nodes.push(record);
      const frequency = param(0);
      return connectable({
        type: "sine",
        frequency,
        start: () => {
          record.started = true;
          record.frequency = frequency.value;
        },
        stop: () => {
          record.stopped = true;
        },
      });
    },
    createDynamicsCompressor: () =>
      connectable({
        threshold: param(0),
        knee: param(0),
        ratio: param(0),
        attack: param(0),
        release: param(0),
      }),
    createBuffer: (_channels: number, length: number) => ({
      duration: length / 48000,
      getChannelData: () => new Float32Array(length),
    }),
  };

  (globalThis as unknown as { window: unknown }).window = {
    AudioContext: function AudioContextStub() {
      return context;
    },
    setTimeout: (fn: () => void) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };

  return {
    nodes,
    gains,
    timers,
    runTimers: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
};

beforeEach(() => {
  harness = install();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** The sources and oscillators one call created, and nothing from before it. */
const capture = (run: () => void): Recorded[] => {
  const before = harness.nodes.length;
  run();
  return harness.nodes.slice(before);
};

const WEAPONS: WeaponId[] = ["ar", "smg", "shotgun", "pistol"];

describe("weapon voices", () => {
  it("builds every layer of every weapon", () => {
    const audio = new GameAudio();
    audio.start();
    for (const id of WEAPONS) {
      const layers = capture(() => audio.shot(id));
      // Snap, crack, blast, mechanism and tail are noise; the body is a tone.
      expect(layers.filter((node) => node.kind === "source").length, id).toBe(5);
      expect(layers.filter((node) => node.kind === "oscillator").length, id).toBe(1);
      expect(layers.every((node) => node.started && node.stopped), id).toBe(true);
    }
  });

  it("gives no two weapons the same voice", () => {
    const audio = new GameAudio();
    audio.start();
    const signatures = WEAPONS.map((id) => {
      const layers = capture(() => audio.shot(id));
      return layers
        .map((node) => `${node.kind}:${node.filter}:${Math.round((node.frequency ?? 0) / 25)}`)
        .join("|");
    });
    expect(new Set(signatures).size).toBe(WEAPONS.length);
  });

  it("does not play one weapon's shot twice in a row", () => {
    const audio = new GameAudio();
    audio.start();
    const first = capture(() => audio.shot("ar")).map((node) => node.frequency);
    const second = capture(() => audio.shot("ar")).map((node) => node.frequency);
    expect(first).not.toEqual(second);
  });

  it("carries the weapon's character into a distant shot", () => {
    const audio = new GameAudio();
    audio.start();
    const near = capture(() => audio.remoteShot("shotgun", 5));
    const far = capture(() => audio.remoteShot("shotgun", 80));
    const brightest = (layers: Recorded[]): number =>
      Math.max(...layers.map((node) => node.frequency ?? 0));
    // Air eats the top of a shot first, so distance reads as dullness.
    expect(brightest(far)).toBeLessThan(brightest(near));
  });

  it("stays silent when the player has turned the sound off", () => {
    const audio = new GameAudio();
    audio.start();
    audio.setEnabled(false);
    expect(capture(() => audio.shot("ar"))).toHaveLength(0);
    expect(capture(() => audio.footstep(1))).toHaveLength(0);
  });
});

describe("footsteps", () => {
  /*
   * One burst of filtered noise is a click, not a foot. What makes a step
   * read as a step is that it is several things at slightly different times:
   * a heel, the floor under it, the mass behind it, grit, and the ball of
   * the foot a moment later.
   */
  it("is built from more than one layer", () => {
    const audio = new GameAudio();
    audio.start();
    expect(capture(() => audio.footstep(1)).length).toBeGreaterThanOrEqual(4);
  });

  it("puts weight under a boot going down and none under a creep", () => {
    const audio = new GameAudio();
    audio.start();
    const hasBody = (weight: number) =>
      capture(() => audio.footstep(weight)).some(
        (node) => node.kind === "oscillator" && (node.frequency ?? 0) < 130,
      );
    expect(hasBody(1.35)).toBe(true);
    expect(hasBody(0.2)).toBe(false);
  });

  it("never plays the same step twice", () => {
    const audio = new GameAudio();
    audio.start();
    const signature = () =>
      capture(() => audio.footstep(1))
        .map((node) => Math.round(node.frequency ?? 0))
        .join(",");
    const steps = new Set([signature(), signature(), signature(), signature()]);
    // Four steps in a row that are all different is what stops a walk in a
    // straight line sounding like a metronome.
    expect(steps.size).toBe(4);
  });
});

describe("ambience", () => {
  it("lays down beds that loop", () => {
    const audio = new GameAudio();
    audio.setAmbience("ruin");
    const beds = capture(() => audio.start());
    const looping = beds.filter((node) => node.loop);
    expect(looping.length).toBeGreaterThanOrEqual(2);
    expect(looping.every((node) => node.started)).toBe(true);
  });

  it("gives a switchyard its mains hum and a ruin none", () => {
    const yard = new GameAudio();
    yard.setAmbience("substation");
    const withHum = capture(() => yard.start()).filter((node) => node.kind === "oscillator");

    harness = install();
    const ruin = new GameAudio();
    ruin.setAmbience("ruin");
    const withoutHum = capture(() => ruin.start()).filter((node) => node.kind === "oscillator");

    // Both have the drifts that keep the wind from sitting still; only the
    // switchyard has anything still drawing current.
    expect(withHum.length).toBeGreaterThan(withoutHum.length);
  });

  it("stops every bed and every timer when the level ends", () => {
    const audio = new GameAudio();
    audio.setAmbience("ruin");
    const beds = capture(() => audio.start());
    // One clock for the one-off sounds, one for the gusts.
    expect(harness.timers.size).toBe(2);

    audio.stopAmbience();
    expect(beds.every((node) => node.stopped)).toBe(true);
    expect(harness.timers.size).toBe(0);
  });

  it("does not stack a second level's beds on the first", () => {
    const audio = new GameAudio();
    audio.setAmbience("ruin");
    const first = capture(() => audio.start());
    audio.setAmbience("substation");
    expect(first.every((node) => node.stopped)).toBe(true);
  });

  it("keeps the one-off sounds coming", () => {
    const audio = new GameAudio();
    audio.setAmbience("ruin");
    audio.start();
    // A gust is a swell of the wind that is already playing and builds
    // nothing new, so this counts across several firings rather than
    // demanding a sound from each one.
    let built = 0;
    for (let i = 0; i < 10; i += 1) {
      built += capture(() => harness.runTimers()).length;
      // Each firing queues the next one rather than falling silent.
      expect(harness.timers.size, `after firing ${i + 1}`).toBe(2);
    }
    expect(built).toBeGreaterThan(0);
  });

  it("keeps the wind in a lull and only lets it up in gusts", () => {
    const audio = new GameAudio();
    audio.start();
    // Only the levels the ambience itself sets, not the master it hangs off.
    const from = harness.gains.length;
    audio.setAmbience("ruin");
    const beds = harness.gains.slice(from);

    harness.runTimers();
    // The wind is the one level that gets ramped: the gust clock drives it.
    const wind = beds.find((bed) => bed.ramps.length >= 2);
    expect(wind, "nothing gusts").toBeDefined();
    // It rests quiet enough to be missed, rises well clear of that in a
    // gust, and comes back down to it. A bed held at one level is static.
    expect(wind!.value).toBeLessThan(0.02);
    expect(Math.max(...wind!.ramps)).toBeGreaterThan(wind!.value * 3);
    expect(wind!.ramps[wind!.ramps.length - 1]).toBeCloseTo(wind!.value, 6);
  });

  it("queues nothing once the level is gone", () => {
    const audio = new GameAudio();
    audio.setAmbience("ruin");
    audio.start();
    audio.stopAmbience();
    expect(capture(() => harness.runTimers())).toHaveLength(0);
    expect(harness.timers.size).toBe(0);
  });
});
