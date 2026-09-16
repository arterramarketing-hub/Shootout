import { describe, expect, it } from "vitest";
import { MOVEMENT, STANCE } from "../src/sim/config";
import { createPlayer, stepPlayer } from "../src/sim/player";
import { emptyInput, type InputFrame } from "../src/sim/types";
import { BrushWorld } from "../src/sim/brushWorld";
import { tickInterval } from "../src/sim/config";
import { vec3 } from "../src/sim/vec3";

/**
 * The dodge: a burst sideways or back that breaks a line of fire, then a
 * wait before the next one. It has to be worth pressing and impossible to
 * live in.
 */

const floor = new BrushWorld([
  { kind: "floor", x: 0, y: -0.5, z: 0, width: 60, height: 1, depth: 60 },
]);

const settle = () => {
  const body = floor.createController(STANCE.radius, STANCE.standHeight / 2);
  const player = createPlayer(vec3(0, STANCE.standHeight / 2, 0), 0);
  body.setPosition(player.position);
  for (let i = 0; i < 10; i += 1) stepPlayer(player, emptyInput(), tickInterval, body);
  return { player, body };
};

const run = (
  player: ReturnType<typeof createPlayer>,
  body: ReturnType<typeof floor.createController>,
  seconds: number,
  frame: Partial<InputFrame> = {},
) => {
  const steps = Math.round(seconds / tickInterval);
  for (let i = 0; i < steps; i += 1) {
    stepPlayer(player, { ...emptyInput(), ...frame, dodgePressed: i === 0 && !!frame.dodgePressed }, tickInterval, body);
  }
};

describe("the dodge", () => {
  it("throws the player the way the stick points, further than a walk would", () => {
    const { player, body } = settle();
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    const dodged = player.position.x;

    const walked = settle();
    run(walked.player, walked.body, MOVEMENT.dodgeTime + 0.05, { moveX: 1 });
    expect(dodged).toBeGreaterThan(walked.player.position.x * 1.8);
    expect(dodged).toBeGreaterThan(2.2);
  });

  it("goes straight back when the stick is centred", () => {
    // Backing off a corner is the dodge everyone wants and the hardest to
    // make on a thumbstick in a hurry, so a press with no stick is that one.
    const { player, body } = settle();
    run(player, body, MOVEMENT.dodgeTime + 0.05, { dodgePressed: true });
    expect(player.position.z).toBeLessThan(-2);
    expect(Math.abs(player.position.x)).toBeLessThan(0.05);
  });

  it("cannot be chained", () => {
    const { player, body } = settle();
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    const afterFirst = player.position.x;
    // Pressed again straight away: nothing beyond the walk.
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    const gain = player.position.x - afterFirst;
    expect(gain).toBeLessThan(MOVEMENT.walkSpeed * (MOVEMENT.dodgeTime + 0.05) * 1.1);
  });

  it("is back after the cooldown", () => {
    const { player, body } = settle();
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    run(player, body, MOVEMENT.dodgeCooldown, {});
    const before = player.position.x;
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    expect(player.position.x - before).toBeGreaterThan(2.2);
  });

  it("does nothing in the air", () => {
    const { player, body } = settle();
    player.grounded = false;
    stepPlayer(player, { ...emptyInput(), moveX: 1, dodgePressed: true }, tickInterval, body);
    expect(player.dodgeTimer).toBe(0);
  });

  it("is over quickly and hands the stick back", () => {
    const { player, body } = settle();
    run(player, body, MOVEMENT.dodgeTime + 0.05, { moveX: 1, dodgePressed: true });
    expect(player.dodgeTimer).toBe(0);
    // Now walking the other way works at once.
    const x = player.position.x;
    run(player, body, 0.5, { moveX: -1 });
    expect(player.position.x).toBeLessThan(x);
  });
});
