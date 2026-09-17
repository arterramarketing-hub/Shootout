import { describe, expect, it } from "vitest";
import { mergeBrushes } from "../src/maps/merge";
import type { BoxBrush } from "../src/maps/types";

const beam = (z: number, depth: number, extra: Partial<BoxBrush> = {}): BoxBrush => ({
  kind: "frame",
  x: 14,
  y: 3.73,
  z,
  width: 0.45,
  height: 0.55,
  depth,
  ...extra,
});

describe("mergeBrushes", () => {
  it("folds an identical brush into one", () => {
    const merged = mergeBrushes([beam(0, 48), beam(0, 48)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBe(48);
  });

  it("folds a beam lying along a longer one into it", () => {
    const merged = mergeBrushes([beam(0, 48), beam(18, 12)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].z).toBe(0);
    expect(merged[0].depth).toBe(48);
  });

  it("joins two that meet end to end", () => {
    const merged = mergeBrushes([beam(-12, 24), beam(12, 24)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBeCloseTo(48);
  });

  it("keeps a chain folding once the first fold reaches a third", () => {
    const merged = mergeBrushes([beam(-16, 16), beam(16, 16), beam(0, 16)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].depth).toBeCloseTo(48);
  });

  it("leaves brushes of another kind, tint, solidity or angle alone", () => {
    expect(mergeBrushes([beam(0, 48), beam(0, 48, { kind: "accent" })])).toHaveLength(2);
    expect(mergeBrushes([beam(0, 48), beam(0, 48, { tint: "#123456" })])).toHaveLength(2);
    expect(mergeBrushes([beam(0, 48), beam(0, 48, { solid: false })])).toHaveLength(2);
    expect(mergeBrushes([beam(0, 48, { yaw: 0.3 }), beam(0, 48, { yaw: 0.3 })])).toHaveLength(2);
  });

  it("leaves brushes that only cross each other alone", () => {
    const across: BoxBrush = { kind: "frame", x: 14, y: 3.73, z: 0, width: 24, height: 0.55, depth: 0.45 };
    expect(mergeBrushes([beam(0, 48), across])).toHaveLength(2);
  });

  it("leaves brushes with a gap between them alone", () => {
    expect(mergeBrushes([beam(-13, 24), beam(13, 24)])).toHaveLength(2);
  });
});
