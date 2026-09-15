/**
 * Where recoil puts the weapon in the player's hands.
 *
 * Separated from the viewmodel, and free of any engine import, because the
 * rule it has to obey is not a rendering detail: recoil degrades a player's
 * aim, and must never degrade their vision. The moment the weapon covers what
 * they are shooting at, they cannot see whether they are hitting, cannot learn
 * the pattern, and cannot correct mid-burst — the feedback loop that made
 * recoil a skill in the first place is gone, and what is left is obstruction.
 *
 * Keeping the maths here means that rule can be asserted rather than trusted.
 */

const DEG_TO_RAD = Math.PI / 180;

export const RECOIL = {
  /**
   * Metres the weapon travels back per unit of kick.
   *
   * Most of a shot's punch lives here rather than in rotation. Backward travel
   * reads as force — the weapon pistons into the shoulder — and it moves the
   * weapon away from the crosshair rather than toward it, so it is the one
   * axis that can be spent freely.
   */
  back: 0.075,
  /** Metres the weapon rises when firing from the hip. */
  up: 0.014,
  /**
   * Metres of rise while fully aimed: none.
   *
   * Lifting the weapon bodily is the single most obstructive thing recoil can
   * do down the sights — on a sidearm the whole clearance is seven
   * millimetres, which a rise of the same size erases outright, whatever the
   * rotation is doing. Aimed, the weapon travels back and rolls instead.
   */
  aimedUpScale: 0,
  /** Degrees of muzzle rise per unit of kick, firing from the hip. */
  hipPitchDegrees: 6.5,
  /**
   * Degrees of muzzle rise per unit of kick while fully aimed.
   *
   * A fraction of the hip figure, because down the sights the weapon is
   * centred on the screen with two or three degrees of clearance and nowhere
   * to swing into. This is the one pose where the weapon has to hold still and
   * let the world move behind it.
   */
  aimedPitchDegrees: 0.8,
  /**
   * The most of its clearance a weapon may spend on muzzle rise while aimed.
   *
   * The figure above is a wish; this is the promise. Each weapon's clearance
   * is measured from its own shape, and the rise is capped at this share of
   * it, so a long-barrelled weapon with little room to give simply kicks less
   * rather than blotting out the target. The rest of the clearance is left for
   * sway and bob, which are moving at the same time.
   */
  aimedHeadroomShare: 0.45,
  /** Random roll per shot, so a burst does not look stamped. */
  roll: 0.5,
  /** Roll is also cut when aimed: a rolling sight picture is an unusable one. */
  aimedRollScale: 0.2,
  /** Fraction of the kick left after one second. */
  recovery: 0.000002,
  /**
   * Ceiling on accumulated kick.
   *
   * Every guarantee here is stated at this number, so nothing the fire rate or
   * the weapon list does later can push the weapon past what was checked.
   */
  maxAccumulated: 2.4,
} as const;

export interface RecoilPose {
  /** Metres toward the player. */
  back: number;
  /** Metres upward. */
  up: number;
  /** Radians of muzzle rise. */
  pitch: number;
  /** Multiplier on this shot's random roll. */
  rollScale: number;
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * The offset a given amount of accumulated kick applies to the weapon.
 *
 * `amount` is the viewmodel's kick accumulator and `ads` is aim progress, from
 * 0 at the hip to 1 fully down the sights. `headroomDegrees` is how far this
 * weapon's muzzle can rise from this pose before its body reaches the
 * crosshair, measured from the model in weaponGeometry; leaving it out removes
 * the cap, which is only right where there is no weapon to cover anything.
 */
export const recoilPose = (
  amount: number,
  ads: number,
  headroomDegrees = Number.POSITIVE_INFINITY,
): RecoilPose => {
  const aim = Math.min(1, Math.max(0, ads));
  const kick = Math.min(RECOIL.maxAccumulated, Math.max(0, amount));

  // What the tuning asks for, and what the weapon can actually afford.
  //
  // The ceiling is a share of the clearance this weapon has in this pose, and
  // it scales with the kick so a single round still moves less than a burst
  // rather than everything slamming into the cap at once. Off the sights the
  // clearance is unbounded, so the wish is simply granted.
  const wish = lerp(RECOIL.hipPitchDegrees, RECOIL.aimedPitchDegrees, aim) * kick;
  // Unbounded clearance is its own case rather than a large number: from the
  // hip the headroom is genuinely infinite, and infinity times a kick of zero
  // is not zero, it is NaN — which propagates into the weapon's rotation and
  // takes the whole viewmodel off the screen.
  const ceiling = Number.isFinite(headroomDegrees)
    ? headroomDegrees * RECOIL.aimedHeadroomShare * (kick / RECOIL.maxAccumulated)
    : Number.POSITIVE_INFINITY;

  return {
    back: kick * RECOIL.back,
    // Rising is what eats the clearance, so aiming takes it away entirely.
    up: kick * RECOIL.up * lerp(1, RECOIL.aimedUpScale, aim),
    pitch: Math.min(wish, ceiling) * DEG_TO_RAD,
    rollScale: lerp(1, RECOIL.aimedRollScale, aim),
  };
};
