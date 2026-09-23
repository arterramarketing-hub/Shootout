import { describe, expect, it } from "vitest";
import { MAPS } from "../src/maps";
import { SURVIVAL_REACH, boulevardMap, boulevardSurvivalMap } from "../src/maps/boulevard";
import { BrushWorld } from "../src/sim/brushWorld";
import { STANCE } from "../src/sim/config";
import { bakeNavGrid } from "../src/sim/navBake";
import { findPathBetween, nearestNode } from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

/**
 * The survival map is the same plant with the fences down and the city
 * around it made solid. What matters is that it is actually open — the
 * street runs on, the city can be walked — that it still ends somewhere,
 * and that every place a zombie can come from joins the place the survivor
 * stands.
 */

const map = boulevardSurvivalMap;
const world = new BrushWorld(map.brushes);
const nav = bakeNavGrid(world, map.nav);

/** Walk the real player capsule in a straight line and report where it got. */
const walk = (from: { x: number; z: number }, dx: number, dz: number, steps: number) => {
  const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
  body.setPosition(vec3(from.x, STANCE.standHeight / 2 + 0.05, from.z));
  for (let i = 0; i < 6; i += 1) body.move(vec3(0, -0.2, 0));
  for (let i = 0; i < steps; i += 1) body.move(vec3(dx, -0.05, dz));
  return body.getPosition();
};

describe("survival map", () => {
  it("is not in the lobby's map list: it is reached through the mode", () => {
    expect(Object.values(MAPS)).not.toContain(map);
  });

  it("takes the fences down across both ends of the street", () => {
    // Out of the middle of the street and straight up it, well past where the
    // fence stood at twenty-three and a half metres.
    for (const direction of [1, -1]) {
      const reached = walk({ x: 0, z: 0 }, 0, direction * 0.12, 400);
      expect(Math.abs(reached.z)).toBeGreaterThan(40);
    }
  });

  it("keeps the fences in team deathmatch", () => {
    const fenced = new BrushWorld(boulevardMap.brushes);
    const body = fenced.createController(STANCE.radius, STANCE.standHeight / 2);
    body.setPosition(vec3(0, STANCE.standHeight / 2 + 0.05, 0));
    for (let i = 0; i < 400; i += 1) body.move(vec3(0, -0.05, 0.12));
    expect(body.getPosition().z).toBeLessThan(24);
  });

  it("makes the city solid, so a building out there stops a body", () => {
    // Every brush the backdrop drew is solid now except leaves.
    const soft = map.brushes.filter(
      (brush) => brush.group === "outskirts" && brush.solid === false,
    );
    for (const brush of soft) expect(brush.kind).toBe("foliage");
    expect(map.brushes.some((brush) => brush.group === "outskirts" && brush.solid !== false)).toBe(
      true,
    );
  });

  it("stands the ground out there, so nobody falls through the street", () => {
    const reached = walk({ x: 0, z: 30 }, 0, 0.12, 100);
    expect(reached.y).toBeGreaterThan(0.3);
    expect(reached.y).toBeLessThan(1.5);
  });

  it("still ends: a wall nobody sees at the edge of the walkable city", () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      // Start out in the open ground past the plant and walk for longer than
      // the city is wide.
      const from = dz !== 0 ? { x: 0, z: 30 * dz } : { x: 40 * dx, z: 40 };
      const reached = walk(from, dx * 0.2, dz * 0.2, 1200);
      expect(Math.abs(reached.x)).toBeLessThan(SURVIVAL_REACH);
      expect(Math.abs(reached.z)).toBeLessThan(SURVIVAL_REACH);
    }
    const bounds = map.brushes.filter((brush) => brush.group === "bounds");
    expect(bounds.length).toBe(4);
    for (const brush of bounds) expect(brush.hidden).toBe(true);
  });

  it("bakes navigation across the whole walkable city", () => {
    const nodes = nav.grid.nodes;
    const far = nodes.filter((node) => {
      const x = node.col * nav.grid.cellSize + nav.grid.originX;
      const z = node.row * nav.grid.cellSize + nav.grid.originZ;
      return Math.abs(x) > 40 || Math.abs(z) > 40;
    });
    expect(far.length).toBeGreaterThan(nodes.length * 0.4);
  });

  it("joins every place a zombie comes from to the place the survivor starts", () => {
    const start = map.spawns.find((spawn) => spawn.team === "a")!;
    const breaches = map.spawns.filter((spawn) => spawn.team === "b");
    expect(breaches.length).toBeGreaterThan(12);
    for (const breach of breaches) {
      const node = nearestNode(nav.grid, vec3(breach.x, 0.1, breach.z), 1);
      expect(node, `breach at ${breach.x}, ${breach.z}`).not.toBeNull();
      expect(Math.abs(node!.y), `breach at ${breach.x}, ${breach.z}`).toBeLessThan(0.6);
      const path = findPathBetween(
        nav.grid,
        vec3(breach.x, 0.1, breach.z),
        vec3(start.x, 0.1, start.z),
      );
      expect(path, `breach at ${breach.x}, ${breach.z}`).not.toBeNull();
    }
  });

  it("bakes in a time a phone can wait for at the start of a run", () => {
    expect(nav.millis).toBeLessThan(2500);
  });
});
