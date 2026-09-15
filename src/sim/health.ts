export interface HealthConfig {
  max: number;
  /** Seconds after taking damage before regeneration starts. */
  regenDelay: number;
  /** Health per second once regeneration starts. */
  regenRate: number;
  /** Seconds of immunity after arriving in the world. */
  spawnProtection: number;
}

export const HEALTH: HealthConfig = {
  max: 100,
  regenDelay: 5,
  regenRate: 12,
  spawnProtection: 3,
};

export interface HealthState {
  current: number;
  /** Counts down to zero, then regeneration begins. */
  regenTimer: number;
  /** Seconds since the last damage, for the screen effect. */
  sinceDamage: number;
  dead: boolean;
  /**
   * World bearing from here toward whatever last did the damage, in radians,
   * or null. Turning this into a screen direction needs the victim's own yaw
   * subtracted, so the arrow keeps pointing at the attacker as they turn.
   */
  lastDamageBearing: number | null;
  /**
   * Seconds of immunity left after spawning.
   *
   * It exists because a respawn puts someone back into a world that did not
   * pause while they were gone, at a fixed point an opponent may already be
   * watching. Without it the player who died is the player who keeps dying,
   * and the fight is decided by who happened to be looking at the spawn.
   */
  spawnProtectionTimer: number;
}

export const createHealth = (config: HealthConfig = HEALTH): HealthState => ({
  current: config.max,
  regenTimer: 0,
  sinceDamage: Infinity,
  dead: false,
  lastDamageBearing: null,
  // Zero, because constructing a health state is not the same act as arriving
  // in the world. `revive` is the spawn, and the spawn is what grants the
  // window; starting every state immune would quietly make anything holding
  // one — a practice target, a bot, a test — briefly unkillable.
  spawnProtectionTimer: 0,
});

/** Apply damage. Returns true when this hit was lethal. */
export const applyDamage = (
  state: HealthState,
  amount: number,
  fromBearing: number | null = null,
  config: HealthConfig = HEALTH,
): boolean => {
  if (state.dead || amount <= 0) return false;
  // Protected players take nothing at all, rather than reduced damage: a
  // window that only slows the kill still hands the fight to whoever was
  // already aiming at the spawn point.
  if (state.spawnProtectionTimer > 0) return false;
  state.current = Math.max(0, state.current - amount);
  state.regenTimer = config.regenDelay;
  state.sinceDamage = 0;
  state.lastDamageBearing = fromBearing;
  if (state.current <= 0) {
    state.dead = true;
    return true;
  }
  return false;
};

export const stepHealth = (
  state: HealthState,
  dt: number,
  config: HealthConfig = HEALTH,
): HealthState => {
  state.sinceDamage += dt;
  state.spawnProtectionTimer = Math.max(0, state.spawnProtectionTimer - dt);
  if (state.dead) return state;
  if (state.regenTimer > 0) {
    state.regenTimer = Math.max(0, state.regenTimer - dt);
    return state;
  }
  // Regeneration is slow by design: it rewards breaking contact, not trading.
  state.current = Math.min(config.max, state.current + config.regenRate * dt);
  return state;
};

export const revive = (state: HealthState, config: HealthConfig = HEALTH): void => {
  state.current = config.max;
  state.regenTimer = 0;
  state.sinceDamage = Infinity;
  state.dead = false;
  state.lastDamageBearing = null;
  state.spawnProtectionTimer = config.spawnProtection;
};

/**
 * Bots do not get a spawn window.
 *
 * It exists to stop a person being farmed at a fixed point by another person.
 * Bots respawn constantly and are most of what anyone shoots at, so giving
 * them the same window means firing at one and watching nothing happen, with
 * no hit marker and nothing on screen to explain it. The asymmetry is between
 * a fairness rule and a filler opponent, not between two players.
 */
export const BOT_HEALTH: HealthConfig = { ...HEALTH, spawnProtection: 0 };

/** Arrive in the world protected. Separate from `revive` so bots can decline. */
export const grantSpawnProtection = (
  state: HealthState,
  config: HealthConfig = HEALTH,
): void => {
  state.spawnProtectionTimer = config.spawnProtection;
};

/**
 * Give up the remaining protection.
 *
 * Firing ends it, because immunity that lets someone shoot is worse than no
 * immunity at all: it turns the safest moment in the round into the best time
 * to attack, which is the opposite of what it is for. Protection is for
 * getting out of the spawn, not for winning from inside it.
 */
export const endSpawnProtection = (state: HealthState): void => {
  state.spawnProtectionTimer = 0;
};

export const isSpawnProtected = (state: HealthState): boolean =>
  !state.dead && state.spawnProtectionTimer > 0;
