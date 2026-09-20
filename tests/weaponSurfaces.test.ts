import { describe, expect, it } from "vitest";
import { MODELS, type Part } from "../src/view/weaponGeometry";

/**
 * No two surfaces on a weapon may sit a hair apart and face the same way.
 *
 * This is the test for a bug that had a long life: the back of the rifle
 * strobed, right under the shooter's eye, because the charging handle was
 * buried in the receiver with its top face half a millimetre above the
 * receiver's own over sixteen square centimetres. Two faces that close,
 * pointing the same way, are a coin toss per pixel per frame, and no depth
 * buffer a phone has can settle it.
 *
 * Faces that point opposite ways are fine however close they are: one of the
 * pair is always turned away and culled, which is what lets a part sit flat
 * on another one. Only same-facing pairs are counted here.
 *
 * The parts are compared as boxes around them, which over-reports rather than
 * under-reports: a round part's box is bigger than the part, so a pair the
 * test clears is genuinely clear.
 */

/** The nearest two same-facing surfaces may come, in metres. */
const CLEARANCE = 0.0008;
/** Below this much shared surface, a pair is a sliver nobody will see. */
const MIN_AREA = 1e-4;

interface Bounds {
  index: number;
  lo: [number, number, number];
  hi: [number, number, number];
  tone: string;
}

const boundsOf = (part: Part, index: number): Bounds => {
  const { x, y, z, width, height, depth } = part;
  return {
    index,
    lo: [x - width / 2, y - height / 2, z - depth / 2],
    hi: [x + width / 2, y + height / 2, z + depth / 2],
    tone: part.tone,
  };
};

const overlap = (a: Bounds, b: Bounds, axis: number): number =>
  Math.min(a.hi[axis], b.hi[axis]) - Math.max(a.lo[axis], b.lo[axis]);

describe("weapon surfaces", () => {
  for (const [id, spec] of Object.entries(MODELS)) {
    it(`${id}: nothing sits a hair in front of anything else`, () => {
      const parts = spec.parts.map(boundsOf);
      const offences: string[] = [];
      for (let a = 0; a < parts.length; a += 1) {
        for (let b = a + 1; b < parts.length; b += 1) {
          const first = parts[a];
          const second = parts[b];
          for (let axis = 0; axis < 3; axis += 1) {
            const across = overlap(first, second, (axis + 1) % 3);
            const along = overlap(first, second, (axis + 2) % 3);
            if (across <= 0 || along <= 0 || across * along < MIN_AREA) continue;
            for (const side of ["lo", "hi"] as const) {
              const gap = Math.abs(first[side][axis] - second[side][axis]);
              if (gap >= CLEARANCE) continue;
              offences.push(
                `${"xyz"[axis]}${side} ${(gap * 1000).toFixed(2)}mm over ` +
                  `${(across * along * 10000).toFixed(1)}cm2: ` +
                  `part ${first.index} (${first.tone}) and ${second.index} (${second.tone})`,
              );
            }
          }
        }
      }
      expect(offences, offences.join("\n")).toHaveLength(0);
    });
  }
});
