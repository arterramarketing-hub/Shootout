import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_ID, MAPS, MAP_IDS, mapById } from "../src/maps";
import { BrushWorld } from "../src/sim/brushWorld";
import { bakeNavGrid } from "../src/sim/navBake";
import { findPathBetween, nearestNode } from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

describe("map registry", () => {
  it("ships at least one level", () => {
    expect(MAP_IDS.length).toBeGreaterThan(0);
  });

  it("has a default that exists", () => {
    expect(MAPS[DEFAULT_MAP_ID]).toBeDefined();
  });

  it("falls back rather than failing on an unknown id", () => {
    expect(mapById("no-such-map")).toBe(MAPS[DEFAULT_MAP_ID]);
  });

  it("keys every map by its own id", () => {
    for (const [key, map] of Object.entries(MAPS)) expect(map.id).toBe(key);
  });
});

describe.each(MAP_IDS)("%s", (id) => {
  const map = MAPS[id];

  it("has geometry and spawns for both sides", () => {
    expect(map.brushes.length).toBeGreaterThan(10);
    expect(map.spawns.some((spawn) => spawn.team === "a")).toBe(true);
    expect(map.spawns.some((spawn) => spawn.team === "b")).toBe(true);
  });

  it("spreads each side's spawns through its wing, on more than one floor", () => {
    // A side that always arrives in one corner is a side that is always
    // waited for in that corner.
    for (const team of ["a", "b"] as const) {
      const points = map.spawns.filter((spawn) => spawn.team === team);
      expect(points.length).toBeGreaterThanOrEqual(12);
      const floors = new Set(points.map((spawn) => Math.round((spawn.y ?? 0) * 10)));
      expect(floors.size).toBeGreaterThanOrEqual(2);
      const zs = points.map((spawn) => spawn.z);
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(30);
    }
  });

  it("keeps each side's spawns on its own side of the street", () => {
    for (const spawn of map.spawns) {
      if (spawn.team === "a") expect(spawn.x).toBeLessThan(-8);
      else expect(spawn.x).toBeGreaterThan(8);
    }
  });

  it("names itself and says what it plays like", () => {
    expect(map.name.length).toBeGreaterThan(0);
    expect(map.tagline.length).toBeGreaterThan(10);
  });

  it("gives every brush a real size", () => {
    for (const brush of map.brushes) {
      expect(brush.width).toBeGreaterThan(0);
      expect(brush.height).toBeGreaterThan(0);
      expect(brush.depth).toBeGreaterThan(0);
    }
  });

  it("keeps spawns inside the playable area", () => {
    const limit = map.size / 2;
    for (const spawn of map.spawns) {
      expect(Math.abs(spawn.x)).toBeLessThan(limit);
      expect(Math.abs(spawn.z)).toBeLessThan(limit);
    }
  });

  it("carries a complete style, with real colours", () => {
    const style = map.style;
    for (const key of ["concrete", "panel", "crate", "metal", "grate", "hazard", "fog"] as const) {
      expect(style[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(style.fillIntensity).toBeGreaterThan(0);
    expect(style.keyIntensity).toBeGreaterThan(0);
  });

  it("bakes a navigation grid a bot can actually cross", () => {
    const world = new BrushWorld(map.brushes);
    const result = bakeNavGrid(world, map.nav);
    expect(result.grid.nodes.length).toBeGreaterThan(800);

    // Every spawn must stand on navigable ground at its own height, or a
    // bot starts stranded and a player starts inside a slab.
    for (const spawn of map.spawns) {
      const y = spawn.y ?? 0;
      const node = nearestNode(result.grid, vec3(spawn.x, y + 0.1, spawn.z), 1);
      expect(node, `spawn at ${spawn.x}, ${spawn.z}, ${y}`).not.toBeNull();
      expect(Math.abs(node!.y - y), `spawn at ${spawn.x}, ${spawn.z}, ${y}`).toBeLessThan(0.6);
    }

    // And every spawn must be able to reach the other side.
    const rust = map.spawns.find((spawn) => spawn.team === "b")!;
    const blue = map.spawns.find((spawn) => spawn.team === "a")!;
    for (const spawn of map.spawns) {
      const foe = spawn.team === "a" ? rust : blue;
      const path = findPathBetween(
        result.grid,
        vec3(spawn.x, (spawn.y ?? 0) + 0.1, spawn.z),
        vec3(foe.x, (foe.y ?? 0) + 0.1, foe.z),
      );
      expect(path, `spawn at ${spawn.x}, ${spawn.z}, ${spawn.y ?? 0}`).not.toBeNull();
      expect(path!.length).toBeGreaterThan(5);
    }
  });

  it("encloses the player, so nobody walks off the edge", () => {
    const world = new BrushWorld(map.brushes);
    const body = world.createController(0.38, 0.9);
    const limit = map.size / 2 + 2;

    for (const direction of [vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1)]) {
      body.setPosition(vec3(0, 0.9, 0));
      for (let step = 0; step < 400; step += 1) {
        body.move(vec3(direction.x * 0.12, -0.05, direction.z * 0.12));
      }
      const position = body.getPosition();
      expect(Math.abs(position.x)).toBeLessThan(limit);
      expect(Math.abs(position.z)).toBeLessThan(limit);
      expect(position.y).toBeGreaterThan(-1);
    }
  });
});
