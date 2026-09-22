import { describe, expect, it } from "vitest";
import { FALL_SECONDS, figurePose, type PoseInput } from "../src/view/figurePose";

const input = (over: Partial<PoseInput> = {}): PoseInput => ({
  stride: 0,
  speed: 0,
  gait: 0,
  pitch: 0,
  dying: null,
  fallSide: 1,
  clock: 0,
  ...over,
});

/** Every angle the pose asks for, so a runaway can be caught wholesale. */
const angles = (pose: ReturnType<typeof figurePose>): number[] =>
  Object.values(pose.joints).flatMap((joint) => [joint.pitch, joint.yaw, joint.roll]);

describe("figure pose", () => {
  it("leaves a standing figure standing", () => {
    // The rest pose is already a soldier on their feet, so a figure at a
    // halt should be a whisker away from it, not folded into one.
    const pose = figurePose(input());
    for (const angle of angles(pose)) expect(Math.abs(angle)).toBeLessThan(0.05);
    expect(Math.abs(pose.bob)).toBeLessThan(0.01);
  });

  it("never asks a joint for an angle a body could not make", () => {
    for (let stride = 0; stride < Math.PI * 2; stride += 0.1) {
      for (const speed of [0, 2, 4, 7]) {
        const pose = figurePose(input({ stride, speed, gait: 1, pitch: 0.4 }));
        for (const angle of angles(pose)) expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it("swings the legs out of phase with each other", () => {
    // Both legs forward at once is a hop, not a walk.
    for (let stride = 0; stride < Math.PI * 2; stride += 0.2) {
      const pose = figurePose(input({ stride, speed: 4, gait: 1 }));
      const right = pose.joints.thighR.pitch;
      const left = pose.joints.thighL.pitch;
      expect(right * left).toBeLessThanOrEqual(1e-9);
    }
  });

  it("folds the knee through the swing and straightens it for the plant", () => {
    // A leg that bends in time with the hip skates; the knee has to lead.
    let mostFolded = { phase: 0, knee: 0 };
    let straightest = { phase: 0, knee: -Infinity };
    for (let stride = 0; stride < Math.PI * 2; stride += 0.05) {
      const knee = figurePose(input({ stride, speed: 4, gait: 1 })).joints.shinR.pitch;
      if (knee > mostFolded.knee) mostFolded = { phase: stride, knee };
      if (-knee > straightest.knee) straightest = { phase: stride, knee: -knee };
    }
    // Folded hardest somewhere in the swing, and the fold is real.
    expect(mostFolded.knee).toBeGreaterThan(0.25);
    // A knee only bends one way.
    for (let stride = 0; stride < Math.PI * 2; stride += 0.05) {
      expect(figurePose(input({ stride, speed: 4, gait: 1 })).joints.shinR.pitch).toBeGreaterThanOrEqual(
        -1e-9,
      );
    }
  });

  it("opens the stride up as the figure speeds up", () => {
    const reach = (speed: number): number => {
      let most = 0;
      for (let stride = 0; stride < Math.PI * 2; stride += 0.05) {
        most = Math.max(most, Math.abs(figurePose(input({ stride, speed, gait: 1 })).joints.thighR.pitch));
      }
      return most;
    };
    expect(reach(6.5)).toBeGreaterThan(reach(2) * 1.3);
  });

  it("stands still when the gait is closed down, whatever the stride says", () => {
    for (let stride = 0; stride < Math.PI * 2; stride += 0.3) {
      const pose = figurePose(input({ stride, speed: 5, gait: 0 }));
      expect(Math.abs(pose.joints.thighR.pitch)).toBeLessThan(1e-9);
      expect(Math.abs(pose.joints.shinR.pitch)).toBeLessThan(1e-9);
    }
  });

  it("bobs twice per stride, because the body rises over each leg", () => {
    const dips: number[] = [];
    let previous = figurePose(input({ stride: -0.05, speed: 4, gait: 1 })).bob;
    let current = figurePose(input({ stride: 0, speed: 4, gait: 1 })).bob;
    for (let stride = 0.05; stride < Math.PI * 2; stride += 0.05) {
      const next = figurePose(input({ stride, speed: 4, gait: 1 })).bob;
      if (current < previous && current < next) dips.push(stride);
      previous = current;
      current = next;
    }
    expect(dips.length).toBe(2);
  });

  it("turns the chest against the hips", () => {
    // Counter-rotation is what stops a walk reading as a shuffle.
    for (const stride of [0.4, 1.9, 3.4, 5.1]) {
      const pose = figurePose(input({ stride, speed: 4, gait: 1 }));
      expect(pose.joints.pelvis.yaw * pose.joints.chest.yaw).toBeLessThan(0);
    }
  });

  it("looks where the figure is looking, and keeps the head level about it", () => {
    const up = figurePose(input({ pitch: 0.5 }));
    const down = figurePose(input({ pitch: -0.5 }));
    expect(up.joints.head.pitch).toBeLessThan(down.joints.head.pitch);
    // The spine takes some of it so the neck is not doing all the work.
    expect(Math.abs(up.joints.chest.pitch)).toBeGreaterThan(0.05);
  });

  it("buckles the knees before the body goes over", () => {
    // A body drops and then falls; it does not tip like a plank.
    const early = figurePose(input({ dying: FALL_SECONDS * 0.18, fallSide: 1 }));
    expect(early.joints.shinR.pitch).toBeGreaterThan(0.25);
    expect(Math.abs(early.joints.pelvis.roll)).toBeLessThan(0.3);
  });

  it("is all the way down by the time the fall is over, and stays there", () => {
    const landed = figurePose(input({ dying: FALL_SECONDS, fallSide: 1 }));
    const later = figurePose(input({ dying: FALL_SECONDS * 4, fallSide: 1 }));
    expect(landed.bob).toBeLessThan(-0.3);
    expect(later.bob).toBeCloseTo(landed.bob, 6);
    for (const angle of angles(later)) expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
  });

  it("falls the way it was told to", () => {
    const right = figurePose(input({ dying: FALL_SECONDS, fallSide: 1 }));
    const left = figurePose(input({ dying: FALL_SECONDS, fallSide: -1 }));
    expect(right.joints.pelvis.roll).toBeCloseTo(-left.joints.pelvis.roll, 6);
    expect(right.sway).toBeCloseTo(-left.sway, 6);
  });

  it("gives two figures that appeared at different moments different idles", () => {
    const a = figurePose(input({ clock: 0.3 }));
    const b = figurePose(input({ clock: 2.4 }));
    expect(a.joints.pelvis.pitch).not.toBeCloseTo(b.joints.pelvis.pitch, 4);
  });
});
