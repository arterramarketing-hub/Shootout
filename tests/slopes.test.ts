import { describe, expect, it } from "vitest";
import { BrushWorld } from "../src/sim/brushWorld";
import { STANCE, tickInterval } from "../src/sim/config";
import { createPlayer, stepPlayer } from "../src/sim/player";
import { emptyInput } from "../src/sim/types";
import { vec3 } from "../src/sim/vec3";
import type { BoxBrush } from "../src/maps/types";

/**
 * Ramps and ledges, walked by the player the way the game walks them.
 *
 * These use `stepPlayer` — gravity, acceleration, the collision response —
 * rather than shoving the collider by hand, because the bugs live in the
 * response: a capsule pushed into a ramp is pushed back out of it, and a
 * kerb is a wall to a controller that never tries stepping over anything.
 */

const FLOOR: BoxBrush = { kind: "floor", x: 0, y: -0.5, z: 0, width: 80, height: 1, depth: 80 };

/** A ramp rising from z=0 to z=run at the given angle, like a fallen slab. */
const ramp = (angleDegrees: number, run: number): BoxBrush => {
  const angle = (angleDegrees * Math.PI) / 180;
  const rise = Math.tan(angle) * run;
  return {
    kind: "floor",
    x: 0,
    y: rise / 2 - (0.3 / 2) * Math.cos(angle),
    z: run / 2,
    width: 6,
    height: 0.3,
    depth: Math.hypot(run, rise),
    pitch: -angle,
  };
};

const walker = (brushes: BoxBrush[], start: { x: number; z: number; y?: number }, yaw = 0) => {
  const world = new BrushWorld(brushes);
  const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
  const player = createPlayer(vec3(start.x, (start.y ?? 0) + STANCE.standHeight / 2 + 0.05, start.z), yaw);
  body.setPosition(player.position);
  for (let i = 0; i < 10; i += 1) stepPlayer(player, { ...emptyInput(), yaw }, tickInterval, body);
  const walk = (seconds: number, moveY = 1) => {
    for (let i = 0; i < Math.round(seconds / tickInterval); i += 1) {
      stepPlayer(player, { ...emptyInput(), moveY, yaw }, tickInterval, body);
    }
    return player.position;
  };
  return { player, walk };
};

describe("ramps", () => {
  it("are climbed at most of walking speed", () => {
    const { walk } = walker([FLOOR, ramp(23, 10)], { x: 0, z: -1 });
    const end = walk(3);
    // Ten metres of run at four a second, less the slope.
    expect(end.z).toBeGreaterThan(8);
    expect(end.y).toBeGreaterThan(3.5);
  });

  it("are climbed when steep, up to the limit the bots use", () => {
    const { walk } = walker([FLOOR, ramp(32, 8)], { x: 0, z: -1 });
    const end = walk(3);
    expect(end.z).toBeGreaterThan(6);
  });

  it("are climbed without leaving the ground or hopping", () => {
    /*
     * The first push into the foot of a ramp is cut short by the slope, and
     * the step-over used to take that for a kerb: half a metre straight up,
     * a fall back onto the ramp, and again eight ticks later, all the way up.
     */
    const { player, walk } = walker([FLOOR, ramp(23, 10)], { x: 0, z: -1 });
    let previous = player.position.y;
    for (let i = 0; i < 150; i += 1) {
      walk(tickInterval);
      expect(player.grounded).toBe(true);
      expect(player.position.y - previous).toBeLessThan(0.05);
      expect(player.position.y - previous).toBeGreaterThan(-0.01);
      previous = player.position.y;
    }
    expect(player.position.y).toBeGreaterThan(3);
  });

  it("are walked down at a run without skipping off them", () => {
    const top = Math.tan((23 * Math.PI) / 180) * 10;
    const landing: BoxBrush = { kind: "floor", x: 0, y: top - 0.15, z: 14, width: 6, height: 0.3, depth: 8 };
    const { player, walk } = walker([FLOOR, ramp(23, 10), landing], { x: 0, z: 13, y: top }, Math.PI);
    let previous = player.position.y;
    for (let i = 0; i < 200; i += 1) {
      walk(tickInterval);
      expect(player.grounded).toBe(true);
      expect(player.position.y - previous).toBeLessThan(0.005);
      expect(player.position.y - previous).toBeGreaterThan(-0.06);
      previous = player.position.y;
    }
    expect(player.position.y).toBeLessThan(1.5);
  });

  it("do not let a standing player creep down them", () => {
    /*
     * Gravity presses the capsule into the slope, the slope pushes it back
     * out along its normal, and the horizontal part of that push is a slide
     * — a few centimetres a second, enough to carry someone out of cover
     * while they are lining up a shot.
     */
    const { walk } = walker([FLOOR, ramp(23, 10)], { x: 0, z: -1 });
    walk(1.5);
    const rested = { ...walk(0.5, 0) };
    const later = walk(3, 0);
    expect(Math.abs(later.z - rested.z)).toBeLessThan(0.02);
    expect(Math.abs(later.y - rested.y)).toBeLessThan(0.05);
  });

  it("are walked down without stopping at the bottom", () => {
    const { walk } = walker([FLOOR, ramp(23, 10)], { x: 0, z: 9.5, y: Math.tan((23 * Math.PI) / 180) * 9.5 }, Math.PI);
    const end = walk(4);
    expect(end.z).toBeLessThan(-3);
    expect(end.y).toBeLessThan(1);
  });
});

describe("ledges", () => {
  const ledge = (height: number): BoxBrush => ({
    kind: "floor", x: 0, y: height / 2, z: 10, width: 20, height, depth: 10,
  });

  it("the height of a kerb are walked straight over", () => {
    const { walk } = walker([FLOOR, ledge(0.15)], { x: 0, z: 0 });
    const end = walk(3);
    expect(end.z).toBeGreaterThan(9);
    expect(end.y).toBeCloseTo(STANCE.standHeight / 2 + 0.15, 0);
  });

  it("the height of a slab edge are stepped up", () => {
    const { walk } = walker([FLOOR, ledge(0.42)], { x: 0, z: 0 });
    const end = walk(3);
    expect(end.z).toBeGreaterThan(9);
    expect(end.y).toBeGreaterThan(STANCE.standHeight / 2 + 0.35);
  });

  it("the height of a spandrel are cover, not a stair", () => {
    // Chest-high brick under every window is the map's cover. If a player
    // could walk up it, every window would be a door.
    const { walk } = walker([FLOOR, ledge(0.95)], { x: 0, z: 0 });
    const end = walk(3);
    expect(end.z).toBeLessThan(5);
    expect(end.y).toBeLessThan(STANCE.standHeight / 2 + 0.2);
  });

  it("a wall still stops the player dead", () => {
    const { player, walk } = walker([FLOOR, ledge(3)], { x: 0, z: 0 });
    walk(3);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(0.5);
    expect(player.position.z).toBeLessThan(5);
  });
});
