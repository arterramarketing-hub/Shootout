import {
  addBloom,
  currentSpread,
  recoilForShot,
  recoverBloom,
  recoverRecoil,
  samplePellets,
  type AngleOffset,
  type ShooterContext,
} from "./ballistics";
import type { Random } from "./random";
import { clamp, moveToward } from "./vec3";
import {
  DEFAULT_LOADOUT,
  secondsPerShot,
  WEAPONS,
  type WeaponDefinition,
  type WeaponId,
} from "./weapons";

/** Seconds of not firing after which the recoil pattern starts over. */
const RECOIL_PATTERN_RESET = 0.35;

export interface WeaponRuntime {
  definition: WeaponDefinition;
  magazine: number;
  reserve: number;
  /** Seconds until the action can fire again. */
  fireCooldown: number;
  /** Seconds left on the current reload, or on the current shell. */
  reloadTimer: number;
  reloading: boolean;
  /** Accumulated cone widening, in degrees. */
  bloom: number;
  /** Position in the recoil pattern. */
  shotIndex: number;
  sinceLastShot: number;
}

export interface LoadoutState {
  weapons: WeaponRuntime[];
  activeIndex: number;
  /** Weapon being swapped to, or null when not swapping. */
  pendingIndex: number | null;
  swapTimer: number;
  /** 0 hip, 1 fully aimed. */
  adsProgress: number;
  /** Accumulated recoil offset in radians, added to the player's aim. */
  recoilPitch: number;
  recoilYaw: number;
  /** Latched until the trigger is released, for semi and pump actions. */
  triggerLatched: boolean;
}

/** What the weapon needs to know about the player holding it. */
export interface LoadoutContext {
  /** Horizontal speed in metres per second. */
  speed: number;
  grounded: boolean;
  crouchAmount: number;
  /** Blocks firing and aiming while above zero. */
  sprintOutTimer: number;
  /** The player's own aim, before recoil. */
  yaw: number;
  pitch: number;
}

export interface LoadoutInput {
  fire: boolean;
  aim: boolean;
  reloadPressed: boolean;
  swapPressed: boolean;
}

/** One trigger pull that hit the world. Resolved by the combat layer. */
export interface ShotEvent {
  weapon: WeaponDefinition;
  /** One entry per pellet, as angular offsets from the aim direction. */
  pellets: AngleOffset[];
  spreadDegrees: number;
  /** Aim including recoil, which is where the bullets actually go. */
  aimYaw: number;
  aimPitch: number;
  /**
   * The share of this shot's kick that moves the player's own aim, in
   * radians. The caller folds it into the look angles, so correcting for it
   * is ordinary aiming rather than a fight with a spring.
   */
  climbPitch: number;
  climbYaw: number;
}

const createRuntime = (id: WeaponId): WeaponRuntime => {
  const definition = WEAPONS[id];
  return {
    definition,
    magazine: definition.magazineSize,
    reserve: definition.reserveAmmo,
    fireCooldown: 0,
    reloadTimer: 0,
    reloading: false,
    bloom: 0,
    shotIndex: 0,
    sinceLastShot: Infinity,
  };
};

export const createLoadout = (ids: readonly WeaponId[] = DEFAULT_LOADOUT): LoadoutState => ({
  weapons: ids.map(createRuntime),
  activeIndex: 0,
  pendingIndex: null,
  swapTimer: 0,
  adsProgress: 0,
  recoilPitch: 0,
  recoilYaw: 0,
  triggerLatched: false,
});

export const activeWeapon = (loadout: LoadoutState): WeaponRuntime =>
  loadout.weapons[loadout.activeIndex];

export const isSwapping = (loadout: LoadoutState): boolean => loadout.pendingIndex !== null;

/** Whether the weapon could fire right now, ignoring the trigger. */
export const canFire = (loadout: LoadoutState, context: LoadoutContext): boolean => {
  const weapon = activeWeapon(loadout);
  return (
    !isSwapping(loadout) &&
    context.sprintOutTimer <= 0 &&
    weapon.fireCooldown <= 0 &&
    weapon.magazine > 0 &&
    // A magazine reload has to finish; a shell reload can be cut short.
    (!weapon.reloading || weapon.definition.shellReload)
  );
};

export const needsReload = (weapon: WeaponRuntime): boolean =>
  weapon.magazine < weapon.definition.magazineSize && weapon.reserve > 0;

/** Advance the loadout one fixed step. Returns a shot if one was fired. */
export const stepLoadout = (
  loadout: LoadoutState,
  input: LoadoutInput,
  context: LoadoutContext,
  dt: number,
  random: Random,
): ShotEvent | null => {
  advanceSwap(loadout, input, dt);

  const weapon = activeWeapon(loadout);
  weapon.fireCooldown = Math.max(0, weapon.fireCooldown - dt);
  weapon.sinceLastShot += dt;
  weapon.bloom = recoverBloom(weapon.bloom, weapon.definition.spread, dt);

  // A burst that has been allowed to settle starts the pattern again.
  if (weapon.sinceLastShot > RECOIL_PATTERN_RESET) weapon.shotIndex = 0;

  loadout.recoilPitch = recoverRecoil(loadout.recoilPitch, weapon.definition.recoil, dt);
  loadout.recoilYaw = recoverRecoil(loadout.recoilYaw, weapon.definition.recoil, dt);

  advanceAds(loadout, input, context, dt);
  advanceReload(loadout, weapon, input, context, dt);

  if (!input.fire) loadout.triggerLatched = false;

  return tryFire(loadout, weapon, input, context, random);
};

const advanceSwap = (loadout: LoadoutState, input: LoadoutInput, dt: number): void => {
  if (loadout.pendingIndex !== null) {
    loadout.swapTimer -= dt;
    if (loadout.swapTimer <= 0) {
      loadout.activeIndex = loadout.pendingIndex;
      loadout.pendingIndex = null;
      loadout.swapTimer = 0;
      loadout.triggerLatched = true;
    }
    return;
  }
  if (!input.swapPressed || loadout.weapons.length < 2) return;

  const next = (loadout.activeIndex + 1) % loadout.weapons.length;
  loadout.pendingIndex = next;
  loadout.swapTimer = loadout.weapons[next].definition.swapTime;
  // Putting a weapon away abandons its reload and drops the sights.
  const current = activeWeapon(loadout);
  current.reloading = false;
  current.reloadTimer = 0;
  loadout.adsProgress = 0;
};

const advanceAds = (
  loadout: LoadoutState,
  input: LoadoutInput,
  context: LoadoutContext,
  dt: number,
): void => {
  const weapon = activeWeapon(loadout);
  const allowed = input.aim && context.sprintOutTimer <= 0 && !isSwapping(loadout);
  const rate = dt / Math.max(1e-4, weapon.definition.adsTime);
  loadout.adsProgress = clamp(moveToward(loadout.adsProgress, allowed ? 1 : 0, rate), 0, 1);
};

const advanceReload = (
  loadout: LoadoutState,
  weapon: WeaponRuntime,
  input: LoadoutInput,
  context: LoadoutContext,
  dt: number,
): void => {
  const definition = weapon.definition;

  if (weapon.reloading) {
    weapon.reloadTimer -= dt;
    if (weapon.reloadTimer > 0) return;

    if (definition.shellReload) {
      // One shell per cycle, repeating until the tube is full or the
      // player fires, which cancels the rest.
      const inserted = Math.min(1, weapon.reserve);
      weapon.magazine += inserted;
      weapon.reserve -= inserted;
      if (needsReload(weapon) && weapon.magazine < definition.magazineSize) {
        weapon.reloadTimer = definition.reloadTime;
      } else {
        weapon.reloading = false;
        weapon.reloadTimer = 0;
      }
    } else {
      const wanted = definition.magazineSize - weapon.magazine;
      const taken = Math.min(wanted, weapon.reserve);
      weapon.magazine += taken;
      weapon.reserve -= taken;
      weapon.reloading = false;
      weapon.reloadTimer = 0;
    }
    return;
  }

  if (isSwapping(loadout) || context.sprintOutTimer > 0) return;

  // Reload on request, or automatically when a dry trigger is pulled.
  const dryFire = input.fire && weapon.magazine === 0;
  if ((input.reloadPressed || dryFire) && needsReload(weapon)) {
    weapon.reloading = true;
    weapon.reloadTimer = definition.reloadTime;
  }
};

const tryFire = (
  loadout: LoadoutState,
  weapon: WeaponRuntime,
  input: LoadoutInput,
  context: LoadoutContext,
  random: Random,
): ShotEvent | null => {
  if (!input.fire || loadout.triggerLatched) return null;
  if (!canFire(loadout, context)) return null;

  const definition = weapon.definition;
  // Firing a pump-action mid-reload cancels the remaining shells.
  if (weapon.reloading) {
    weapon.reloading = false;
    weapon.reloadTimer = 0;
  }

  const shooter: ShooterContext = {
    speed: context.speed,
    grounded: context.grounded,
    crouchAmount: context.crouchAmount,
    adsProgress: loadout.adsProgress,
  };
  const spreadDegrees = currentSpread(definition.spread, weapon.bloom, shooter);
  const pellets = samplePellets(definition, spreadDegrees, random);

  const aimYaw = context.yaw + loadout.recoilYaw;
  const aimPitch = context.pitch + loadout.recoilPitch;

  /*
   * The kick splits in two, and the halves are sized independently.
   *
   * The spring throws the camera by `punch` times the pattern entry and
   * recovers within a few shots: that is what one round looks like, and it
   * has to be big enough to see. The climb is a fraction of the same entry
   * and never recovers: that is what a magazine adds up to, and it has to
   * stay small enough that thirty of them do not point the player at the sky.
   * Deriving one from the other would force a single compromise that is
   * either invisible per shot or absurd per magazine.
   */
  const kick = recoilForShot(definition.recoil, weapon.shotIndex, loadout.adsProgress);
  const climbShare = clamp(definition.recoil.climb, 0, 1);
  const punch = Math.max(0, definition.recoil.punch);
  const climbPitch = kick.pitch * climbShare;
  const climbYaw = kick.yaw * climbShare;
  loadout.recoilPitch += kick.pitch * punch;
  loadout.recoilYaw += kick.yaw * punch;

  weapon.magazine -= 1;
  weapon.fireCooldown = secondsPerShot(definition);
  weapon.bloom = addBloom(weapon.bloom, definition.spread);
  weapon.shotIndex += 1;
  weapon.sinceLastShot = 0;
  if (definition.mode !== "auto") loadout.triggerLatched = true;

  return { weapon: definition, pellets, spreadDegrees, aimYaw, aimPitch, climbPitch, climbYaw };
};
