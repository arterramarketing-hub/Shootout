import { describe, expect, it } from "vitest";
import { FALL, createFall, fallTilt, stepFall, type FallHit } from "../src/sim/fall";

const shot = (over: Partial<FallHit> = {}): FallHit => ({
  dirX: 0,
  dirZ: 1,
  height: 1.2,
  headshot: false,
  damage: 34,
  ...over,
});

/** Run a fall for a while and report where it ended and when it landed. */
const run = (hit: FallHit, seconds = 3, room?: { ahead: number; behind: number }) => {
  const fall = createFall(hit);
  if (room) {
    fall.roomAhead = room.ahead;
    fall.roomBehind = room.behind;
  }
  let landedAt = -1;
  let impact = 0;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const step = stepFall(fall, dt);
    if (step.landed && landedAt < 0) {
      landedAt = t;
      impact = step.impact;
    }
  }
  return { fall, landedAt, impact };
};

describe("a body falling", () => {
  it("topples away from the shooter when shot in the chest", () => {
    const { fall, landedAt } = run(shot({ height: 1.3 }));
    expect(fall.angle).toBeCloseTo(FALL.lieAngle, 5);
    expect(landedAt).toBeGreaterThan(0.2);
    expect(landedAt).toBeLessThan(2);
    expect(fall.settled).toBe(true);
  });

  it("goes over faster from a headshot than from a chest shot", () => {
    const head = run(shot({ height: 1.62, headshot: true }));
    const chest = run(shot({ height: 1.25 }));
    expect(head.fall.angle).toBeGreaterThan(0);
    expect(head.landedAt).toBeLessThan(chest.landedAt);
  });

  it("has its legs taken out by a low shot, and falls back toward the shooter", () => {
    const { fall } = run(shot({ height: 0.45 }));
    // The feet go along the shot, the body the other way.
    expect(fall.slide).toBeGreaterThan(0.05);
    expect(fall.angle).toBeCloseTo(-FALL.lieAngle, 5);
  });

  it("falls the way the shot was going, in the world", () => {
    const fall = createFall(shot({ dirX: 1, dirZ: 0, height: 1.4 }));
    for (let i = 0; i < 180; i += 1) stepFall(fall, 1 / 60);
    const tilt = fallTilt(fall);
    // Row 1 is where the body's up axis went: over along +x, near the ground.
    expect(tilt[3]).toBeGreaterThan(0.9);
    expect(Math.abs(tilt[4])).toBeLessThan(0.2);
    expect(Math.abs(tilt[5])).toBeLessThan(1e-6);
  });

  it("slumps against a wall instead of falling through it", () => {
    const { fall, landedAt } = run(shot({ height: 1.3 }), 3, { ahead: 1.0, behind: 5 });
    const crown = fall.slide + FALL.height * Math.sin(fall.angle);
    expect(landedAt).toBeGreaterThan(0);
    expect(crown).toBeLessThanOrEqual(1.0 - FALL.wallGap + 1e-6);
    expect(fall.angle).toBeLessThan(FALL.lieAngle - 0.3);
  });

  it("hits harder the harder it was shoved", () => {
    const rifle = run(shot({ height: 1.3, damage: 34 }));
    const shotgun = run(shot({ height: 1.3, damage: 112 }));
    expect(shotgun.landedAt).toBeLessThan(rifle.landedAt);
    expect(shotgun.impact).toBeGreaterThan(0);
  });

  it("gives out at the knees, and faster from a leg shot", () => {
    const legs = createFall(shot({ height: 0.5 }));
    const chest = createFall(shot({ height: 1.3 }));
    stepFall(legs, 0.1);
    stepFall(chest, 0.1);
    expect(legs.buckle).toBeGreaterThan(chest.buckle);
  });

  it("keeps every number finite across a spread of shots", () => {
    for (let height = 0.1; height <= 1.75; height += 0.15) {
      for (const damage of [14, 34, 102, 112]) {
        const { fall } = run(shot({ height, damage, dirX: 0.6, dirZ: -0.8 }), 4);
        for (const value of [fall.angle, fall.spin, fall.slide, fall.head, fall.arms]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(Math.abs(fall.angle)).toBeLessThanOrEqual(FALL.lieAngle + 1e-9);
        expect(Math.abs(fall.slide)).toBeLessThan(3);
        expect(Math.abs(fall.head)).toBeLessThan(1.5);
        expect(Math.abs(fall.arms)).toBeLessThan(1.5);
      }
    }
  });
});
