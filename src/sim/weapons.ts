/**
 * Weapon data. Every number a weapon has lives here, nowhere else.
 *
 * All four are original designs. The damage figures are built backwards from
 * the lethality target: three body shots or fewer, one headshot always, and a
 * time to kill between 100 and 300 milliseconds.
 */

export type WeaponId = "ar" | "smg" | "shotgun" | "pistol";

/** How the trigger behaves. */
export type FireMode =
  /** Held trigger keeps firing. */
  | "auto"
  /** One shot per press. */
  | "semi"
  /** One shot per press, with a cycle delay that cannot be rushed. */
  | "pump";

export interface DamageFalloff {
  /** Full damage out to here. */
  nearRange: number;
  /** Damage reaches its floor here and stays there. */
  farRange: number;
  /** The floor, as a fraction of base damage. */
  farMultiplier: number;
}

export interface SpreadProfile {
  /** Cone half-angle at rest, in degrees. */
  hipBase: number;
  adsBase: number;
  /** Added to the cone by each shot. */
  perShot: number;
  /** Ceiling on accumulated bloom. */
  max: number;
  /** Degrees of bloom recovered per second. */
  recovery: number;
  /** Extra cone per metre per second of movement. */
  movementPenalty: number;
  /** Airborne and crouched multipliers on the whole cone. */
  airborneMultiplier: number;
  crouchMultiplier: number;
}

export interface RecoilProfile {
  /**
   * Per-shot kick in degrees as [pitch, yaw]. Index by shot number; the last
   * entry repeats once the pattern runs out. A fixed pattern rather than
   * random kick is what makes recoil learnable.
   */
  pattern: readonly (readonly [number, number])[];
  /** Fraction of the accumulated kick still present after one second. */
  recovery: number;
  /**
   * Share of each shot's kick that moves the player's own aim rather than
   * springing back, 0 to 1.
   *
   * This is what makes recoil something to fight. A kick that only offsets
   * the camera and then recovers is worse than no recoil at all: the player
   * pulls down to hold the target, the offset springs back underneath them,
   * and the correction they just made becomes permanent error in the other
   * direction. Moving part of the kick into the aim itself means pulling
   * down is ordinary aiming, and nothing springs back to fight it.
   */
  climb: number;
  /**
   * How hard one shot shakes the camera, as a multiple of the pattern entry.
   *
   * Deliberately small. The violence of a shot belongs on the weapon, which
   * kicks back and up in the player's hands; the camera only trembles. Putting
   * it on the camera instead moves the whole world away from the target: at
   * ten rounds a second the offsets stack, and the thing the player was aiming
   * at ends up sitting far below the crosshair for as long as the trigger is
   * held. They can no longer see where they are shooting, which is exactly
   * what no shooter does and what this value being too high produced.
   *
   * The rule it has to satisfy: during sustained fire the camera must stay
   * within about a degree of where the player is actually aiming. Everything
   * beyond that goes into `climb`, which moves the aim itself and is therefore
   * something the player can follow and correct, or into the weapon model.
   */
  punch: number;
  /** Kick multiplier while fully aimed. */
  adsMultiplier: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  /** Shown under the ammo counter. */
  className: string;
  /** What it fires, as the banner shows it. */
  calibre: string;
  mode: FireMode;
  damage: number;
  headshotMultiplier: number;
  /** Above one only for the shotgun. */
  pelletsPerShot: number;
  roundsPerMinute: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadTime: number;
  /** Reload one round at a time, interruptible by firing. */
  shellReload: boolean;
  /** Seconds to raise or lower the sights. */
  adsTime: number;
  /** Horizontal field of view while aimed, in degrees. */
  adsFovDegrees: number;
  /** Seconds to bring the weapon up after a swap. */
  swapTime: number;
  /** Hitscan ray length, in metres. */
  maxRange: number;
  falloff: DamageFalloff;
  spread: SpreadProfile;
  recoil: RecoilProfile;
}

/**
 * Ridgeline AR. The default: three body shots at 620 rpm is a 194 ms kill,
 * with a climb that is steep but straight for the first eight rounds.
 */
const ridgeline: WeaponDefinition = {
  id: "ar",
  name: "Ridgeline",
  className: "Assault Rifle",
  calibre: "5.56",
  mode: "auto",
  damage: 34,
  headshotMultiplier: 3.0,
  pelletsPerShot: 1,
  roundsPerMinute: 620,
  magazineSize: 30,
  reserveAmmo: 150,
  reloadTime: 2.1,
  shellReload: false,
  adsTime: 0.24,
  adsFovDegrees: 55,
  swapTime: 0.55,
  maxRange: 150,
  falloff: { nearRange: 30, farRange: 60, farMultiplier: 0.75 },
  spread: {
    hipBase: 2.6,
    adsBase: 0.16,
    // At 620 rpm this accumulates about 3.1 degrees a second against 2.2 of
    // recovery, so a held trigger opens the cone up over a magazine and a
    // tapped one stays tight. Recovery faster than accumulation would make
    // bloom inert.
    perShot: 0.30,
    max: 3.2,
    recovery: 2.2,
    movementPenalty: 0.28,
    airborneMultiplier: 2.4,
    crouchMultiplier: 0.72,
  },
  recoil: {
    // Straight climb, then a lean to the right that has to be learned.
    pattern: [
      [0.42, 0.03], [0.5, -0.05], [0.55, 0.08], [0.58, 0.12],
      [0.6, 0.18], [0.6, 0.24], [0.58, 0.3], [0.56, 0.34],
      [0.5, 0.26], [0.48, 0.1], [0.46, -0.12], [0.44, -0.28],
      [0.44, -0.2], [0.44, 0.05], [0.44, 0.22],
    ],
    recovery: 0.004,
    climb: 0.55,
    punch: 0.9,
    adsMultiplier: 0.72,
  },
};

/**
 * Wasp SMG. Three body shots at 900 rpm is a 133 ms kill, the fastest in the
 * game, but only up close: past thirty metres the damage floor makes it five
 * shots and 267 ms, which loses every trade the rifle takes.
 */
const wasp: WeaponDefinition = {
  id: "smg",
  name: "Wasp",
  className: "Submachine Gun",
  calibre: "9MM",
  mode: "auto",
  damage: 35,
  headshotMultiplier: 3.0,
  pelletsPerShot: 1,
  roundsPerMinute: 900,
  magazineSize: 25,
  reserveAmmo: 150,
  reloadTime: 1.8,
  shellReload: false,
  adsTime: 0.18,
  adsFovDegrees: 62,
  swapTime: 0.45,
  maxRange: 90,
  falloff: { nearRange: 12, farRange: 30, farMultiplier: 0.6 },
  spread: {
    hipBase: 2.1,
    adsBase: 0.5,
    perShot: 0.26,
    max: 4.2,
    recovery: 2.6,
    movementPenalty: 0.16,
    airborneMultiplier: 2.0,
    crouchMultiplier: 0.8,
  },
  recoil: {
    // Fast, loose, and it wanders: hold it on target with movement, not memory.
    pattern: [
      [0.3, -0.1], [0.34, 0.14], [0.36, -0.18], [0.38, 0.22],
      [0.4, -0.24], [0.4, 0.26], [0.4, -0.22], [0.38, 0.18],
      [0.38, -0.26], [0.36, 0.3],
    ],
    recovery: 0.004,
    climb: 0.5,
    punch: 0.8,
    adsMultiplier: 0.8,
  },
};

/**
 * Breaker 12. Eight pellets at fourteen damage is a one-shot kill inside
 * eight metres and close to useless past twenty. Reloads one shell at a time,
 * so a pump can be cut short to fire.
 */
const breaker: WeaponDefinition = {
  id: "shotgun",
  name: "Breaker 12",
  className: "Pump Shotgun",
  calibre: "12GA",
  mode: "pump",
  damage: 14,
  headshotMultiplier: 1.5,
  pelletsPerShot: 8,
  roundsPerMinute: 70,
  magazineSize: 5,
  reserveAmmo: 35,
  reloadTime: 0.52,
  shellReload: true,
  adsTime: 0.3,
  adsFovDegrees: 68,
  swapTime: 0.6,
  maxRange: 40,
  falloff: { nearRange: 8, farRange: 20, farMultiplier: 0.3 },
  spread: {
    hipBase: 4.6,
    adsBase: 3.0,
    perShot: 0,
    max: 0,
    recovery: 0,
    movementPenalty: 0.1,
    airborneMultiplier: 1.5,
    crouchMultiplier: 0.85,
  },
  recoil: {
    pattern: [[2.2, 0.25]],
    recovery: 0.004,
    climb: 0.5,
    punch: 1.1,
    adsMultiplier: 0.85,
  },
};

/**
 * P9 sidearm. Three body shots, the fastest swap in the game, and it is
 * never the reason you lose a fight you should have won.
 */
const sidearm: WeaponDefinition = {
  id: "pistol",
  name: "P9",
  className: "Sidearm",
  calibre: "9MM",
  mode: "semi",
  damage: 34,
  headshotMultiplier: 3.0,
  pelletsPerShot: 1,
  roundsPerMinute: 450,
  magazineSize: 15,
  reserveAmmo: 90,
  reloadTime: 1.5,
  shellReload: false,
  adsTime: 0.15,
  adsFovDegrees: 64,
  swapTime: 0.3,
  maxRange: 80,
  falloff: { nearRange: 20, farRange: 45, farMultiplier: 0.7 },
  spread: {
    hipBase: 2.0,
    adsBase: 0.22,
    // Tuned so controlled fire holds accuracy and trigger spamming loses it.
    perShot: 0.40,
    max: 3.0,
    recovery: 2.4,
    movementPenalty: 0.2,
    airborneMultiplier: 2.0,
    crouchMultiplier: 0.75,
  },
  recoil: {
    pattern: [[0.72, 0.06], [0.76, -0.1], [0.78, 0.12], [0.8, -0.14]],
    recovery: 0.004,
    climb: 0.5,
    punch: 0.8,
    adsMultiplier: 0.75,
  },
};

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  ar: ridgeline,
  smg: wasp,
  shotgun: breaker,
  pistol: sidearm,
};

/** Order weapons are cycled in. */
export const DEFAULT_LOADOUT: readonly WeaponId[] = ["ar", "smg", "shotgun", "pistol"];

export const secondsPerShot = (definition: WeaponDefinition): number =>
  60 / definition.roundsPerMinute;
