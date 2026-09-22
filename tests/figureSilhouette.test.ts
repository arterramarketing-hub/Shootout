import { describe, expect, it } from "vitest";
import type { Team } from "../src/sim/bots";
import { HIP_HEIGHT, type Part, figureParts, hipOffset } from "../src/view/figureParts";

/**
 * Two sides that differ only in colour are two sides you cannot tell apart
 * at distance, in shade, or through fog, because colour is the first thing
 * all three take away. So this measures the thing that survives them: the
 * outline.
 *
 * Each figure is rasterised at a centimetre, from the front and from the
 * side, and the two teams' outlines are compared. The numbers below are
 * loose on purpose — they are there to catch the silhouettes drifting back
 * together, not to pin any particular piece of kit in place.
 */

const CELL = 0.01;
const HALF = 1.4;
const TOP = 2.1;

/** Every block of one figure, with the legs put where the hips are. */
const allParts = (team: Team): Part[] => {
  const parts = figureParts(team);
  const legs = (side: -1 | 1): Part[] =>
    parts.leg.map((part) => ({
      ...part,
      x: part.x + side * hipOffset(team),
      y: part.y + HIP_HEIGHT,
    }));
  return [...parts.body, ...parts.head, ...legs(-1), ...legs(1)];
};

/** The corners of a part after its own yaw and pitch, in world axes. */
const corners = (part: Part): [number, number, number][] => {
  const cy = Math.cos(part.yaw ?? 0);
  const sy = Math.sin(part.yaw ?? 0);
  const cp = Math.cos(part.pitch ?? 0);
  const sp = Math.sin(part.pitch ?? 0);
  const out: [number, number, number][] = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sv of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const x = sx * part.width;
        const y = sv * part.height;
        const z = sz * part.depth;
        // Pitch about x, then yaw about y: the order the renderer bakes.
        const y1 = y * cp - z * sp;
        const z1 = y * sp + z * cp;
        out.push([part.x + x * cy + z1 * sy, part.y + y1, part.z - x * sy + z1 * cy]);
      }
    }
  }
  return out;
};

/**
 * A filled outline, seen down one axis.
 *
 * Each block is drawn as the box that contains it, which over-fills a
 * rotated one. Only the arms and one strap are rotated and none of them is
 * on the outline, so this is the outline.
 */
const silhouette = (parts: Part[], axis: 0 | 2): boolean[] => {
  const across = axis === 0 ? 2 : 0;
  const width = Math.round((HALF * 2) / CELL);
  const height = Math.round(TOP / CELL);
  const grid = new Array<boolean>(width * height).fill(false);
  for (const part of parts) {
    const points = corners(part);
    let loA = Infinity;
    let hiA = -Infinity;
    let loB = Infinity;
    let hiB = -Infinity;
    for (const point of points) {
      loA = Math.min(loA, point[across]);
      hiA = Math.max(hiA, point[across]);
      loB = Math.min(loB, point[1]);
      hiB = Math.max(hiB, point[1]);
    }
    const x0 = Math.max(0, Math.round((loA + HALF) / CELL));
    const x1 = Math.min(width - 1, Math.round((hiA + HALF) / CELL));
    const y0 = Math.max(0, Math.round(loB / CELL));
    const y1 = Math.min(height - 1, Math.round(hiB / CELL));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grid[y * width + x] = true;
  }
  return grid;
};

/** How much of the two outlines together is in only one of them. */
const difference = (a: boolean[], b: boolean[]): number => {
  let union = 0;
  let only = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i] && !b[i]) continue;
    union += 1;
    if (a[i] !== b[i]) only += 1;
  }
  return only / union;
};

/** How wide the figure is at a given height, down a given axis. */
const widthAt = (parts: Part[], y: number, axis: 0 | 2): number => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const part of parts) {
    const points = corners(part);
    let loY = Infinity;
    let hiY = -Infinity;
    for (const point of points) {
      loY = Math.min(loY, point[1]);
      hiY = Math.max(hiY, point[1]);
    }
    if (y < loY || y > hiY) continue;
    for (const point of points) {
      lo = Math.min(lo, point[axis]);
      hi = Math.max(hi, point[axis]);
    }
  }
  return hi - lo;
};

const blue = allParts("a");
const rust = allParts("b");

describe("figure silhouette", () => {
  it("gives the two sides different outlines head on", () => {
    // A third of the two outlines together belongs to only one of them.
    expect(difference(silhouette(blue, 2), silhouette(rust, 2))).toBeGreaterThan(0.24);
  });

  it("gives the two sides different outlines from the side", () => {
    expect(difference(silhouette(blue, 0), silhouette(rust, 0))).toBeGreaterThan(0.16);
  });

  it("carries the weight high on one side and low on the other", () => {
    // Shoulders against waist, which is the read at any distance: one side
    // is a wedge point down, the other a wedge point up.
    const blueRatio = widthAt(blue, 1.4, 0) / widthAt(blue, 0.98, 0);
    const rustRatio = widthAt(rust, 1.4, 0) / widthAt(rust, 0.98, 0);
    expect(blueRatio).toBeGreaterThan(rustRatio * 1.15);
  });

  it("gives the helmets different proportions", () => {
    // The shell, not the bounding box: a mount on one side widens the box
    // without making the helmet a wide one.
    const shell = (team: Team): number =>
      Math.max(...figureParts(team).head.filter((p) => p.tone === "trim").map((p) => p.width));
    // How far the helmet reaches past the face, which is the read in profile.
    const reach = (team: Team): number =>
      Math.max(...figureParts(team).head.map((p) => p.z + p.depth / 2));

    // One side wears a wide dome, the other a narrow bump.
    expect(shell("a")).toBeGreaterThan(shell("b") * 1.2);
    // And the narrow one makes it up out front, so neither is simply smaller.
    expect(reach("b")).toBeGreaterThan(reach("a") * 1.15);
  });

  it("keeps everything that could be aimed at off the head", () => {
    // Anything above the head that is not helmet has to be plainly beside
    // it, or it invites a shot the hitbox will not answer.
    for (const team of ["a", "b"] as Team[]) {
      for (const part of allParts(team)) {
        const top = Math.max(...corners(part).map((point) => point[1]));
        // Above both helmets. What a helmet does to the outline is the point
        // of all this; what anything else does up there is a missed shot.
        if (top <= 1.83) continue;
        const clear = Math.abs(part.x) - part.width / 2 > 0.11 || part.z + part.depth / 2 < -0.14;
        expect(clear, `${team} part at ${part.x},${part.y},${part.z}`).toBe(true);
      }
    }
  });

  it("keeps both figures within a sane envelope", () => {
    for (const parts of [blue, rust]) {
      let top = -Infinity;
      let wide = 0;
      for (const part of parts) {
        for (const point of corners(part)) {
          top = Math.max(top, point[1]);
          wide = Math.max(wide, Math.abs(point[0]));
        }
      }
      expect(top).toBeLessThan(2);
      expect(wide).toBeLessThan(0.55);
    }
  });
});
