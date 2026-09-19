import { describe, expect, it } from "vitest";
import { SPAWN, pickSpawn, type SpawnOption } from "../src/sim/spawn";

/**
 * Spawning, which used to open a round with the inside of a team-mate's head
 * filling the screen. Whatever else it weighs up, it never puts two bodies in
 * the same place.
 */

const points: SpawnOption[] = [
  { x: 0, z: 0, yaw: 0 },
  { x: 10, z: 0, yaw: 1 },
  { x: 20, z: 0, yaw: 2 },
];

describe("pickSpawn", () => {
  it("takes a free point over one someone is standing on", () => {
    const choice = pickSpawn(points, [{ x: 0, z: 0 }], []);
    expect(choice.x).not.toBe(0);
  });

  it("keeps clear of every body, not just the nearest point's", () => {
    const bodies = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    const choice = pickSpawn(points, bodies, []);
    for (const body of bodies) {
      expect(Math.hypot(choice.x - body.x, choice.z - body.z)).toBeGreaterThan(SPAWN.clearance);
    }
  });

  it("breaks the tie between free points by distance from the enemy", () => {
    const choice = pickSpawn(points, [], [{ x: 0, z: 0 }]);
    expect(choice.x).toBe(20);
  });

  it("does not let the enemy override standing room", () => {
    // The far point is taken, so the nearer free one wins even though it is
    // closer to the enemy.
    const choice = pickSpawn(points, [{ x: 20, z: 0 }], [{ x: -5, z: 0 }]);
    expect(choice.x).toBe(10);
  });

  it("carries the point's facing", () => {
    expect(pickSpawn(points, [], [{ x: 0, z: 0 }]).yaw).toBe(2);
  });

  it("steps aside rather than stacking when every point is taken", () => {
    const bodies = points.map((point) => ({ x: point.x, z: point.z }));
    const choice = pickSpawn(points, bodies, []);
    const nearest = Math.min(
      ...bodies.map((body) => Math.hypot(choice.x - body.x, choice.z - body.z)),
    );
    expect(nearest).toBeGreaterThan(1);
  });

  it("steps aside onto open ground when it is told where that is", () => {
    const bodies = [{ x: 0, z: 0 }];
    // Everything north of the point is inside a wall.
    const choice = pickSpawn([points[0]], bodies, [], (_x, z) => z < 0.01);
    expect(choice.z).toBeLessThan(0.01);
    expect(Math.hypot(choice.x, choice.z)).toBeGreaterThan(1);
  });

  it("stays put when it is boxed in on every side", () => {
    const choice = pickSpawn([points[0]], [{ x: 0, z: 0 }], [], () => false);
    expect(choice.x).toBe(0);
    expect(choice.z).toBe(0);
  });

  it("says so when the map has no points for the team", () => {
    expect(() => pickSpawn([], [], [])).toThrow(/no spawn points/);
  });
});
