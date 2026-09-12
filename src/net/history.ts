import { MAX_REWIND_MS } from "./protocol";
import { vec3, type Vec3 } from "../sim/vec3";

export interface HistorySample {
  /** Server clock, in milliseconds. */
  time: number;
  position: Vec3;
  yaw: number;
  /** 0 standing, 1 crouched, so rewound hitboxes match the stance. */
  crouch: number;
  alive: boolean;
}

/**
 * A short rolling record of where each combatant was.
 *
 * Lag compensation is what makes shooting feel honest over a connection: a
 * player fires at what their screen shows, which is already a hundred
 * milliseconds old by the time the server hears about it. Rewinding everyone
 * else to that moment is how the server judges the shot the shooter actually
 * took, rather than the one they would have taken with no latency.
 */
export class PositionHistory {
  private readonly samples: HistorySample[] = [];

  constructor(private readonly windowMs = MAX_REWIND_MS + 200) {}

  get length(): number {
    return this.samples.length;
  }

  record(sample: HistorySample): void {
    this.samples.push(sample);
    const cutoff = sample.time - this.windowMs;
    // Drop from the front rather than filtering: samples arrive in order.
    let drop = 0;
    while (drop < this.samples.length - 1 && this.samples[drop].time < cutoff) drop += 1;
    if (drop > 0) this.samples.splice(0, drop);
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** The newest sample, or null when nothing has been recorded. */
  latest(): HistorySample | null {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  /**
   * Where this combatant was at `time`, interpolated between samples.
   * Times outside the recorded window clamp to its ends rather than failing,
   * so an unusually slow client still gets a sane answer.
   */
  sampleAt(time: number): HistorySample | null {
    if (this.samples.length === 0) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (time <= first.time) return first;
    if (time >= last.time) return last;

    for (let i = this.samples.length - 1; i > 0; i -= 1) {
      const after = this.samples[i];
      const before = this.samples[i - 1];
      if (time < before.time) continue;
      const span = after.time - before.time;
      const t = span > 1e-6 ? (time - before.time) / span : 0;
      return {
        time,
        position: vec3(
          before.position.x + (after.position.x - before.position.x) * t,
          before.position.y + (after.position.y - before.position.y) * t,
          before.position.z + (after.position.z - before.position.z) * t,
        ),
        yaw: lerpAngle(before.yaw, after.yaw, t),
        crouch: before.crouch + (after.crouch - before.crouch) * t,
        // A combatant counts as alive only if they were alive at both ends,
        // so a rewind can never resurrect someone to be shot again.
        alive: before.alive && after.alive,
      };
    }
    return last;
  }
}

/** Interpolate between angles the short way round the circle. */
export const lerpAngle = (from: number, to: number, t: number): number => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
};

/**
 * How far back to rewind for a given client, in milliseconds.
 *
 * Half the round trip puts the server at the moment the input left the client;
 * the interpolation delay accounts for remote players already being drawn in
 * the past on that client's screen. The cap stops a badly lagged player from
 * shooting at where everyone stood a second ago.
 */
export const rewindMillis = (
  roundTripMs: number,
  interpolationDelayMs: number,
  maxRewindMs = MAX_REWIND_MS,
): number => {
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return interpolationDelayMs;
  const total = roundTripMs / 2 + interpolationDelayMs;
  return Math.max(0, Math.min(maxRewindMs, total));
};
