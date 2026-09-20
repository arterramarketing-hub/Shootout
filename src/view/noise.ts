/**
 * Tiling value noise.
 *
 * Every surface in the game is painted at load rather than downloaded, and
 * the thing that separates a painted surface from a convincing one is
 * variation at every scale at once: blotches a metre across, mottling a
 * hand's width, grain you only see with your face against it. Scattered
 * circles give one scale. This gives all of them.
 *
 * It tiles exactly. A texture that repeats every three metres has to line up
 * with itself, and noise that does not wrap puts a seam on every wall.
 */

/** A hash of two lattice points, stable for a given salt. */
const hash = (x: number, y: number, salt: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Ease so the lattice does not show as a grid of diamonds. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

export interface NoiseField {
  /**
   * One octave at the given number of cells across the tile, from 0 to 1.
   *
   * `cells` is how many lattice points fit in one repeat, so a small number
   * is a broad swell and a large one is fine grain.
   */
  value(x: number, y: number, cells: number): number;
  /** Octaves summed, each one twice as fine and half as strong. */
  fbm(x: number, y: number, cells: number, octaves: number): number;
}

/**
 * A field that repeats every `period` units in both axes.
 *
 * For a texture that is the texture's width in pixels; for the sky it is the
 * span of the cloud layer in metres.
 */
export const createNoiseField = (seed: number, period: number): NoiseField => {
  const field: NoiseField = {
    value(x, y, cells) {
      const step = period / cells;
      const gx = x / step;
      const gy = y / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      // Wrapping the lattice, not the coordinate, is what makes it tile.
      const wrap = (v: number): number => ((v % cells) + cells) % cells;
      const xa = wrap(x0);
      const xb = wrap(x0 + 1);
      const ya = wrap(y0);
      const yb = wrap(y0 + 1);
      const salt = seed ^ Math.imul(cells, 0x9e3779b1);
      const top = hash(xa, ya, salt) + (hash(xb, ya, salt) - hash(xa, ya, salt)) * fx;
      const bottom = hash(xa, yb, salt) + (hash(xb, yb, salt) - hash(xa, yb, salt)) * fx;
      return top + (bottom - top) * fy;
    },

    fbm(x, y, cells, octaves) {
      let total = 0;
      let amplitude = 1;
      let weight = 0;
      for (let octave = 0; octave < octaves; octave += 1) {
        total += field.value(x, y, cells * 2 ** octave) * amplitude;
        weight += amplitude;
        amplitude *= 0.5;
      }
      return total / weight;
    },
  };
  return field;
};
