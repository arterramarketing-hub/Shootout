import { describe, expect, it } from "vitest";
import {
  addNode,
  createEmptyGrid,
  findPath,
  findPathBetween,
  linkNodes,
  nearestNode,
  nodeWorldPosition,
  worldToCell,
  MAX_STEP,
  type NavGrid,
} from "../src/sim/nav";
import { vec3 } from "../src/sim/vec3";

/** A flat square of walkable cells. */
const flatGrid = (size: number, cellSize = 1): NavGrid => {
  const grid = createEmptyGrid(cellSize, 0, 0, size, size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) addNode(grid, col, row, 0);
  }
  linkNodes(grid);
  return grid;
};

describe("grid geometry", () => {
  it("round-trips a world position through a cell", () => {
    const grid = flatGrid(5, 0.5);
    const cell = worldToCell(grid, 1.5, 2.0);
    expect(cell).toEqual({ col: 3, row: 4 });
  });

  it("places nodes at their cell centres", () => {
    const grid = createEmptyGrid(2, -10, -10, 4, 4);
    const node = addNode(grid, 2, 3, 1.5);
    expect(nodeWorldPosition(grid, node)).toEqual({ x: -6, y: 1.5, z: -4 });
  });
});

describe("linkNodes", () => {
  it("connects a node to all eight neighbours in open ground", () => {
    const grid = flatGrid(5);
    const middle = grid.nodes.find((node) => node.col === 2 && node.row === 2)!;
    expect(middle.links).toHaveLength(8);
  });

  it("gives a corner only three neighbours", () => {
    const grid = flatGrid(5);
    const corner = grid.nodes.find((node) => node.col === 0 && node.row === 0)!;
    expect(corner.links).toHaveLength(3);
  });

  it("refuses a step taller than the limit", () => {
    const grid = createEmptyGrid(1, 0, 0, 2, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 1, 0, MAX_STEP + 0.5);
    linkNodes(grid);
    expect(grid.nodes[0].links).toHaveLength(0);
  });

  it("allows a step inside the limit", () => {
    const grid = createEmptyGrid(1, 0, 0, 2, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 1, 0, MAX_STEP - 0.05);
    linkNodes(grid);
    expect(grid.nodes[0].links).toEqual([1]);
  });

  it("refuses a diagonal that would cut a wall corner", () => {
    // Two nodes touching only at a corner, with both orthogonals missing.
    const grid = createEmptyGrid(1, 0, 0, 2, 2);
    addNode(grid, 0, 0, 0);
    addNode(grid, 1, 1, 0);
    linkNodes(grid);
    expect(grid.nodes[0].links).toHaveLength(0);
  });

  it("keeps separate layers apart at the same cell", () => {
    const grid = createEmptyGrid(1, 0, 0, 2, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 0, 0, 3);
    addNode(grid, 1, 0, 0);
    linkNodes(grid);
    const upper = grid.nodes[1];
    expect(upper.links).toHaveLength(0);
  });
});

describe("nearestNode", () => {
  it("finds the node under a position", () => {
    const grid = flatGrid(5);
    const node = nearestNode(grid, vec3(2.1, 0, 1.9));
    expect(node).not.toBeNull();
    expect(node!.col).toBe(2);
    expect(node!.row).toBe(2);
  });

  it("prefers the layer at the right height", () => {
    const grid = createEmptyGrid(1, 0, 0, 1, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 0, 0, 3);
    linkNodes(grid);
    expect(nearestNode(grid, vec3(0, 2.9, 0))!.y).toBe(3);
    expect(nearestNode(grid, vec3(0, 0.1, 0))!.y).toBe(0);
  });

  it("returns null when nothing is within reach", () => {
    const grid = flatGrid(3);
    expect(nearestNode(grid, vec3(60, 0, 60), 2)).toBeNull();
  });
});

describe("findPath", () => {
  it("returns an empty path when already there", () => {
    const grid = flatGrid(4);
    expect(findPath(grid, 0, 0)).toEqual([]);
  });

  it("crosses open ground", () => {
    const grid = flatGrid(6);
    const path = findPath(grid, 0, grid.nodes.length - 1);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    const last = path![path!.length - 1];
    expect(last.x).toBe(5);
    expect(last.z).toBe(5);
  });

  it("takes the diagonal rather than walking the edges", () => {
    const grid = flatGrid(6);
    const path = findPath(grid, 0, grid.nodes.length - 1)!;
    // Five diagonal steps beat ten orthogonal ones.
    expect(path.length).toBeLessThanOrEqual(6);
  });

  it("routes around a wall instead of through it", () => {
    const grid = createEmptyGrid(1, 0, 0, 5, 3);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        // A wall down the middle, with a gap along the bottom row.
        if (col === 2 && row !== 2) continue;
        addNode(grid, col, row, 0);
      }
    }
    linkNodes(grid);
    const start = grid.nodes.find((n) => n.col === 0 && n.row === 0)!;
    const goal = grid.nodes.find((n) => n.col === 4 && n.row === 0)!;
    const path = findPath(grid, start.index, goal.index);
    expect(path).not.toBeNull();
    // The only way through is the gap, so the path must dip to the far row.
    expect(path!.some((point) => point.z === 2)).toBe(true);
  });

  it("returns null when the goal is walled off", () => {
    const grid = createEmptyGrid(1, 0, 0, 3, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 2, 0, 0);
    linkNodes(grid);
    expect(findPath(grid, 0, 1)).toBeNull();
  });

  it("gives up rather than searching forever", () => {
    const grid = flatGrid(30);
    // A tiny budget cannot reach the far corner, and must not hang trying.
    expect(findPath(grid, 0, grid.nodes.length - 1, 5)).toBeNull();
  });

  it("climbs between layers when a ramp links them", () => {
    const grid = createEmptyGrid(1, 0, 0, 4, 1);
    addNode(grid, 0, 0, 0);
    addNode(grid, 1, 0, 0.4);
    addNode(grid, 2, 0, 0.8);
    addNode(grid, 3, 0, 1.2);
    linkNodes(grid);
    const path = findPath(grid, 0, 3);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1].y).toBeCloseTo(1.2, 5);
  });
});

describe("findPathBetween", () => {
  it("plans between two world positions", () => {
    const grid = flatGrid(6);
    const path = findPathBetween(grid, vec3(0, 0, 0), vec3(5, 0, 5));
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  it("returns null when a position is off the grid", () => {
    const grid = flatGrid(4);
    expect(findPathBetween(grid, vec3(0, 0, 0), vec3(80, 0, 80))).toBeNull();
  });
});
