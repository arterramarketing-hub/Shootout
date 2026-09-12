import { clamp, damp } from "./vec3";

export const TARGET = {
  health: 100,
  /** Seconds a knocked-down plate stays down. */
  resetDelay: 3.0,
  /** Seconds for the plate to swing down or back up. */
  knockdownTime: 0.22,
  resetTime: 0.45,
  /** Seconds the hit flash stays lit. */
  flashTime: 0.14,
} as const;

export interface TargetState {
  id: string;
  health: number;
  down: boolean;
  /** 0 upright, 1 flat. */
  knockdown: number;
  /** Seconds until the plate stands back up. */
  resetTimer: number;
  /** Fades from 1 to 0 after a hit, driving the flash. */
  flash: number;
  /** True on the step the plate went down, for sound and scoring. */
  justDropped: boolean;
  /** True when the killing hit was a headshot. */
  lastHitHeadshot: boolean;
}

export const createTarget = (id: string): TargetState => ({
  id,
  health: TARGET.health,
  down: false,
  knockdown: 0,
  resetTimer: 0,
  flash: 0,
  justDropped: false,
  lastHitHeadshot: false,
});

/** Apply damage to a plate. Returns true when this hit knocked it down. */
export const damageTarget = (
  target: TargetState,
  amount: number,
  headshot: boolean,
): boolean => {
  if (target.down || amount <= 0) return false;
  target.health -= amount;
  target.flash = 1;
  target.lastHitHeadshot = headshot;
  if (target.health > 0) return false;
  target.health = 0;
  target.down = true;
  target.justDropped = true;
  target.resetTimer = TARGET.resetDelay;
  return true;
};

export const stepTarget = (target: TargetState, dt: number): TargetState => {
  target.justDropped = false;
  target.flash = Math.max(0, target.flash - dt / TARGET.flashTime);

  if (target.down) {
    // Drop fast, then wait; a plate that falls slowly reads as a miss.
    target.knockdown = clamp(target.knockdown + dt / TARGET.knockdownTime, 0, 1);
    target.resetTimer -= dt;
    if (target.resetTimer <= 0) {
      target.down = false;
      target.health = TARGET.health;
    }
    return target;
  }

  target.knockdown = clamp(target.knockdown - dt / TARGET.resetTime, 0, 1);
  return target;
};

export const stepTargets = (targets: TargetState[], dt: number): void => {
  for (const target of targets) stepTarget(target, dt);
};

/** Smoothed flash value for rendering, so the plate does not strobe. */
export const targetFlashColorWeight = (target: TargetState, previous: number, dt: number): number =>
  damp(previous, target.flash, 0.0001, dt);
