import { SIM, tickInterval } from "../sim/config";

export interface FrameTiming {
  /** Real seconds since the previous frame, clamped. */
  delta: number;
  /** Fraction of a tick elapsed, for interpolating render state. */
  alpha: number;
  steps: number;
}

/**
 * Fixed-timestep accumulator. The simulation always advances in equal steps,
 * so physics and gameplay are deterministic and frame-rate independent; the
 * renderer interpolates between the last two states.
 */
export class FixedStepLoop {
  private accumulator = 0;

  constructor(private readonly step = tickInterval) {}

  /** Returns how many simulation steps this frame owes, and the leftover alpha. */
  advance(deltaSeconds: number): FrameTiming {
    // A tab that was backgrounded returns a huge delta; clamp or the sim
    // will try to catch up with hundreds of steps and freeze the page.
    const delta = Math.min(deltaSeconds, this.step * SIM.maxStepsPerFrame);
    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= this.step && steps < SIM.maxStepsPerFrame) {
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps >= SIM.maxStepsPerFrame) this.accumulator = 0;

    return { delta, alpha: this.accumulator / this.step, steps };
  }

  get stepSeconds(): number {
    return this.step;
  }
}

/** Rolling frame-rate meter for the debug readout. */
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  value = 0;

  update(deltaSeconds: number): void {
    this.frames += 1;
    this.elapsed += deltaSeconds;
    if (this.elapsed >= 0.5) {
      this.value = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
  }
}
