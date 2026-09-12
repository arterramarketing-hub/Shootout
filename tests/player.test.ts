import { describe, expect, it } from "vitest";
import { MOVEMENT, STANCE, tickInterval } from "../src/sim/config";
import {
  createPlayer,
  directionalSpeed,
  eyeOffset,
  stanceHalfHeight,
  stepPlayer,
  stickToWorld,
  wantsSprint,
} from "../src/sim/player";
import { emptyInput, type CollisionWorld, type InputFrame } from "../src/sim/types";
import { vec3, type Vec3 } from "../src/sim/vec3";

/** A world with a floor at y=0 and nothing else. */
class FlatWorld implements CollisionWorld {
  position: Vec3 = vec3(0, STANCE.standHeight / 2, 0);
  halfHeight: number = STANCE.standHeight / 2;
  radius: number = STANCE.radius;
  ceilingHeight = Infinity;

  setSize(radius: number, halfHeight: number): void {
    this.position.y += halfHeight - this.halfHeight;
    this.radius = radius;
    this.halfHeight = halfHeight;
  }

  move(displacement: Vec3): Vec3 {
    const target = {
      x: this.position.x + displacement.x,
      y: this.position.y + displacement.y,
      z: this.position.z + displacement.z,
    };
    const floor = this.halfHeight;
    if (target.y < floor) target.y = floor;
    const achieved = vec3(
      target.x - this.position.x,
      target.y - this.position.y,
      target.z - this.position.z,
    );
    this.position = target;
    return achieved;
  }

  getPosition(): Vec3 {
    return { ...this.position };
  }

  setPosition(position: Vec3): void {
    this.position = { ...position };
  }

  hasHeadroom(fromHalfHeight: number, toHalfHeight: number): boolean {
    return this.position.y + toHalfHeight * 2 - fromHalfHeight <= this.ceilingHeight;
  }
}

const run = (
  world: FlatWorld,
  input: Partial<InputFrame>,
  seconds: number,
  state = createPlayer(world.getPosition()),
) => {
  const frame = { ...emptyInput(), ...input };
  const steps = Math.round(seconds / tickInterval);
  for (let i = 0; i < steps; i += 1) stepPlayer(state, frame, tickInterval, world);
  return state;
};

describe("directionalSpeed", () => {
  it("is zero with no input", () => {
    expect(directionalSpeed(0, 0, MOVEMENT.walkSpeed)).toBe(0);
  });

  it("gives full speed straight forward", () => {
    expect(directionalSpeed(0, 1, MOVEMENT.walkSpeed)).toBeCloseTo(MOVEMENT.walkSpeed, 5);
  });

  it("penalises backpedalling", () => {
    const back = directionalSpeed(0, -1, MOVEMENT.walkSpeed);
    expect(back).toBeCloseTo(MOVEMENT.walkSpeed * MOVEMENT.backMultiplier, 5);
    expect(back).toBeLessThan(directionalSpeed(0, 1, MOVEMENT.walkSpeed));
  });

  it("penalises strafing", () => {
    expect(directionalSpeed(1, 0, MOVEMENT.walkSpeed)).toBeCloseTo(
      MOVEMENT.walkSpeed * MOVEMENT.strafeMultiplier,
      5,
    );
  });

  it("scales with partial stick deflection", () => {
    const half = directionalSpeed(0, 0.5, MOVEMENT.walkSpeed);
    expect(half).toBeCloseTo(MOVEMENT.walkSpeed * 0.5, 5);
  });
});

describe("wantsSprint", () => {
  const frame = (moveX: number, moveY: number): InputFrame => ({
    ...emptyInput(),
    moveX,
    moveY,
  });

  it("requires a near-full stick", () => {
    expect(wantsSprint(frame(0, 0.5))).toBe(false);
    expect(wantsSprint(frame(0, 1))).toBe(true);
  });

  it("refuses to sprint backwards", () => {
    expect(wantsSprint(frame(0, -1))).toBe(false);
  });

  it("refuses to sprint sideways", () => {
    expect(wantsSprint(frame(1, 0))).toBe(false);
  });
});

describe("stickToWorld", () => {
  it("maps forward to +Z at zero yaw", () => {
    const direction = stickToWorld(0, 1, 0);
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.z).toBeCloseTo(1, 6);
  });

  it("maps forward to +X at a quarter turn", () => {
    const direction = stickToWorld(0, 1, Math.PI / 2);
    expect(direction.x).toBeCloseTo(1, 6);
    expect(direction.z).toBeCloseTo(0, 6);
  });

  it("maps strafe right to +X at zero yaw", () => {
    const direction = stickToWorld(1, 0, 0);
    expect(direction.x).toBeCloseTo(1, 6);
    expect(direction.z).toBeCloseTo(0, 6);
  });

  it("preserves magnitude under rotation", () => {
    for (const yaw of [0, 0.7, 2.1, -1.3]) {
      const direction = stickToWorld(0.6, 0.8, yaw);
      expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1, 6);
    }
  });
});

describe("stepPlayer", () => {
  it("settles on the floor and reports grounded", () => {
    const world = new FlatWorld();
    const state = run(world, {}, 0.5);
    expect(state.grounded).toBe(true);
    expect(state.position.y).toBeCloseTo(STANCE.standHeight / 2, 4);
  });

  it("reaches walk speed and does not exceed it", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1 }, 2);
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    expect(speed).toBeCloseTo(MOVEMENT.walkSpeed, 1);
    expect(speed).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 1e-6);
  });

  it("reaches sprint speed only with the stick pushed forward", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1, sprint: true }, 2);
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeCloseTo(
      MOVEMENT.sprintSpeed,
      1,
    );
    expect(state.sprinting).toBe(true);
  });

  it("does not sprint while crouched", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1, sprint: true, crouch: true }, 2);
    expect(state.sprinting).toBe(false);
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeCloseTo(
      MOVEMENT.crouchSpeed,
      1,
    );
  });

  it("keeps the sprint-out timer up while sprinting and drains it after", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1, sprint: true }, 1);
    expect(state.sprintOutTimer).toBeCloseTo(MOVEMENT.sprintOutTime, 5);
    run(world, { moveY: 0 }, MOVEMENT.sprintOutTime + 0.1, state);
    expect(state.sprintOutTimer).toBe(0);
  });

  it("decelerates to a stop when the stick is released", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1 }, 1.5);
    run(world, { moveY: 0 }, 1, state);
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeCloseTo(0, 4);
  });

  it("moves in the direction it faces", () => {
    const world = new FlatWorld();
    const state = run(world, { moveY: 1, yaw: Math.PI / 2 }, 1);
    expect(state.position.x).toBeGreaterThan(1);
    expect(Math.abs(state.position.z)).toBeLessThan(0.2);
  });

  it("lowers the collider and the eye when crouching", () => {
    const world = new FlatWorld();
    const standing = run(world, {}, 0.5);
    const standingEye = standing.position.y + eyeOffset(standing);
    const crouched = run(world, { crouch: true }, 1, standing);
    const crouchedEye = crouched.position.y + eyeOffset(crouched);
    expect(crouched.crouchAmount).toBeCloseTo(1, 3);
    expect(crouchedEye).toBeLessThan(standingEye);
    expect(crouchedEye).toBeCloseTo(STANCE.crouchEyeHeight, 2);
  });

  it("stays crouched when there is no headroom", () => {
    const world = new FlatWorld();
    const state = run(world, { crouch: true }, 1);
    world.ceilingHeight = STANCE.crouchHeight + 0.1;
    run(world, { crouch: false }, 1, state);
    expect(state.crouchAmount).toBeGreaterThan(0.9);
  });

  it("leans and returns to centre", () => {
    const world = new FlatWorld();
    const state = run(world, { leanRight: true }, 0.5);
    expect(state.leanAmount).toBeCloseTo(1, 3);
    run(world, {}, 0.5, state);
    expect(state.leanAmount).toBeCloseTo(0, 3);
  });

  it("accumulates bob distance only while moving on the ground", () => {
    const world = new FlatWorld();
    const moving = run(world, { moveY: 1 }, 1);
    expect(moving.bobDistance).toBeGreaterThan(1);
    const before = moving.bobDistance;
    run(world, {}, 1, moving);
    expect(moving.bobDistance - before).toBeLessThan(0.5);
  });

  it("is frame-rate independent", () => {
    const coarse = new FlatWorld();
    const fine = new FlatWorld();
    const frame = { ...emptyInput(), moveY: 1 };
    const coarseState = createPlayer(coarse.getPosition());
    const fineState = createPlayer(fine.getPosition());
    for (let i = 0; i < 120; i += 1) stepPlayer(coarseState, frame, 1 / 60, coarse);
    for (let i = 0; i < 240; i += 1) stepPlayer(fineState, frame, 1 / 120, fine);
    expect(coarseState.position.z).toBeCloseTo(fineState.position.z, 1);
  });
});

describe("stanceHalfHeight", () => {
  it("interpolates between the two stances", () => {
    expect(stanceHalfHeight(0)).toBeCloseTo(STANCE.standHeight / 2, 6);
    expect(stanceHalfHeight(1)).toBeCloseTo(STANCE.crouchHeight / 2, 6);
    expect(stanceHalfHeight(0.5)).toBeCloseTo(
      (STANCE.standHeight / 2 + STANCE.crouchHeight / 2) / 2,
      6,
    );
  });
});
