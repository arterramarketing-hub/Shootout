import { describe, expect, it } from "vitest";
import { makeAabb, makeObb, rayObb, sphereObb, toLocal } from "../src/sim/obb";
import { vec3 } from "../src/sim/vec3";

const unitBox = makeAabb(vec3(0, 0, 0), vec3(1, 1, 1));

describe("toLocal", () => {
  it("is the identity for an unrotated box at the origin", () => {
    expect(toLocal(unitBox, vec3(0.5, -0.25, 2))).toEqual({ x: 0.5, y: -0.25, z: 2 });
  });

  it("undoes a quarter turn about the vertical axis", () => {
    const box = makeObb(vec3(0, 0, 0), vec3(1, 1, 1), Math.PI / 2, 0);
    const local = toLocal(box, vec3(0, 0, 1));
    expect(local.x).toBeCloseTo(-1, 6);
    expect(local.z).toBeCloseTo(0, 6);
  });
});

describe("rayObb", () => {
  it("reports the distance to the near face", () => {
    const hit = rayObb(unitBox, vec3(0, 0, -5), vec3(0, 0, 1), 100);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4, 6);
  });

  it("returns an outward normal that opposes the ray", () => {
    // This is the sign that decides whether a floor faces up or down, and
    // getting it backwards makes every walkable surface unwalkable.
    const down = rayObb(unitBox, vec3(0, 5, 0), vec3(0, -1, 0), 100);
    expect(down!.normal.y).toBeCloseTo(1, 6);

    const up = rayObb(unitBox, vec3(0, -5, 0), vec3(0, 1, 0), 100);
    expect(up!.normal.y).toBeCloseTo(-1, 6);

    const east = rayObb(unitBox, vec3(-5, 0, 0), vec3(1, 0, 0), 100);
    expect(east!.normal.x).toBeCloseTo(-1, 6);

    const west = rayObb(unitBox, vec3(5, 0, 0), vec3(-1, 0, 0), 100);
    expect(west!.normal.x).toBeCloseTo(1, 6);
  });

  it("misses a box the ray passes beside", () => {
    expect(rayObb(unitBox, vec3(5, 0, -5), vec3(0, 0, 1), 100)).toBeNull();
  });

  it("misses a box behind the ray", () => {
    expect(rayObb(unitBox, vec3(0, 0, 5), vec3(0, 0, 1), 100)).toBeNull();
  });

  it("respects the maximum distance", () => {
    expect(rayObb(unitBox, vec3(0, 0, -5), vec3(0, 0, 1), 3)).toBeNull();
    expect(rayObb(unitBox, vec3(0, 0, -5), vec3(0, 0, 1), 5)).not.toBeNull();
  });

  it("hits a rotated box on its rotated face", () => {
    const box = makeObb(vec3(0, 0, 0), vec3(1, 1, 0.2), Math.PI / 4, 0);
    const hit = rayObb(box, vec3(0, 0, -5), vec3(0, 0, 1), 100);
    expect(hit).not.toBeNull();
    // The face is turned 45 degrees, so the normal leans out of the axis.
    expect(Math.abs(hit!.normal.z)).toBeLessThan(0.99);
    expect(Math.hypot(hit!.normal.x, hit!.normal.y, hit!.normal.z)).toBeCloseTo(1, 6);
  });

  it("gives a ramp a normal that leans back up the slope", () => {
    const ramp = makeObb(vec3(0, 1, 0), vec3(2, 0.2, 4), 0, -0.4);
    const hit = rayObb(ramp, vec3(0, 6, 0), vec3(0, -1, 0), 100);
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeGreaterThan(0.8);
    expect(hit!.normal.z).not.toBeCloseTo(0, 2);
  });
});

describe("sphereObb", () => {
  it("reports nothing when the sphere is clear", () => {
    expect(sphereObb(unitBox, vec3(5, 0, 0), 0.5)).toBeNull();
  });

  it("pushes a sphere resting on the top face straight up", () => {
    const hit = sphereObb(unitBox, vec3(0, 1.4, 0), 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeCloseTo(1, 6);
    expect(hit!.depth).toBeCloseTo(0.1, 6);
  });

  it("pushes a sphere against a side face sideways", () => {
    const hit = sphereObb(unitBox, vec3(1.3, 0, 0), 0.5);
    expect(hit!.normal.x).toBeCloseTo(1, 6);
    expect(hit!.depth).toBeCloseTo(0.2, 6);
  });

  it("pushes a sphere whose centre is inside out through the nearest face", () => {
    const hit = sphereObb(unitBox, vec3(0, 0.9, 0), 0.2);
    expect(hit).not.toBeNull();
    expect(hit!.normal.y).toBeCloseTo(1, 6);
    // Out through the top, plus the radius, so it ends up fully clear.
    expect(hit!.depth).toBeCloseTo(0.3, 6);
  });

  it("always returns a unit normal", () => {
    for (const point of [vec3(1.2, 1.2, 0), vec3(0, 1.4, 1.2), vec3(1.1, 1.1, 1.1)]) {
      const hit = sphereObb(unitBox, point, 0.6);
      if (!hit) continue;
      expect(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z)).toBeCloseTo(1, 6);
    }
  });

  it("pushes out along the rotated face of a rotated box", () => {
    const box = makeObb(vec3(0, 0, 0), vec3(1, 1, 1), Math.PI / 2, 0);
    const hit = sphereObb(box, vec3(0, 0, 1.3), 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.normal.z).toBeCloseTo(1, 6);
  });
});
