/**
 * Every gameplay tunable lives here. Nothing in the simulation hard-codes a number.
 * Units are metres, seconds, and radians unless a name says otherwise.
 */

export const MOVEMENT = {
  /**
   * Sustained forward speed with the stick at full deflection.
   *
   * These are quick for a shooter, deliberately. A phone gives the player a
   * thumb on a glass circle instead of a stick, so every correction costs
   * more than it does on a pad and a pace that reads as businesslike on a
   * console reads as wading here. The other half of it is the maps: a
   * crossing at Boulevard Works is sixty metres of open street, and at four
   * metres a second that is fifteen seconds of being shot at on the way.
   */
  walkSpeed: 4.8,
  sprintSpeed: 7.4,
  crouchSpeed: 2.4,
  /** Strafing and backpedalling are slower than advancing. */
  strafeMultiplier: 0.9,
  backMultiplier: 0.78,
  /**
   * Ground acceleration and braking, in metres per second squared.
   *
   * High enough that the top speed is reached inside a tenth of a second.
   * Most of what reads as a slow character is not the speed it settles at,
   * it is the time spent getting there, which is the part the player feels
   * on every single tap of the stick.
   */
  acceleration: 72,
  deceleration: 88,
  /** Airborne control is deliberately poor: no bunny hopping. */
  airAcceleration: 6,
  gravity: -22,
  /** Stick deflection above which the player starts sprinting. */
  sprintStickThreshold: 0.92,
  /** Sprint is only granted when moving roughly forward, in radians off-axis. */
  sprintMaxAngle: 0.9,
  /** Delay after sprinting before aiming or firing is allowed. */
  sprintOutTime: 0.25,
  /**
   * The dodge: a short burst of speed in the direction the stick is held, or
   * straight back when it is not, that breaks a line of fire without giving
   * the player a way to travel faster than sprinting over any distance. It
   * covers a little under three metres, which is one piece of cover to the
   * next in these maps, and then it is spent for a while.
   */
  dodgeSpeed: 12.6,
  dodgeTime: 0.24,
  dodgeCooldown: 1.4,
  /** A slope steeper than this is a wall, not a ramp. */
  maxSlopeAngle: 0.85,
  /**
   * The tallest ledge a player walks straight up: a kerb, a slab edge, the
   * lip of a fallen floor. Below the spandrels, which are cover to crouch
   * behind and not a stair.
   */
  stepHeight: 0.5,
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
  /**
   * Cycles per metre walked, which is also what paces the footsteps: one
   * step every half cycle.
   *
   * At a little under two and a half metres to the cycle, a walk is about
   * two and a half steps a second and a sprint a little under four, which is
   * roughly what a person does. Pacing it any tighter turns a sprint into a
   * drum roll -- the old figure gave five and a half steps a second, which
   * is nobody running anywhere.
   */
  bobFrequency: 0.41,
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
