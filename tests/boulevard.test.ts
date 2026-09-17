import { describe, expect, it } from "vitest";
import { boulevardMap } from "../src/maps/boulevard";
import { BrushWorld } from "../src/sim/brushWorld";
import { STANCE, tickInterval } from "../src/sim/config";
import { createPlayer, stepPlayer } from "../src/sim/player";
import { emptyInput } from "../src/sim/types";
import { findPathBetween, nearestNode } from "../src/sim/nav";
import { bakeNavGrid } from "../src/sim/navBake";
import { vec3 } from "../src/sim/vec3";

/**
 * Boulevard Works is the first map with floors stacked on floors, and the
 * first where the route between two points is not on the ground. These are
 * the promises its layout makes — three lanes, both sides reaching the high
 * ground, the courtyard as the middle — checked against the baked grid the
 * bots will actually path on.
 */

const map = boulevardMap;
const world = new BrushWorld(map.brushes);
const { grid, millis } = bakeNavGrid(world, map.nav);

const spawn = (team: "a" | "b") => map.spawns.find((point) => point.team === team)!;

/** A point on the grid, at the floor height asked for, or the test fails loudly. */
const at = (x: number, y: number, z: number) => {
  const node = nearestNode(grid, vec3(x, y, z), 2);
  expect(node, `no walkable ground near (${x}, ${y}, ${z})`).not.toBeNull();
  expect(Math.abs(node!.y - y), `ground near (${x}, ${z}) is at ${node!.y.toFixed(1)}, not ${y}`).toBeLessThan(0.7);
  return node!;
};

const reaches = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => {
  const path = findPathBetween(grid, vec3(from.x, from.y, from.z), vec3(to.x, to.y, to.z));
  expect(path, `no path from (${from.x}, ${from.y}, ${from.z}) to (${to.x}, ${to.y}, ${to.z})`).not.toBeNull();
  return path!;
};

describe("the three lanes", () => {
  it("bakes quickly enough to load on a phone", () => {
    // Three storeys of frame is several hundred brushes; the broadphase is
    // what keeps this within a blink.
    expect(millis).toBeLessThan(1500);
  });

  it("puts a floor at each level the fight is meant to reach", () => {
    at(-25, 0, 0); // west wing, ground
    at(-25, 4.3, 10); // west wing, first floor
    at(-11, 8.6, 0); // west wing, second-floor landing at the bridge
    at(0, 8.6, 0); // the bridge
    at(11, 8.6, 0); // east landing
    at(0, 0, 10); // the street
    at(20, 0, 0); // the courtyard
    at(29, 0, 10); // rear bar, ground
    at(20, 4.3, 18); // north return, first floor
  });

  it("lets both sides walk onto the bridge", () => {
    const bridge = { x: 0, y: 8.6, z: 0 };
    reaches({ ...spawn("a"), y: 0 }, bridge);
    reaches({ ...spawn("b"), y: 0 }, bridge);
  });

  it("lets both sides reach the courtyard on the ground", () => {
    const courtyard = { x: 20, y: 0, z: 0 };
    reaches({ ...spawn("a"), y: 0 }, courtyard);
    reaches({ ...spawn("b"), y: 0 }, courtyard);
  });

  it("keeps the street and the bridge as separate ways across", () => {
    /*
     * The point of a bridge is that it is a second route. If the street
     * path and the bridge path shared most of their cells, one of them
     * would not be a lane, it would be a detour.
     */
    const west = { x: -10, y: 0, z: 10 };
    const east = { x: 11, y: 0, z: 10 };
    const street = reaches(west, east);
    const overBridge = [...reaches(west, { x: 0, y: 8.6, z: 0 }), ...reaches({ x: 0, y: 8.6, z: 0 }, east)];
    const cell = (point: { x: number; y: number; z: number }) =>
      `${Math.round(point.x / 0.6)}:${Math.round(point.z / 0.6)}:${Math.round(point.y)}`;
    const streetCells = new Set(street.map(cell));
    const shared = overBridge.filter((point) => streetCells.has(cell(point)));
    expect(shared.length / overBridge.length).toBeLessThan(0.35);
  });

  it("keeps the roofs and the tower out of bounds", () => {
    // The fight is ground, first floor and the bridge. A bot that found the
    // roof would be a bot nobody could reach.
    for (const node of grid.nodes) expect(node.y).toBeLessThan(9.6);
  });
});

describe("the ways up", () => {
  it("are all shallow enough to walk", () => {
    // Fallen slabs are the stairs. Anything steeper than the bots' slope
    // limit is a wall with a texture on it.
    const slabs = map.brushes.filter((brush) => brush.pitch && Math.abs(brush.pitch) > 0.3 && brush.depth > 6);
    expect(slabs.length).toBeGreaterThanOrEqual(5);
    for (const slab of slabs) expect(Math.abs(slab.pitch!)).toBeLessThan(Math.acos(0.84));
  });

  it("are climbed by the player, all the way up", () => {
    /*
     * Walked by the game's own player step — gravity, acceleration and all —
     * not by shoving the collider. The bugs that matter live in the
     * collision response, and a hand-driven capsule never meets them.
     */
    const climbs: [number, number, number, number, number][] = [
      [-17, -13.5, -17, -3.5, 0], // west wing, ground to first
      [-11, 21.5, -11, 12.5, 4.3], // west wing, first to the landing
      [17, 2.5, 17, 11.5, 0], // courtyard to the north return
      [23, -2.5, 23, -11.5, 0], // courtyard to the south return
      [11, -21.5, 11, -12.5, 4.3], // east bar, first to the landing
    ];
    for (const [x1, z1, x2, z2, floor] of climbs) {
      const yaw = Math.atan2(x2 - x1, z2 - z1);
      const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
      const player = createPlayer(vec3(x1, floor + STANCE.standHeight / 2 + 0.05, z1), yaw);
      body.setPosition(player.position);
      for (let i = 0; i < 10; i += 1) stepPlayer(player, { ...emptyInput(), yaw }, tickInterval, body);
      for (let i = 0; i < Math.round(4 / tickInterval); i += 1) {
        stepPlayer(player, { ...emptyInput(), moveY: 1, yaw }, tickInterval, body);
      }
      const end = player.position;
      const wanted = Math.hypot(x2 - x1, z2 - z1);
      const gone = ((end.x - x1) * (x2 - x1) + (end.z - z1) * (z2 - z1)) / wanted;
      expect(gone, `stuck at (${end.x.toFixed(1)}, ${end.z.toFixed(1)}) climbing from (${x1}, ${z1})`).toBeGreaterThan(wanted - 1);
      expect(end.y - floor).toBeGreaterThan(4.3 + STANCE.standHeight / 2 - 0.3);
    }
  });
});

describe("surfaces", () => {
  /*
   * Two faces in one plane are drawn in an order the depth buffer cannot
   * settle, and the surface flickers as the camera moves. The frame is
   * drawn block by block and the bridge meets the buildings at floor level,
   * so the map is checked for the two ways that goes wrong: a brush drawn
   * twice, and two floors sharing a top surface.
   */
  const upright = map.brushes.filter((brush) => !brush.yaw && !brush.pitch);
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

  it("draws no brush twice", () => {
    const seen = new Set<string>();
    for (const brush of map.brushes) {
      const key = JSON.stringify([brush.kind, brush.x, brush.y, brush.z, brush.width, brush.height, brush.depth, brush.yaw ?? 0, brush.pitch ?? 0]);
      expect(seen.has(key), `brush drawn twice: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("gives no two floors the same top surface", () => {
    // Beams cross inside columns and share tops there, hidden; only the
    // surfaces people walk on and look down at are checked.
    const walkable = new Set(["floor", "rubble", "asphalt", "catwalk"]);
    const floors = upright.filter((brush) => walkable.has(brush.kind) && brush.y + brush.height / 2 > 0.05);
    for (let i = 0; i < floors.length; i += 1) {
      for (let j = i + 1; j < floors.length; j += 1) {
        const a = floors[i];
        const b = floors[j];
        if (Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) > 0.002) continue;
        const across = overlap(a.x - a.width / 2, a.x + a.width / 2, b.x - b.width / 2, b.x + b.width / 2);
        const along = overlap(a.z - a.depth / 2, a.z + a.depth / 2, b.z - b.depth / 2, b.z + b.depth / 2);
        if (across <= 0.01 || along <= 0.01) continue;
        expect.fail(
          `${a.kind} at (${a.x}, ${a.z}) and ${b.kind} at (${b.x}, ${b.z}) share a top at y=${(a.y + a.height / 2).toFixed(2)} over ${(across * along).toFixed(2)} m²`,
        );
      }
    }
  });
});
