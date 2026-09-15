import { describe, expect, it } from "vitest";
import { RECOIL, recoilPose } from "../src/view/recoilPose";
import {
  MODELS,
  aimedHeadroomDegrees,
  headroomDegrees,
  coversCentre,
  holdPosition,
  riseHeadroomDegrees,
  type ModelSpec,
  type WeaponPose,
} from "../src/view/weaponGeometry";

/**
 * Recoil degrades a player's aim. It must never degrade their vision.
 *
 * A weapon that swings over the crosshair takes away the one thing the player
 * needs to fight the recoil: seeing where the shots are going. These tests
 * walk the same boxes the renderer builds and the same pose maths it applies,
 * so they are not checking a remembered number — they are checking what is on
 * the screen.
 */

const WEAPONS = Object.entries(MODELS) as [string, ModelSpec][];

/** Build the pose the viewmodel writes for a given kick, as applyPose does. */
const poseAt = (spec: ModelSpec, kick: number, ads: number): WeaponPose => {
  const rest = holdPosition(spec, ads);
  const recoil = recoilPose(kick, ads, headroomDegrees(spec, ads));
  return {
    x: rest.x,
    y: rest.y + recoil.up,
    z: rest.z - recoil.back,
    // The renderer writes `pitch -= recoil.pitch`, so muzzle rise is negative.
    pitch: -recoil.pitch,
    yaw: 0,
    roll: 0,
  };
};

/** Every kick between nothing and the ceiling, not just the two ends. */
const kicks = (): number[] => {
  const steps: number[] = [];
  for (let i = 0; i <= 48; i += 1) steps.push((RECOIL.maxAccumulated * i) / 48);
  return steps;
};

describe("the aimed weapon and the crosshair", () => {
  it.each(WEAPONS)("%s rests with the target in sight", (_id, spec) => {
    // Before a shot is fired there has to be somewhere for the weapon to go.
    // A barrel that already sits a degree under the crosshair has no budget,
    // and the first round of the burst spends it.
    expect(aimedHeadroomDegrees(spec)).toBeGreaterThan(1.8);
  });

  it.each(WEAPONS)("%s never crosses the crosshair, at any kick", (_id, spec) => {
    for (const kick of kicks()) {
      expect(coversCentre(spec, poseAt(spec, kick, 1))).toBe(false);
    }
  });

  it.each(WEAPONS)("%s leaves room for the sway and bob on top", (_id, spec) => {
    // The kick is not the only thing moving the weapon while the player is
    // holding an aim, so clearing the centre by a hair is not clearing it.
    const worst = poseAt(spec, RECOIL.maxAccumulated, 1);
    expect(riseHeadroomDegrees(spec, worst)).toBeGreaterThan(1);
  });

  it.each(WEAPONS)("%s stays clear part way into the aim as well", (_id, spec) => {
    // The transition is its own pose, and a player who fires during it is not
    // excused from being able to see.
    for (let ads = 0; ads <= 1; ads += 0.05) {
      expect(coversCentre(spec, poseAt(spec, RECOIL.maxAccumulated, ads))).toBe(false);
    }
  });
});

describe("the clearance cap", () => {
  it("cuts the rise for a weapon with no room, and leaves a roomy one alone", () => {
    /*
     * The wish is a fixed number of degrees; the promise is a share of what
     * the weapon actually has. A long barrel under a low sight kicks less on
     * screen than a stubby one, which is the opposite of arbitrary: it is the
     * only way both can keep the target visible.
     */
    const tight = recoilPose(RECOIL.maxAccumulated, 1, 1.5);
    const roomy = recoilPose(RECOIL.maxAccumulated, 1, 40);
    expect(tight.pitch).toBeLessThan(roomy.pitch);
    expect(tight.pitch * (180 / Math.PI)).toBeLessThanOrEqual(
      1.5 * RECOIL.aimedHeadroomShare + 1e-9,
    );
  });

  it("holds even if the accumulator is handed something past its ceiling", () => {
    const capped = recoilPose(RECOIL.maxAccumulated, 1, 3);
    const absurd = recoilPose(RECOIL.maxAccumulated * 10, 1, 3);
    expect(absurd.pitch).toBeCloseTo(capped.pitch, 10);
    expect(absurd.back).toBeCloseTo(capped.back, 10);
  });

  it("stays a number when there is nothing to clear and nothing to kick", () => {
    /*
     * Unbounded clearance and no accumulated kick is the pose the weapon is in
     * for most of a match, and multiplying those two together naively gives
     * NaN rather than zero. That NaN reaches the weapon's rotation and takes
     * the viewmodel off the screen entirely — no weapon, no error, no clue.
     */
    for (const ads of [0, 0.5, 1]) {
      const pose = recoilPose(0, ads, Number.POSITIVE_INFINITY);
      expect(Number.isFinite(pose.pitch)).toBe(true);
      expect(Number.isFinite(pose.back)).toBe(true);
      expect(Number.isFinite(pose.up)).toBe(true);
      expect(Number.isFinite(pose.rollScale)).toBe(true);
      expect(pose.pitch).toBe(0);
    }
    const hip = recoilPose(1, 0, Number.POSITIVE_INFINITY);
    expect(hip.pitch).toBeCloseTo((RECOIL.hipPitchDegrees * Math.PI) / 180, 10);
  });

  it("catches a weapon that swings over the crosshair", () => {
    /*
     * The check has to be able to fail, so here is the tuning it replaced:
     * roughly nineteen degrees of muzzle rise per unit of kick, which put the
     * receiver across the middle of the screen for the whole burst.
     */
    const spec = MODELS.ar;
    const rest = holdPosition(spec, 1);
    const old: WeaponPose = {
      ...rest,
      pitch: -19 * (Math.PI / 180),
      yaw: 0,
      roll: 0,
    };
    expect(coversCentre(spec, old)).toBe(true);
  });
});

describe("firing from the hip", () => {
  it.each(WEAPONS)("%s is held off to the side, so it may kick freely", (_id, spec) => {
    // Nothing here is a compromise: the weapon is not in front of the
    // crosshair to begin with, so it can move as violently as it likes.
    const worst = poseAt(spec, RECOIL.maxAccumulated, 0);
    expect(coversCentre(spec, worst)).toBe(false);
    expect(riseHeadroomDegrees(spec, worst)).toBe(Number.POSITIVE_INFINITY);
  });

  it("kicks the weapon far harder than aiming does", () => {
    const hip = recoilPose(1, 0, headroomDegrees(MODELS.ar, 0));
    const aimed = recoilPose(1, 1, headroomDegrees(MODELS.ar, 1));
    expect(hip.pitch).toBeGreaterThan(aimed.pitch * 5);
    expect(hip.up).toBeGreaterThan(0);
    expect(aimed.up).toBe(0);
    expect(aimed.rollScale).toBeLessThan(hip.rollScale);
  });

  it("puts the same punch into travel either way", () => {
    // Backward travel is the one axis that reads as force without costing
    // anything, because it moves the weapon away from the target rather than
    // across it. Aiming has no reason to give it up.
    const hipBack = (kick: number) => recoilPose(kick, 0, headroomDegrees(MODELS.ar, 0)).back;
    expect(recoilPose(1, 1, headroomDegrees(MODELS.ar, 1)).back).toBeCloseTo(hipBack(1), 10);
    expect(hipBack(2)).toBeCloseTo(hipBack(1) * 2, 10);
  });
});
