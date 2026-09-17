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
  dodgeTimer: 0,
  dodgeCooldown: 0,
  dodgeDirection: vec3(),
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

  updateDodge(state, input, dt);
  if (state.dodgeTimer > 0) {
    // The dodge owns the ground velocity while it lasts; the stick gets it
    // back the moment it ends, with the momentum still on it.
    state.velocity.x = state.dodgeDirection.x * MOVEMENT.dodgeSpeed;
    state.velocity.z = state.dodgeDirection.z * MOVEMENT.dodgeSpeed;
  } else {
    applyHorizontalMovement(state, input, dt, sprinting);
  }

  state.velocity.y += MOVEMENT.gravity * dt;

  const wasGrounded = state.grounded;
  const requested = vec3(
    state.velocity.x * dt,
    state.velocity.y * dt,
    state.velocity.z * dt,
  );
  // On a slope, walk along it rather than into it. Pushing a capsule
  // horizontally into a ramp gets it shoved back out along the ramp's normal,
  // which reads as an invisible wall at the foot of every ramp in the game.
  const ground = wasGrounded ? (world.groundNormal?.() ?? null) : null;
  if (ground && ground.y > 0.01 && ground.y < 0.9999) {
    const along = -(requested.x * ground.x + requested.z * ground.z) / ground.y;
    // Up or down: a player walking down a steep slab at a run outpaces the
    // ground stick and skips off it otherwise. The stick itself is not
    // folded in: four centimetres a tick pressed into a slope is pushed back
    // out along its normal, and a quarter of the climbing speed goes with
    // it. A couple of millimetres is enough to keep the contact registered.
    requested.y = along - SLOPE_STICK;
  }
  const actual = moveWithStep(requested, world, wasGrounded);
  snapToGround(requested, actual, world, wasGrounded);

  resolveCollisionResponse(state, requested, actual, dt, wasGrounded, world);

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

/**
 * Start a dodge on the press, and run the clocks.
 *
 * Grounded only: a dodge in the air would be a second jump. The direction is
 * the stick's, in the world, or straight back from where the player is
 * looking when the stick is centred, since backing off a corner is the dodge
 * most players want and the one hardest to make on a thumbstick in a hurry.
 */
const updateDodge = (state: PlayerState, input: InputFrame, dt: number): void => {
  state.dodgeTimer = Math.max(0, state.dodgeTimer - dt);
  state.dodgeCooldown = Math.max(0, state.dodgeCooldown - dt);
  if (!input.dodgePressed || state.dodgeCooldown > 0 || !state.grounded) return;

  const stick = stickToWorld(input.moveX, input.moveY, state.yaw);
  const magnitude = Math.hypot(stick.x, stick.z);
  if (magnitude > 0.25) {
    state.dodgeDirection = vec3(stick.x / magnitude, 0, stick.z / magnitude);
  } else {
    const back = stickToWorld(0, -1, state.yaw);
    state.dodgeDirection = vec3(back.x, 0, back.z);
  }
  state.dodgeTimer = MOVEMENT.dodgeTime;
  state.dodgeCooldown = MOVEMENT.dodgeCooldown;
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

/** How far into a slope a grounded move presses, in metres, to stay in contact. */
const SLOPE_STICK = 0.004;
/** How far below a grounded player the ground may have dropped away, in metres, and still be theirs. */
const GROUND_SNAP = 0.25;

/**
 * Keep a walking player on ground that falls away under them.
 *
 * Over the crest of a ramp, the last contact on the flat says the ground is
 * level, so the move goes level, and the slope is a centimetre below the
 * capsule by the end of it. Left there, the player is airborne for a tick
 * and lands: no sprint, no bob, and a stutter every time. Walking off a real
 * drop is different, and further than the snap reaches.
 */
const snapToGround = (
  requested: Vec3,
  actual: Vec3,
  world: CollisionWorld,
  wasGrounded: boolean,
): void => {
  if (!wasGrounded || requested.y > 0) return;
  if ((world.groundNormal?.() ?? null) !== null) return;
  const here = world.getPosition();
  // In short sweeps, not one drop: a capsule dropped a quarter of a metre
  // onto a slope is pushed back out along its normal, and the sideways part
  // of that is a lurch. A few centimetres at a time barely registers.
  const sweeps = 5;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    world.move(vec3(0, -GROUND_SNAP / sweeps, 0));
    if ((world.groundNormal?.() ?? null) !== null) {
      const landed = world.getPosition();
      actual.x += landed.x - here.x;
      actual.y += landed.y - here.y;
      actual.z += landed.z - here.z;
      return;
    }
  }
  world.setPosition(here);
};

/**
 * Move, and if a ledge stopped the move, try stepping over it.
 *
 * A capsule pushed into a kerb is pushed straight back; nothing about the
 * push knows the kerb is fifteen centimetres high. So when a grounded move is
 * cut short, try it again lifted by the step height, then settle back down,
 * and keep whichever got further. A standing player is also never dragged
 * sideways by the ground alone: with nothing asked for horizontally, the
 * capsule is put back where it was, which is what stops it creeping down a
 * ramp it is only standing on.
 */
const moveWithStep = (
  requested: Vec3,
  world: CollisionWorld,
  wasGrounded: boolean,
): Vec3 => {
  const before = world.getPosition();
  const actual = world.move(requested);
  const wanted = Math.hypot(requested.x, requested.z);

  if (wanted < 1e-6) {
    if (wasGrounded) {
      const now = world.getPosition();
      world.setPosition(vec3(before.x, now.y, before.z));
      return vec3(0, now.y - before.y, 0);
    }
    return actual;
  }
  if (!wasGrounded) return actual;

  const got = (requested.x * actual.x + requested.z * actual.z) / wanted;
  const standingOn = world.groundNormal?.() ?? null;
  // A slope cuts a move short too: the first push into the foot of a ramp
  // is shoved back out along its normal before the slope-following above
  // has a normal to follow. That is not a ledge. Stepping over it lifts the
  // player half a metre into the air above a surface they could simply walk
  // up, and the fall back onto it is the jitter every ramp used to have.
  if (standingOn && standingOn.y < 0.9999 && actual.y >= requested.y - 1e-6) return actual;
  // Cut short, or riding up the edge of something without standing on it:
  // a round bottom on the corner of a ledge slides most of the way along and
  // a little way up, and never gets on top.
  const nudgedUp = actual.y > requested.y + 0.005 && !standingOn;
  if (got >= wanted * 0.9 && !nudgedUp) return actual;

  // Blocked. Try the same move from a step higher, then settle back onto
  // whatever is there. The settle keeps the ground it found and nothing
  // else: a round bottom coming down on the edge of a kerb is shoved
  // sideways off it, and taking that shove would put the player back where
  // they started every tick and call the kerb a wall.
  const stalled = world.getPosition();
  world.setPosition(before);
  const lift = world.move(vec3(0, MOVEMENT.stepHeight, 0));
  if (lift.y < MOVEMENT.stepHeight * 0.5) {
    // Something overhead: under the raised end of a fallen slab, there is no
    // stepping up, and trying pushes the player about under the ceiling.
    world.setPosition(stalled);
    return actual;
  }
  const across = world.move(vec3(requested.x, 0, requested.z));
  const crossed = world.getPosition();
  const gotStepped = (requested.x * across.x + requested.z * across.z) / wanted;
  if (gotStepped <= got + 1e-4) {
    // No further from up here either: it is a wall.
    world.setPosition(stalled);
    return actual;
  }

  world.move(vec3(0, -lift.y - 0.02, 0));
  const settled = world.getPosition();
  const landed = (world.groundNormal?.() ?? null) !== null && settled.y > before.y + 0.02;
  if (landed && settled.y - before.y <= MOVEMENT.stepHeight + 0.01) {
    world.setPosition(vec3(crossed.x, settled.y, crossed.z));
    return vec3(crossed.x - before.x, settled.y - before.y, crossed.z - before.z);
  }
  /*
   * Over the edge but not yet over the top: a round bottom this far onto a
   * ledge comes down on its corner and is shoved off. So stay up, and keep
   * going. Gravity brings the capsule down over the next few steps, by which
   * time it is far enough on to land on the ledge rather than its edge.
   */
  world.setPosition(crossed);
  return vec3(crossed.x - before.x, crossed.y - before.y, crossed.z - before.z);
};

const resolveCollisionResponse = (
  state: PlayerState,
  requested: Vec3,
  actual: Vec3,
  dt: number,
  wasGrounded: boolean,
  world: CollisionWorld,
): void => {
  const blockedBelow = requested.y < 0 && actual.y > requested.y + 1e-4;
  const blockedAbove = requested.y > 0 && actual.y < requested.y - 1e-4;
  // Climbing a slope is a move that asks to go up and does, so nothing is
  // blocked below; the ground is still under the player. What decides it is
  // whether the move ended in contact with a floor, and the collider knows.
  const onGround = blockedBelow || (wasGrounded && (world.groundNormal?.() ?? null) !== null);

  if (onGround) {
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

  // A wall stops horizontal momentum rather than letting it build up against
  // it. A wall, not a ramp: sliding along a slope always costs a little of
  // the asked-for distance, and treating that as a wall halves the speed a
  // player climbs at. Only a real shortfall counts.
  if (dt > 0) {
    const blockedX = Math.abs(actual.x) < Math.abs(requested.x) * 0.6 - 1e-5;
    const blockedZ = Math.abs(actual.z) < Math.abs(requested.z) * 0.6 - 1e-5;
    if (blockedX) state.velocity.x = actual.x / dt;
    if (blockedZ) state.velocity.z = actual.z / dt;
  }
};
