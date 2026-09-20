import { describe, expect, it } from "vitest";
import { createNoiseField } from "../src/view/noise";

/**
 * The noise every surface and the sky are painted with.
 *
 * The property that matters is that it tiles: a texture repeating every
 * three metres has to line up with itself, and noise that does not wrap puts
 * a seam down every wall in the game.
 */

const PERIOD = 256;

describe("createNoiseField", () => {
  it("repeats exactly across a tile", () => {
    const field = createNoiseField(1234, PERIOD);
    for (const [x, y] of [
      [0, 0],
      [17.5, 3.25],
      [200, 71],
      [255.5, 255.5],
    ]) {
      expect(field.value(x + PERIOD, y, 8)).toBeCloseTo(field.value(x, y, 8), 12);
      expect(field.value(x, y + PERIOD, 8)).toBeCloseTo(field.value(x, y, 8), 12);
      expect(field.fbm(x + PERIOD, y + PERIOD, 4, 5)).toBeCloseTo(field.fbm(x, y, 4, 5), 12);
    }
  });

  it("wraps negative coordinates onto the same tile", () => {
    const field = createNoiseField(99, PERIOD);
    expect(field.value(-PERIOD + 12, -PERIOD + 30, 8)).toBeCloseTo(field.value(12, 30, 8), 12);
  });

  it("stays between nothing and everything", () => {
    const field = createNoiseField(7, PERIOD);
    for (let i = 0; i < 4000; i += 1) {
      const x = (i * 7.31) % PERIOD;
      const y = (i * 3.17) % PERIOD;
      const one = field.value(x, y, 16);
      const many = field.fbm(x, y, 4, 6);
      expect(one).toBeGreaterThanOrEqual(0);
      expect(one).toBeLessThanOrEqual(1);
      expect(many).toBeGreaterThanOrEqual(0);
      expect(many).toBeLessThanOrEqual(1);
    }
  });

  it("varies: it is noise, not a constant", () => {
    const field = createNoiseField(42, PERIOD);
    const samples: number[] = [];
    for (let i = 0; i < 400; i += 1) samples.push(field.fbm(i * 0.63, i * 1.11, 4, 4));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const spread = Math.sqrt(
      samples.reduce((total, value) => total + (value - mean) ** 2, 0) / samples.length,
    );
    expect(spread).toBeGreaterThan(0.04);
    expect(mean).toBeGreaterThan(0.25);
    expect(mean).toBeLessThan(0.75);
  });

  it("gives the same field for a seed and a different one for another", () => {
    const a = createNoiseField(5, PERIOD);
    const b = createNoiseField(5, PERIOD);
    const c = createNoiseField(6, PERIOD);
    expect(a.fbm(30, 40, 8, 4)).toBe(b.fbm(30, 40, 8, 4));
    expect(a.fbm(30, 40, 8, 4)).not.toBe(c.fbm(30, 40, 8, 4));
  });

  it("is smooth: neighbouring pixels are neighbouring values", () => {
    const field = createNoiseField(3, PERIOD);
    let worst = 0;
    for (let x = 0; x < PERIOD; x += 1) {
      const step = Math.abs(field.value(x + 1, 64, 8) - field.value(x, 64, 8));
      worst = Math.max(worst, step);
    }
    // Eight cells across 256 pixels is a 32-pixel swell; a jump of more than
    // a tenth between neighbours would be a lattice edge showing.
    expect(worst).toBeLessThan(0.1);
  });

  it("gets finer as the cell count rises", () => {
    const field = createNoiseField(11, PERIOD);
    const roughness = (cells: number): number => {
      let total = 0;
      for (let x = 0; x < PERIOD; x += 1) {
        total += Math.abs(field.value(x + 1, 30, cells) - field.value(x, 30, cells));
      }
      return total;
    };
    expect(roughness(64)).toBeGreaterThan(roughness(4) * 4);
  });
});
