import type { Vec3 } from "./vec3";

/** One frame of player intent. Produced by input, consumed by the simulation. */
export interface InputFrame {
  /** Stick deflection. x is strafe, y is forward. Each in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** Absolute look angles in radians. Look is applied at render rate, not stepped. */
  yaw: number;
  pitch: number;
  /** Held-button state. */
  sprint: boolean;
  crouch: boolean;
  leanLeft: boolean;
  leanRight: boolean;
  fire: boolean;
  aim: boolean;
  /** Edge-triggered actions, consumed once by the simulation. */
  reloadPressed: boolean;
  swapPressed: boolean;
  dodgePressed: boolean;
}

export const emptyInput = (): InputFrame => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  leanLeft: false,
  leanRight: false,
  fire: false,
  aim: false,
  reloadPressed: false,
  swapPressed: false,
  dodgePressed: false,
});

export interface PlayerState {
  /** Collider centre, not the feet. */
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** 0 standing, 1 fully crouched. */
  crouchAmount: number;
  /** -1 fully left, +1 fully right. */
  leanAmount: number;
  sprinting: boolean;
  /** Counts down after sprinting; aiming and firing are blocked while above zero. */
  sprintOutTimer: number;
  /** Accumulated ground distance, drives head bob. */
  bobDistance: number;
  /** Downward camera offset from the last landing, recovering toward zero. */
  landingOffset: number;
  /** Collider half-height for the current stance. */
  halfHeight: number;
  radius: number;
  /** Seconds left in the current dodge; zero when not dodging. */
  dodgeTimer: number;
  /** Seconds until the next dodge is allowed. */
  dodgeCooldown: number;
  /** Direction of the dodge in progress, on the ground plane, unit length. */
  dodgeDirection: Vec3;
}

/**
 * The simulation's only view of the level. The Babylon layer implements this,
 * which keeps the simulation free of engine types.
 */
export interface CollisionWorld {
  /** Resize the collider for the current stance. */
  setSize(radius: number, halfHeight: number): void;
  /** Apply a displacement with sliding. Returns the displacement actually achieved. */
  move(displacement: Vec3): Vec3;
  /** Current collider centre. */
  getPosition(): Vec3;
  /** Teleport, ignoring collision. Used for spawning. */
  setPosition(position: Vec3): void;
  /** Whether the collider has headroom to return to full height. */
  hasHeadroom(fromHalfHeight: number, toHalfHeight: number): boolean;
}
