import { describe, expect, it } from "vitest";
import { figurePose, type PoseInput } from "../src/view/figurePose";
import { BONES } from "../src/view/soldier";
import {
  ZOMBIE_BONES,
  ZOMBIE_PALETTES,
  isZombieLook,
  zombieLook,
  zombieSkin,
  type ZombieLook,
} from "../src/view/zombie";

const looks: ZombieLook[] = ["zombie0", "zombie1", "zombie2"];

const points = (look: ZombieLook): [number, number, number][] => {
  const skin = zombieSkin(look);
  const out: [number, number, number][] = [];
  for (let i = 0; i < skin.positions.length; i += 3) {
    out.push([skin.positions[i], skin.positions[i + 1], skin.positions[i + 2]]);
  }
  return out;
};

const input = (over: Partial<PoseInput> = {}): PoseInput => ({
  stride: 0,
  speed: 0,
  gait: 0,
  pitch: 0,
  dying: null,
  fallSide: 1,
  clock: 0,
  shamble: true,
  ...over,
});

describe("zombie figure", () => {
  it("shares the soldier's skeleton, bone for bone, so one pose drives both", () => {
    expect(ZOMBIE_BONES.map((bone) => [bone.name, bone.parent])).toEqual(
      BONES.map((bone) => [bone.name, bone.parent]),
    );
  });

  it("stands about as tall as a soldier, so the hitboxes fit it", () => {
    for (const look of looks) {
      const ys = points(look).map(([, y]) => y);
      expect(Math.min(...ys)).toBeLessThan(0.05);
      expect(Math.max(...ys)).toBeGreaterThan(1.7);
      expect(Math.max(...ys)).toBeLessThan(1.8);
    }
  });

  it("reaches out in front with both hands", () => {
    for (const look of looks) {
      const ahead = points(look).filter(([, y, z]) => y > 1.1 && z > 0.45);
      expect(ahead.some(([x]) => x > 0.1)).toBe(true);
      expect(ahead.some(([x]) => x < -0.1)).toBe(true);
    }
  });

  it("binds every vertex to a real bone, with weights that sum to one", () => {
    const skin = zombieSkin("zombie0");
    for (let i = 0; i < skin.boneIndices.length; i += 4) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        expect(skin.boneIndices[i + k]).toBeLessThan(ZOMBIE_BONES.length);
        sum += skin.boneWeights[i + k];
      }
      expect(sum).toBeCloseTo(1, 4);
    }
  });

  it("gives runners their own clothes, and splits the rest", () => {
    expect(zombieLook("zed_4", true)).toBe("zombie2");
    const walkers = new Set(["zed_0", "zed_1", "zed_2", "zed_3"].map((id) => zombieLook(id, false)));
    expect(walkers).toEqual(new Set(["zombie0", "zombie1"]));
    expect(isZombieLook("a")).toBe(false);
    expect(ZOMBIE_PALETTES).toHaveLength(3);
  });
});

describe("shamble", () => {
  it("hunches, but not so far the head leaves its hitbox", () => {
    const pose = figurePose(input());
    // Spine and chest pitch carry the head forward by about their sines
    // times the distance to the head; kept inside the box's half width.
    const forward = 0.52 * Math.sin(pose.joints.spine.pitch) + 0.36 * Math.sin(pose.joints.chest.pitch);
    expect(pose.joints.spine.pitch).toBeGreaterThan(0);
    expect(forward).toBeLessThan(0.13 + 0.07);
  });

  it("drags one leg: the left reaches less than the right", () => {
    let right = 0;
    let left = 0;
    for (let stride = 0; stride < Math.PI * 2; stride += 0.1) {
      const pose = figurePose(input({ stride, speed: 2, gait: 1 }));
      right = Math.max(right, Math.abs(pose.joints.thighR.pitch));
      left = Math.max(left, Math.abs(pose.joints.thighL.pitch));
    }
    expect(left).toBeLessThan(right * 0.8);
  });

  it("raises the arms through a swing and brings them down after", () => {
    const rest = figurePose(input()).joints.armR.pitch;
    const up = figurePose(input({ swing: 0.6 })).joints.armR.pitch;
    const down = figurePose(input({ swing: 1 })).joints.armR.pitch;
    // Negative pitch lifts an arm held out in front.
    expect(up).toBeLessThan(rest - 0.5);
    expect(down).toBeGreaterThan(rest + 0.2);
  });

  it("never asks a joint for an angle a body could not make", () => {
    for (let stride = 0; stride < Math.PI * 2; stride += 0.2) {
      for (const swing of [null, 0, 0.3, 0.6, 0.9, 1]) {
        const pose = figurePose(input({ stride, speed: 4, gait: 1, swing, clock: stride * 3 }));
        for (const joint of Object.values(pose.joints)) {
          for (const angle of [joint.pitch, joint.yaw, joint.roll]) {
            expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
          }
        }
      }
    }
  });
});
