/**
 * Every gameplay tunable lives here. Nothing in the simulation hard-codes a number.
 * Units are metres, seconds, and radians unless a name says otherwise.
 */

export const MOVEMENT = {
  /** Sustained forward speed with the stick at full deflection. */
  walkSpeed: 4.0,
  sprintSpeed: 6.5,
  crouchSpeed: 1.9,
  /** Strafing and backpedalling are slower than advancing. */
  strafeMultiplier: 0.85,
  backMultiplier: 0.75,
  /** Ground acceleration and braking, in metres per second squared. */
  acceleration: 55,
  deceleration: 70,
  /** Airborne control is deliberately poor: no bunny hopping. */
  airAcceleration: 6,
  gravity: -22,
  /** Stick deflection above which the player starts sprinting. */
  sprintStickThreshold: 0.92,
  /** Sprint is only granted when moving roughly forward, in radians off-axis. */
  sprintMaxAngle: 0.9,
  /** Delay after sprinting before aiming or firing is allowed. */
  sprintOutTime: 0.25,
  /** A slope steeper than this is a wall, not a ramp. */
  maxSlopeAngle: 0.85,
  /**
   * Downward speed held while grounded. The swept collider comes to rest a
   * hair above the floor, so without this the next step's fall is unobstructed
   * and the player reads as airborne while standing still.
   */
  groundStickSpeed: 2.0,
} as const;

export const STANCE = {
  standHeight: 1.8,
  crouchHeight: 1.2,
  /** Camera sits below the top of the collider, not on it. */
  standEyeHeight: 1.65,
  crouchEyeHeight: 1.05,
  radius: 0.38,
  /** Seconds to fully change stance. */
  crouchTransitionTime: 0.22,
  /** Lean offset at full commitment, and the roll that sells it. */
  leanDistance: 0.45,
  leanRollRadians: 0.17,
  leanTransitionTime: 0.16,
} as const;

export const CAMERA = {
  defaultFovDegrees: 80,
  minFovDegrees: 65,
  maxFovDegrees: 100,
  /** Pitch clamp keeps the horizon sane and stops gimbal weirdness. */
  maxPitchRadians: 1.54,
  nearClip: 0.08,
  farClip: 220,
  /** Head bob: amplitude in metres, cycles per metre travelled. */
  bobAmplitude: 0.035,
  bobFrequency: 0.55,
  bobRollAmplitude: 0.012,
  /** Landing dip, in metres, and how fast it recovers. */
  landingDip: 0.09,
  landingRecovery: 0.001,
} as const;

export const LOOK = {
  /** Radians of yaw per CSS pixel dragged, before the user multiplier. */
  baseSensitivity: 0.0032,
  /** User-facing multipliers, persisted in settings. */
  defaultTouchSensitivity: 1.0,
  defaultMouseSensitivity: 1.0,
  /** Aim-down-sights slows the look to match the narrower field of view. */
  adsSensitivityScale: 0.6,
  invertY: false,
  /** Gyroscope contribution, 0 disables it. */
  defaultGyroScale: 0.0,
} as const;

export const INPUT = {
  /** Floating stick: radius of full deflection, in CSS pixels. */
  joystickRadius: 64,
  /** Deflection below this is treated as zero, to absorb thumb tremor. */
  joystickDeadzone: 0.14,
  /** The stick re-centres under the thumb if it drags past the ring. */
  joystickFollow: true,
  /** A touch shorter than this and under the move threshold counts as a tap. */
  tapMaxDuration: 0.25,
  tapMaxDistance: 14,
} as const;

export const SIM = {
  /** Fixed simulation rate. Rendering interpolates between these steps. */
  tickRate: 60,
  /** Never simulate more than this many steps in one frame after a stall. */
  maxStepsPerFrame: 5,
} as const;

export const tickInterval = 1 / SIM.tickRate;
