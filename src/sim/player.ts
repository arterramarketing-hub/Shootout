import { CAMERA, MOVEMENT, STANCE } from "./config";
import type { CollisionWorld, InputFrame, PlayerState } from "./types";
import { clamp, copy, damp, lengthXZ, moveToward, vec3, type Vec3 } from "./vec3";

export const createPlayer = (spawn: Vec3, yaw = 0): PlayerState => ({
  position: copy(spawn),
  velocity: vec3(),
  yaw,
  pitch: 0,
  grounded: false,
  crouchAmount: 0,
  leanAmount: 0,
  sprinting: false,
  sprintOutTimer: 0,
  bobDistance: 0,
  landingOffset: 0,
  halfHeight: STANCE.standHeight / 2,
  radius: STANCE.radius,
});

/** Camera height above the collider centre for the current stance. */
export const eyeOffset = (state: PlayerState): number => {
  const standOffset = CAMERA_EYE_STAND;
  const crouchOffset = CAMERA_EYE_CROUCH;
  return standOffset + (crouchOffset - standOffset) * state.crouchAmount;
};

const CAMERA_EYE_STAND = STANCE.standEyeHeight - STANCE.standHeight / 2;
const CAMERA_EYE_CROUCH = STANCE.crouchEyeHeight - STANCE.crouchHeight / 2;

/** Half-height of the collider for a given crouch blend. */
export const stanceHalfHeight = (crouchAmount: number): number => {
  const stand = STANCE.standHeight / 2;
  const crouch = STANCE.crouchHeight / 2;
  return stand + (crouch - stand) * crouchAmount;
};

/**
 * Directional speed limit. Advancing is fastest; strafing and retreating are
 * penalised so that players cannot backpedal as fast as they push.
 */
export const directionalSpeed = (
  moveX: number,
  moveY: number,
  baseSpeed: number,
): number => {
  const magnitude = Math.min(1, Math.hypot(moveX, moveY));
  if (magnitude < 1e-6) return 0;
  const forward = moveY / magnitude;
  const side = Math.abs(moveX) / magnitude;
  // Blend the penalties by how much of the input points each way.
  const backBlend = forward < 0 ? -forward : 0;
  const multiplier =
    1 * Math.max(0, forward) +
    MOVEMENT.backMultiplier * backBlend +
    MOVEMENT.strafeMultiplier * side;
  const normalised = multiplier / Math.max(1e-6, Math.max(0, forward) + backBlend + side);
  return baseSpeed * normalised * magnitude;
};

/** Whether the current stick input qualifies as a sprint. */
export const wantsSprint = (input: InputFrame): boolean => {
  const magnitude = Math.hypot(input.moveX, input.moveY);
  if (magnitude < MOVEMENT.sprintStickThreshold) return false;
  // Only forward-ish input sprints. atan2(x, y) is the angle off the forward
  // axis, and it must keep the sign of moveY so that a full-stick backpedal
  // reads as 180 degrees off forward rather than zero.
  const angleOffForward = Math.abs(Math.atan2(input.moveX, input.moveY));
  return angleOffForward <= MOVEMENT.sprintMaxAngle;
};

/** Rotate stick input into world space using the player's yaw. */
export const stickToWorld = (moveX: number, moveY: number, yaw: number): Vec3 => {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Forward is +Z at yaw 0, matching the engine's left-handed convention.
  return vec3(moveY * sin + moveX * cos, 0, moveY * cos - moveX * sin);
};

/** Advance the player by one fixed step. Mutates and returns `state`. */
export const stepPlayer = (
  state: PlayerState,
  input: InputFrame,
  dt: number,
  world: CollisionWorld,
): PlayerState => {
  state.yaw = input.yaw;
  state.pitch = input.pitch;

  updateStance(state, input, dt, world);

  const sprinting =
    input.sprint && wantsSprint(input) && state.crouchAmount < 0.5 && state.grounded;
  state.sprinting = sprinting;
  state.sprintOutTimer = sprinting
    ? MOVEMENT.sprintOutTime
    : Math.max(0, state.sprintOutTimer - dt);

  applyHorizontalMovement(state, input, dt, sprinting);

  state.velocity.y += MOVEMENT.gravity * dt;

  const wasGrounded = state.grounded;
  const requested = vec3(
    state.velocity.x * dt,
    state.velocity.y * dt,
    state.velocity.z * dt,
  );
  const actual = world.move(requested);

  resolveCollisionResponse(state, requested, actual, dt, wasGrounded);

  const resolved = world.getPosition();
  state.position.x = resolved.x;
  state.position.y = resolved.y;
  state.position.z = resolved.z;

  if (state.grounded) {
    state.bobDistance += lengthXZ(actual);
  }
  state.landingOffset = damp(state.landingOffset, 0, CAMERA.landingRecovery, dt);

  return state;
};

const updateStance = (
  state: PlayerState,
  input: InputFrame,
  dt: number,
  world: CollisionWorld,
): void => {
  const crouchRate = dt / STANCE.crouchTransitionTime;
  const standingHalf = STANCE.standHeight / 2;
  let wantCrouch = input.crouch;

  // Refuse to stand up under low cover.
  if (!wantCrouch && state.crouchAmount > 0) {
    if (!world.hasHeadroom(state.halfHeight, standingHalf)) wantCrouch = true;
  }
  state.crouchAmount = moveToward(state.crouchAmount, wantCrouch ? 1 : 0, crouchRate);

  const halfHeight = stanceHalfHeight(state.crouchAmount);
  if (Math.abs(halfHeight - state.halfHeight) > 1e-5) {
    state.halfHeight = halfHeight;
    world.setSize(state.radius, halfHeight);
  }

  const leanTarget = (input.leanRight ? 1 : 0) - (input.leanLeft ? 1 : 0);
  state.leanAmount = moveToward(
    state.leanAmount,
    leanTarget,
    dt / STANCE.leanTransitionTime,
  );
};

const applyHorizontalMovement = (
  state: PlayerState,
  input: InputFrame,
  dt: number,
  sprinting: boolean,
): void => {
  const baseSpeed = sprinting
    ? MOVEMENT.sprintSpeed
    : state.crouchAmount > 0.5
      ? MOVEMENT.crouchSpeed
      : MOVEMENT.walkSpeed;

  const targetSpeed = directionalSpeed(input.moveX, input.moveY, baseSpeed);
  const direction = stickToWorld(input.moveX, input.moveY, state.yaw);
  const magnitude = Math.hypot(direction.x, direction.z);
  const wishX = magnitude > 1e-6 ? (direction.x / magnitude) * targetSpeed : 0;
  const wishZ = magnitude > 1e-6 ? (direction.z / magnitude) * targetSpeed : 0;

  const rate = state.grounded
    ? targetSpeed > 0
      ? MOVEMENT.acceleration
      : MOVEMENT.deceleration
    : MOVEMENT.airAcceleration;

  state.velocity.x = moveToward(state.velocity.x, wishX, rate * dt);
  state.velocity.z = moveToward(state.velocity.z, wishZ, rate * dt);
};

const resolveCollisionResponse = (
  state: PlayerState,
  requested: Vec3,
  actual: Vec3,
  dt: number,
  wasGrounded: boolean,
): void => {
  const blockedBelow = requested.y < 0 && actual.y > requested.y + 1e-4;
  const blockedAbove = requested.y > 0 && actual.y < requested.y - 1e-4;

  if (blockedBelow) {
    if (!wasGrounded && state.velocity.y < -4) {
      // Scale the landing dip by impact speed, capped so a long fall is not absurd.
      const impact = clamp(-state.velocity.y / 12, 0, 1);
      state.landingOffset = CAMERA.landingDip * impact;
    }
    state.grounded = true;
    // Not zero: a small sustained push keeps the collider in contact so the
    // next step still registers the floor. Well under the landing threshold,
    // so this never triggers a landing dip.
    state.velocity.y = -MOVEMENT.groundStickSpeed;
  } else {
    state.grounded = false;
    if (blockedAbove) state.velocity.y = 0;
  }

  // A wall stops horizontal momentum rather than letting it build up against it.
  if (dt > 0) {
    const blockedX = Math.abs(actual.x) < Math.abs(requested.x) - 1e-5;
    const blockedZ = Math.abs(actual.z) < Math.abs(requested.z) - 1e-5;
    if (blockedX) state.velocity.x = actual.x / dt;
    if (blockedZ) state.velocity.z = actual.z / dt;
  }
};
