import type { BoxBrush } from "./types";

const EPS = 1e-6;

type Range = [number, number];

const ranges = (b: BoxBrush): [Range, Range, Range] => [
  [b.x - b.width / 2, b.x + b.width / 2],
  [b.y - b.height / 2, b.y + b.height / 2],
  [b.z - b.depth / 2, b.z + b.depth / 2],
];

const same = (a: Range, b: Range): boolean =>
  Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

const touching = (a: Range, b: Range): boolean => a[0] <= b[1] + EPS && b[0] <= a[1] + EPS;

const alike = (a: BoxBrush, b: BoxBrush): boolean =>
  a.kind === b.kind &&
  (a.tint ?? "") === (b.tint ?? "") &&
  (a.solid ?? true) === (b.solid ?? true) &&
  (a.yaw ?? 0) === 0 &&
  (b.yaw ?? 0) === 0 &&
  (a.pitch ?? 0) === 0 &&
  (b.pitch ?? 0) === 0;

/** The one brush two collinear ones make, or null when they are not. */
const join = (a: BoxBrush, b: BoxBrush): BoxBrush | null => {
  if (!alike(a, b)) return null;
  const ra = ranges(a);
  const rb = ranges(b);
  const equal = [same(ra[0], rb[0]), same(ra[1], rb[1]), same(ra[2], rb[2])];
  const matches = equal.filter(Boolean).length;
  if (matches < 2) return null;
  const axis = matches === 3 ? 0 : equal.indexOf(false);
  if (!touching(ra[axis], rb[axis])) return null;
  const merged: [Range, Range, Range] = [ra[0], ra[1], ra[2]];
  merged[axis] = [Math.min(ra[axis][0], rb[axis][0]), Math.max(ra[axis][1], rb[axis][1])];
  return {
    ...a,
    x: (merged[0][0] + merged[0][1]) / 2,
    y: (merged[1][0] + merged[1][1]) / 2,
    z: (merged[2][0] + merged[2][1]) / 2,
    width: merged[0][1] - merged[0][0],
    height: merged[1][1] - merged[1][0],
    depth: merged[2][1] - merged[2][0],
  };
};

/**
 * Fold brushes that lie along one another into one.
 *
 * A frame drawn block by block puts a beam along every shared column line
 * twice, once for each block, and the two lie exactly on top of each other.
 * Two faces in one plane are drawn in an order the depth buffer cannot
 * settle, and the surface flickers as the camera moves. Any two brushes of
 * one kind that share a cross-section and overlap or touch along the third
 * axis are one brush, and so are two identical ones. Only upright,
 * unrotated brushes are folded: a tilted one has no shared axis to fold on.
 */
export const mergeBrushes = (brushes: readonly BoxBrush[]): BoxBrush[] => {
  const out = brushes.map((brush) => ({ ...brush }));
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const joined = join(out[i], out[j]);
      if (!joined) continue;
      out[i] = joined;
      out.splice(j, 1);
      // The bigger brush may now reach a third one it did not before.
      j = i;
    }
  }
  return out;
};
