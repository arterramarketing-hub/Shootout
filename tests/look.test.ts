import { describe, expect, it } from "vitest";
import { CAMERA, LOOK } from "../src/sim/config";
import { applyLookDelta, createLook, defaultLookSettings } from "../src/sim/look";

describe("applyLookDelta", () => {
  it("turns right for a rightward drag", () => {
    const look = createLook();
    applyLookDelta(look, 100, 0, defaultLookSettings(), "touch");
    expect(look.yaw).toBeGreaterThan(0);
    expect(look.yaw).toBeCloseTo(100 * LOOK.baseSensitivity, 6);
  });

  it("clamps pitch so the view cannot flip over", () => {
    const look = createLook();
    const settings = defaultLookSettings();
    applyLookDelta(look, 0, 100000, settings, "touch");
    expect(look.pitch).toBeCloseTo(CAMERA.maxPitchRadians, 6);
    applyLookDelta(look, 0, -200000, settings, "touch");
    expect(look.pitch).toBeCloseTo(-CAMERA.maxPitchRadians, 6);
  });

  it("honours inverted pitch", () => {
    const normal = createLook();
    const inverted = createLook();
    applyLookDelta(normal, 0, 50, { ...defaultLookSettings(), invertY: false }, "touch");
    applyLookDelta(inverted, 0, 50, { ...defaultLookSettings(), invertY: true }, "touch");
    expect(Math.sign(normal.pitch)).toBe(-Math.sign(inverted.pitch));
  });

  it("slows the look while aiming", () => {
    const hip = createLook();
    const ads = createLook();
    const settings = defaultLookSettings();
    applyLookDelta(hip, 100, 0, settings, "touch", false);
    applyLookDelta(ads, 100, 0, settings, "touch", true);
    expect(Math.abs(ads.yaw)).toBeLessThan(Math.abs(hip.yaw));
    expect(ads.yaw).toBeCloseTo(hip.yaw * LOOK.adsSensitivityScale, 6);
  });

  it("scales by the per-source sensitivity", () => {
    const look = createLook();
    applyLookDelta(look, 100, 0, { ...defaultLookSettings(), touchSensitivity: 2 }, "touch");
    expect(look.yaw).toBeCloseTo(200 * LOOK.baseSensitivity, 6);
  });

  it("keeps yaw bounded over a long session", () => {
    const look = createLook();
    const settings = defaultLookSettings();
    for (let i = 0; i < 5000; i += 1) applyLookDelta(look, 500, 0, settings, "touch");
    expect(Math.abs(look.yaw)).toBeLessThanOrEqual(Math.PI * 2);
  });
});
