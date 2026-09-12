import type { Random } from "./random";
import type { DamageFalloff, RecoilProfile, SpreadProfile, WeaponDefinition } from "./weapons";
import { clamp } from "./vec3";

const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/** How the shooter was moving when the trigger came down. */
export interface ShooterContext {
  /** Horizontal speed in metres per second. */
  speed: number;
  grounded: boolean;
  /** 0 standing, 1 crouched. */
  crouchAmount: number;
  /** 0 hip fire, 1 fully aimed. */
  adsProgress: number;
}

/**
 * Cone half-angle in degrees for the next shot.
 *
 * Four things widen it: the weapon's own base cone, bloom accumulated from
 * firing, movement, and being airborne. Crouching narrows it. Aiming
 * interpolates between the hip and aimed base cones rather than switching,
 * so a shot fired mid-transition is scored at the accuracy it looked like.
 */
export const currentSpread = (
  profile: SpreadProfile,
  bloom: number,
  context: ShooterContext,
): number => {
  const ads = clamp(context.adsProgress, 0, 1);
  const base = profile.hipBase + (profile.adsBase - profile.hipBase) * ads;
  let cone = base + bloom + context.speed * profile.movementPenalty;
  if (!context.grounded) cone *= profile.airborneMultiplier;
  // Crouch only pays off when planted; it should not reward crouch-walking.
  const crouchWeight = context.crouchAmount * (context.speed < 0.5 ? 1 : 0.4);
  cone *= 1 + (profile.crouchMultiplier - 1) * crouchWeight;
  return Math.max(0, cone);
};

/** Bloom left after `dt` seconds of recovery. */
export const recoverBloom = (bloom: number, profile: SpreadProfile, dt: number): number =>
  Math.max(0, bloom - profile.recovery * dt);

/** Bloom after one more shot, capped. */
export const addBloom = (bloom: number, profile: SpreadProfile): number =>
  Math.min(profile.max, bloom + profile.perShot);

/**
 * Damage multiplier at a distance: full inside the near range, falling
 * linearly to a floor at the far range and flat beyond it.
 */
export const falloffMultiplier = (falloff: DamageFalloff, distance: number): number => {
  if (distance <= falloff.nearRange) return 1;
  if (distance >= falloff.farRange) return falloff.farMultiplier;
  const span = falloff.farRange - falloff.nearRange;
  if (span <= 0) return falloff.farMultiplier;
  const t = (distance - falloff.nearRange) / span;
  return 1 + (falloff.farMultiplier - 1) * t;
};

/** Damage one pellet does at a distance, to a head or a body. */
export const damageAt = (
  definition: WeaponDefinition,
  distance: number,
  headshot: boolean,
): number => {
  const base = definition.damage * falloffMultiplier(definition.falloff, distance);
  return headshot ? base * definition.headshotMultiplier : base;
};

/** Body shots needed to kill at point blank, for design checks and tests. */
export const shotsToKill = (
  definition: WeaponDefinition,
  health: number,
  distance = 0,
): number => {
  const perShot = damageAt(definition, distance, false) * definition.pelletsPerShot;
  if (perShot <= 0) return Infinity;
  return Math.ceil(health / perShot);
};

/** Seconds to kill at point blank: the gaps between shots, not the shots. */
export const timeToKill = (definition: WeaponDefinition, health: number): number => {
  const shots = shotsToKill(definition, health);
  if (!Number.isFinite(shots)) return Infinity;
  return (shots - 1) * (60 / definition.roundsPerMinute);
};

export interface AngleOffset {
  yaw: number;
  pitch: number;
}

/**
 * One direction inside the spread cone.
 *
 * The radius is square-rooted so that points land uniformly across the disc.
 * Without it, pellets bunch in the middle and a shotgun stops behaving like
 * a shotgun.
 */
export const samplePellet = (spreadDegrees: number, random: Random): AngleOffset => {
  if (spreadDegrees <= 0) return { yaw: 0, pitch: 0 };
  const maxRadius = Math.tan(spreadDegrees * DEG_TO_RAD);
  const angle = random.next() * TAU;
  const radius = Math.sqrt(random.next()) * maxRadius;
  return { yaw: Math.cos(angle) * radius, pitch: Math.sin(angle) * radius };
};

/** Every pellet in one trigger pull. */
export const samplePellets = (
  definition: WeaponDefinition,
  spreadDegrees: number,
  random: Random,
): AngleOffset[] => {
  const offsets: AngleOffset[] = [];
  for (let i = 0; i < definition.pelletsPerShot; i += 1) {
    offsets.push(samplePellet(spreadDegrees, random));
  }
  return offsets;
};

/**
 * Kick for a given shot in a burst, in radians.
 * The pattern is fixed and its last entry repeats, so a long burst stays
 * learnable instead of turning random once the pattern runs out.
 */
export const recoilForShot = (
  profile: RecoilProfile,
  shotIndex: number,
  adsProgress: number,
): AngleOffset => {
  const pattern = profile.pattern;
  if (pattern.length === 0) return { yaw: 0, pitch: 0 };
  const entry = pattern[Math.min(shotIndex, pattern.length - 1)];
  const ads = clamp(adsProgress, 0, 1);
  const scale = (1 + (profile.adsMultiplier - 1) * ads) * DEG_TO_RAD;
  return { pitch: entry[0] * scale, yaw: entry[1] * scale };
};

/** Accumulated kick after `dt` seconds of recovery toward centre. */
export const recoverRecoil = (
  value: number,
  profile: RecoilProfile,
  dt: number,
): number => value * Math.pow(profile.recovery, dt);
