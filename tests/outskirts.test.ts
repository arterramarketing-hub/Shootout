import { describe, expect, it } from "vitest";
import { buildOutskirts } from "../src/maps/outskirts";
import { boulevardMap } from "../src/maps/boulevard";
import { settingsFor } from "../src/engine/quality";

/**
 * The city outside the level.
 *
 * It exists to be looked at and for no other reason, so what it must never
 * do is take part in the game: nothing out here may be solid, because a
 * solid brush goes into the physics, into the nav bake and into the path of
 * every bullet. It must also stay outside the level's own footprint, or the
 * player walks through a backdrop, and inside the far clip, or the player
 * looks at nothing.
 */

const EDGE = { x: 32, z: 24 };

const outskirts = buildOutskirts({
  seed: 0x0b0e1e ^ 0x5eed,
  edge: EDGE,
  roadWest: -8,
  roadEast: 8,
});

const inside = (brush: { x: number; z: number; width: number; depth: number }): boolean =>
  Math.abs(brush.x) - brush.width / 2 < EDGE.x && Math.abs(brush.z) - brush.depth / 2 < EDGE.z;

describe("outskirts", () => {
  it("is scenery and nothing else: not one brush is solid", () => {
    const solid = outskirts.brushes.filter((brush) => brush.solid !== false);
    expect(solid, `${solid.length} solid brushes outside the level`).toHaveLength(0);
  });

  it("stays out of the level", () => {
    // The ground slab is the exception: it runs under everything, including
    // under the level, and sits below the level's own floor where it is
    // never seen.
    const intruders = outskirts.brushes.filter(
      (brush) => inside(brush) && brush.y + brush.height / 2 > -0.05,
    );
    expect(
      intruders,
      intruders.map((b) => `${b.kind} at (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`).join(", "),
    ).toHaveLength(0);
  });

  it("keeps its silhouettes inside what the weakest tier can see", () => {
    // Fog ends at the far plane, so anything past it is already invisible
    // when it is clipped -- but a backdrop that only exists past the fog is
    // no backdrop at all. What has to be there is the near band: the
    // boulevard, the blocks across it, and the first of the industry behind
    // them, standing inside what a phone on the low tier still renders.
    const reach = settingsFor("low").viewDistance * 0.75;
    const standing = outskirts.brushes.filter((brush) => {
      const range = Math.hypot(
        Math.max(0, Math.abs(brush.x) - EDGE.x),
        Math.max(0, Math.abs(brush.z) - EDGE.z),
      );
      return brush.height > 6 && range < reach;
    });
    expect(standing.length, `only ${standing.length} standing shapes within ${reach}m`)
      .toBeGreaterThan(60);
  });

  it("stays within its own reach", () => {
    for (const brush of outskirts.brushes) {
      expect(Math.abs(brush.x) + brush.width / 2, brush.kind).toBeLessThanOrEqual(151);
      expect(Math.abs(brush.z) + brush.depth / 2, brush.kind).toBeLessThanOrEqual(151);
    }
  });

  it("puts something out there worth looking at", () => {
    expect(outskirts.brushes.length).toBeGreaterThan(300);
    const kinds = new Set(outskirts.brushes.map((brush) => brush.kind));
    // Roads, brick blocks, steel sheds and greenery: a backdrop of one
    // material reads as a painted flat.
    for (const kind of ["asphalt", "brick", "cladding", "foliage", "frame"]) {
      expect(kinds.has(kind as never), `nothing made of ${kind}`).toBe(true);
    }
  });

  it("costs the level no extra draw calls beyond its surfaces", () => {
    // Brushes merge by kind and tint, so the backdrop's whole cost is the
    // number of distinct pairs it introduces, not the number of buildings.
    const batches = new Set(
      boulevardMap.brushes.map((brush) => `${brush.kind}/${brush.tint ?? ""}`),
    );
    expect(batches.size).toBeLessThan(48);
  });
});
