import { describe, expect, it } from "vitest";
import { VOWELS, placeSound } from "../src/engine/zombieAudio";

const facingNorth = { x: 0, y: 0, z: 0, yaw: 0 };

describe("placing a zombie's sounds", () => {
  it("pans a sound to the side it is on", () => {
    // Facing +z, +x is to the right.
    expect(placeSound(facingNorth, { x: 5, y: 0, z: 0 }).pan).toBeGreaterThan(0.5);
    expect(placeSound(facingNorth, { x: -5, y: 0, z: 0 }).pan).toBeLessThan(-0.5);
    expect(Math.abs(placeSound(facingNorth, { x: 0, y: 0, z: 5 }).pan)).toBeLessThan(1e-9);
  });

  it("turns with the listener", () => {
    // Facing +x, a sound at +z is on the left.
    const facingEast = { ...facingNorth, yaw: Math.PI / 2 };
    expect(placeSound(facingEast, { x: 0, y: 0, z: 5 }).pan).toBeLessThan(-0.5);
  });

  it("is quieter and duller the further away it is", () => {
    const near = placeSound(facingNorth, { x: 0, y: 0, z: 3 });
    const far = placeSound(facingNorth, { x: 0, y: 0, z: 30 });
    expect(far.level).toBeLessThan(near.level * 0.5);
    expect(far.cutoff).toBeLessThan(near.cutoff);
  });

  it("is duller behind than in front, so a warning from behind sounds like one", () => {
    const ahead = placeSound(facingNorth, { x: 0, y: 0, z: 8 });
    const behind = placeSound(facingNorth, { x: 0, y: 0, z: -8 });
    expect(behind.level).toBeCloseTo(ahead.level, 6);
    expect(behind.cutoff).toBeLessThan(ahead.cutoff * 0.8);
  });

  it("voices through open vowels, low to high resonance", () => {
    for (const vowel of VOWELS) {
      expect(vowel[0]).toBeLessThan(vowel[1]);
      expect(vowel[1]).toBeLessThan(vowel[2]);
    }
  });
});
