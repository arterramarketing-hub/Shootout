import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_ID, MAPS, MAP_IDS, mapById } from "../src/maps";
import { BrushWorld } from "../src/sim/brushWorld";
import { bakeNavGrid } from "../src/sim/navBake";
import { findPathBetween, nearestNode } from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

describe("map registry", () => {
  it("ships more than one level", () => {
    expect(MAP_IDS.length).toBeGreaterThan(1);
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

  it("has geometry, spawns for both sides, and something to shoot", () => {
    expect(map.brushes.length).toBeGreaterThan(10);
    expect(map.spawns.some((spawn) => spawn.team === "a")).toBe(true);
    expect(map.spawns.some((spawn) => spawn.team === "b")).toBe(true);
    expect(map.targets.length).toBeGreaterThan(0);
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

  it("gives every target a distinct identifier", () => {
    const ids = map.targets.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
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

    // Every spawn must stand on navigable ground, or bots start stranded.
    for (const spawn of map.spawns) {
      const node = nearestNode(result.grid, vec3(spawn.x, 0.1, spawn.z), 4);
      expect(node).not.toBeNull();
    }

    // And the two sides must be able to reach each other.
    const blue = map.spawns.find((spawn) => spawn.team === "a")!;
    const rust = map.spawns.find((spawn) => spawn.team === "b")!;
    const path = findPathBetween(
      result.grid,
      vec3(blue.x, 0.1, blue.z),
      vec3(rust.x, 0.1, rust.z),
    );
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(5);
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
