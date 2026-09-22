import { describe, expect, it } from "vitest";
import { RETRO, isLook, presentationFor, scalingLevelFor } from "../src/engine/look";
import { settingsFor } from "../src/engine/quality";

describe("look", () => {
  it("accepts only the two looks", () => {
    expect(isLook("modern")).toBe(true);
    expect(isLook("retro")).toBe(true);
    expect(isLook("n64")).toBe(false);
    expect(isLook(undefined)).toBe(false);
  });

  it("leaves the modern look's tier alone", () => {
    const high = settingsFor("high");
    expect(presentationFor(high, "modern")).toEqual(high);
  });

  it("never gives the retro look a shadow map, on any tier", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(presentationFor(settingsFor(tier), "retro").shadows).toBe(false);
    }
  });

  it("draws the retro look a short way and no further", () => {
    const high = settingsFor("high");
    const retro = presentationFor(high, "retro");
    expect(retro.viewDistance).toBe(RETRO.viewDistance);
    expect(retro.viewDistance).toBeLessThan(high.viewDistance);
    // But still past the backdrop, which stands within a hundred and twenty.
    expect(retro.viewDistance).toBeGreaterThan(120);
  });

  it("keeps the retro look's other tier settings", () => {
    const low = settingsFor("low");
    const retro = presentationFor(low, "retro");
    expect(retro.tier).toBe("low");
    expect(retro.fog).toBe(low.fog);
    expect(retro.antialias).toBe(low.antialias);
  });

  it("renders the modern look at the device's ratio up to the tier's ceiling", () => {
    const high = settingsFor("high");
    // A phone at three times density is held to the tier's one and a half.
    expect(scalingLevelFor("modern", high, 3, 400)).toBeCloseTo(1 / 1.5, 6);
    // A monitor at one is rendered one to one.
    expect(scalingLevelFor("modern", high, 1, 1000)).toBeCloseTo(1, 6);
  });

  it("renders the retro look at the same height however big the screen", () => {
    const high = settingsFor("high");
    const rendered = (css: number, dpr: number): number =>
      (css * dpr) / scalingLevelFor("retro", high, dpr, css);
    // A phone and a monitor both come out at the retro height in device pixels
    // divided by their ratio: the same picture, whatever is drawing it.
    expect(rendered(400, 3) / 3).toBeCloseTo(RETRO.internalHeight, 3);
    expect(rendered(1080, 1)).toBeCloseTo(RETRO.internalHeight, 3);
  });

  it("never renders the retro look sharper than the screen", () => {
    const high = settingsFor("high");
    // A window shorter than the retro height has nothing to stretch, so the
    // level stays at one rather than going below it.
    expect(scalingLevelFor("retro", high, 1, 200)).toBe(1);
  });

  it("costs the retro look a fraction of the modern look's pixels", () => {
    const high = settingsFor("high");
    const modern = 1 / scalingLevelFor("modern", high, 2, 400);
    const retro = 1 / scalingLevelFor("retro", high, 2, 400);
    // Pixels go with the square of the scale.
    expect((retro / modern) ** 2).toBeLessThan(0.3);
  });
});
