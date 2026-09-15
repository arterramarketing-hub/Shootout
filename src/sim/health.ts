export interface HealthConfig {
  max: number;
  /** Seconds after taking damage before regeneration starts. */
  regenDelay: number;
  /** Health per second once regeneration starts. */
  regenRate: number;
}

export const HEALTH: HealthConfig = {
  max: 100,
  regenDelay: 5,
  regenRate: 12,
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
}

export const createHealth = (config: HealthConfig = HEALTH): HealthState => ({
  current: config.max,
  regenTimer: 0,
  sinceDamage: Infinity,
  dead: false,
  lastDamageBearing: null,
});

/** Apply damage. Returns true when this hit was lethal. */
export const applyDamage = (
  state: HealthState,
  amount: number,
  fromBearing: number | null = null,
  config: HealthConfig = HEALTH,
): boolean => {
  if (state.dead || amount <= 0) return false;
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
};
