import { describe, expect, it } from "vitest";
import { FixedStepLoop, FpsMeter } from "../src/engine/loop";
import { SIM, tickInterval } from "../src/sim/config";

describe("FixedStepLoop", () => {
  it("runs one step per tick at the target rate", () => {
    const loop = new FixedStepLoop();
    expect(loop.advance(tickInterval).steps).toBe(1);
  });

  it("accumulates fractional frames into whole steps", () => {
    const loop = new FixedStepLoop();
    const half = tickInterval / 2;
    expect(loop.advance(half).steps).toBe(0);
    expect(loop.advance(half).steps).toBe(1);
  });

  it("reports alpha for interpolation", () => {
    const loop = new FixedStepLoop();
    const timing = loop.advance(tickInterval * 1.5);
    expect(timing.steps).toBe(1);
    expect(timing.alpha).toBeCloseTo(0.5, 5);
  });

  it("caps catch-up after a long stall", () => {
    const loop = new FixedStepLoop();
    const timing = loop.advance(10);
    expect(timing.steps).toBeLessThanOrEqual(SIM.maxStepsPerFrame);
  });

  it("does not spiral after a stall", () => {
    const loop = new FixedStepLoop();
    loop.advance(10);
    expect(loop.advance(tickInterval).steps).toBe(1);
  });

  it("keeps simulated time close to real time at an odd frame rate", () => {
    const loop = new FixedStepLoop();
    const frameTime = 1 / 47;
    let steps = 0;
    for (let i = 0; i < 470; i += 1) steps += loop.advance(frameTime).steps;
    // 10 seconds of real time should be about 600 simulation steps.
    expect(steps).toBeGreaterThan(590);
    expect(steps).toBeLessThan(610);
  });
});

describe("FpsMeter", () => {
  it("reports the average over its window", () => {
    const meter = new FpsMeter();
    for (let i = 0; i < 60; i += 1) meter.update(1 / 60);
    expect(meter.value).toBeGreaterThan(55);
    expect(meter.value).toBeLessThan(65);
  });

  it("starts at zero before the first window closes", () => {
    const meter = new FpsMeter();
    meter.update(1 / 60);
    expect(meter.value).toBe(0);
  });
});
