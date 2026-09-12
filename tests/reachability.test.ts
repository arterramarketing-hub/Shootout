import { describe, expect, it } from "vitest";
import { MAPS, MAP_IDS } from "../src/maps";
import type { MapDefinition } from "../src/maps/types";
import { BrushWorld } from "../src/sim/brushWorld";
import { STANCE } from "../src/sim/config";
import { bakeNavGrid } from "../src/sim/navBake";
import { nearestNode } from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

/**
 * Walk the real player capsule outward from a point, half a metre at a time.
 *
 * This is deliberately not a navigation-grid check. The grid samples every
 * 0.6 m and the capsule is 0.76 m across, so the grid can path through gaps a
 * player cannot fit through, and it reported a sealed office block as fully
 * connected while a player spawning inside it could reach nothing but the
 * rooms. The capsule is the only thing that answers the question the player
 * is actually asking.
 */
const capsuleReach = (map: MapDefinition, from: { x: number; z: number }): number => {
  const world = new BrushWorld(map.brushes);
  const step = 0.5;
  const limit = map.size / 2 + 2;
  const key = (x: number, z: number) => `${Math.round(x / step)}:${Math.round(z / step)}`;

  const start = { x: Math.round(from.x / step) * step, z: Math.round(from.z / step) * step };
  const seen = new Set<string>([key(start.x, start.z)]);
  const stack = [start];

  while (stack.length > 0 && seen.size < 20_000) {
    const at = stack.pop()!;
    for (const [dx, dz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const target = { x: at.x + dx, z: at.z + dz };
      if (Math.abs(target.x) > limit || Math.abs(target.z) > limit) continue;
      if (seen.has(key(target.x, target.z))) continue;

      const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
      body.setPosition(vec3(at.x, STANCE.standHeight / 2 + 0.05, at.z));
      // Settle onto the ground before trying to walk anywhere.
      for (let i = 0; i < 6; i += 1) body.move(vec3(0, -0.2, 0));
      const before = body.getPosition();
      for (let i = 0; i < 10; i += 1) body.move(vec3(dx / 10, -0.08, dz / 10));
      const after = body.getPosition();

      if (Math.hypot(after.x - before.x, after.z - before.z) < step * 0.7) continue;
      if (Math.abs(after.x - target.x) > step * 0.6) continue;
      if (Math.abs(after.z - target.z) > step * 0.6) continue;

      seen.add(key(target.x, target.z));
      stack.push(target);
    }
  }
  return seen.size;
};

describe.each(MAP_IDS)("%s is not a trap", (id) => {
  const map = MAPS[id];
  // Every spawn should open onto most of the level. A spawn that reaches only
  // a few hundred cells is sealed in a room; one that reaches a handful is
  // standing on a desk.
  const floor = 2500;

  it("lets a player walk out of every spawn", () => {
    for (const spawn of map.spawns) {
      const reached = capsuleReach(map, spawn);
      expect(
        reached,
        `spawn ${spawn.team} at (${spawn.x}, ${spawn.z}) reaches only ${reached} cells`,
      ).toBeGreaterThan(floor);
    }
  });

  it("puts every spawn on the ground, not on the furniture", () => {
    const world = new BrushWorld(map.brushes);
    for (const spawn of map.spawns) {
      const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
      body.setPosition(vec3(spawn.x, 4, spawn.z));
      for (let i = 0; i < 60; i += 1) body.move(vec3(0, -0.1, 0));
      const feet = body.getPosition().y - STANCE.standHeight / 2;
      expect(
        feet,
        `spawn ${spawn.team} at (${spawn.x}, ${spawn.z}) lands ${feet.toFixed(2)}m up`,
      ).toBeLessThan(0.4);
    }
  });

  it("connects the whole navigable level into one piece", () => {
    const world = new BrushWorld(map.brushes);
    const { grid } = bakeNavGrid(world);

    const component = new Int32Array(grid.nodes.length).fill(-1);
    const sizes: number[] = [];
    for (const node of grid.nodes) {
      if (component[node.index] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [node.index];
      component[node.index] = id;
      while (stack.length > 0) {
        const current = stack.pop()!;
        size += 1;
        for (const link of grid.nodes[current].links) {
          if (component[link] !== -1) continue;
          component[link] = id;
          stack.push(link);
        }
      }
      sizes.push(size);
    }

    // Bots path on this grid, so a second island is a squad that never arrives.
    const largest = Math.max(...sizes);
    expect(largest / grid.nodes.length).toBeGreaterThan(0.97);

    for (const spawn of map.spawns) {
      const node = nearestNode(grid, vec3(spawn.x, 0.1, spawn.z), 6);
      expect(node, `spawn ${spawn.team} has no navigable ground`).not.toBeNull();
      expect(sizes[component[node!.index]]).toBe(largest);
    }
  });
});
