/**
 * A body going down, as a body and not as an animation.
 *
 * When a zombie dies it stops holding itself up, and what happens next is
 * mechanics: a rigid body standing on its feet, given a shove by the round
 * that killed it, falls under gravity. Where the round went in decides the
 * fall. A shot high on the body turns it about its feet and it topples away
 * from the shooter. A headshot does that harder and snaps the head back. A
 * shot low in the legs lands below the body's centre of mass, so it knocks
 * the feet out along the line of fire and the rest of the body goes over
 * the other way, back towards the shooter.
 *
 * The model is a rod in the vertical plane that contains the shot: a foot
 * on the ground with Coulomb friction under it, a centre of mass part way
 * up, and a moment of inertia about that centre. A standing rod is
 * unstable, so the shove only has to choose which way it goes; gravity
 * does the rest. The ground stops it when it lies flat, and a wall stops it
 * when the top of it reaches one, so a zombie shot against a wall slumps
 * against it rather than falling through it.
 *
 * Head and arms ride on damped springs driven by how fast the body is
 * turning, so they lag and flop rather than staying fixed to the torso.
 *
 * Engine-free and deterministic: the same shot makes the same fall.
 */

export const FALL = {
  /** Kilograms. Only ratios matter, but real numbers keep them honest. */
  mass: 70,
  /** Metres from the feet to the crown. */
  height: 1.75,
  /** Metres from the feet to the centre of mass. */
  centre: 0.95,
  /** Moment of inertia about the centre of mass, kg m². A rod of this length. */
  inertia: (70 * 1.75 * 1.75) / 12,
  gravity: 9.81,
  /**
   * Coulomb friction between the feet and the ground. Low: a body that has
   * stopped holding itself up does not plant its feet.
   */
  friction: 0.35,
  /**
   * The least spin a fall starts with, in radians a second. A dead body
   * does not balance, and without this a shove that happens to land near
   * the centre of mass leaves it standing upright for a second first.
   */
  minimumSpin: 1.2,
  /** How long the shove takes the weight off the feet, in seconds. */
  liftSeconds: 0.15,
  /**
   * The shove a killing round gives, in newton-seconds.
   *
   * Far more than a bullet carries. This is the game's idea of a hit being
   * felt, and it is sized so a body shot visibly throws the fall rather than
   * merely deciding its direction.
   */
  impulse: 55,
  /** Extra shove per point of damage past a rifle round, for the shotgun. */
  impulsePerDamage: 0.5,
  /** How far off vertical the body lies when flat: its own thickness. */
  lieAngle: Math.PI / 2 - 0.08,
  /** How much of the spin survives hitting the ground. */
  restitution: 0.18,
  /** Below this spin, in radians a second, a bounce is over. */
  restSpin: 0.35,
  /** Physics steps a second. The rod is stiff near vertical; small steps. */
  rate: 240,
  /** How close the crown comes to a wall before the wall holds it. */
  wallGap: 0.15,
  /** How long the legs take to give way, in seconds. */
  buckleSeconds: 0.35,
} as const;

export interface FallState {
  /** Unit horizontal direction the shot was travelling. */
  dirX: number;
  dirZ: number;
  /** Radians off vertical; positive leans along the shot. */
  angle: number;
  /** Radians a second. */
  spin: number;
  /** How far the feet have slid along the shot, in metres, and how fast. */
  slide: number;
  slideSpeed: number;
  /** Room along the shot and against it before a wall, in metres. */
  roomAhead: number;
  roomBehind: number;
  /** Height the round went in at, in metres from the feet. */
  hitHeight: number;
  headshot: boolean;
  /** Nought to one: how far the legs have given way. */
  buckle: number;
  /** How much faster the legs go, for a shot that took them out. */
  buckleRate: number;
  /** The head's lag behind the torso, in radians, and its rate. */
  head: number;
  headSpeed: number;
  /** The arms' fling, in radians, and its rate. */
  arms: number;
  armsSpeed: number;
  /** On the ground, or against a wall, and done moving. */
  settled: boolean;
  /** Has hit the ground at least once. */
  landed: boolean;
  /** Seconds of physics not yet stepped, so the step is fixed. */
  pending: number;
  /** Seconds since death, for the moment the feet are off the ground. */
  age: number;
}

export interface FallHit {
  /** Unit horizontal direction of the shot. Need not be normalised. */
  dirX: number;
  dirZ: number;
  /** Metres above the feet the round went in. */
  height: number;
  headshot: boolean;
  /** The damage the killing shot did, which scales the shove. */
  damage: number;
}

/** What one step of the fall did, for the sounds it makes. */
export interface FallStep {
  /** The body reached the ground (or a wall) this step. */
  landed: boolean;
  /** How hard, as the crown's speed in metres a second. */
  impact: number;
}

/**
 * The body at the instant of death, having just been shoved.
 *
 * The shove is an impulse at the hit height on a free rod: it gives the
 * centre of mass a velocity along the shot and the rod a spin about its
 * centre, positive above the centre of mass and negative below it. The feet
 * then move at whatever that pair of motions puts them at, and friction
 * takes over from there.
 */
export const createFall = (hit: FallHit): FallState => {
  let dirX = hit.dirX;
  let dirZ = hit.dirZ;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6) {
    dirX = 0;
    dirZ = 1;
  } else {
    dirX /= length;
    dirZ /= length;
  }
  const height = Math.max(0.05, Math.min(FALL.height, hit.height));
  // Capped: past a shotgun blast at arm's length, more damage is not more shove.
  const shove =
    FALL.impulse + Math.max(0, Math.min(hit.damage, 120) - 34) * FALL.impulsePerDamage;
  const lever = height - FALL.centre;
  const kick = (shove * lever) / FALL.inertia;
  const way = kick === 0 ? 1 : Math.sign(kick);
  const spin = way * Math.max(FALL.minimumSpin, Math.abs(kick));
  const centreSpeed = shove / FALL.mass;
  // The feet move with the centre, less what the spin carries them back by.
  const slideSpeed = centreSpeed - FALL.centre * kick;
  const legShot = height < 0.8;

  return {
    dirX,
    dirZ,
    angle: 0,
    spin,
    slide: 0,
    slideSpeed,
    roomAhead: Infinity,
    roomBehind: Infinity,
    hitHeight: height,
    headshot: hit.headshot,
    buckle: 0,
    buckleRate: legShot ? 2.2 : 1,
    // A headshot throws the head back hard before the body has moved.
    head: 0,
    headSpeed: hit.headshot ? 9 : 2.5 * Math.sign(spin || 1),
    arms: 0,
    armsSpeed: 3 + Math.abs(spin) * 0.8,
    settled: false,
    landed: false,
    pending: 0,
    age: 0,
  };
};

/** Angular acceleration of the rod, and the friction state that goes with it. */
const accelerate = (
  fall: FallState,
): { angular: number; slide: number } => {
  const m = FALL.mass;
  const c = FALL.centre;
  const g = FALL.gravity;
  // Under the shove the feet are unweighted for an instant, so friction
  // comes in over the first part of the fall rather than all at once.
  const mu = FALL.friction * Math.min(1, fall.age / FALL.liftSeconds);
  const sin = Math.sin(fall.angle);
  const cos = Math.cos(fall.angle);
  const spin2 = fall.spin * fall.spin;

  const sliding = Math.abs(fall.slideSpeed) > 1e-3;
  if (!sliding) {
    // Feet planted: a pendulum about the feet, upside down.
    const angular = (m * g * c * sin) / (FALL.inertia + m * c * c);
    const normal = m * (g - c * sin * angular - c * cos * spin2);
    const grip = m * (c * cos * angular - c * sin * spin2);
    if (normal > 0 && Math.abs(grip) <= mu * normal) return { angular, slide: 0 };
    // Friction cannot hold it: the feet go the way the grip was resisting.
    fall.slideSpeed = -Math.sign(grip) * 1e-3 * 1.01;
  }

  const direction = Math.sign(fall.slideSpeed);
  const lean = sin + mu * direction * cos;
  const denominator = FALL.inertia + m * c * c * sin * lean;
  if (denominator < FALL.inertia * 0.3) {
    // Near the one arrangement where sliding friction has no consistent
    // answer: plant the feet rather than divide by nothing.
    fall.slideSpeed = 0;
    return { angular: (m * g * c * sin) / (FALL.inertia + m * c * c), slide: 0 };
  }
  let angular = (m * c * lean * (g - c * cos * spin2)) / denominator;
  let normal = m * (g - c * sin * angular - c * cos * spin2);
  if (normal < 0) {
    // Momentarily unloaded: no friction, and nothing turning it.
    normal = 0;
    angular = 0;
  }
  const friction = -mu * normal * direction;
  const slide = friction / m - c * cos * angular + c * sin * spin2;
  return { angular, slide };
};

/** Spring a limb toward the torso, pushed by how the torso is turning. */
const spring = (
  value: number,
  speed: number,
  push: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number] => {
  const accel = -stiffness * value - damping * speed + push;
  const next = speed + accel * dt;
  return [value + next * dt, next];
};

/** One fixed physics step. */
const tick = (fall: FallState, dt: number): FallStep => {
  const result: FallStep = { landed: false, impact: 0 };
  fall.age += dt;
  fall.buckle = Math.min(1, fall.buckle + (dt / FALL.buckleSeconds) * fall.buckleRate);

  if (fall.settled) {
    [fall.head, fall.headSpeed] = spring(fall.head, fall.headSpeed, 0, 30, 6, dt);
    [fall.arms, fall.armsSpeed] = spring(fall.arms, fall.armsSpeed, 0, 20, 5, dt);
    return result;
  }

  const { angular, slide } = accelerate(fall);
  const before = fall.slideSpeed;
  fall.spin += angular * dt;
  fall.angle += fall.spin * dt;
  if (!fall.landed) {
    fall.slideSpeed += slide * dt;
    // Friction stops the feet; it never turns them round.
    if (before !== 0 && Math.sign(fall.slideSpeed) !== Math.sign(before)) fall.slideSpeed = 0;
  } else {
    // Lying on the ground, the whole body drags.
    fall.slideSpeed *= Math.exp(-9 * dt);
  }
  fall.slide += fall.slideSpeed * dt;
  // The feet do not go through a wall either.
  const footAhead = fall.roomAhead - 0.3;
  const footBehind = -(fall.roomBehind - 0.3);
  if (fall.slide > footAhead || fall.slide < footBehind) {
    fall.slide = Math.max(footBehind, Math.min(footAhead, fall.slide));
    fall.slideSpeed = 0;
  }

  // The limbs lag the torso: when it turns one way they are left behind.
  [fall.head, fall.headSpeed] = spring(fall.head, fall.headSpeed, -angular * 0.08, 40, 7, dt);
  [fall.arms, fall.armsSpeed] = spring(
    fall.arms,
    fall.armsSpeed,
    Math.abs(angular) * 0.12,
    18,
    4,
    dt,
  );

  // The ground.
  if (Math.abs(fall.angle) >= FALL.lieAngle) {
    const side = Math.sign(fall.angle);
    fall.angle = side * FALL.lieAngle;
    if (fall.spin * side > 0) {
      const impact = Math.abs(fall.spin) * FALL.height;
      if (!fall.landed || impact > 1) {
        result.landed = true;
        result.impact = impact;
      }
      fall.landed = true;
      fall.spin = -fall.spin * FALL.restitution;
      // The jolt goes into the limbs.
      fall.headSpeed += side * impact * 1.2;
      fall.armsSpeed += impact * 1.4;
      if (Math.abs(fall.spin) < FALL.restSpin) {
        fall.spin = 0;
        fall.settled = Math.abs(fall.slideSpeed) < 0.05;
      }
    }
  }

  // Walls. The crown reaches `slide + height * sin(angle)` along the shot.
  const reach = fall.slide + FALL.height * Math.sin(fall.angle);
  const limitAhead = fall.roomAhead - FALL.wallGap;
  const limitBehind = -(fall.roomBehind - FALL.wallGap);
  if (reach > limitAhead || reach < limitBehind) {
    const limit = reach > limitAhead ? limitAhead : limitBehind;
    const sin = Math.max(-1, Math.min(1, (limit - fall.slide) / FALL.height));
    fall.angle = Math.asin(sin);
    const impact = Math.abs(fall.spin) * FALL.height;
    if (!fall.landed) {
      result.landed = true;
      result.impact = impact;
    }
    fall.landed = true;
    fall.spin = 0;
    fall.slideSpeed = 0;
    fall.headSpeed += Math.sign(limit) * impact;
    fall.settled = true;
  }
  return result;
};

/**
 * Advance a fall by `dt` seconds, in fixed steps.
 *
 * Returns whether it hit the ground during this advance and how hard, so
 * the caller can make the thump.
 */
export const stepFall = (fall: FallState, dt: number): FallStep => {
  const out: FallStep = { landed: false, impact: 0 };
  fall.pending += dt;
  const step = 1 / FALL.rate;
  // Bounded, so a long stall cannot turn into a long catch-up.
  let budget = Math.ceil(0.25 * FALL.rate);
  while (fall.pending >= step && budget > 0) {
    fall.pending -= step;
    budget -= 1;
    const result = tick(fall, step);
    if (result.landed) {
      out.landed = true;
      out.impact = Math.max(out.impact, result.impact);
    }
  }
  if (budget === 0) fall.pending = 0;
  return out;
};

/**
 * Where the feet are and how the body is turned, as a 3x3 rotation.
 *
 * Rows are where the world's x, y and z axes go, the convention the view's
 * engine uses, so it can be handed over as it is. The rotation leans the
 * vertical over by `angle` towards the shot direction and leaves the axis
 * across the shot alone.
 */
export const fallTilt = (fall: FallState): number[] => {
  const s = Math.sin(fall.angle);
  const c = Math.cos(fall.angle);
  const d = [fall.dirX, 0, fall.dirZ];
  // Up goes to c*up + s*d; d goes to c*d - s*up; the axis across is fixed.
  const image = (v: number[]): number[] => {
    const along = v[0] * d[0] + v[2] * d[2];
    const up = v[1];
    const acrossX = v[0] - along * d[0];
    const acrossZ = v[2] - along * d[2];
    return [
      acrossX + along * c * d[0] + up * s * d[0],
      -along * s + up * c,
      acrossZ + along * c * d[2] + up * s * d[2],
    ];
  };
  return [...image([1, 0, 0]), ...image([0, 1, 0]), ...image([0, 0, 1])];
};
