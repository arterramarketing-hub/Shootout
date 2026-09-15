import { describe, expect, it } from "vitest";
import { BrushWorld } from "../src/sim/brushWorld";
import type { BoxBrush } from "../src/maps/types";
import { bakeNavGrid } from "../src/sim/navBake";
import { pruneIsolated, createEmptyGrid, addNode, linkNodes } from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

/** A floor with four walls around a ten metre room. */
const room = (): BoxBrush[] => [
  { kind: "floor", x: 0, y: -0.5, z: 0, width: 20, height: 1, depth: 20 },
  { kind: "wall", x: 0, y: 2, z: 5, width: 20, height: 4, depth: 0.4 },
  { kind: "wall", x: 0, y: 2, z: -5, width: 20, height: 4, depth: 0.4 },
  { kind: "wall", x: 5, y: 2, z: 0, width: 0.4, height: 4, depth: 20 },
  { kind: "wall", x: -5, y: 2, z: 0, width: 0.4, height: 4, depth: 20 },
];

/** A capsule standing in the middle of a room, ready to move. */
const standingWorld = (brushes = room()) => {
  const body = new BrushWorld(brushes).createController(0.38, 0.9);
  body.setPosition(vec3(0, 0.9, 0));
  return body;
};

describe("collision", () => {
  it("holds a capsule up on the floor", () => {
    const world = standingWorld();
    for (let i = 0; i < 60; i += 1) world.move(vec3(0, -0.1, 0));
    expect(world.getPosition().y).toBeCloseTo(0.9, 2);
    expect(world.grounded).toBe(true);
  });

  it("reports airborne when there is nothing underneath", () => {
    const world = standingWorld([]);
    world.move(vec3(0, -0.1, 0));
    expect(world.grounded).toBe(false);
  });

  it("stops at a wall instead of passing through it", () => {
    const world = standingWorld();
    for (let i = 0; i < 200; i += 1) world.move(vec3(0, 0, 0.1));
    // The wall stands at z = 5 and the capsule has a radius, so it must halt short.
    expect(world.getPosition().z).toBeLessThan(4.8);
  });

  it("cannot be forced through a wall by one enormous step", () => {
    const world = standingWorld();
    world.move(vec3(0, 0, 40));
    expect(world.getPosition().z).toBeLessThan(4.8);
  });

  it("slides along a wall rather than sticking to it", () => {
    const world = standingWorld();
    for (let i = 0; i < 120; i += 1) world.move(vec3(0.06, 0, 0.06));
    const position = world.getPosition();
    expect(position.z).toBeLessThan(4.8);
    // Blocked forward, but the sideways component still made ground.
    expect(position.x).toBeGreaterThan(1.5);
  });

  it("reports how far it actually travelled", () => {
    const world = standingWorld();
    world.setPosition(vec3(0, 0.9, 4.3));
    const moved = world.move(vec3(0, 0, 2));
    expect(moved.z).toBeLessThan(2);
    expect(moved.z).toBeGreaterThan(0);
  });

  it("walks up a ramp", () => {
    const brushes: BoxBrush[] = [
      ...room(),
      { kind: "catwalk", x: 0, y: 0.75, z: 2, width: 4, height: 0.3, depth: 5, pitch: -0.35 },
    ];
    const world = standingWorld(brushes);
    world.setPosition(vec3(0, 0.9, -0.5));
    for (let i = 0; i < 200; i += 1) {
      world.move(vec3(0, -0.04, 0.03));
    }
    // The ramp climbs toward positive z, so the capsule should end up higher.
    expect(world.getPosition().y).toBeGreaterThan(1.2);
  });

  it("keeps the feet planted when the stance shrinks", () => {
    const world = standingWorld();
    const feet = world.getPosition().y - 0.9;
    world.setSize(0.38, 0.6);
    expect(world.getPosition().y - 0.6).toBeCloseTo(feet, 6);
  });

  it("knows when there is no headroom to stand up", () => {
    const low: BoxBrush[] = [
      ...room(),
      { kind: "wall", x: 0, y: 1.3, z: 0, width: 3, height: 0.3, depth: 3 },
    ];
    const body = new BrushWorld(low).createController(0.38, 0.6);
    body.setPosition(vec3(0, 0.6, 0));
    expect(body.hasHeadroom(0.6, 0.9)).toBe(false);
    body.setPosition(vec3(4, 0.6, 0));
    expect(body.hasHeadroom(0.6, 0.9)).toBe(true);
  });
});

describe("hitscan", () => {
  it("hits level geometry and reports the surface normal", () => {
    const world = new BrushWorld(room());
    const hit = world.raycast(vec3(0, 1.6, 0), vec3(0, 0, 1), 50);
    expect(hit).not.toBeNull();
    expect(hit!.targetId).toBeNull();
    expect(hit!.normal.z).toBeCloseTo(-1, 6);
  });

  it("returns nothing when the ray reaches open air", () => {
    const world = new BrushWorld([]);
    expect(world.raycast(vec3(0, 1.6, 0), vec3(0, 0, 1), 50)).toBeNull();
  });

  it("finds a registered hitbox and marks a head", () => {
    const world = new BrushWorld(room());
    world.setHitboxes("enemy", [
      { center: vec3(0, 1.0, 3), halfExtents: vec3(0.25, 0.5, 0.25), isHead: false },
      { center: vec3(0, 1.62, 3), halfExtents: vec3(0.13, 0.13, 0.13), isHead: true },
    ]);
    const body = world.raycast(vec3(0, 1.0, 0), vec3(0, 0, 1), 50);
    expect(body!.targetId).toBe("enemy");
    expect(body!.headshot).toBe(false);

    const head = world.raycast(vec3(0, 1.62, 0), vec3(0, 0, 1), 50);
    expect(head!.targetId).toBe("enemy");
    expect(head!.headshot).toBe(true);
  });

  it("lets a wall shield a target behind it", () => {
    const world = new BrushWorld(room());
    // Beyond the far wall, so cover should win.
    world.setHitboxes("enemy", [
      { center: vec3(0, 1.0, 8), halfExtents: vec3(0.25, 0.5, 0.25), isHead: false },
    ]);
    const hit = world.raycast(vec3(0, 1.0, 0), vec3(0, 0, 1), 50);
    expect(hit!.targetId).toBeNull();
  });

  it("returns the nearest of two targets", () => {
    const world = new BrushWorld([]);
    world.setHitboxes("far", [
      { center: vec3(0, 1, 10), halfExtents: vec3(0.4, 0.5, 0.4), isHead: false },
    ]);
    world.setHitboxes("near", [
      { center: vec3(0, 1, 4), halfExtents: vec3(0.4, 0.5, 0.4), isHead: false },
    ]);
    expect(world.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 50)!.targetId).toBe("near");
  });

  it("makes a shooter transparent to its own rays", () => {
    const world = new BrushWorld([]);
    world.setHitboxes("me", [
      { center: vec3(0, 1, 0), halfExtents: vec3(0.3, 0.5, 0.3), isHead: true },
    ]);
    world.setHitboxes("them", [
      { center: vec3(0, 1, 6), halfExtents: vec3(0.3, 0.5, 0.3), isHead: false },
    ]);
    expect(world.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 50, "me")!.targetId).toBe("them");
    expect(world.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 50)!.targetId).toBe("me");
  });

  it("forgets a hitbox once it is cleared", () => {
    const world = new BrushWorld([]);
    world.setHitboxes("enemy", [
      { center: vec3(0, 1, 5), halfExtents: vec3(0.3, 0.5, 0.3), isHead: false },
    ]);
    expect(world.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 50)).not.toBeNull();
    world.setHitboxes("enemy", []);
    expect(world.raycast(vec3(0, 1, 0), vec3(0, 0, 1), 50)).toBeNull();
  });
});

describe("navigation bake", () => {
  it("finds the floor of a room", () => {
    const world = new BrushWorld(room());
    const result = bakeNavGrid(world, {
      halfExtent: 5,
      cellSize: 0.5,
      ceilingY: 3.5,
      maxWalkableY: 3,
      headroom: 1.7,
      maxSlopeNormalY: 0.84,
      maxLayers: 2,
    });
    expect(result.grid.nodes.length).toBeGreaterThan(100);
    // Every node sits on the floor, which is the only walkable surface here.
    for (const node of result.grid.nodes) expect(node.y).toBeCloseTo(0, 3);
  });

  it("finds no ground in empty space", () => {
    const result = bakeNavGrid(new BrushWorld([]), {
      halfExtent: 3,
      cellSize: 1,
      ceilingY: 3,
      maxWalkableY: 3,
      headroom: 1.7,
      maxSlopeNormalY: 0.84,
      maxLayers: 1,
    });
    expect(result.grid.nodes).toHaveLength(0);
  });
});

describe("pruneIsolated", () => {
  it("keeps the largest component whatever its size, not a fixed minimum", () => {
    // The rule is reachability, not size: a big pocket nothing can climb into
    // is as useless as a small one, and the flat top of a tall prop is a big
    // pocket. Two components, the smaller one goes, however many nodes it has.
    const grid = createEmptyGrid(1, 0, 0, 12, 4);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 5; col += 1) addNode(grid, col, row, 0);
    }
    // A sizeable perch, well clear of the ground and of any link to it.
    for (let row = 0; row < 4; row += 1) {
      for (let col = 8; col < 12; col += 1) addNode(grid, col, row, 9);
    }
    linkNodes(grid);

    expect(pruneIsolated(grid)).toBe(16);
    expect(grid.nodes).toHaveLength(20);
    expect(grid.nodes.every((node) => node.y === 0)).toBe(true);
  });

  it("removes an island nothing links to", () => {
    const grid = createEmptyGrid(1, 0, 0, 6, 6);
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) addNode(grid, col, row, 0);
    }
    // A lone perch far above, reachable from nowhere.
    addNode(grid, 2, 2, 5);
    linkNodes(grid);
    const before = grid.nodes.length;

    const removed = pruneIsolated(grid);
    expect(removed).toBe(1);
    expect(grid.nodes).toHaveLength(before - 1);
    expect(grid.nodes.every((node) => node.y === 0)).toBe(true);
  });

  it("leaves a fully connected grid alone", () => {
    const grid = createEmptyGrid(1, 0, 0, 6, 6);
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) addNode(grid, col, row, 0);
    }
    linkNodes(grid);
    expect(pruneIsolated(grid)).toBe(0);
    expect(grid.nodes).toHaveLength(36);
  });

  it("renumbers surviving nodes so their indices stay valid", () => {
    const grid = createEmptyGrid(1, 0, 0, 6, 6);
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) addNode(grid, col, row, 0);
    }
    addNode(grid, 0, 0, 9);
    linkNodes(grid);
    pruneIsolated(grid);
    grid.nodes.forEach((node, index) => {
      expect(node.index).toBe(index);
      for (const link of node.links) expect(grid.nodes[link]).toBeDefined();
    });
  });
});
